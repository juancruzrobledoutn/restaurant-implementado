"""
Waiter-facing service-call endpoints (C-11).

CLEAN-ARCH: Thin router — WAITER, MANAGER, or ADMIN only.
All state-machine logic lives in ServiceCallService.

Endpoints:
  GET   /api/waiter/service-calls?branch_id={id}&status={CREATED|ACKED|CLOSED}
    — list service calls. Default filter: CREATED + ACKED (open calls only).
  PATCH /api/waiter/service-calls/{call_id}
    body: { status: "ACKED" | "CLOSED" }
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
from rest_api.schemas.service_call import (
    ServiceCallOutput,
    ServiceCallStatusUpdateInput,
)
from rest_api.services.domain import ServiceCallService
from rest_api.services.permissions import PermissionContext

router = APIRouter(tags=["waiter-service-calls"])


@router.get(
    "/service-calls",
    response_model=list[ServiceCallOutput],
    summary="List service calls (default: open only)",
)
async def list_service_calls(
    branch_id: int = Query(..., gt=0),
    status: Literal["CREATED", "ACKED", "CLOSED"] | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> list[ServiceCallOutput]:
    ctx = PermissionContext(user)
    ctx.require_management_or_waiter()
    ctx.require_branch_access(branch_id)

    service = ServiceCallService(db)
    try:
        calls = await service.list_open(
            branch_id=branch_id,
            tenant_id=ctx.tenant_id,
            branch_ids=None if ctx.is_admin else ctx.branch_ids,
            status_filter=[status] if status is not None else None,
        )
    except ForbiddenError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    return [ServiceCallOutput.model_validate(c) for c in calls]


@router.patch(
    "/service-calls/{call_id}",
    response_model=ServiceCallOutput,
    summary="Ack or close a service call",
)
async def update_service_call(
    call_id: int,
    body: ServiceCallStatusUpdateInput,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> ServiceCallOutput:
    ctx = PermissionContext(user)
    ctx.require_management_or_waiter()

    service = ServiceCallService(db)
    try:
        if body.status == "ACKED":
            call = await service.ack(
                call_id=call_id,
                tenant_id=ctx.tenant_id,
                branch_ids=None if ctx.is_admin else ctx.branch_ids,
                user_id=ctx.user_id,
            )
        else:  # "CLOSED"
            call = await service.close(
                call_id=call_id,
                tenant_id=ctx.tenant_id,
                branch_ids=None if ctx.is_admin else ctx.branch_ids,
                user_id=ctx.user_id,
            )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ForbiddenError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return ServiceCallOutput.model_validate(call)
