"""
Admin branches router — branch settings endpoints (C-28).

CLEAN-ARCH: Thin router — delegates all business logic to BranchSettingsService.

Endpoints:
  GET  /api/admin/branches/{branch_id}/settings  — read branch settings (MANAGER/ADMIN)
  PATCH /api/admin/branches/{branch_id}          — update branch settings (MANAGER/ADMIN)

Permission rules:
  - Both endpoints require ADMIN or MANAGER role (require_management)
  - Both require branch access (require_branch_access) — ADMIN bypasses
  - Cross-tenant access is blocked by service-level tenant_id scoping
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from shared.infrastructure.db import get_db
from rest_api.core.dependencies import current_user
from rest_api.schemas.branch_settings import BranchSettingsResponse, BranchSettingsUpdate
from rest_api.services.domain.branch_settings_service import BranchSettingsService
from rest_api.services.permissions import PermissionContext

router = APIRouter(tags=["admin-branch-settings"])


@router.get(
    "/branches/{branch_id}/settings",
    response_model=BranchSettingsResponse,
    summary="Get branch operational settings",
)
async def get_branch_settings(
    branch_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[dict, Depends(current_user)],
) -> BranchSettingsResponse:
    """
    Return operational settings for a branch.

    Requires ADMIN or MANAGER role.
    MANAGER can only access branches they are assigned to.
    Cross-tenant access is rejected with 404 (not 403) to avoid info leak.
    """
    ctx = PermissionContext(user)
    ctx.require_management()
    ctx.require_branch_access(branch_id)

    service = BranchSettingsService(db)
    result = await service.get_settings(branch_id=branch_id, tenant_id=ctx.tenant_id)

    if result is None:
        raise HTTPException(status_code=404, detail="Branch not found")

    return result


@router.patch(
    "/branches/{branch_id}",
    response_model=BranchSettingsResponse,
    summary="Update branch operational settings",
)
async def update_branch_settings(
    branch_id: int,
    body: BranchSettingsUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[dict, Depends(current_user)],
) -> BranchSettingsResponse:
    """
    Update operational settings for a branch (partial update).

    Requires ADMIN or MANAGER role with branch access.
    Slug changes invalidate the public menu Redis cache (best-effort).
    Duplicate slug within the same tenant returns 409.
    Invalid timezone or opening_hours format returns 422.
    """
    ctx = PermissionContext(user)
    ctx.require_management()
    ctx.require_branch_access(branch_id)

    service = BranchSettingsService(db)
    return await service.update_settings(
        branch_id=branch_id,
        tenant_id=ctx.tenant_id,
        patch=body,
    )
