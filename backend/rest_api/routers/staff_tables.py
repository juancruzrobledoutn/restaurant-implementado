"""
Staff table session read endpoints (C-08).

CLEAN-ARCH: Thin router — zero business logic here.
All logic delegated to TableSessionService.

Endpoints:
  GET /api/tables/{table_id}/session          → get active session by table ID
  GET /api/tables/code/{code}/session         → get active session by table code
                                                 (requires ?branch_slug= query param)

RBAC: require_management_or_waiter() — any staff with branch access.
Note: branch_slug is REQUIRED for the code endpoint (D-07). Without it → 400.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from shared.infrastructure.db import get_db
from shared.utils.exceptions import NotFoundError
from rest_api.core.dependencies import current_user
from rest_api.schemas.table_session import TableSessionWithDinersOutput
from rest_api.services.domain.table_session_service import TableSessionService
from rest_api.services.permissions import PermissionContext

router = APIRouter(tags=["staff-tables"])


@router.get(
    "/tables/{table_id}/session",
    response_model=TableSessionWithDinersOutput,
    summary="Get active session by table ID (staff)",
)
async def get_session_by_table_id(
    table_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> TableSessionWithDinersOutput:
    """Return the active session for a specific table, with its diner list."""
    ctx = PermissionContext(user)
    ctx.require_management_or_waiter()

    service = TableSessionService(db)
    session = await service.get_active_by_table_id(
        table_id=table_id,
        tenant_id=ctx.tenant_id,
        branch_ids=None if ctx.is_admin else ctx.branch_ids,
    )

    if not session:
        raise HTTPException(status_code=404, detail="No active session found for this table")

    ctx.require_branch_access(session.branch_id)
    return TableSessionWithDinersOutput.model_validate(session)


@router.get(
    "/tables/code/{code}/session",
    response_model=TableSessionWithDinersOutput,
    summary="Get active session by table code (requires branch_slug query param)",
)
async def get_session_by_code(
    code: str,
    branch_slug: str = Query(..., description="Branch slug — required because codes are not globally unique"),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> TableSessionWithDinersOutput:
    """
    Return the active session for a table identified by its code within a specific branch.

    branch_slug is required — table codes are not globally unique (D-07).
    """
    ctx = PermissionContext(user)
    ctx.require_management_or_waiter()

    service = TableSessionService(db)
    session = await service.get_active_by_code(
        branch_slug=branch_slug,
        code=code,
        tenant_id=ctx.tenant_id,
    )

    if not session:
        raise HTTPException(status_code=404, detail="No active session found for this table code")

    ctx.require_branch_access(session.branch_id)
    return TableSessionWithDinersOutput.model_validate(session)
