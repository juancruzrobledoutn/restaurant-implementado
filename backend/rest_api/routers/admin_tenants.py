"""
Admin tenants router — tenant settings endpoints (C-28).

CLEAN-ARCH: Thin router — delegates all business logic to TenantSettingsService.

Endpoints:
  GET  /api/admin/tenants/me  — read tenant settings (ADMIN only)
  PATCH /api/admin/tenants/me — update tenant settings (ADMIN only)

Permission rules:
  - Both endpoints require ADMIN role only (require_admin)
  - tenant_id always sourced from JWT (ctx.tenant_id) — NEVER from URL
  - privacy_salt is NEVER exposed — enforced by TenantSettingsResponse schema
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from shared.infrastructure.db import get_db
from rest_api.core.dependencies import current_user
from rest_api.schemas.tenant import TenantSettingsResponse, TenantSettingsUpdate
from rest_api.services.domain.tenant_settings_service import TenantSettingsService
from rest_api.services.permissions import PermissionContext

router = APIRouter(tags=["admin-tenant-settings"])


@router.get(
    "/tenants/me",
    response_model=TenantSettingsResponse,
    summary="Get tenant settings for the authenticated admin",
)
async def get_tenant_settings(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[dict, Depends(current_user)],
) -> TenantSettingsResponse:
    """
    Return settings for the current user's tenant.

    Requires ADMIN role. Uses tenant_id from JWT — not from URL (prevents IDOR).
    privacy_salt is never included in the response.
    """
    ctx = PermissionContext(user)
    ctx.require_admin()

    service = TenantSettingsService(db)
    result = await service.get(tenant_id=ctx.tenant_id)

    if result is None:
        raise HTTPException(status_code=404, detail="Tenant not found")

    return result


@router.patch(
    "/tenants/me",
    response_model=TenantSettingsResponse,
    summary="Update tenant settings",
)
async def update_tenant_settings(
    body: TenantSettingsUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[dict, Depends(current_user)],
) -> TenantSettingsResponse:
    """
    Update settings for the current user's tenant (partial update).

    Requires ADMIN role. Only `name` is editable. privacy_salt is never exposed.
    Blank name returns 422.
    """
    ctx = PermissionContext(user)
    ctx.require_admin()

    service = TenantSettingsService(db)
    result = await service.update(tenant_id=ctx.tenant_id, patch=body)

    if result is None:
        raise HTTPException(status_code=404, detail="Tenant not found")

    return result
