"""
SectorService — domain service for branch sector and table management.

Clean Architecture rules:
  - NEVER db.commit() directly → safe_commit(db)
  - NEVER is_active == True → is_active.is_(True)
  - ALWAYS enforce tenant isolation via branch.tenant_id join
  - Soft delete only — no physical deletes (except WaiterSectorAssignment)
  - WaiterSectorAssignment is hard-deleted (ephemeral daily record)

Multi-tenant isolation:
  BranchSector has no tenant_id column — tenant is enforced by joining through
  Branch (sector.branch_id → branch.tenant_id). Every query scopes to tenant
  by checking branch.tenant_id == tenant_id.
"""
from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.config.logging import get_logger
from shared.config.constants import Roles
from shared.infrastructure.db import safe_commit
from shared.utils.exceptions import NotFoundError, ValidationError
from rest_api.models.branch import Branch
from rest_api.models.sector import BranchSector, Table, WaiterSectorAssignment
from rest_api.models.user import User, UserBranchRole
from rest_api.schemas.sector import (
    AssignmentCreate,
    AssignmentResponse,
    SectorCreate,
    SectorResponse,
    SectorUpdate,
)

logger = get_logger(__name__)


class SectorService:
    """
    Domain service for BranchSector CRUD and waiter assignment management.

    All methods enforce tenant isolation via branch.tenant_id.
    Cascade soft-delete on sector propagates to all tables in that sector.
    Waiter assignments are hard-deleted (ephemeral operational records).
    """

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    # ── Private helpers ────────────────────────────────────────────────────────

    async def _get_branch(self, branch_id: int, tenant_id: int) -> Branch:
        """Return branch if it belongs to the tenant, else raise ValidationError."""
        branch = await self._db.scalar(
            select(Branch).where(
                Branch.id == branch_id,
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
        )
        if not branch:
            raise ValidationError("branch_id inválido o no pertenece al tenant", field="branch_id")
        return branch

    async def _get_sector(self, sector_id: int, tenant_id: int) -> BranchSector:
        """Return active sector owned by tenant, else raise NotFoundError."""
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

    def _to_sector_response(self, sector: BranchSector) -> SectorResponse:
        return SectorResponse.model_validate(sector)

    # ── Sector CRUD ────────────────────────────────────────────────────────────

    async def list_by_branch(
        self,
        tenant_id: int,
        branch_id: int,
        limit: int = 50,
        offset: int = 0,
    ) -> list[SectorResponse]:
        """List active sectors for a branch, ordered by name."""
        await self._get_branch(branch_id, tenant_id)

        result = await self._db.execute(
            select(BranchSector)
            .where(
                BranchSector.branch_id == branch_id,
                BranchSector.is_active.is_(True),
            )
            .order_by(BranchSector.name)
            .limit(min(limit, 100))
            .offset(offset)
        )
        sectors = result.scalars().all()
        return [self._to_sector_response(s) for s in sectors]

    async def get_by_id(self, sector_id: int, tenant_id: int) -> SectorResponse:
        """Return a single sector by ID, scoped to tenant."""
        sector = await self._get_sector(sector_id, tenant_id)
        return self._to_sector_response(sector)

    async def create(
        self,
        data: SectorCreate,
        tenant_id: int,
        user_id: int,
    ) -> SectorResponse:
        """Create a new sector. Validates branch belongs to tenant."""
        await self._get_branch(data.branch_id, tenant_id)

        sector = BranchSector(
            branch_id=data.branch_id,
            name=data.name,
        )
        self._db.add(sector)
        await self._db.flush()
        await self._db.refresh(sector)
        await safe_commit(self._db)

        logger.debug(
            "sector.create: id=%s branch_id=%s tenant=%s",
            sector.id, data.branch_id, tenant_id,
        )
        return self._to_sector_response(sector)

    async def update(
        self,
        sector_id: int,
        data: SectorUpdate,
        tenant_id: int,
        user_id: int,
    ) -> SectorResponse:
        """Update sector fields. Validates tenant ownership."""
        sector = await self._get_sector(sector_id, tenant_id)

        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(sector, field, value)

        await self._db.flush()
        await self._db.refresh(sector)
        await safe_commit(self._db)

        return self._to_sector_response(sector)

    async def delete(
        self,
        sector_id: int,
        tenant_id: int,
        user_id: int,
    ) -> dict[str, Any]:
        """
        Soft-delete a sector and cascade to all its active tables.

        Returns dict with affected counts per entity type.
        Explicit cascade queries (not lazy-load) for async SQLAlchemy compatibility.
        """
        sector = await self._get_sector(sector_id, tenant_id)
        now = datetime.now(UTC)

        # Soft-delete the sector
        sector.is_active = False
        sector.deleted_at = now
        sector.deleted_by_id = user_id

        # Cascade soft-delete to all active tables in this sector
        tables_result = await self._db.execute(
            select(Table).where(
                Table.sector_id == sector_id,
                Table.is_active.is_(True),
            )
        )
        tables = tables_result.scalars().all()
        tables_affected = len(tables)

        for table in tables:
            table.is_active = False
            table.deleted_at = now
            table.deleted_by_id = user_id

        await safe_commit(self._db)

        logger.debug(
            "sector.delete: id=%s cascaded to %d tables tenant=%s",
            sector_id, tables_affected, tenant_id,
        )
        return {"affected": {"BranchSector": 1, "Table": tables_affected}}

    # ── Waiter Assignments ─────────────────────────────────────────────────────

    async def create_assignment(
        self,
        sector_id: int,
        data: AssignmentCreate,
        tenant_id: int,
    ) -> AssignmentResponse:
        """
        Assign a waiter to a sector for a given date.

        Validates:
          - Sector exists and belongs to tenant
          - User exists and has WAITER role for the sector's branch
          - No duplicate assignment (same user + sector + date)
        """
        sector = await self._get_sector(sector_id, tenant_id)

        # Verify user exists and has WAITER role for this branch
        waiter_role = await self._db.scalar(
            select(UserBranchRole).where(
                UserBranchRole.user_id == data.user_id,
                UserBranchRole.branch_id == sector.branch_id,
                UserBranchRole.role == Roles.WAITER,
            )
        )
        if not waiter_role:
            raise ValidationError(
                "El usuario no tiene rol WAITER en la sucursal de este sector",
                field="user_id",
            )

        # Check for duplicate assignment
        existing = await self._db.scalar(
            select(WaiterSectorAssignment).where(
                WaiterSectorAssignment.user_id == data.user_id,
                WaiterSectorAssignment.sector_id == sector_id,
                WaiterSectorAssignment.date == data.date,
            )
        )
        if existing:
            raise ValidationError(
                "Ya existe una asignación para este mozo en este sector y fecha",
                field="user_id",
            )

        assignment = WaiterSectorAssignment(
            user_id=data.user_id,
            sector_id=sector_id,
            date=data.date,
        )
        self._db.add(assignment)
        await self._db.flush()

        # Eager-load user for the response
        result = await self._db.execute(
            select(WaiterSectorAssignment)
            .options(selectinload(WaiterSectorAssignment.user))
            .where(WaiterSectorAssignment.id == assignment.id)
        )
        assignment_with_user = result.scalar_one()
        await safe_commit(self._db)

        return AssignmentResponse.model_validate(assignment_with_user)

    async def list_assignments(
        self,
        sector_id: int,
        assignment_date: date,
        tenant_id: int,
    ) -> list[AssignmentResponse]:
        """Return waiter assignments for a sector on a given date."""
        # Verify sector belongs to tenant
        await self._get_sector(sector_id, tenant_id)

        result = await self._db.execute(
            select(WaiterSectorAssignment)
            .options(selectinload(WaiterSectorAssignment.user))
            .where(
                WaiterSectorAssignment.sector_id == sector_id,
                WaiterSectorAssignment.date == assignment_date,
            )
        )
        assignments = result.scalars().all()
        return [AssignmentResponse.model_validate(a) for a in assignments]

    async def delete_assignment(
        self,
        assignment_id: int,
        tenant_id: int,
    ) -> None:
        """
        Hard-delete a waiter assignment.

        WaiterSectorAssignment is ephemeral — no soft-delete, no audit trail needed.
        Verifies sector belongs to tenant before deleting.
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
