"""
Tests for BaseCRUDService (services/base.py).

A concrete TenantService is defined in this file as a test double — it operates
on Tenant entities via a TenantRepository subclass.

Coverage:
  - get_by_id: raises NotFoundError with correct resource name and identifier
  - create: calls _validate_create and _after_create in order; returns entity
  - delete: soft-deletes the entity and calls _after_delete
  - Template Method hooks are called (verified via a spy subclass)

Notes:
  - BaseCRUDService.create() delegates to repo.create(data) where data is a
    plain dict. The concrete TestTenantService overrides create() to build the
    model first, matching the intended subclass contract.
  - Branch is used for delete tests because Tenant has no tenant_id (the repo
    expects it), so we test delete via a BranchService subclass.
"""
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.branch import Branch
from rest_api.models.tenant import Tenant
from rest_api.repositories.base import TenantRepository
from rest_api.services.base import BaseCRUDService
from shared.infrastructure.db import safe_commit
from shared.utils.exceptions import NotFoundError


# ── Concrete repos ─────────────────────────────────────────────────────────────


class _TenantRepo(TenantRepository[Tenant]):
    model = Tenant


class _BranchRepo(TenantRepository[Branch]):
    model = Branch


# ── Concrete services ──────────────────────────────────────────────────────────


class TestTenantService(BaseCRUDService[Tenant, Tenant]):
    """
    Minimal concrete service for Tenant.

    Overrides create() to build the Tenant from a dict before persisting,
    because Tenant itself has no tenant_id column (it IS the tenant root).
    """

    def _get_repository(self) -> _TenantRepo:
        return _TenantRepo(self.db)

    async def create(self, data: dict[str, Any], tenant_id: int) -> Tenant:  # type: ignore[override]
        await self._validate_create(data, tenant_id)
        tenant = Tenant(**data)
        repo = self._get_repository()
        entity = await repo.create(tenant)
        await self._after_create(entity)
        await safe_commit(self.db)
        return entity


class TestBranchService(BaseCRUDService[Branch, Branch]):
    """Concrete service for Branch — used to test delete and get_by_id isolation."""

    def _get_repository(self) -> _BranchRepo:
        return _BranchRepo(self.db)

    async def create(self, data: dict[str, Any], tenant_id: int) -> Branch:  # type: ignore[override]
        await self._validate_create(data, tenant_id)
        branch = Branch(**data)
        repo = self._get_repository()
        entity = await repo.create(branch)
        await self._after_create(entity)
        await safe_commit(self.db)
        return entity


# ── Spy subclass to verify hook call order ─────────────────────────────────────


class SpyTenantService(TestTenantService):
    """Records which hooks were called and in which order."""

    def __init__(self, db: AsyncSession) -> None:
        super().__init__(db)
        self.calls: list[str] = []

    async def _validate_create(self, data: dict[str, Any], tenant_id: int) -> None:
        self.calls.append("_validate_create")

    async def _after_create(self, entity: Tenant) -> None:
        self.calls.append("_after_create")

    async def _after_delete(self, entity: Tenant) -> None:
        self.calls.append("_after_delete")


class SpyBranchService(TestBranchService):
    """Records which hooks were called for Branch operations."""

    def __init__(self, db: AsyncSession) -> None:
        super().__init__(db)
        self.calls: list[str] = []

    async def _validate_create(self, data: dict[str, Any], tenant_id: int) -> None:
        self.calls.append("_validate_create")

    async def _after_create(self, entity: Branch) -> None:
        self.calls.append("_after_create")

    async def _after_delete(self, entity: Branch) -> None:
        self.calls.append("_after_delete")


# ── Helpers ────────────────────────────────────────────────────────────────────


async def _seed_tenant(db: AsyncSession, name: str = "Service Tenant") -> Tenant:
    tenant = Tenant(name=name)
    db.add(tenant)
    await db.flush()
    await db.refresh(tenant)
    return tenant


async def _seed_branch(
    db: AsyncSession,
    tenant_id: int,
    slug: str = "svc",
) -> Branch:
    branch = Branch(
        tenant_id=tenant_id,
        name="Svc Branch",
        address="Calle 1",
        slug=slug,
    )
    db.add(branch)
    await db.flush()
    await db.refresh(branch)
    return branch


# ── get_by_id ──────────────────────────────────────────────────────────────────


