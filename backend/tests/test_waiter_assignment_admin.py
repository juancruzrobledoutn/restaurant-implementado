"""
Tests for WaiterAssignmentService (C-13 admin waiter assignments).

Coverage:
  - create + unique constraint (409 via ValidationError)
  - list by date/branch/sector
  - delete (hard delete)
  - non-WAITER user raises ValidationError
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.branch import Branch
from rest_api.models.sector import BranchSector
from rest_api.models.tenant import Tenant
from rest_api.models.user import User, UserBranchRole
from rest_api.schemas.waiter_assignment import WaiterAssignmentCreate
from rest_api.services.domain.waiter_assignment_service import WaiterAssignmentService
from shared.config.constants import Roles
from shared.utils.exceptions import NotFoundError, ValidationError


TODAY = date.today()
TOMORROW = TODAY + timedelta(days=1)


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def tenant(db: AsyncSession) -> Tenant:
    t = Tenant(name="WaiterAssignmentService Test Tenant")
    db.add(t)
    await db.flush()
    return t


@pytest_asyncio.fixture
async def branch(db: AsyncSession, tenant: Tenant) -> Branch:
    b = Branch(
        tenant_id=tenant.id,
        name="Assignment Branch",
        address="Calle 10",
        slug="was-branch",
    )
    db.add(b)
    await db.flush()
    return b


@pytest_asyncio.fixture
async def sector(db: AsyncSession, branch: Branch) -> BranchSector:
    s = BranchSector(branch_id=branch.id, name="Salón Principal")
    db.add(s)
    await db.flush()
    return s


@pytest_asyncio.fixture
async def waiter_user(db: AsyncSession, tenant: Tenant, branch: Branch) -> User:
    u = User(
        tenant_id=tenant.id,
        email="waiter-was@test.com",
        full_name="Waiter User",
        hashed_password="hashed",
    )
    db.add(u)
    await db.flush()
    db.add(UserBranchRole(user_id=u.id, branch_id=branch.id, role=Roles.WAITER))
    await db.flush()
    return u


@pytest_asyncio.fixture
async def manager_user(db: AsyncSession, tenant: Tenant, branch: Branch) -> User:
    """User with MANAGER role — should NOT be assignable as waiter."""
    u = User(
        tenant_id=tenant.id,
        email="manager-was@test.com",
        full_name="Manager User",
        hashed_password="hashed",
    )
    db.add(u)
    await db.flush()
    db.add(UserBranchRole(user_id=u.id, branch_id=branch.id, role=Roles.MANAGER))
    await db.flush()
    return u


# ── Create ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_assignment_success(
    db: AsyncSession, tenant: Tenant, sector: BranchSector, waiter_user: User
) -> None:
    """Create a waiter-sector assignment for today."""
    svc = WaiterAssignmentService(db)
    result = await svc.create(
        data=WaiterAssignmentCreate(
            user_id=waiter_user.id,
            sector_id=sector.id,
            date=TODAY,
        ),
        tenant_id=tenant.id,
    )
    assert result.id is not None
    assert result.user_id == waiter_user.id
    assert result.sector_id == sector.id
    assert result.date == TODAY


@pytest.mark.asyncio
async def test_create_assignment_includes_user_and_sector(
    db: AsyncSession, tenant: Tenant, sector: BranchSector, waiter_user: User
) -> None:
    """Assignment response includes nested user and sector."""
    svc = WaiterAssignmentService(db)
    result = await svc.create(
        data=WaiterAssignmentCreate(
            user_id=waiter_user.id,
            sector_id=sector.id,
            date=TODAY,
        ),
        tenant_id=tenant.id,
    )
    assert result.user is not None
    assert result.user.email == "waiter-was@test.com"
    assert result.sector is not None
    assert result.sector.name == "Salón Principal"


@pytest.mark.asyncio
async def test_create_assignment_duplicate_raises_validation_error(
    db: AsyncSession, tenant: Tenant, sector: BranchSector, waiter_user: User
) -> None:
    """Duplicate (user, sector, date) raises ValidationError → 409."""
    svc = WaiterAssignmentService(db)
    await svc.create(
        data=WaiterAssignmentCreate(
            user_id=waiter_user.id,
            sector_id=sector.id,
            date=TODAY,
        ),
        tenant_id=tenant.id,
    )

    with pytest.raises(ValidationError, match="Ya existe"):
        await svc.create(
            data=WaiterAssignmentCreate(
                user_id=waiter_user.id,
                sector_id=sector.id,
                date=TODAY,
            ),
            tenant_id=tenant.id,
        )


@pytest.mark.asyncio
async def test_create_assignment_non_waiter_raises_validation_error(
    db: AsyncSession, tenant: Tenant, sector: BranchSector, manager_user: User
) -> None:
    """User without WAITER role in the sector's branch raises ValidationError."""
    svc = WaiterAssignmentService(db)
    with pytest.raises(ValidationError, match="WAITER"):
        await svc.create(
            data=WaiterAssignmentCreate(
                user_id=manager_user.id,
                sector_id=sector.id,
                date=TODAY,
            ),
            tenant_id=tenant.id,
        )


