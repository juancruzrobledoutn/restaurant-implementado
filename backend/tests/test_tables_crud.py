"""
Tests for TableService — table CRUD and business rules.

Coverage:
  9.2 - Table CRUD (create, read, update, soft-delete)
      - Code uniqueness within branch (409 on duplicate)
      - Same code allowed across different branches
      - Filtering by sector_id
      - Sector must be active and belong to same branch
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.branch import Branch
from rest_api.models.sector import BranchSector, Table
from rest_api.models.tenant import Tenant
from rest_api.schemas.sector import TableCreate, TableUpdate
from rest_api.services.domain.table_service import TableService
from shared.utils.exceptions import NotFoundError, ValidationError


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def tenant(db: AsyncSession) -> Tenant:
    t = Tenant(name="Table Test Tenant")
    db.add(t)
    await db.flush()
    return t


@pytest_asyncio.fixture
async def tenant_b(db: AsyncSession) -> Tenant:
    t = Tenant(name="Table Test Tenant B")
    db.add(t)
    await db.flush()
    return t


@pytest_asyncio.fixture
async def branch(db: AsyncSession, tenant: Tenant) -> Branch:
    b = Branch(
        tenant_id=tenant.id, name="Branch X", address="Calle 1", slug="branch-x"
    )
    db.add(b)
    await db.flush()
    return b


@pytest_asyncio.fixture
async def branch2(db: AsyncSession, tenant: Tenant) -> Branch:
    """Second branch for the same tenant — for cross-branch code uniqueness tests."""
    b = Branch(
        tenant_id=tenant.id, name="Branch Y", address="Calle 2", slug="branch-y"
    )
    db.add(b)
    await db.flush()
    return b


@pytest_asyncio.fixture
async def sector(db: AsyncSession, branch: Branch) -> BranchSector:
    s = BranchSector(branch_id=branch.id, name="Sector A")
    db.add(s)
    await db.flush()
    return s


@pytest_asyncio.fixture
async def sector2(db: AsyncSession, branch: Branch) -> BranchSector:
    s = BranchSector(branch_id=branch.id, name="Sector B")
    db.add(s)
    await db.flush()
    return s


@pytest_asyncio.fixture
async def sector_branch2(db: AsyncSession, branch2: Branch) -> BranchSector:
    s = BranchSector(branch_id=branch2.id, name="Sector Branch2")
    db.add(s)
    await db.flush()
    return s


@pytest_asyncio.fixture
async def table(db: AsyncSession, branch: Branch, sector: BranchSector) -> Table:
    t = Table(
        branch_id=branch.id,
        sector_id=sector.id,
        number=1,
        code="T01",
        capacity=4,
        status="AVAILABLE",
    )
    db.add(t)
    await db.flush()
    return t


# ── Create ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_table(
    db: AsyncSession, branch: Branch, sector: BranchSector, tenant: Tenant
) -> None:
    """TableService creates a table with correct defaults."""
    svc = TableService(db)
    result = await svc.create(
        data=TableCreate(
            branch_id=branch.id,
            sector_id=sector.id,
            number=5,
            code="t05",  # should be uppercased
            capacity=6,
        ),
        tenant_id=tenant.id,
        user_id=1,
    )
    assert result.id is not None
    assert result.code == "T05"  # uppercased
    assert result.status == "AVAILABLE"
    assert result.capacity == 6
    assert result.is_active is True


@pytest.mark.asyncio
async def test_create_table_invalid_branch(
    db: AsyncSession, sector: BranchSector, tenant: Tenant
) -> None:
    """Creating a table with non-existent branch raises ValidationError."""
    svc = TableService(db)
    with pytest.raises(ValidationError):
        await svc.create(
            data=TableCreate(
                branch_id=99999,
                sector_id=sector.id,
                number=1,
                code="T01",
                capacity=4,
            ),
            tenant_id=tenant.id,
            user_id=1,
        )


@pytest.mark.asyncio
async def test_create_table_sector_wrong_branch(
    db: AsyncSession,
    branch: Branch,
    branch2: Branch,
    sector_branch2: BranchSector,
    tenant: Tenant,
) -> None:
    """Creating a table with sector from different branch raises ValidationError."""
    svc = TableService(db)
    with pytest.raises(ValidationError):
        await svc.create(
            data=TableCreate(
                branch_id=branch.id,
                sector_id=sector_branch2.id,  # sector belongs to branch2, not branch
                number=1,
                code="T01",
                capacity=4,
            ),
            tenant_id=tenant.id,
            user_id=1,
        )


# ── Code Uniqueness ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_table_duplicate_code_same_branch(
    db: AsyncSession,
    branch: Branch,
    sector: BranchSector,
    table: Table,
    tenant: Tenant,
) -> None:
    """Duplicate code within the same branch raises ValidationError (→ 409)."""
    svc = TableService(db)
    with pytest.raises(ValidationError, match="Ya existe"):
        await svc.create(
            data=TableCreate(
                branch_id=branch.id,
                sector_id=sector.id,
                number=2,
                code="T01",  # same code as fixture table
                capacity=4,
            ),
            tenant_id=tenant.id,
            user_id=1,
        )


@pytest.mark.asyncio
async def test_create_table_same_code_different_branch_is_allowed(
    db: AsyncSession,
    branch: Branch,
    branch2: Branch,
    sector: BranchSector,
    sector_branch2: BranchSector,
    table: Table,
    tenant: Tenant,
) -> None:
    """Same code is allowed in a different branch — uniqueness is per-branch only."""
    svc = TableService(db)
    result = await svc.create(
        data=TableCreate(
            branch_id=branch2.id,
            sector_id=sector_branch2.id,
            number=1,
            code="T01",  # same code, different branch → OK
            capacity=4,
        ),
        tenant_id=tenant.id,
        user_id=1,
    )
    assert result.code == "T01"
    assert result.branch_id == branch2.id


# ── Read ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_table_by_id(
    db: AsyncSession, table: Table, tenant: Tenant
) -> None:
    """TableService returns a table by ID."""
    svc = TableService(db)
    result = await svc.get_by_id(table_id=table.id, tenant_id=tenant.id)
    assert result.id == table.id
    assert result.code == table.code


@pytest.mark.asyncio
async def test_get_table_not_found(db: AsyncSession, tenant: Tenant) -> None:
    """Getting a non-existent table raises NotFoundError."""
    svc = TableService(db)
    with pytest.raises(NotFoundError):
        await svc.get_by_id(table_id=99999, tenant_id=tenant.id)


@pytest.mark.asyncio
async def test_list_tables_by_branch(
    db: AsyncSession,
    branch: Branch,
    sector: BranchSector,
    sector2: BranchSector,
    tenant: Tenant,
) -> None:
    """TableService lists all active tables for a branch."""
    svc = TableService(db)
    await svc.create(
        TableCreate(branch_id=branch.id, sector_id=sector.id, number=1, code="A1", capacity=2),
        tenant_id=tenant.id, user_id=1
    )
    await svc.create(
        TableCreate(branch_id=branch.id, sector_id=sector2.id, number=2, code="B2", capacity=4),
        tenant_id=tenant.id, user_id=1
    )

    results = await svc.list_by_branch(tenant_id=tenant.id, branch_id=branch.id)
    assert len(results) == 2


@pytest.mark.asyncio
async def test_list_tables_filtered_by_sector(
    db: AsyncSession,
    branch: Branch,
    sector: BranchSector,
    sector2: BranchSector,
    tenant: Tenant,
) -> None:
    """Filtering by sector_id returns only tables from that sector."""
    svc = TableService(db)
    await svc.create(
        TableCreate(branch_id=branch.id, sector_id=sector.id, number=1, code="A1", capacity=2),
        tenant_id=tenant.id, user_id=1
    )
    await svc.create(
        TableCreate(branch_id=branch.id, sector_id=sector2.id, number=2, code="B2", capacity=4),
        tenant_id=tenant.id, user_id=1
    )

    results = await svc.list_by_branch(
        tenant_id=tenant.id, branch_id=branch.id, sector_id=sector.id
    )
    assert len(results) == 1
    assert results[0].code == "A1"


# ── Update ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_table_capacity(
    db: AsyncSession, table: Table, tenant: Tenant
) -> None:
    """TableService updates table capacity."""
    svc = TableService(db)
    result = await svc.update(
        table_id=table.id,
        data=TableUpdate(capacity=10),
        tenant_id=tenant.id,
        user_id=1,
    )
    assert result.capacity == 10
    assert result.code == table.code  # unchanged


@pytest.mark.asyncio
async def test_update_table_status(
    db: AsyncSession, table: Table, tenant: Tenant
) -> None:
    """TableService updates table status."""
    svc = TableService(db)
    result = await svc.update(
        table_id=table.id,
        data=TableUpdate(status="OCCUPIED"),
        tenant_id=tenant.id,
        user_id=1,
    )
    assert result.status == "OCCUPIED"


@pytest.mark.asyncio
async def test_update_table_code_duplicate_raises_conflict(
    db: AsyncSession,
    branch: Branch,
    sector: BranchSector,
    table: Table,
    tenant: Tenant,
) -> None:
    """Updating code to an existing code in the same branch raises ValidationError."""
    svc = TableService(db)
    # Create a second table
    await svc.create(
        TableCreate(branch_id=branch.id, sector_id=sector.id, number=2, code="T02", capacity=4),
        tenant_id=tenant.id, user_id=1,
    )

    with pytest.raises(ValidationError, match="Ya existe"):
        await svc.update(
            table_id=table.id,
            data=TableUpdate(code="T02"),  # already taken
            tenant_id=tenant.id,
            user_id=1,
        )


@pytest.mark.asyncio
async def test_update_table_same_code_is_allowed(
    db: AsyncSession, table: Table, tenant: Tenant
) -> None:
    """Updating a table with its own current code does not raise a conflict."""
    svc = TableService(db)
    result = await svc.update(
        table_id=table.id,
        data=TableUpdate(code="T01", capacity=8),  # same code, new capacity
        tenant_id=tenant.id,
        user_id=1,
    )
    assert result.code == "T01"
    assert result.capacity == 8


# ── Soft Delete ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_table_soft_deletes(
    db: AsyncSession, table: Table, tenant: Tenant
) -> None:
    """TableService soft-deletes a table."""
    svc = TableService(db)
    await svc.delete(table_id=table.id, tenant_id=tenant.id, user_id=1)

    await db.refresh(table)
    assert table.is_active is False
    assert table.deleted_at is not None
    assert table.deleted_by_id == 1


@pytest.mark.asyncio
async def test_delete_table_not_found(db: AsyncSession, tenant: Tenant) -> None:
    """Deleting a non-existent table raises NotFoundError."""
    svc = TableService(db)
    with pytest.raises(NotFoundError):
        await svc.delete(table_id=99999, tenant_id=tenant.id, user_id=1)


@pytest.mark.asyncio
async def test_deleted_table_not_returned_in_list(
    db: AsyncSession,
    branch: Branch,
    sector: BranchSector,
    table: Table,
    tenant: Tenant,
) -> None:
    """Soft-deleted tables are excluded from list results."""
    svc = TableService(db)
    await svc.delete(table_id=table.id, tenant_id=tenant.id, user_id=1)

    results = await svc.list_by_branch(tenant_id=tenant.id, branch_id=branch.id)
    assert len(results) == 0
