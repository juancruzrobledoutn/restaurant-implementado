"""
Kitchen-facing ticket endpoints (C-11).

CLEAN-ARCH: Thin router — KITCHEN, MANAGER, or ADMIN only.
All state-machine logic lives in TicketService. This router just routes HTTP.

Endpoints:
  GET   /api/kitchen/tickets?branch_id={id}&status={IN_PROGRESS|READY|DELIVERED}
    — list active tickets filtered by tenant + branch + optional status.
  PATCH /api/kitchen/tickets/{ticket_id}
    body: { status: "READY" | "DELIVERED" }
    - READY: flips both ticket and round (round IN_KITCHEN → READY).
    - DELIVERED: flips both ticket and round (round READY → SERVED).
"""
from typing import Literal

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
from rest_api.schemas.kitchen_ticket import (
    KitchenTicketOutput,
    KitchenTicketStatusUpdateInput,
)
from rest_api.services.domain import TicketService
from rest_api.services.permissions import PermissionContext

router = APIRouter(tags=["kitchen-tickets"])


@router.get(
    "/tickets",
    response_model=list[KitchenTicketOutput],
    summary="List active kitchen tickets for a branch",
)
async def list_kitchen_tickets(
    branch_id: int = Query(..., gt=0),
    status: Literal["IN_PROGRESS", "READY", "DELIVERED"] | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> list[KitchenTicketOutput]:
    ctx = PermissionContext(user)
    ctx.require_kitchen_or_management()
    ctx.require_branch_access(branch_id)

    service = TicketService(db)
    try:
        return await service.list_for_kitchen(
            branch_id=branch_id,
            tenant_id=ctx.tenant_id,
            branch_ids=None if ctx.is_admin else ctx.branch_ids,
            status_filter=status,
        )
    except ForbiddenError as exc:
        raise HTTPException(status_code=403, detail=str(exc))


@router.patch(
    "/tickets/{ticket_id}",
    response_model=KitchenTicketOutput,
    summary="Transition a kitchen ticket (READY or DELIVERED)",
)
async def update_kitchen_ticket(
    ticket_id: int,
    body: KitchenTicketStatusUpdateInput,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> KitchenTicketOutput:
    ctx = PermissionContext(user)
    ctx.require_kitchen_or_management()

    service = TicketService(db)
    try:
        return await service.set_status(
            ticket_id=ticket_id,
            target_status=body.status,
            tenant_id=ctx.tenant_id,
            branch_ids=None if ctx.is_admin else ctx.branch_ids,
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
