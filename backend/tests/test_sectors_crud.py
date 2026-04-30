"""
Tests for SectorService — branch sector CRUD and multi-tenant isolation.

Coverage:
  9.1 - BranchSector CRUD (create, read, update, soft-delete + cascade to tables)
  9.4 - Multi-tenant isolation (tenant A cannot access tenant B sectors/tables)
  9.5 - RBAC (ADMIN can do all; MANAGER can create/edit but not delete;
               KITCHEN/WAITER get 403 on admin endpoints)

Architecture notes:
  - Services tested directly (unit tests with in-memory SQLite via conftest fixtures)
  - Router RBAC tests use TestClient with overridden current_user dependency
  - SQLite is patched for BigInteger → Integer in conftest._patch_bigint_for_sqlite
"""
from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.branch import Branch
from rest_api.models.sector import BranchSector, Table
from rest_api.models.tenant import Tenant
from rest_api.schemas.sector import SectorCreate, SectorUpdate, TableCreate
from rest_api.services.domain.sector_service import SectorService
from rest_api.services.domain.table_service import TableService
from shared.infrastructure.db import safe_commit
from shared.utils.exceptions import NotFoundError, ValidationError


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def tenant_a(db: AsyncSession) -> Tenant:
    t = Tenant(name="Tenant Alpha")
    db.add(t)
    await db.flush()
    return t


@pytest_asyncio.fixture
async def tenant_b(db: AsyncSession) -> Tenant:
    t = Tenant(name="Tenant Beta")
    db.add(t)
    await db.flush()
    return t


@pytest_asyncio.fixture
async def branch_a(db: AsyncSession, tenant_a: Tenant) -> Branch:
    b = Branch(
        tenant_id=tenant_a.id,
        name="Branch Centro A",
        address="Calle 1 #100",
        slug="centro-a",
    )
    db.add(b)
    await db.flush()
    return b


@pytest_asyncio.fixture
async def branch_b(db: AsyncSession, tenant_b: Tenant) -> Branch:
    b = Branch(
        tenant_id=tenant_b.id,
        name="Branch Norte B",
        address="Calle 2 #200",
        slug="norte-b",
    )
    db.add(b)
    await db.flush()
    return b


@pytest_asyncio.fixture
async def sector(db: AsyncSession, branch_a: Branch) -> BranchSector:
    s = BranchSector(branch_id=branch_a.id, name="Salón Principal")
    db.add(s)
    await db.flush()
    return s


@pytest_asyncio.fixture
async def table(db: AsyncSession, sector: BranchSector, branch_a: Branch) -> Table:
    t = Table(
        branch_id=branch_a.id,
        sector_id=sector.id,
        number=1,
        code="T01",
        capacity=4,
        status="AVAILABLE",
    )
    db.add(t)
    await db.flush()
    return t


# ── 9.1 Sector CRUD ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_sector(db: AsyncSession, branch_a: Branch, tenant_a: Tenant) -> None:
    """SectorService creates a BranchSector scoped to a branch."""
    svc = SectorService(db)
    result = await svc.create(
        data=SectorCreate(branch_id=branch_a.id, name="Terraza"),
        tenant_id=tenant_a.id,
        user_id=1,
    )
    assert result.id is not None
    assert result.name == "Terraza"
    assert result.branch_id == branch_a.id
    assert result.is_active is True


@pytest.mark.asyncio
async def test_create_sector_trims_name(db: AsyncSession, branch_a: Branch, tenant_a: Tenant) -> None:
    """Sector name is trimmed on creation."""
    svc = SectorService(db)
    result = await svc.create(
        data=SectorCreate(branch_id=branch_a.id, name="  Bar  "),
        tenant_id=tenant_a.id,
        user_id=1,
    )
    assert result.name == "Bar"


@pytest.mark.asyncio
async def test_create_sector_invalid_branch(db: AsyncSession, tenant_a: Tenant) -> None:
    """Creating sector with non-existent branch raises ValidationError."""
    svc = SectorService(db)
    with pytest.raises(ValidationError):
        await svc.create(
            data=SectorCreate(branch_id=99999, name="Sector X"),
            tenant_id=tenant_a.id,
            user_id=1,
        )


@pytest.mark.asyncio
async def test_list_sectors_by_branch(
    db: AsyncSession, branch_a: Branch, tenant_a: Tenant
) -> None:
    """SectorService lists only active sectors for the branch."""
    svc = SectorService(db)
    await svc.create(SectorCreate(branch_id=branch_a.id, name="Salón"), tenant_id=tenant_a.id, user_id=1)
    await svc.create(SectorCreate(branch_id=branch_a.id, name="Terraza"), tenant_id=tenant_a.id, user_id=1)

    results = await svc.list_by_branch(tenant_id=tenant_a.id, branch_id=branch_a.id)
    assert len(results) == 2
    names = {r.name for r in results}
    assert "Salón" in names
    assert "Terraza" in names


