"""
TableService — domain service for table management within a branch sector.

Clean Architecture rules:
  - NEVER db.commit() directly → safe_commit(db)
  - NEVER is_active == True → is_active.is_(True)
  - ALWAYS enforce tenant isolation via branch.tenant_id join
  - Soft delete only — no physical deletes

Business rules:
  - Table code must be unique within a branch (case-insensitive, stored uppercase)
  - Sector must exist, be active, and belong to the same branch as the table
  - Duplicate code within branch → 409 Conflict (ValidationError)
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config.logging import get_logger
from shared.infrastructure.db import safe_commit
from shared.utils.exceptions import NotFoundError, ValidationError
from rest_api.models.branch import Branch
from rest_api.models.sector import BranchSector, Table
from rest_api.schemas.sector import TableCreate, TableResponse, TableUpdate

logger = get_logger(__name__)


class TableService:
    """
    Domain service for Table CRUD.

    All methods enforce tenant isolation via branch.tenant_id.
    Code uniqueness is enforced within a branch — same code allowed across branches.
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

    async def _get_table(self, table_id: int, tenant_id: int) -> Table:
        """Return active table owned by tenant, else raise NotFoundError."""
        result = await self._db.execute(
            select(Table)
            .join(Branch, Branch.id == Table.branch_id)
            .where(
                Table.id == table_id,
                Table.is_active.is_(True),
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
        )
        table = result.scalar_one_or_none()
        if not table:
            raise NotFoundError("Table", table_id)
        return table

    async def _check_code_uniqueness(
        self,
        branch_id: int,
        code: str,
        exclude_table_id: int | None = None,
    ) -> None:
        """
        Raise ValidationError if the code already exists in the branch.
        Pass exclude_table_id when updating to skip the table being updated.
        """
        query = select(Table).where(
            Table.branch_id == branch_id,
            Table.code == code.upper(),
            Table.is_active.is_(True),
        )
        if exclude_table_id is not None:
            query = query.where(Table.id != exclude_table_id)

        existing = await self._db.scalar(query)
        if existing:
            raise ValidationError(
                f"Ya existe una mesa con código '{code}' en esta sucursal",
                field="code",
            )

    async def _get_sector_for_branch(self, sector_id: int, branch_id: int) -> BranchSector:
        """Verify sector exists, is active, and belongs to the given branch."""
        sector = await self._db.scalar(
            select(BranchSector).where(
                BranchSector.id == sector_id,
                BranchSector.branch_id == branch_id,
                BranchSector.is_active.is_(True),
            )
        )
        if not sector:
            raise ValidationError(
                "sector_id inválido, inactivo o no pertenece a esta sucursal",
                field="sector_id",
            )
        return sector

    def _to_response(self, table: Table) -> TableResponse:
        return TableResponse.model_validate(table)

    # ── Table CRUD ─────────────────────────────────────────────────────────────

    async def list_by_branch(
        self,
        tenant_id: int,
        branch_id: int,
        sector_id: int | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[TableResponse]:
        """List active tables for a branch, optionally filtered by sector."""
        await self._get_branch(branch_id, tenant_id)

        query = (
            select(Table)
            .where(
                Table.branch_id == branch_id,
                Table.is_active.is_(True),
            )
            .order_by(Table.code)
            .limit(min(limit, 100))
            .offset(offset)
        )
        if sector_id is not None:
            query = query.where(Table.sector_id == sector_id)

        result = await self._db.execute(query)
        tables = result.scalars().all()
        return [self._to_response(t) for t in tables]

    async def get_by_id(self, table_id: int, tenant_id: int) -> TableResponse:
        """Return a single table by ID, scoped to tenant."""
        table = await self._get_table(table_id, tenant_id)
        return self._to_response(table)

    async def create(
        self,
        data: TableCreate,
        tenant_id: int,
        user_id: int,
    ) -> TableResponse:
        """
        Create a new table.

        Validates:
          - branch belongs to tenant
          - sector is active and belongs to the same branch
          - code is unique within the branch
        """
        await self._get_branch(data.branch_id, tenant_id)
        await self._get_sector_for_branch(data.sector_id, data.branch_id)
        await self._check_code_uniqueness(data.branch_id, data.code)

        table = Table(
            branch_id=data.branch_id,
            sector_id=data.sector_id,
            number=data.number,
            code=data.code.upper(),
            capacity=data.capacity,
            status="AVAILABLE",
        )
        self._db.add(table)
        await self._db.flush()
        await self._db.refresh(table)
        await safe_commit(self._db)

        logger.debug(
            "table.create: id=%s code=%s branch_id=%s tenant=%s",
            table.id, table.code, data.branch_id, tenant_id,
        )
        return self._to_response(table)

    async def update(
        self,
        table_id: int,
        data: TableUpdate,
        tenant_id: int,
        user_id: int,
    ) -> TableResponse:
        """
        Update table fields. Validates tenant ownership and code uniqueness on code change.
        """
        table = await self._get_table(table_id, tenant_id)

        update_data = data.model_dump(exclude_unset=True)

        # Enforce code uniqueness if code is being changed
        if "code" in update_data and update_data["code"] is not None:
            update_data["code"] = update_data["code"].upper()
            await self._check_code_uniqueness(
                table.branch_id, update_data["code"], exclude_table_id=table_id
            )

        for field, value in update_data.items():
            setattr(table, field, value)

        await self._db.flush()
        await self._db.refresh(table)
        await safe_commit(self._db)

        return self._to_response(table)

    async def delete(
        self,
        table_id: int,
        tenant_id: int,
        user_id: int,
    ) -> None:
        """Soft-delete a table."""
        table = await self._get_table(table_id, tenant_id)

        table.is_active = False
        table.deleted_at = datetime.now(UTC)
        table.deleted_by_id = user_id

        await safe_commit(self._db)
        logger.debug("table.delete: id=%s tenant=%s", table_id, tenant_id)
