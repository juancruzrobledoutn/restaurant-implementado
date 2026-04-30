"""
Waiter table session endpoints (C-08 + C-12).

CLEAN-ARCH: Thin router — zero business logic here.
All logic delegated to TableSessionService and BillingService.

Endpoints:
  GET   /api/waiter/tables                               → list tables in waiter's sectors (WAITER/MANAGER/ADMIN)
  POST  /api/waiter/tables/{table_id}/activate           → open session (WAITER/MANAGER/ADMIN)
  PATCH /api/waiter/sessions/{session_id}/request-check  → OPEN → PAYING (WAITER/MANAGER/ADMIN) [C-08]
  POST  /api/waiter/sessions/{session_id}/check          → create billing check (C-12)
  POST  /api/waiter/payments/manual                      → register manual payment (C-12)
  POST  /api/waiter/tables/{table_id}/close              → cleanup after billing resolved (C-12)

RBAC: require_management_or_waiter() — KITCHEN is explicitly excluded.
"""
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from shared.config.constants import Roles
from shared.config.logging import get_logger
from shared.infrastructure.db import get_db
from shared.utils.exceptions import ConflictError, NotFoundError, ValidationError
from rest_api.core.dependencies import current_user
from rest_api.core.limiter import limiter
from rest_api.models.sector import BranchSector, Table, WaiterSectorAssignment
from rest_api.models.table_session import TableSession
from rest_api.schemas.billing import CheckOut, ManualPaymentBody, PaymentOut
from rest_api.schemas.table_session import TableSessionOutput
from rest_api.services.domain.billing_service import BillingService
from rest_api.services.domain.table_session_service import TableSessionService
from rest_api.services.permissions import PermissionContext

router = APIRouter(tags=["waiter-tables"])

logger = get_logger(__name__)


