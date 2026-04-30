"""
Waiter-facing compact menu endpoint (C-11).

CLEAN-ARCH: Thin router — delegates to WaiterMenuService.

Endpoint:
  GET /api/waiter/branches/{branch_id}/menu
    — compact nested menu for the quick-command flow.
    Auth: JWT WAITER, MANAGER, or ADMIN. KITCHEN rejected.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from shared.infrastructure.db import get_db
from shared.utils.exceptions import ForbiddenError, NotFoundError
from rest_api.core.dependencies import current_user
from rest_api.schemas.waiter_menu import WaiterMenuResponse
from rest_api.services.domain import WaiterMenuService
from rest_api.services.permissions import PermissionContext

router = APIRouter(tags=["waiter-menu"])


@router.get(
    "/branches/{branch_id}/menu",
    response_model=WaiterMenuResponse,
    summary="Compact menu for the waiter quick-command flow",
)
async def get_waiter_menu(
    branch_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> WaiterMenuResponse:
    ctx = PermissionContext(user)
    ctx.require_management_or_waiter()
    ctx.require_branch_access(branch_id)

    service = WaiterMenuService(db)
    try:
        return await service.build_menu(
            branch_id=branch_id,
            tenant_id=ctx.tenant_id,
            branch_ids=None if ctx.is_admin else ctx.branch_ids,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ForbiddenError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
