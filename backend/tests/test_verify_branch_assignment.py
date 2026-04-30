"""
Tests for WaiterAssignmentService.verify_for_branch.

Coverage:
  - WAITER assigned returns {assigned: true, sector_id, sector_name}
  - Not assigned returns {assigned: false}
  - Non-existent branch returns {assigned: false} (no leak)
  - Multiple sectors same branch → first match deterministic (sector_id ASC)
  - Different tenant branch → {assigned: false} (tenant isolation)
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


TODAY = date.today()
TOMORROW = TODAY + timedelta(days=1)


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def tenant(db: AsyncSession) -> Tenant:
    t = Tenant(name="Verify Test Tenant")
    db.add(t)
    await db.flush()
    return t


@pytest_asyncio.fixture
async def tenant2(db: AsyncSession) -> Tenant:
    t = Tenant(name="Verify Test Tenant 2")
    db.add(t)
    await db.flush()
    return t


@pytest_asyncio.fixture
async def branch(db: AsyncSession, tenant: Tenant) -> Branch:
    b = Branch(
        tenant_id=tenant.id,
        name="Verify Branch",
        address="Calle Verificación",
        slug="verify-branch",
    )
    db.add(b)
    await db.flush()
    return b


@pytest_asyncio.fixture
async def sector(db: AsyncSession, branch: Branch) -> BranchSector:
    s = BranchSector(branch_id=branch.id, name="Sector Verificación")
    db.add(s)
    await db.flush()
    return s


@pytest_asyncio.fixture
async def waiter(db: AsyncSession, tenant: Tenant, branch: Branch) -> User:
    u = User(
        tenant_id=tenant.id,
        email="verify-waiter@test.com",
        full_name="Verify Waiter",
        hashed_password="hashed",
    )
    db.add(u)
    await db.flush()
    db.add(UserBranchRole(user_id=u.id, branch_id=branch.id, role=Roles.WAITER))
    await db.flush()
    return u


# ── Tests ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_verify_assigned_returns_true_with_sector(
    db: AsyncSession,
    tenant: Tenant,
    branch: Branch,
    sector: BranchSector,
    waiter: User,
) -> None:
    """Waiter assigned to sector returns assigned=True with sector_id and sector_name."""
    svc = WaiterAssignmentService(db)
    await svc.create(
        data=WaiterAssignmentCreate(
            user_id=waiter.id, sector_id=sector.id, date=TODAY
        ),
        tenant_id=tenant.id,
    )

    result = await svc.verify_for_branch(
        user_id=waiter.id,
        branch_id=branch.id,
        tenant_id=tenant.id,
        target_date=TODAY,
    )
    assert result.assigned is True
    assert result.sector_id == sector.id
    assert result.sector_name == "Sector Verificación"


@pytest.mark.asyncio
async def test_verify_not_assigned_returns_false(
    db: AsyncSession,
    tenant: Tenant,
    branch: Branch,
    waiter: User,
) -> None:
    """Waiter without assignment returns assigned=False."""
    svc = WaiterAssignmentService(db)
    result = await svc.verify_for_branch(
        user_id=waiter.id,
        branch_id=branch.id,
        tenant_id=tenant.id,
        target_date=TODAY,
    )
    assert result.assigned is False
    assert result.sector_id is None
    assert result.sector_name is None


@pytest.mark.asyncio
async def test_verify_nonexistent_branch_returns_false(
    db: AsyncSession, tenant: Tenant, waiter: User
) -> None:
    """Non-existent branch returns assigned=False (no tenant data leak)."""
    svc = WaiterAssignmentService(db)
    result = await svc.verify_for_branch(
        user_id=waiter.id,
        branch_id=99999,  # does not exist
        tenant_id=tenant.id,
        target_date=TODAY,
    )
    assert result.assigned is False


@pytest.mark.asyncio
async def test_verify_different_date_returns_false(
    db: AsyncSession,
    tenant: Tenant,
    branch: Branch,
    sector: BranchSector,
    waiter: User,
) -> None:
    """Assignment for tomorrow does not satisfy today's verification."""
    svc = WaiterAssignmentService(db)
    await svc.create(
        data=WaiterAssignmentCreate(
            user_id=waiter.id, sector_id=sector.id, date=TOMORROW
        ),
        tenant_id=tenant.id,
    )

    result = await svc.verify_for_branch(
        user_id=waiter.id,
        branch_id=branch.id,
        tenant_id=tenant.id,
        target_date=TODAY,
    )
    assert result.assigned is False


@pytest.mark.asyncio
async def test_verify_multiple_sectors_deterministic_first(
    db: AsyncSession,
    tenant: Tenant,
    branch: Branch,
    waiter: User,
) -> None:
    """Multiple sectors → returns the one with lowest sector_id (deterministic)."""
    # Create two sectors — sector1 has lower ID
    sector1 = BranchSector(branch_id=branch.id, name="Sector Alpha")
    sector2 = BranchSector(branch_id=branch.id, name="Sector Beta")
    db.add(sector1)
    db.add(sector2)
    await db.flush()

    svc = WaiterAssignmentService(db)
    # Assign to both sectors
    await svc.create(
        data=WaiterAssignmentCreate(
            user_id=waiter.id, sector_id=sector1.id, date=TODAY
        ),
        tenant_id=tenant.id,
    )
    await svc.create(
        data=WaiterAssignmentCreate(
            user_id=waiter.id, sector_id=sector2.id, date=TODAY
        ),
        tenant_id=tenant.id,
    )

    result = await svc.verify_for_branch(
        user_id=waiter.id,
        branch_id=branch.id,
        tenant_id=tenant.id,
        target_date=TODAY,
    )
    assert result.assigned is True
    # Should return first sector (lowest sector_id)
    assert result.sector_id == min(sector1.id, sector2.id)


@pytest.mark.asyncio
async def test_verify_cross_tenant_branch_returns_false(
    db: AsyncSession,
    tenant: Tenant,
    tenant2: Tenant,
    waiter: User,
    sector: BranchSector,
) -> None:
    """Branch belonging to tenant2 cannot be accessed via tenant1 context."""
    branch2 = Branch(
        tenant_id=tenant2.id,
        name="Tenant2 Branch",
        address="Calle Otro",
        slug="t2-branch",
    )
    db.add(branch2)
    await db.flush()

    svc = WaiterAssignmentService(db)
    # Even if waiter is assigned somewhere, cross-tenant branch returns false
    await svc.create(
        data=WaiterAssignmentCreate(
            user_id=waiter.id, sector_id=sector.id, date=TODAY
        ),
        tenant_id=tenant.id,
    )

    result = await svc.verify_for_branch(
        user_id=waiter.id,
        branch_id=branch2.id,
        tenant_id=tenant.id,  # tenant1 context cannot see tenant2's branch
        target_date=TODAY,
    )
    assert result.assigned is False
