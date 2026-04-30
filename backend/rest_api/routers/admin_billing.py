"""
Admin billing endpoints (C-26).

CLEAN-ARCH: Thin router — zero business logic here.
All logic is delegated to AdminBillingService.

Endpoints:
  GET /api/admin/billing/checks    → paginated checks listing (ADMIN/MANAGER)
  GET /api/admin/billing/payments  → paginated payments listing (ADMIN/MANAGER)

Auth:
  - Both endpoints: ADMIN or MANAGER only (require_management).
  - Branch-scoped: require_branch_access(branch_id).
  - KITCHEN, WAITER: 403 Forbidden.
  - Rate limit: 60/minute (auditing tool — not real-time).

Design decisions (design.md D1):
  - Under /api/admin prefix, separate from /api/billing (which accepts Table Token).
  - Separate router from billing.py to keep auth surface clean.
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config.logging import get_logger
from shared.infrastructure.db import get_db
from shared.utils.exceptions import ValidationError
from rest_api.core.dependencies import current_user
from rest_api.core.limiter import limiter
from rest_api.schemas.admin_billing import (
    PaginatedChecksOut,
    PaginatedPaymentsOut,
)
from rest_api.services.domain.admin_billing_service import AdminBillingService
from rest_api.services.permissions import PermissionContext

router = APIRouter(tags=["admin-billing"])

logger = get_logger(__name__)


def _today() -> date:
    from datetime import timezone
    from datetime import datetime
    return datetime.now(tz=timezone.utc).date()


@router.get(
    "/billing/checks",
    response_model=PaginatedChecksOut,
    summary="List billing checks for a branch with filters (ADMIN/MANAGER, 60/min)",
)
@limiter.limit("60/minute")
async def list_admin_checks(
    request: Request,
    branch_id: int = Query(..., description="Branch ID to query"),
    from_: date = Query(default_factory=_today, alias="from", description="Start date YYYY-MM-DD (inclusive)"),
    to: date = Query(default_factory=_today, description="End date YYYY-MM-DD (inclusive)"),
    status: str | None = Query(None, description="Filter by check status: REQUESTED | PAID"),
    page: int = Query(1, ge=1, description="Page number (1-based)"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page (max 100)"),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> PaginatedChecksOut:
    """
    Return a paginated list of billing checks for a specific branch.

    Filters:
    - from / to: date range (default today; max 90 days)
    - status: REQUESTED | PAID (optional)

    Returns 409 if the date range exceeds 90 days.
    Returns 403 if the user does not have MANAGER or ADMIN role,
    or does not have access to the requested branch.
    """
    ctx = PermissionContext(user)
    ctx.require_management()
    ctx.require_branch_access(branch_id)

    # Validate status value
    if status is not None and status not in ("REQUESTED", "PAID"):
        raise HTTPException(status_code=422, detail="status must be REQUESTED or PAID")

    service = AdminBillingService(db)
    try:
        return await service.list_checks(
            tenant_id=ctx.tenant_id,
            branch_id=branch_id,
            from_=from_,
            to=to,
            status=status,
            page=page,
            page_size=page_size,
        )
    except ValidationError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.get(
    "/billing/payments",
    response_model=PaginatedPaymentsOut,
    summary="List payments for a branch with filters (ADMIN/MANAGER, 60/min)",
)
@limiter.limit("60/minute")
async def list_admin_payments(
    request: Request,
    branch_id: int = Query(..., description="Branch ID to query"),
    from_: date = Query(default_factory=_today, alias="from", description="Start date YYYY-MM-DD (inclusive)"),
    to: date = Query(default_factory=_today, description="End date YYYY-MM-DD (inclusive)"),
    method: str | None = Query(None, description="Filter by method: cash | card | transfer | mercadopago"),
    status: str | None = Query(None, description="Filter by status: PENDING | APPROVED | REJECTED | FAILED"),
    page: int = Query(1, ge=1, description="Page number (1-based)"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page (max 100)"),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> PaginatedPaymentsOut:
    """
    Return a paginated list of payments for a specific branch.

    Filters:
    - from / to: date range (default today; max 90 days)
    - method: cash | card | transfer | mercadopago (optional)
    - status: PENDING | APPROVED | REJECTED | FAILED (optional)

    Returns 409 if the date range exceeds 90 days.
    Returns 403 if the user does not have MANAGER or ADMIN role,
    or does not have access to the requested branch.
    """
    ctx = PermissionContext(user)
    ctx.require_management()
    ctx.require_branch_access(branch_id)

    # Validate enum values
    valid_methods = {"cash", "card", "transfer", "mercadopago"}
    valid_statuses = {"PENDING", "APPROVED", "REJECTED", "FAILED"}
    if method is not None and method not in valid_methods:
        raise HTTPException(status_code=422, detail=f"method must be one of: {', '.join(sorted(valid_methods))}")
    if status is not None and status not in valid_statuses:
        raise HTTPException(status_code=422, detail=f"status must be one of: {', '.join(sorted(valid_statuses))}")

    service = AdminBillingService(db)
    try:
        return await service.list_payments(
            tenant_id=ctx.tenant_id,
            branch_id=branch_id,
            from_=from_,
            to=to,
            method=method,
            status=status,
            page=page,
            page_size=page_size,
        )
    except ValidationError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
