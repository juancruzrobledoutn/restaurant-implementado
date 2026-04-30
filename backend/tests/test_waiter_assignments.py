"""
Tests for SectorService — waiter assignment management.

Coverage:
  9.3 - Create assignment for today
      - Duplicate assignment rejection (409 via ValidationError)
      - List assignments by date
      - Delete assignment (hard delete)
      - Assigning non-WAITER user raises ValidationError (→ 422)
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.branch import Branch
from rest_api.models.sector import BranchSector, WaiterSectorAssignment
from rest_api.models.tenant import Tenant
from rest_api.models.user import User, UserBranchRole
from rest_api.schemas.sector import AssignmentCreate
from rest_api.services.domain.sector_service import SectorService
from shared.utils.exceptions import NotFoundError, ValidationError


TODAY = date.today()
TOMORROW = TODAY + timedelta(days=1)


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def tenant(db: AsyncSession) -> Tenant:
    t = Tenant(name="Assignment Test Tenant")
    db.add(t)
    await db.flush()
    return t


@pytest_asyncio.fixture
async def branch(db: AsyncSession, tenant: Tenant) -> Branch:
    b = Branch(
        tenant_id=tenant.id,
        name="Assignment Branch",
        address="Calle 5",
        slug="assign-branch",
    )
    db.add(b)
    await db.flush()
    return b


@pytest_asyncio.fixture
async def sector(db: AsyncSession, branch: Branch) -> BranchSector:
    s = BranchSector(branch_id=branch.id, name="Salón")
    db.add(s)
    await db.flush()
    return s


@pytest_asyncio.fixture
async def waiter(db: AsyncSession, tenant: Tenant, branch: Branch) -> User:
    """A user with WAITER role assigned to the test branch."""
    u = User(
        tenant_id=tenant.id,
        email="waiter@test.com",
        full_name="Test Waiter",
        hashed_password="hashed",
    )
    db.add(u)
    await db.flush()

    role = UserBranchRole(user_id=u.id, branch_id=branch.id, role="WAITER")
    db.add(role)
    await db.flush()
    return u


@pytest_asyncio.fixture
async def manager(db: AsyncSession, tenant: Tenant, branch: Branch) -> User:
    """A user with MANAGER role (not WAITER) for rejection tests."""
    u = User(
        tenant_id=tenant.id,
        email="manager@test.com",
        full_name="Test Manager",
        hashed_password="hashed",
    )
    db.add(u)
    await db.flush()

    role = UserBranchRole(user_id=u.id, branch_id=branch.id, role="MANAGER")
    db.add(role)
    await db.flush()
    return u


# ── Create Assignment ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_assignment_for_today(
    db: AsyncSession,
    sector: BranchSector,
    waiter: User,
    tenant: Tenant,
) -> None:
    """SectorService creates a waiter assignment for today."""
    svc = SectorService(db)
    result = await svc.create_assignment(
        sector_id=sector.id,
        data=AssignmentCreate(user_id=waiter.id, date=TODAY),
        tenant_id=tenant.id,
    )
    assert result.id is not None
    assert result.user_id == waiter.id
    assert result.sector_id == sector.id
    assert result.date == TODAY


@pytest.mark.asyncio
async def test_create_assignment_includes_user_details(
    db: AsyncSession,
    sector: BranchSector,
    waiter: User,
    tenant: Tenant,
) -> None:
    """Assignment response includes user email and full_name."""
    svc = SectorService(db)
    result = await svc.create_assignment(
        sector_id=sector.id,
        data=AssignmentCreate(user_id=waiter.id, date=TODAY),
        tenant_id=tenant.id,
    )
    assert result.user is not None
    assert result.user.email == "waiter@test.com"
    assert result.user.full_name == "Test Waiter"


@pytest.mark.asyncio
async def test_create_assignment_non_waiter_raises_validation_error(
    db: AsyncSession,
    sector: BranchSector,
    manager: User,
    tenant: Tenant,
) -> None:
    """Assigning a non-WAITER user raises ValidationError."""
    svc = SectorService(db)
    with pytest.raises(ValidationError, match="WAITER"):
        await svc.create_assignment(
            sector_id=sector.id,
            data=AssignmentCreate(user_id=manager.id, date=TODAY),
            tenant_id=tenant.id,
        )


@pytest.mark.asyncio
async def test_create_assignment_invalid_sector(
    db: AsyncSession, waiter: User, tenant: Tenant
) -> None:
    """Creating assignment for non-existent sector raises NotFoundError."""
    svc = SectorService(db)
    with pytest.raises(NotFoundError):
        await svc.create_assignment(
            sector_id=99999,
            data=AssignmentCreate(user_id=waiter.id, date=TODAY),
            tenant_id=tenant.id,
        )


# ── Duplicate Rejection ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_duplicate_assignment_raises_validation_error(
    db: AsyncSession,
    sector: BranchSector,
    waiter: User,
    tenant: Tenant,
) -> None:
    """Second assignment for same user+sector+date raises ValidationError (→ 409)."""
    svc = SectorService(db)
    await svc.create_assignment(
        sector_id=sector.id,
        data=AssignmentCreate(user_id=waiter.id, date=TODAY),
        tenant_id=tenant.id,
    )

    with pytest.raises(ValidationError, match="Ya existe"):
        await svc.create_assignment(
            sector_id=sector.id,
            data=AssignmentCreate(user_id=waiter.id, date=TODAY),
            tenant_id=tenant.id,
        )


@pytest.mark.asyncio
async def test_same_waiter_different_dates_is_allowed(
    db: AsyncSession,
    sector: BranchSector,
    waiter: User,
    tenant: Tenant,
) -> None:
    """Same waiter can be assigned to same sector on different dates."""
    svc = SectorService(db)
    r1 = await svc.create_assignment(
        sector_id=sector.id,
        data=AssignmentCreate(user_id=waiter.id, date=TODAY),
        tenant_id=tenant.id,
    )
    r2 = await svc.create_assignment(
        sector_id=sector.id,
        data=AssignmentCreate(user_id=waiter.id, date=TOMORROW),
        tenant_id=tenant.id,
    )
    assert r1.id != r2.id


# ── List Assignments ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_assignments_by_date(
    db: AsyncSession,
    sector: BranchSector,
    waiter: User,
    tenant: Tenant,
) -> None:
    """Listing assignments by date returns only assignments for that date."""
    svc = SectorService(db)
    await svc.create_assignment(
        sector_id=sector.id,
        data=AssignmentCreate(user_id=waiter.id, date=TODAY),
        tenant_id=tenant.id,
    )
    # Assignment for different date — should not appear
    await svc.create_assignment(
        sector_id=sector.id,
        data=AssignmentCreate(user_id=waiter.id, date=TOMORROW),
        tenant_id=tenant.id,
    )

    results = await svc.list_assignments(
        sector_id=sector.id, assignment_date=TODAY, tenant_id=tenant.id
    )
    assert len(results) == 1
    assert results[0].date == TODAY


@pytest.mark.asyncio
async def test_list_assignments_empty_for_date_with_no_assignments(
    db: AsyncSession,
    sector: BranchSector,
    tenant: Tenant,
) -> None:
    """Listing assignments for a date with no assignments returns empty list."""
    svc = SectorService(db)
    results = await svc.list_assignments(
        sector_id=sector.id, assignment_date=TODAY, tenant_id=tenant.id
    )
    assert results == []


# ── Delete Assignment ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_assignment_hard_deletes(
    db: AsyncSession,
    sector: BranchSector,
    waiter: User,
    tenant: Tenant,
) -> None:
    """Deleting an assignment permanently removes it (hard delete)."""
    svc = SectorService(db)
    created = await svc.create_assignment(
        sector_id=sector.id,
        data=AssignmentCreate(user_id=waiter.id, date=TODAY),
        tenant_id=tenant.id,
    )

    await svc.delete_assignment(assignment_id=created.id, tenant_id=tenant.id)

    # Verify it's gone from the list
    results = await svc.list_assignments(
        sector_id=sector.id, assignment_date=TODAY, tenant_id=tenant.id
    )
    assert len(results) == 0


@pytest.mark.asyncio
async def test_delete_assignment_allows_reassignment(
    db: AsyncSession,
    sector: BranchSector,
    waiter: User,
    tenant: Tenant,
) -> None:
    """After hard-deleting an assignment, the same slot can be reassigned."""
    svc = SectorService(db)
    created = await svc.create_assignment(
        sector_id=sector.id,
        data=AssignmentCreate(user_id=waiter.id, date=TODAY),
        tenant_id=tenant.id,
    )
    await svc.delete_assignment(assignment_id=created.id, tenant_id=tenant.id)

    # Should not raise — slot is free now
    new_assignment = await svc.create_assignment(
        sector_id=sector.id,
        data=AssignmentCreate(user_id=waiter.id, date=TODAY),
        tenant_id=tenant.id,
    )
    assert new_assignment.id is not None


@pytest.mark.asyncio
async def test_delete_assignment_not_found(
    db: AsyncSession, tenant: Tenant
) -> None:
    """Deleting a non-existent assignment raises NotFoundError."""
    svc = SectorService(db)
    with pytest.raises(NotFoundError):
        await svc.delete_assignment(assignment_id=99999, tenant_id=tenant.id)
