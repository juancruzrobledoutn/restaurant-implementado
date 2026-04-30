"""
Admin-facing round endpoints (C-10, C-25).

CLEAN-ARCH: Thin router — MANAGER or ADMIN only.

Endpoints (C-10):
  PATCH /api/admin/rounds/{round_id}
    body: { status: "SUBMITTED" | "CANCELED", cancel_reason?: str }
    - SUBMITTED: CONFIRMED → SUBMITTED (writes to outbox for kitchen dispatch)
    - CANCELED: any non-terminal → CANCELED (cancel_reason required)

Endpoints (C-25):
  GET /api/admin/rounds
    query: branch_id (required), date, sector_id, status, table_code, limit, offset
    → paginated list of rounds enriched for admin UI
  GET /api/admin/rounds/{round_id}
    → single round with embedded items for detail modal
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from shared.infrastructure.db import get_db
from shared.utils.exceptions import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    StockInsufficientError,
    ValidationError,
)
from rest_api.core.dependencies import current_user
from rest_api.schemas.round import (
    AdminRoundStatusUpdateInput,
    RoundAdminListOutput,
    RoundAdminWithItemsOutput,
    RoundOutput,
    StockInsufficientDetail,
)
from rest_api.services.domain import RoundService
from rest_api.services.permissions import PermissionContext

router = APIRouter(tags=["admin-rounds"])


@router.get(
    "/rounds",
    response_model=RoundAdminListOutput,
    summary="Admin/Manager: paginated list of rounds with filters",
)
async def list_admin_rounds(
    branch_id: int = Query(..., gt=0, description="Branch to query (required)"),
    date: Optional[str] = Query(default=None, description="YYYY-MM-DD local date filter"),
    sector_id: Optional[int] = Query(default=None, gt=0),
    status: Optional[str] = Query(default=None),
    table_code: Optional[str] = Query(default=None, max_length=50),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> RoundAdminListOutput:
    ctx = PermissionContext(user)
    ctx.require_management()
    branch_scope = None if ctx.is_admin else ctx.branch_ids

    try:
        items, total = await RoundService(db).list_for_admin(
            tenant_id=ctx.tenant_id,
            branch_id=branch_id,
            date=date,
            sector_id=sector_id,
            status=status,
            table_code=table_code,
            limit=limit,
            offset=offset,
            branch_ids=branch_scope,
        )
        return RoundAdminListOutput(
            items=items,
            total=total,
            limit=limit,
            offset=offset,
        )
    except ForbiddenError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.get(
    "/rounds/{round_id}",
    response_model=RoundAdminWithItemsOutput,
    summary="Admin/Manager: get round detail with embedded items",
)
async def get_admin_round_detail(
    round_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> RoundAdminWithItemsOutput:
    ctx = PermissionContext(user)
    ctx.require_management()
    branch_scope = None if ctx.is_admin else ctx.branch_ids

    try:
        return await RoundService(db).get_admin_detail(
            round_id=round_id,
            tenant_id=ctx.tenant_id,
            branch_ids=branch_scope,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ForbiddenError as exc:
        raise HTTPException(status_code=403, detail=str(exc))


@router.patch(
    "/rounds/{round_id}",
    response_model=RoundOutput,
    summary="Admin/Manager transitions a round to SUBMITTED or CANCELED",
)
async def update_round_admin(
    round_id: int,
    body: AdminRoundStatusUpdateInput,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> RoundOutput:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = RoundService(db)
    branch_scope = None if ctx.is_admin else ctx.branch_ids

    try:
        if body.status == "SUBMITTED":
            return await service.submit(
                round_id=round_id,
                tenant_id=ctx.tenant_id,
                branch_ids=branch_scope,
                user_id=ctx.user_id,
                user_role=ctx.top_role or "",
            )
        # status == "CANCELED"
        return await service.cancel(
            round_id=round_id,
            tenant_id=ctx.tenant_id,
            branch_ids=branch_scope,
            user_id=ctx.user_id,
            user_role=ctx.top_role or "",
            cancel_reason=body.cancel_reason or "",
        )
    except StockInsufficientError as exc:
        # Structured 409 body per spec.
        detail = StockInsufficientDetail(shortages=exc.shortages).model_dump()
        raise HTTPException(status_code=409, detail=detail)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ForbiddenError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
