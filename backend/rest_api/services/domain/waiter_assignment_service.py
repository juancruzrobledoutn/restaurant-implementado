"""
WaiterAssignmentService — domain service for daily waiter-sector assignments.

Clean Architecture rules:
  - NEVER db.commit() directly → safe_commit(db)
  - NEVER is_active == True → is_active.is_(True)
  - ALWAYS filter by tenant_id (via branch join)

Design decisions (from design.md):
  - D-03: verify_for_branch returns HTTP 200 always (never 403/404) to prevent
    tenant information leakage.
  - D-05: Separate service from StaffService — assignments are ephemeral/lightweight.
  - D-10: date.today() in UTC is MVP; timezone-aware tenant dates deferred.
  - WaiterSectorAssignment is hard-deleted (ephemeral, no AuditMixin).
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.config.constants import Roles
from shared.config.logging import get_logger
from shared.infrastructure.db import safe_commit
from shared.utils.exceptions import NotFoundError, ValidationError
from rest_api.models.branch import Branch
from rest_api.models.sector import BranchSector, WaiterSectorAssignment
from rest_api.models.user import User, UserBranchRole
from rest_api.schemas.waiter_assignment import (
    SectorMini,
    UserMini,
    VerifyBranchAssignmentOut,
    WaiterAssignmentCreate,
    WaiterAssignmentOut,
)

logger = get_logger(__name__)


def _assignment_to_out(assignment: WaiterSectorAssignment) -> WaiterAssignmentOut:
    """Convert WaiterSectorAssignment ORM instance to WaiterAssignmentOut schema."""
    user_out: Optional[UserMini] = None
    sector_out: Optional[SectorMini] = None

    if assignment.user:
        user_out = UserMini(
            id=assignment.user.id,
            email=assignment.user.email,
            full_name=assignment.user.full_name,
        )
    if assignment.sector:
        sector_out = SectorMini(
            id=assignment.sector.id,
            name=assignment.sector.name,
        )

    return WaiterAssignmentOut(
        id=assignment.id,
        user_id=assignment.user_id,
        sector_id=assignment.sector_id,
        date=assignment.date,
        user=user_out,
        sector=sector_out,
    )


class WaiterAssignmentService:
    """
    Domain service for managing daily waiter-sector assignments.

    Multi-tenant isolation: sector belongs to branch → branch.tenant_id must
    match the tenant_id of the operating user.
    """

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    # ── Private helpers ────────────────────────────────────────────────────────

    async def _get_sector(self, sector_id: int, tenant_id: int) -> BranchSector:
        """Return active sector belonging to tenant via branch, else raise NotFoundError."""
        result = await self._db.execute(
            select(BranchSector)
            .join(Branch, Branch.id == BranchSector.branch_id)
            .where(
                BranchSector.id == sector_id,
                BranchSector.is_active.is_(True),
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
        )
        sector = result.scalar_one_or_none()
        if not sector:
            raise NotFoundError("BranchSector", sector_id)
        return sector

    # ── CRUD ───────────────────────────────────────────────────────────────────

    async def create(
        self,
        data: WaiterAssignmentCreate,
        tenant_id: int,
    ) -> WaiterAssignmentOut:
        """
        Create a daily assignment of a waiter to a sector.

        Validates:
          - Sector belongs to the tenant (via branch join)
          - User belongs to the tenant and has WAITER role in the sector's branch
          - No duplicate (user_id, sector_id, date) — raises ValidationError (→ 409)
        """
        sector = await self._get_sector(data.sector_id, tenant_id)

        # Validate user belongs to tenant and has WAITER role in the sector's branch
        user = await self._db.scalar(
            select(User).where(
                User.id == data.user_id,
                User.tenant_id == tenant_id,
                User.is_active.is_(True),
            )
        )
        if not user:
            raise NotFoundError("User", data.user_id)

        # Check WAITER role on the sector's branch
        waiter_role = await self._db.scalar(
            select(UserBranchRole).where(
                UserBranchRole.user_id == data.user_id,
                UserBranchRole.branch_id == sector.branch_id,
                UserBranchRole.role == Roles.WAITER,
            )
        )
        if not waiter_role:
            raise ValidationError(
                f"User {data.user_id} does not have WAITER role on branch {sector.branch_id}",
                field="user_id",
            )

        # Check uniqueness
        existing = await self._db.scalar(
            select(WaiterSectorAssignment).where(
                WaiterSectorAssignment.user_id == data.user_id,
                WaiterSectorAssignment.sector_id == data.sector_id,
                WaiterSectorAssignment.date == data.date,
            )
        )
        if existing:
            raise ValidationError(
                f"Ya existe una asignación para user_id={data.user_id}, "
                f"sector_id={data.sector_id}, date={data.date}",
                field="date",
            )

        assignment = WaiterSectorAssignment(
            user_id=data.user_id,
            sector_id=data.sector_id,
            date=data.date,
        )
        self._db.add(assignment)
        await self._db.flush()

        # Reload with relationships
        result = await self._db.execute(
            select(WaiterSectorAssignment)
            .where(WaiterSectorAssignment.id == assignment.id)
            .options(
                selectinload(WaiterSectorAssignment.user),
                selectinload(WaiterSectorAssignment.sector),
            )
        )
        assignment = result.scalar_one()
        await safe_commit(self._db)

        return _assignment_to_out(assignment)

    async def list_by_date(
        self,
        tenant_id: int,
        target_date: date,
        branch_id: Optional[int] = None,
        sector_id: Optional[int] = None,
    ) -> list[WaiterAssignmentOut]:
        """
        List assignments for a given date, optionally filtered by branch/sector.

        Multi-tenant isolation enforced via BranchSector → Branch → tenant_id.
        """
        stmt = (
            select(WaiterSectorAssignment)
            .join(BranchSector, BranchSector.id == WaiterSectorAssignment.sector_id)
            .join(Branch, Branch.id == BranchSector.branch_id)
            .where(
                WaiterSectorAssignment.date == target_date,
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
                BranchSector.is_active.is_(True),
            )
            .options(
                selectinload(WaiterSectorAssignment.user),
                selectinload(WaiterSectorAssignment.sector),
            )
            .order_by(WaiterSectorAssignment.id)
        )

        if branch_id is not None:
            stmt = stmt.where(Branch.id == branch_id)

        if sector_id is not None:
            stmt = stmt.where(WaiterSectorAssignment.sector_id == sector_id)

        result = await self._db.execute(stmt)
        assignments = result.scalars().unique().all()
        return [_assignment_to_out(a) for a in assignments]

    async def delete(self, assignment_id: int, tenant_id: int) -> None:
        """
        Hard-delete a waiter assignment.

        WaiterSectorAssignment is an ephemeral record — hard delete per C-07 design.
        Multi-tenant isolation: validates assignment belongs to tenant via sector.branch.
        """
        result = await self._db.execute(
            select(WaiterSectorAssignment)
            .join(BranchSector, BranchSector.id == WaiterSectorAssignment.sector_id)
            .join(Branch, Branch.id == BranchSector.branch_id)
            .where(
                WaiterSectorAssignment.id == assignment_id,
                Branch.tenant_id == tenant_id,
            )
        )
        assignment = result.scalar_one_or_none()
        if not assignment:
            raise NotFoundError("WaiterSectorAssignment", assignment_id)

        await self._db.delete(assignment)
        await safe_commit(self._db)

    async def verify_for_branch(
        self,
        user_id: int,
        branch_id: int,
        tenant_id: int,
        target_date: Optional[date] = None,
    ) -> VerifyBranchAssignmentOut:
        """
        Verify if a waiter is assigned to the given branch for today (UTC).

        Decision D-03: ALWAYS returns 200. Never 403/404.
        Returns {assigned: false} if not assigned or if branch doesn't exist.
        First match returned for deterministic result (ordered by sector_id ASC).

        Args:
            user_id: The waiter's user ID.
            branch_id: The branch to check assignment for.
            tenant_id: Tenant context for multi-tenant isolation.
            target_date: Date to verify (defaults to date.today()).
        """
        if target_date is None:
            target_date = date.today()

        result = await self._db.execute(
            select(WaiterSectorAssignment, BranchSector)
            .join(BranchSector, BranchSector.id == WaiterSectorAssignment.sector_id)
            .join(Branch, Branch.id == BranchSector.branch_id)
            .where(
                WaiterSectorAssignment.user_id == user_id,
                WaiterSectorAssignment.date == target_date,
                Branch.id == branch_id,
                Branch.tenant_id == tenant_id,
                BranchSector.is_active.is_(True),
            )
            .order_by(WaiterSectorAssignment.sector_id.asc())
            .limit(1)
        )
        row = result.first()

        if not row:
            return VerifyBranchAssignmentOut(assigned=False)

        assignment, sector = row
        return VerifyBranchAssignmentOut(
            assigned=True,
            sector_id=sector.id,
            sector_name=sector.name,
        )