# ── List ───────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_by_date_returns_correct_date(
    db: AsyncSession, tenant: Tenant, sector: BranchSector, waiter_user: User
) -> None:
    """list_by_date returns only assignments for the specified date."""
    svc = WaiterAssignmentService(db)
    await svc.create(
        data=WaiterAssignmentCreate(
            user_id=waiter_user.id, sector_id=sector.id, date=TODAY
        ),
        tenant_id=tenant.id,
    )
    await svc.create(
        data=WaiterAssignmentCreate(
            user_id=waiter_user.id, sector_id=sector.id, date=TOMORROW
        ),
        tenant_id=tenant.id,
    )

    results = await svc.list_by_date(tenant_id=tenant.id, target_date=TODAY)
    assert len(results) == 1
    assert results[0].date == TODAY


@pytest.mark.asyncio
async def test_list_by_date_sector_filter(
    db: AsyncSession, tenant: Tenant, branch: Branch, waiter_user: User
) -> None:
    """list_by_date with sector_id filter returns only that sector's assignments."""
    sector1 = BranchSector(branch_id=branch.id, name="Sector 1")
    sector2 = BranchSector(branch_id=branch.id, name="Sector 2")
    db.add(sector1)
    db.add(sector2)
    await db.flush()

    svc = WaiterAssignmentService(db)
    await svc.create(
        data=WaiterAssignmentCreate(
            user_id=waiter_user.id, sector_id=sector1.id, date=TODAY
        ),
        tenant_id=tenant.id,
    )
    await svc.create(
        data=WaiterAssignmentCreate(
            user_id=waiter_user.id, sector_id=sector2.id, date=TODAY
        ),
        tenant_id=tenant.id,
    )

    results = await svc.list_by_date(
        tenant_id=tenant.id, target_date=TODAY, sector_id=sector1.id
    )
    assert len(results) == 1
    assert results[0].sector_id == sector1.id


# ── Delete ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_assignment_hard_deletes(
    db: AsyncSession, tenant: Tenant, sector: BranchSector, waiter_user: User
) -> None:
    """delete() hard-deletes the assignment record."""
    svc = WaiterAssignmentService(db)
    created = await svc.create(
        data=WaiterAssignmentCreate(
            user_id=waiter_user.id, sector_id=sector.id, date=TODAY
        ),
        tenant_id=tenant.id,
    )

    await svc.delete(assignment_id=created.id, tenant_id=tenant.id)

    results = await svc.list_by_date(
        tenant_id=tenant.id, target_date=TODAY, sector_id=sector.id
    )
    assert len(results) == 0


@pytest.mark.asyncio
async def test_delete_nonexistent_raises_not_found(
    db: AsyncSession, tenant: Tenant
) -> None:
    """Deleting a non-existent assignment raises NotFoundError."""
    svc = WaiterAssignmentService(db)
    with pytest.raises(NotFoundError):
        await svc.delete(assignment_id=99999, tenant_id=tenant.id)
