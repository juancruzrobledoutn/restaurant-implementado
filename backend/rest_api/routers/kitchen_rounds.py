"""
Kitchen-facing round endpoints (C-10).

CLEAN-ARCH: Thin router — KITCHEN, MANAGER, or ADMIN only.
The kitchen's "never see PENDING or CONFIRMED" invariant is enforced inside
RoundService.list_for_kitchen — this router just routes HTTP.

Endpoints:
  GET   /api/kitchen/rounds?branch_id={id}    — list SUBMITTED/IN_KITCHEN/READY rounds
  PATCH /api/kitchen/rounds/{round_id}
    body: { status: "IN_KITCHEN" | "READY" }
    - IN_KITCHEN: SUBMITTED → IN_KITCHEN (direct event)
    - READY: IN_KITCHEN → READY (outbox event)
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from shared.infrastructure.db import get_db
from shared.utils.exceptions import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ValidationError,
)
from rest_api.core.dependencies import current_user
from rest_api.schemas.round import (
    KitchenRoundOutput,
    KitchenRoundStatusUpdateInput,
    RoundOutput,
)
from rest_api.services.domain import RoundService
from rest_api.services.permissions import PermissionContext

router = APIRouter(tags=["kitchen-rounds"])


@router.get(
    "/rounds",
    response_model=list[KitchenRoundOutput],
    summary="List rounds visible to the kitchen (SUBMITTED/IN_KITCHEN/READY only)",
)
async def list_kitchen_rounds(
    branch_id: int = Query(..., gt=0),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> list[KitchenRoundOutput]:
    ctx = PermissionContext(user)
    ctx.require_kitchen_or_management()
    service = RoundService(db)
    try:
        return await service.list_for_kitchen(
            branch_id=branch_id,
            tenant_id=ctx.tenant_id,
            branch_ids=None if ctx.is_admin else ctx.branch_ids,
        )
    except ForbiddenError as exc:
        raise HTTPException(status_code=403, detail=str(exc))


@router.patch(
    "/rounds/{round_id}",
    response_model=RoundOutput,
    summary="Kitchen moves a round through SUBMITTED → IN_KITCHEN → READY",
)
async def update_round_kitchen(
    round_id: int,
    body: KitchenRoundStatusUpdateInput,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> RoundOutput:
    ctx = PermissionContext(user)
    ctx.require_kitchen_or_management()
    service = RoundService(db)
    branch_scope = None if ctx.is_admin else ctx.branch_ids

    try:
        if body.status == "IN_KITCHEN":
            return await service.start_kitchen(
                round_id=round_id,
                tenant_id=ctx.tenant_id,
                branch_ids=branch_scope,
                user_id=ctx.user_id,
                user_role=ctx.top_role or "",
            )
        # status == "READY"
        return await service.mark_ready(
            round_id=round_id,
            tenant_id=ctx.tenant_id,
            branch_ids=branch_scope,
            user_id=ctx.user_id,
            user_role=ctx.top_role or "",
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ForbiddenError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