@router.get(
    "/tables",
    response_model=list[dict],
    status_code=200,
    summary="List tables assigned to the waiter (WAITER/MANAGER/ADMIN)",
)
async def list_waiter_tables(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> list[dict[str, Any]]:
    """
    List all tables visible to the current user with session info.

    WAITER  → tables from sectors assigned to them today.
    MANAGER/ADMIN → all tables in their accessible branches.
    """
    ctx = PermissionContext(user)
    ctx.require_management_or_waiter()

    # Active session subquery (OPEN or PAYING) — one per table at most (D-02).
    active_session = aliased(TableSession)

    stmt = (
        select(
            Table.id,
            Table.code,
            Table.status,
            BranchSector.id.label("sector_id"),
            BranchSector.name.label("sector_name"),
            active_session.id.label("session_id"),
            active_session.status.label("session_status"),
        )
        .join(BranchSector, Table.sector_id == BranchSector.id)
        .outerjoin(
            active_session,
            (active_session.table_id == Table.id)
            & (active_session.is_active.is_(True))
            & (active_session.status.in_(["OPEN", "PAYING"])),
        )
        .where(
            Table.is_active.is_(True),
            BranchSector.is_active.is_(True),
        )
    )

    is_plain_waiter = Roles.WAITER in ctx.roles and not any(
        r in ctx.roles for r in (Roles.MANAGER, Roles.ADMIN)
    )

    if is_plain_waiter:
        today = date.today()
        stmt = stmt.join(
            WaiterSectorAssignment,
            (WaiterSectorAssignment.sector_id == BranchSector.id)
            & (WaiterSectorAssignment.user_id == ctx.user_id)
            & (WaiterSectorAssignment.date == today),
        )
    elif not ctx.is_admin:
        stmt = stmt.where(Table.branch_id.in_(ctx.branch_ids))

    stmt = stmt.order_by(BranchSector.id.asc(), Table.number.asc())

    rows = (await db.execute(stmt)).all()
    return [
        {
            "id": r.id,
            "code": r.code,
            # Frontend status enum: AVAILABLE | OCCUPIED | ACTIVE | PAYING | OUT_OF_SERVICE
            # Derive from session state when present:
            #   session OPEN    → ACTIVE (waiter can request check)
            #   session PAYING  → PAYING
            #   otherwise       → fall back to the table's own status column
            "status": (
                "ACTIVE"
                if r.session_status == "OPEN"
                else "PAYING"
                if r.session_status == "PAYING"
                else r.status
            ),
            "sector_id": r.sector_id,
            "sector_name": r.sector_name,
            "session_id": r.session_id,
            "session_status": r.session_status,
        }
        for r in rows
    ]


@router.post(
    "/tables/{table_id}/activate",
    response_model=TableSessionOutput,
    status_code=201,
    summary="Activate a table session (WAITER/MANAGER/ADMIN)",
)
async def activate_table(
    table_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> TableSessionOutput:
    """Open a new session for a table. Fails 409 if a session is already active."""
    ctx = PermissionContext(user)
    ctx.require_management_or_waiter()
    service = TableSessionService(db)
    try:
        return await service.activate(
            table_id=table_id,
            tenant_id=ctx.tenant_id,
            user_id=ctx.user_id,
            user_email=ctx.user_email,
            branch_ids=None if ctx.is_admin else ctx.branch_ids,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValidationError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.patch(
    "/sessions/{session_id}/request-check",
    response_model=TableSessionOutput,
    status_code=200,
    summary="Request check — transition session from OPEN to PAYING (WAITER/MANAGER/ADMIN)",
)
async def request_check(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> TableSessionOutput:
    """Transition an OPEN session to PAYING. Fails 409 if session is not OPEN."""
    ctx = PermissionContext(user)
    ctx.require_management_or_waiter()
    service = TableSessionService(db)
    try:
        return await service.request_check(
            session_id=session_id,
            tenant_id=ctx.tenant_id,
            user_id=ctx.user_id,
            user_email=ctx.user_email,
            branch_ids=None if ctx.is_admin else ctx.branch_ids,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValidationError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.post(
    "/tables/{table_id}/close",
    response_model=TableSessionOutput,
    status_code=200,
    summary="Close the active session for a table after billing resolved (WAITER/MANAGER/ADMIN)",
)
async def close_table_session(
    table_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> TableSessionOutput:
    """
    Close the active session for a table.

    C-12 behavior:
    - If session is in PAYING status and check is REQUESTED (not PAID): returns 409.
    - If session is already CLOSED (billing resolved by BillingService): performs
      cleanup (hard-delete cart_items, set table AVAILABLE) and returns 200.
    - If session is OPEN (no check requested): raises 409.

    BillingService._resolve_check() is the canonical path for PAYING → CLOSED.
    This endpoint handles the post-close cleanup triggered by the waiter.
    """
    ctx = PermissionContext(user)
    ctx.require_management_or_waiter()
    session_service = TableSessionService(db)
    billing_service = BillingService(db)

    # Find active (or recently closed) session for this table
    session_obj = await session_service.get_active_by_table_id(
        table_id=table_id,
        tenant_id=ctx.tenant_id,
        branch_ids=None if ctx.is_admin else ctx.branch_ids,
    )
    if not session_obj:
        raise HTTPException(status_code=404, detail="No active session found for this table")

    # Check billing state — guard against closing while billing is in progress
    from sqlalchemy import select
    from rest_api.models.billing import Check as CheckModel

    existing_check = await db.scalar(
        select(CheckModel).where(CheckModel.session_id == session_obj.id)
    )

    if existing_check and existing_check.status == "REQUESTED":
        raise HTTPException(
            status_code=409,
            detail=(
                f"La sesión tiene un check pendiente (id={existing_check.id}, "
                "status=REQUESTED). Esperá a que se complete el cobro."
            ),
        )

    try:
        return await session_service.close(
            session_id=session_obj.id,
            tenant_id=ctx.tenant_id,
            user_id=ctx.user_id,
            user_email=ctx.user_email,
            branch_ids=None if ctx.is_admin else ctx.branch_ids,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except (ValidationError, ConflictError) as exc:
        raise HTTPException(status_code=409, detail=str(exc))


# ── C-12: Billing endpoints on waiter router ──────────────────────────────────


@router.post(
    "/sessions/{session_id}/check",
    response_model=CheckOut,
    status_code=201,
    summary="Request a billing check for a session (WAITER/MANAGER/ADMIN, 5/min)",
)
@limiter.limit("5/minute")
async def waiter_request_check(
    request: Request,
    session_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> CheckOut:
    """
    Request a check for a session using equal_split (waiter default).

    Delegates to BillingService.request_check() with split_method='equal_split'.
    Returns 409 if session is not OPEN or check already exists.
    """
    ctx = PermissionContext(user)
    ctx.require_management_or_waiter()

    service = BillingService(db)
    try:
        return await service.request_check(
            session_id=session_id,
            split_method="equal_split",
            tenant_id=ctx.tenant_id,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except (ConflictError, ValidationError) as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.post(
    "/payments/manual",
    response_model=PaymentOut,
    status_code=200,
    summary="Register manual payment (cash/card/transfer) (WAITER/MANAGER/ADMIN, 20/min)",
)
@limiter.limit("20/minute")
async def register_manual_payment(
    request: Request,
    body: ManualPaymentBody,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> PaymentOut:
    """
    Register a manual payment (cash, card, or bank transfer) for a check.

    Runs FIFO allocation. If payment completes the check, transitions
    session to CLOSED and fires CHECK_PAID outbox event.

    Returns 409 if check is not in REQUESTED status.
    """
    ctx = PermissionContext(user)
    ctx.require_management_or_waiter()

    service = BillingService(db)
    try:
        return await service.register_manual_payment(
            check_id=body.check_id,
            amount_cents=body.amount_cents,
            method=body.method,
            tenant_id=ctx.tenant_id,
            reference=body.reference,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except (ConflictError, ValidationError) as exc:
        raise HTTPException(status_code=409, detail=str(exc))