@pytest.mark.asyncio
async def test_get_sector_by_id(
    db: AsyncSession, sector: BranchSector, tenant_a: Tenant
) -> None:
    """SectorService returns a sector by ID when it belongs to tenant."""
    svc = SectorService(db)
    result = await svc.get_by_id(sector_id=sector.id, tenant_id=tenant_a.id)
    assert result.id == sector.id
    assert result.name == sector.name


@pytest.mark.asyncio
async def test_get_sector_not_found(db: AsyncSession, tenant_a: Tenant) -> None:
    """Getting a non-existent sector raises NotFoundError."""
    svc = SectorService(db)
    with pytest.raises(NotFoundError):
        await svc.get_by_id(sector_id=99999, tenant_id=tenant_a.id)


@pytest.mark.asyncio
async def test_update_sector_name(
    db: AsyncSession, sector: BranchSector, tenant_a: Tenant
) -> None:
    """SectorService updates sector name."""
    svc = SectorService(db)
    result = await svc.update(
        sector_id=sector.id,
        data=SectorUpdate(name="Terraza VIP"),
        tenant_id=tenant_a.id,
        user_id=1,
    )
    assert result.name == "Terraza VIP"
    assert result.id == sector.id


@pytest.mark.asyncio
async def test_delete_sector_soft_deletes(
    db: AsyncSession,
    sector: BranchSector,
    table: Table,
    tenant_a: Tenant,
) -> None:
    """Deleting a sector soft-deletes the sector itself."""
    svc = SectorService(db)
    await svc.delete(sector_id=sector.id, tenant_id=tenant_a.id, user_id=1)

    await db.refresh(sector)
    assert sector.is_active is False
    assert sector.deleted_at is not None
    assert sector.deleted_by_id == 1


@pytest.mark.asyncio
async def test_delete_sector_cascades_to_tables(
    db: AsyncSession,
    sector: BranchSector,
    table: Table,
    tenant_a: Tenant,
) -> None:
    """Deleting a sector also soft-deletes all tables in that sector."""
    svc = SectorService(db)
    result = await svc.delete(sector_id=sector.id, tenant_id=tenant_a.id, user_id=1)

    await db.refresh(table)
    assert table.is_active is False
    assert table.deleted_at is not None
    assert result["affected"]["Table"] == 1


@pytest.mark.asyncio
async def test_delete_sector_cascades_to_multiple_tables(
    db: AsyncSession,
    sector: BranchSector,
    branch_a: Branch,
    tenant_a: Tenant,
) -> None:
    """Deleting a sector soft-deletes all tables in it, returns correct count."""
    # Create 3 tables in the sector
    for i in range(1, 4):
        t = Table(branch_id=branch_a.id, sector_id=sector.id, number=i, code=f"T0{i}", capacity=4)
        db.add(t)
    await db.flush()

    svc = SectorService(db)
    result = await svc.delete(sector_id=sector.id, tenant_id=tenant_a.id, user_id=1)
    assert result["affected"]["Table"] == 3


# ── 9.4 Multi-Tenant Isolation ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_tenant_a_cannot_access_tenant_b_sector(
    db: AsyncSession,
    branch_b: Branch,
    tenant_a: Tenant,
    tenant_b: Tenant,
) -> None:
    """Tenant A cannot read or modify sectors that belong to Tenant B."""
    # Create a sector in tenant B
    sector_b = BranchSector(branch_id=branch_b.id, name="Sector B Only")
    db.add(sector_b)
    await db.flush()

    svc = SectorService(db)
    # Tenant A tries to access sector from Tenant B — must raise NotFoundError
    with pytest.raises(NotFoundError):
        await svc.get_by_id(sector_id=sector_b.id, tenant_id=tenant_a.id)


@pytest.mark.asyncio
async def test_tenant_a_cannot_update_tenant_b_sector(
    db: AsyncSession,
    branch_b: Branch,
    tenant_a: Tenant,
    tenant_b: Tenant,
) -> None:
    """Tenant A cannot update sectors from Tenant B."""
    sector_b = BranchSector(branch_id=branch_b.id, name="Sector B")
    db.add(sector_b)
    await db.flush()

    svc = SectorService(db)
    with pytest.raises(NotFoundError):
        await svc.update(
            sector_id=sector_b.id,
            data=SectorUpdate(name="Hacked"),
            tenant_id=tenant_a.id,
            user_id=1,
        )


