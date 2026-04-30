"""
Tests for TenantRepository (base.py).

Concrete subclass used: TenantRepo(TenantRepository[Tenant]) — defined in this file.

Coverage:
  - create: persists entity and returns it with an assigned ID
  - get_by_id: returns entity when found
  - get_by_id: returns None for wrong tenant_id (tenant isolation)
  - get_by_id: returns None for soft-deleted entity
  - list_all: returns only active entities for the given tenant
  - list_all: respects limit and offset
  - soft_delete: sets is_active=False, deleted_at, deleted_by_id
  - soft_delete: entity no longer appears in list_all
"""
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.branch import Branch
from rest_api.models.tenant import Tenant
from rest_api.repositories.base import TenantRepository


# ── Concrete repo for Tenant ───────────────────────────────────────────────────


class TenantRepo(TenantRepository[Tenant]):
    model = Tenant


# ── Helpers ────────────────────────────────────────────────────────────────────


async def _create_tenant(db: AsyncSession, name: str = "Test Tenant") -> Tenant:
    """Helper: add a Tenant directly and flush so it has an ID."""
    tenant = Tenant(name=name)
    db.add(tenant)
    await db.flush()
    await db.refresh(tenant)
    return tenant


# NOTE: TenantRepository expects models with tenant_id. Tenant itself doesn't
# have tenant_id — we use Branch (which belongs to Tenant) for the repo tests
# that exercise the tenant-scoped query interface.
#
# To keep things self-contained we create a BranchRepository subclass here and
# run all meaningful TenantRepository contract tests against Branch, which has
# tenant_id, is_active, and all AuditMixin fields.


class BranchRepo(TenantRepository[Branch]):
    model = Branch


async def _make_branch(
    db: AsyncSession,
    tenant_id: int,
    slug: str = "main",
    name: str = "Sucursal",
) -> Branch:
    repo = BranchRepo(db)
    branch = Branch(
        tenant_id=tenant_id,
        name=name,
        address="Av. Test 123",
        slug=slug,
    )
    return await repo.create(branch)


# ── create ─────────────────────────────────────────────────────────────────────


async def test_repository_create_persists_and_returns_entity(
    db: AsyncSession,
) -> None:
    # Arrange
    tenant = await _create_tenant(db)

    # Act
    branch = await _make_branch(db, tenant_id=tenant.id, slug="created")

    # Assert
    assert branch.id is not None
    assert branch.tenant_id == tenant.id
    assert branch.slug == "created"


async def test_repository_create_assigns_autoincrement_id(db: AsyncSession) -> None:
    tenant = await _create_tenant(db)

    branch1 = await _make_branch(db, tenant_id=tenant.id, slug="s1")
    branch2 = await _make_branch(db, tenant_id=tenant.id, slug="s2")

    assert branch1.id != branch2.id


# ── get_by_id ──────────────────────────────────────────────────────────────────


async def test_repository_get_by_id_returns_entity_when_found(
    db: AsyncSession,
) -> None:
    # Arrange
    tenant = await _create_tenant(db)
    branch = await _make_branch(db, tenant_id=tenant.id)
    repo = BranchRepo(db)

    # Act
    found = await repo.get_by_id(branch.id, tenant.id)

    # Assert
    assert found is not None
    assert found.id == branch.id


async def test_repository_get_by_id_returns_none_for_wrong_tenant_id(
    db: AsyncSession,
) -> None:
    """Tenant isolation: entity from tenant A is invisible to tenant B."""
    # Arrange
    tenant_a = await _create_tenant(db, name="Tenant A")
    tenant_b = await _create_tenant(db, name="Tenant B")
    branch = await _make_branch(db, tenant_id=tenant_a.id)
    repo = BranchRepo(db)

    # Act
    found = await repo.get_by_id(branch.id, tenant_b.id)

    # Assert
    assert found is None


async def test_repository_get_by_id_returns_none_for_soft_deleted_entity(
    db: AsyncSession,
) -> None:
    # Arrange
    tenant = await _create_tenant(db)
    branch = await _make_branch(db, tenant_id=tenant.id)
    repo = BranchRepo(db)

    await repo.soft_delete(branch, user_id=1)

    # Act
    found = await repo.get_by_id(branch.id, tenant.id)

    # Assert
    assert found is None