async def test_service_get_by_id_raises_not_found_error_for_missing_id(
    db: AsyncSession,
) -> None:
    # Arrange
    tenant = await _seed_tenant(db)
    svc = TestBranchService(db)

    # Act / Assert
    with pytest.raises(NotFoundError) as exc_info:
        await svc.get_by_id(entity_id=999_999, tenant_id=tenant.id)

    err = exc_info.value
    assert err.identifier == 999_999
    # Resource name is derived from the class name: "TestBranch"
    assert "TestBranch" in err.resource or "Branch" in err.resource


async def test_service_get_by_id_raises_not_found_error_with_identifier_in_message(
    db: AsyncSession,
) -> None:
    tenant = await _seed_tenant(db)
    svc = TestBranchService(db)

    with pytest.raises(NotFoundError) as exc_info:
        await svc.get_by_id(entity_id=42, tenant_id=tenant.id)

    assert "42" in exc_info.value.message


async def test_service_get_by_id_returns_entity_when_exists(
    db: AsyncSession,
) -> None:
    tenant = await _seed_tenant(db)
    branch = await _seed_branch(db, tenant_id=tenant.id)
    svc = TestBranchService(db)

    result = await svc.get_by_id(entity_id=branch.id, tenant_id=tenant.id)

    assert result.id == branch.id


# ── create hooks ───────────────────────────────────────────────────────────────


async def test_service_create_calls_validate_before_after_create(
    db: AsyncSession,
) -> None:
    """_validate_create must be called before _after_create."""
    spy = SpyTenantService(db)

    await spy.create({"name": "Hook Order Test"}, tenant_id=0)

    assert spy.calls == ["_validate_create", "_after_create"]


async def test_service_create_returns_persisted_entity(db: AsyncSession) -> None:
    svc = TestTenantService(db)

    tenant = await svc.create({"name": "Persisted Tenant"}, tenant_id=0)

    assert tenant.id is not None
    assert tenant.name == "Persisted Tenant"


async def test_service_create_validation_hook_is_called(db: AsyncSession) -> None:
    spy = SpyTenantService(db)

    await spy.create({"name": "Validate Me"}, tenant_id=0)

    assert "_validate_create" in spy.calls


async def test_service_create_after_create_hook_is_called(db: AsyncSession) -> None:
    spy = SpyTenantService(db)

    await spy.create({"name": "After Create"}, tenant_id=0)

    assert "_after_create" in spy.calls


# ── delete ─────────────────────────────────────────────────────────────────────


async def test_service_delete_soft_deletes_entity(db: AsyncSession) -> None:
    # Arrange
    tenant = await _seed_tenant(db)
    branch = await _seed_branch(db, tenant_id=tenant.id, slug="to-delete")
    svc = TestBranchService(db)

    # Act
    await svc.delete(
        entity_id=branch.id,
        tenant_id=tenant.id,
        user_id=1,
        user_email="admin@test.com",
    )

    # Assert — entity is no longer retrievable
    repo = _BranchRepo(db)
    found = await repo.get_by_id(branch.id, tenant.id)
    assert found is None


async def test_service_delete_calls_after_delete_hook(db: AsyncSession) -> None:
    tenant = await _seed_tenant(db)
    branch = await _seed_branch(db, tenant_id=tenant.id, slug="hook-delete")
    spy = SpyBranchService(db)

    await spy.delete(
        entity_id=branch.id,
        tenant_id=tenant.id,
        user_id=1,
        user_email="x@x.com",
    )

    assert "_after_delete" in spy.calls


async def test_service_delete_raises_not_found_for_nonexistent_entity(
    db: AsyncSession,
) -> None:
    tenant = await _seed_tenant(db)
    svc = TestBranchService(db)

    with pytest.raises(NotFoundError):
        await svc.delete(
            entity_id=999_999,
            tenant_id=tenant.id,
            user_id=1,
            user_email="x@x.com",
        )


async def test_service_delete_raises_not_found_for_wrong_tenant(
    db: AsyncSession,
) -> None:
    """Tenant isolation: cannot delete another tenant's entity."""
    tenant_a = await _seed_tenant(db, name="A")
    tenant_b = await _seed_tenant(db, name="B")
    branch = await _seed_branch(db, tenant_id=tenant_a.id)
    svc = TestBranchService(db)

    with pytest.raises(NotFoundError):
        await svc.delete(
            entity_id=branch.id,
            tenant_id=tenant_b.id,
            user_id=1,
            user_email="x@x.com",
        )
