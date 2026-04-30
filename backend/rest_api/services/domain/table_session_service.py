"""
TableSessionService — domain service for table session lifecycle (C-08).

State machine: OPEN → PAYING → CLOSED

Clean Architecture rules:
  - NEVER db.commit() directly → safe_commit(db)
  - NEVER is_active == True → is_active.is_(True)
  - ALWAYS enforce tenant isolation via branch.tenant_id join
  - SELECT ... FOR UPDATE on the table row before any state change (D-02)
  - CartItem hard-delete on close — same transaction as session soft-delete (D-05)
  - table.status updated in same transaction as session status (D-10)

Multi-tenant isolation:
  TableSession has no direct tenant_id column — isolation goes through
  table → branch → tenant. Every method that takes tenant_id validates this chain.
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.config.logging import get_logger
from shared.infrastructure.db import safe_commit
from shared.utils.exceptions import NotFoundError, ValidationError
from rest_api.models.branch import Branch
from rest_api.models.sector import Table
from rest_api.models.table_session import CartItem, Diner, TableSession
from rest_api.schemas.table_session import TableSessionOutput

logger = get_logger(__name__)

# Statuses that count as "active" for the single-session invariant
_ACTIVE_STATUSES = ("OPEN", "PAYING")


class TableSessionService:
    """
    Domain service for the table session state machine.

    Enforces the single-active-session invariant via a two-layer approach:
      1. SELECT ... FOR UPDATE on the Table row (prevents race conditions)
      2. Partial unique index uq_table_session_active_per_table (DB backstop)

    All writes use safe_commit(db). All boolean checks use .is_(True).
    """

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    # ── Private helpers ────────────────────────────────────────────────────────

    async def _get_table_for_update(self, table_id: int, tenant_id: int) -> Table:
        """
        Load a table with a SELECT ... FOR UPDATE lock.

        Validates tenant ownership via branch.tenant_id join.
        Raises ValidationError if not found or not active.
        """
        result = await self._db.execute(
            select(Table)
            .join(Branch, Branch.id == Table.branch_id)
            .where(
                Table.id == table_id,
                Table.is_active.is_(True),
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
            .with_for_update()
        )
        table = result.scalar_one_or_none()
        if not table:
            raise NotFoundError("Table", table_id)
        return table

    async def _get_session_for_update(
        self,
        session_id: int,
        tenant_id: int,
        branch_ids: list[int] | None = None,
    ) -> TableSession:
        """
        Load a session with a SELECT ... FOR UPDATE lock.

        Validates tenant ownership. If branch_ids is provided, also validates
        that the session's branch is in the list (for non-admin users).
        """
        result = await self._db.execute(
            select(TableSession)
            .join(Branch, Branch.id == TableSession.branch_id)
            .where(
                TableSession.id == session_id,
                TableSession.is_active.is_(True),
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
            .with_for_update()
        )
        session = result.scalar_one_or_none()
        if not session:
            raise NotFoundError("TableSession", session_id)

        if branch_ids is not None and session.branch_id not in branch_ids:
            raise ValidationError(
                "No tenés acceso a la sucursal de esta sesión",
                field="branch_id",
            )

        return session

    def _to_output(self, session: TableSession) -> TableSessionOutput:
        return TableSessionOutput.model_validate(session)

    # ── Public API ─────────────────────────────────────────────────────────────

    async def activate(
        self,
        *,
        table_id: int,
        tenant_id: int,
        user_id: int,
        user_email: str,
        branch_ids: list[int] | None = None,
        bypass_branch_check: bool = False,
    ) -> TableSessionOutput:
        """
        Open a new table session.

        Flow:
          1. Load the table with SELECT ... FOR UPDATE
          2. Validate tenant ownership + branch access (unless bypass_branch_check)
          3. Check table is not OUT_OF_SERVICE
          4. Check no active session exists for this table
          5. Create TableSession(status=OPEN) + set table.status=OCCUPIED
          6. safe_commit(db)
          7. Return TableSessionOutput

        bypass_branch_check=True is used only for the public join endpoint,
        where there is no authenticated user to check branches against.
        """
        table = await self._get_table_for_update(table_id, tenant_id)

        if not bypass_branch_check and branch_ids is not None:
            if table.branch_id not in branch_ids:
                raise ValidationError(
                    "No tenés acceso a la sucursal de esta mesa",
                    field="branch_id",
                )

        if table.status == "OUT_OF_SERVICE":
            raise ValidationError(
                "La mesa está fuera de servicio y no puede ser activada",
                field="table_id",
            )

        # Check for an existing active session (service-level check — D-02)
        existing = await self._db.scalar(
            select(TableSession).where(
                TableSession.table_id == table_id,
                TableSession.is_active.is_(True),
                TableSession.status.in_(_ACTIVE_STATUSES),
            )
        )
        if existing:
            raise ValidationError(
                f"La mesa ya tiene una sesión activa (id={existing.id}, status={existing.status})",
                field="table_id",
            )

        # Create session and update table status atomically
        session = TableSession(
            table_id=table_id,
            branch_id=table.branch_id,
            status="OPEN",
        )
        table.status = "OCCUPIED"
        self._db.add(session)
        await self._db.flush()
        await self._db.refresh(session)
        await safe_commit(self._db)

        logger.debug(
            "table_session.activate: session_id=%s table_id=%s tenant=%s actor=%s",
            session.id, table_id, tenant_id, user_id,
        )
        return self._to_output(session)

    async def _set_paying(
        self,
        *,
        session_id: int,
        tenant_id: int,
        user_id: int,
        branch_ids: list[int] | None = None,
    ) -> None:
        """
        [PRIVATE — C-12] Transition session from OPEN → PAYING.

        This method is called exclusively by BillingService.request_check().
        No router or other service may call this directly.

        Raises ValidationError (409) if session is not OPEN.
        """
        session = await self._get_session_for_update(
            session_id, tenant_id, branch_ids
        )

        if session.status != "OPEN":
            raise ValidationError(
                f"La sesión no puede pasar a PAYING desde status={session.status!r}. "
                "Solo es posible desde OPEN.",
                field="session_id",
            )

        session.status = "PAYING"
        await self._db.flush()

        logger.debug(
            "table_session._set_paying: session_id=%s tenant=%s actor=%s",
            session_id, tenant_id, user_id,
        )

    async def request_check(
        self,
        *,
        session_id: int,
        tenant_id: int,
        user_id: int,
        user_email: str,
        branch_ids: list[int] | None = None,
    ) -> TableSessionOutput:
        """
        [DEPRECATED — C-08 endpoint, kept for backwards compat with C-08 router]

        Direct status transition OPEN → PAYING without creating a billing check.

        NOTE (C-12): The canonical path for requesting a check is
        BillingService.request_check() which atomically creates the check +
        transitions the session. This method is kept for the C-08 router endpoint
        (/api/waiter/sessions/{id}/request-check) which was created before C-12.

        Raises ValidationError (409) if session is not OPEN.
        """
        session = await self._get_session_for_update(
            session_id, tenant_id, branch_ids
        )

        if session.status != "OPEN":
            raise ValidationError(
                f"La sesión no puede pasar a PAYING desde status={session.status!r}. "
                "Solo es posible desde OPEN.",
                field="session_id",
            )

        session.status = "PAYING"
        await self._db.flush()
        await self._db.refresh(session)
        await safe_commit(self._db)

        logger.debug(
            "table_session.request_check: session_id=%s tenant=%s actor=%s",
            session_id, tenant_id, user_id,
        )
        return self._to_output(session)

    async def close(
        self,
        *,
        session_id: int,
        tenant_id: int,
        user_id: int,
        user_email: str,
        branch_ids: list[int] | None = None,
    ) -> TableSessionOutput:
        """
        Close a session: PAYING → CLOSED (waiter-initiated cleanup after billing).

        C-12 guard: if a Check exists for this session and is NOT PAID, raises
        ValidationError(409) to prevent premature close before billing resolves.

        BillingService._resolve_check() is the canonical path that sets
        session.status = CLOSED. This method handles the cleanup step
        triggered by the waiter (cart cleanup + table release).

        Raises:
            ValidationError (409) if session has a pending (REQUESTED) check.
            ValidationError (409) if session is not PAYING or CLOSED.
        """
        session = await self._get_session_for_update(
            session_id, tenant_id, branch_ids
        )

        # C-12 guard: block close if billing check is REQUESTED (not yet PAID)
        from sqlalchemy import select as sa_select
        from rest_api.models.billing import Check as BillingCheck

        existing_check = await self._db.scalar(
            sa_select(BillingCheck).where(BillingCheck.session_id == session_id)
        )
        if existing_check and existing_check.status == "REQUESTED":
            raise ValidationError(
                f"La sesión id={session_id} tiene un check pendiente "
                f"(id={existing_check.id}, status=REQUESTED). "
                "Esperá a que el cobro se complete antes de cerrar la sesión.",
                field="session_id",
            )

        # Accept PAYING (needs cleanup) or CLOSED (already resolved by billing)
        if session.status not in ("PAYING", "CLOSED"):
            raise ValidationError(
                f"La sesión no puede cerrarse desde status={session.status!r}. "
                "Debe estar en PAYING o CLOSED.",
                field="session_id",
            )

        # Hard-delete all cart items for this session (D-05)
        await self._db.execute(
            delete(CartItem).where(CartItem.session_id == session_id)
        )

        # If not already CLOSED (billing resolved), soft-delete the session
        if session.status != "CLOSED":
            now = datetime.now(UTC)
            session.status = "CLOSED"
            session.is_active = False
            session.deleted_at = now
            session.deleted_by_id = user_id

        # Release the table (D-10)
        result = await self._db.execute(
            select(Table).where(Table.id == session.table_id)
        )
        table = result.scalar_one_or_none()
        if table:
            table.status = "AVAILABLE"

        await self._db.flush()
        await self._db.refresh(session)
        await safe_commit(self._db)

        logger.debug(
            "table_session.close: session_id=%s tenant=%s actor=%s",
            session_id, tenant_id, user_id,
        )
        return self._to_output(session)

    async def cleanup_after_close(
        self,
        *,
        session_id: int,
        table_id: int,
    ) -> None:
        """
        [C-12] Hard-delete cart items and reset table status after billing resolves.

        Called by BillingService._resolve_check() (or the waiter close endpoint)
        after the session transitions to CLOSED. This is the only place that
        hard-deletes CartItems (D-05).

        Does NOT commit — caller owns the transaction.
        """
        # Hard-delete all cart items
        await self._db.execute(
            delete(CartItem).where(CartItem.session_id == session_id)
        )

        # Release the table
        result = await self._db.execute(
            select(Table).where(Table.id == table_id)
        )
        table = result.scalar_one_or_none()
        if table:
            table.status = "AVAILABLE"

        await self._db.flush()

        logger.debug(
            "table_session.cleanup_after_close: session_id=%s table_id=%s",
            session_id, table_id,
        )

    async def get_active_by_table_id(
        self,
        table_id: int,
        tenant_id: int,
        branch_ids: list[int] | None = None,
    ) -> TableSession | None:
        """
        Return the active session for a table, eager-loading diners.

        Returns None if no active session exists.
        Validates tenant ownership via branch join.
        """
        result = await self._db.execute(
            select(TableSession)
            .join(Branch, Branch.id == TableSession.branch_id)
            .where(
                TableSession.table_id == table_id,
                TableSession.is_active.is_(True),
                TableSession.status.in_(_ACTIVE_STATUSES),
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
            .options(selectinload(TableSession.diners))
        )
        session = result.scalar_one_or_none()

        if session and branch_ids is not None and session.branch_id not in branch_ids:
            return None  # User doesn't have access — treat as not found

        return session

    async def get_active_by_code(
        self,
        branch_slug: str,
        code: str,
        tenant_id: int,
    ) -> TableSession | None:
        """
        Resolve branch_slug → branch → table (by code) → active session.

        Returns None if any step in the chain fails.
        The caller must validate branch access after calling this method.
        Diners are eagerly loaded to avoid lazy-loading issues in serialization.
        """
        # Resolve branch from slug scoped to tenant
        branch = await self._db.scalar(
            select(Branch).where(
                Branch.slug == branch_slug,
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
        )
        if not branch:
            return None

        # Resolve table by branch + code
        table = await self._db.scalar(
            select(Table).where(
                Table.branch_id == branch.id,
                Table.code == code,
                Table.is_active.is_(True),
            )
        )
        if not table:
            return None

        # Return active session for this table with diners eagerly loaded
        result = await self._db.execute(
            select(TableSession)
            .where(
                TableSession.table_id == table.id,
                TableSession.is_active.is_(True),
                TableSession.status.in_(_ACTIVE_STATUSES),
            )
            .options(selectinload(TableSession.diners))
        )
        return result.scalar_one_or_none()

    async def get_table_for_public_join(
        self,
        branch_slug: str,
        code: str,
        tenant_id: int,
    ) -> tuple[Table, Branch] | None:
        """
        Resolve branch_slug + code to a Table for the public join endpoint.

        Returns (table, branch) or None if not found.
        Used by the public join router to locate the table without auth.
        """
        branch = await self._db.scalar(
            select(Branch).where(
                Branch.slug == branch_slug,
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
        )
        if not branch:
            return None

        result = await self._db.execute(
            select(Table).where(
                Table.branch_id == branch.id,
                Table.code == code,
                Table.is_active.is_(True),
            )
        )
        table = result.scalar_one_or_none()
        if not table:
            return None

        return table, branch