async def test_repository_get_by_id_returns_none_for_nonexistent_id(
    db: AsyncSession,
) -> None:
    tenant = await _create_tenant(db)
    repo = BranchRepo(db)

    found = await repo.get_by_id(999_999, tenant.id)

    assert found is None


# ── list_all ───────────────────────────────────────────────────────────────────


async def test_repository_list_all_returns_only_active_entities_for_tenant(
    db: AsyncSession,
) -> None:
    # Arrange
    tenant = await _create_tenant(db)
    b1 = await _make_branch(db, tenant_id=tenant.id, slug="active-1")
    b2 = await _make_branch(db, tenant_id=tenant.id, slug="active-2")
    soft_deleted = await _make_branch(db, tenant_id=tenant.id, slug="deleted")
    repo = BranchRepo(db)
    await repo.soft_delete(soft_deleted, user_id=1)

    # Act
    results = await repo.list_all(tenant.id)

    # Assert
    ids = [r.id for r in results]
    assert b1.id in ids
    assert b2.id in ids
    assert soft_deleted.id not in ids


async def test_repository_list_all_excludes_other_tenant_entities(
    db: AsyncSession,
) -> None:
    tenant_a = await _create_tenant(db, name="A")
    tenant_b = await _create_tenant(db, name="B")
    branch_a = await _make_branch(db, tenant_id=tenant_a.id)
    await _make_branch(db, tenant_id=tenant_b.id, slug="other")
    repo = BranchRepo(db)

    results = await repo.list_all(tenant_a.id)

    ids = [r.id for r in results]
    assert branch_a.id in ids
    assert all(r.tenant_id == tenant_a.id for r in results)


async def test_repository_list_all_respects_limit(db: AsyncSession) -> None:
    tenant = await _create_tenant(db)
    for i in range(5):
        await _make_branch(db, tenant_id=tenant.id, slug=f"b{i}")
    repo = BranchRepo(db)

    results = await repo.list_all(tenant.id, limit=3)

    assert len(results) == 3


async def test_repository_list_all_respects_offset(db: AsyncSession) -> None:
    tenant = await _create_tenant(db)
    branches = []
    for i in range(4):
        b = await _make_branch(db, tenant_id=tenant.id, slug=f"off{i}")
        branches.append(b)
    repo = BranchRepo(db)

    # First page
    page1 = await repo.list_all(tenant.id, limit=2, offset=0)
    # Second page
    page2 = await repo.list_all(tenant.id, limit=2, offset=2)

    assert len(page1) == 2
    assert len(page2) == 2
    # No overlap
    ids_p1 = {r.id for r in page1}
    ids_p2 = {r.id for r in page2}
    assert ids_p1.isdisjoint(ids_p2)


# ── soft_delete ────────────────────────────────────────────────────────────────


async def test_repository_soft_delete_sets_is_active_false(
    db: AsyncSession,
) -> None:
    # Arrange
    tenant = await _create_tenant(db)
    branch = await _make_branch(db, tenant_id=tenant.id)
    repo = BranchRepo(db)

    # Act
    await repo.soft_delete(branch, user_id=42)

    # Assert
    assert branch.is_active is False


async def test_repository_soft_delete_sets_deleted_at(db: AsyncSession) -> None:
    tenant = await _create_tenant(db)
    branch = await _make_branch(db, tenant_id=tenant.id)
    repo = BranchRepo(db)

    before = datetime.now(UTC)
    await repo.soft_delete(branch, user_id=7)

    assert branch.deleted_at is not None
    assert branch.deleted_at >= before


async def test_repository_soft_delete_sets_deleted_by_id(db: AsyncSession) -> None:
    tenant = await _create_tenant(db)
    branch = await _make_branch(db, tenant_id=tenant.id)
    repo = BranchRepo(db)

    await repo.soft_delete(branch, user_id=99)

    assert branch.deleted_by_id == 99


async def test_repository_soft_delete_entity_not_in_list_all(
    db: AsyncSession,
) -> None:
    # Arrange
    tenant = await _create_tenant(db)
    branch = await _make_branch(db, tenant_id=tenant.id)
    repo = BranchRepo(db)

    # Act
    await repo.soft_delete(branch, user_id=1)
    results = await repo.list_all(tenant.id)

    # Assert
    assert branch.id not in [r.id for r in results]