@pytest.mark.asyncio
async def test_tenant_a_cannot_delete_tenant_b_sector(
    db: AsyncSession,
    branch_b: Branch,
    tenant_a: Tenant,
    tenant_b: Tenant,
) -> None:
    """Tenant A cannot delete sectors from Tenant B."""
    sector_b = BranchSector(branch_id=branch_b.id, name="Sector B")
    db.add(sector_b)
    await db.flush()

    svc = SectorService(db)
    with pytest.raises(NotFoundError):
        await svc.delete(sector_id=sector_b.id, tenant_id=tenant_a.id, user_id=1)


@pytest.mark.asyncio
async def test_list_sectors_does_not_leak_across_tenants(
    db: AsyncSession,
    branch_a: Branch,
    branch_b: Branch,
    tenant_a: Tenant,
    tenant_b: Tenant,
) -> None:
    """Listing sectors for branch_a does not include sectors from branch_b."""
    svc = SectorService(db)
    await svc.create(SectorCreate(branch_id=branch_a.id, name="Only A"), tenant_id=tenant_a.id, user_id=1)

    # Sector for tenant B (separate branch)
    sector_b = BranchSector(branch_id=branch_b.id, name="Only B")
    db.add(sector_b)
    await db.flush()

    results = await svc.list_by_branch(tenant_id=tenant_a.id, branch_id=branch_a.id)
    names = {r.name for r in results}
    assert "Only A" in names
    assert "Only B" not in names


# ── 9.5 RBAC Tests ───────────────────────────────────────────────────────────

def _make_user(role: str, tenant_id: int = 1, branch_ids: list[int] | None = None) -> dict:
    return {
        "user_id": 1,
        "email": f"{role.lower()}@test.com",
        "tenant_id": tenant_id,
        "branch_ids": branch_ids or [1],
        "roles": [role],
        "jti": "test-jti",
        "exp": 9999999999,
    }


def _override_current_user(user_dict: dict):
    """Return an override for the current_user dependency."""
    async def _fake_user():
        return user_dict
    return _fake_user


@pytest.fixture
def test_client_admin() -> TestClient:
    from rest_api.main import app
    from rest_api.core.dependencies import current_user

    app.dependency_overrides[current_user] = _override_current_user(
        _make_user("ADMIN", tenant_id=1, branch_ids=[])
    )
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def test_client_manager() -> TestClient:
    from rest_api.main import app
    from rest_api.core.dependencies import current_user

    app.dependency_overrides[current_user] = _override_current_user(
        _make_user("MANAGER", tenant_id=1, branch_ids=[1])
    )
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def test_client_kitchen() -> TestClient:
    from rest_api.main import app
    from rest_api.core.dependencies import current_user

    app.dependency_overrides[current_user] = _override_current_user(
        _make_user("KITCHEN", tenant_id=1, branch_ids=[1])
    )
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def test_client_waiter() -> TestClient:
    from rest_api.main import app
    from rest_api.core.dependencies import current_user

    app.dependency_overrides[current_user] = _override_current_user(
        _make_user("WAITER", tenant_id=1, branch_ids=[1])
    )
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c
    app.dependency_overrides.clear()


def test_kitchen_cannot_list_sectors(test_client_kitchen: TestClient) -> None:
    """KITCHEN role gets 403 on GET /api/admin/sectors."""
    resp = test_client_kitchen.get("/api/admin/sectors?branch_id=1")
    assert resp.status_code == 403


def test_waiter_cannot_list_sectors(test_client_waiter: TestClient) -> None:
    """WAITER role gets 403 on GET /api/admin/sectors."""
    resp = test_client_waiter.get("/api/admin/sectors?branch_id=1")
    assert resp.status_code == 403


def test_kitchen_cannot_create_sector(test_client_kitchen: TestClient) -> None:
    """KITCHEN role gets 403 on POST /api/admin/sectors."""
    resp = test_client_kitchen.post(
        "/api/admin/sectors", json={"branch_id": 1, "name": "Hack"}
    )
    assert resp.status_code == 403


def test_waiter_cannot_create_table(test_client_waiter: TestClient) -> None:
    """WAITER role gets 403 on POST /api/admin/tables."""
    resp = test_client_waiter.post(
        "/api/admin/tables",
        json={"branch_id": 1, "sector_id": 1, "number": 1, "code": "T01", "capacity": 4},
    )
    assert resp.status_code == 403


def test_manager_cannot_delete_sector(test_client_manager: TestClient) -> None:
    """MANAGER role gets 403 on DELETE /api/admin/sectors/{id} (ADMIN only)."""
    resp = test_client_manager.delete("/api/admin/sectors/1")
    assert resp.status_code == 403


def test_manager_cannot_delete_table(test_client_manager: TestClient) -> None:
    """MANAGER role gets 403 on DELETE /api/admin/tables/{id} (ADMIN only)."""
    resp = test_client_manager.delete("/api/admin/tables/1")
    assert resp.status_code == 403
