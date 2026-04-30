"""
Admin promotions router — thin HTTP adapter.

Clean Architecture rules:
  - ZERO business logic — delegates all to PromotionService
  - Only: parse request, build PermissionContext, call service, return response

Endpoints:
  GET    /api/admin/promotions                            → list paginated (ADMIN/MANAGER)
  GET    /api/admin/promotions/{id}                       → get single (ADMIN/MANAGER)
  POST   /api/admin/promotions                            → create (ADMIN/MANAGER) — 201
  PATCH  /api/admin/promotions/{id}                       → update metadata (ADMIN/MANAGER)
  DELETE /api/admin/promotions/{id}                       → soft-delete (ADMIN only) — 204
  POST   /api/admin/promotions/{id}/branches              → link branch (ADMIN/MANAGER)
  DELETE /api/admin/promotions/{id}/branches/{branch_id}  → unlink branch (ADMIN/MANAGER)
  POST   /api/admin/promotions/{id}/products              → link product (ADMIN/MANAGER)
  DELETE /api/admin/promotions/{id}/products/{product_id} → unlink product (ADMIN/MANAGER)

RBAC:
  - Create/Update/Link: require_management() → ADMIN or MANAGER
  - Delete: require_admin() → ADMIN only (403 for MANAGER)
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from shared.infrastructure.db import get_db
from shared.utils.exceptions import ForbiddenError, NotFoundError, ValidationError
from rest_api.core.dependencies import current_user
from rest_api.schemas.promotion import PromotionCreate, PromotionOut, PromotionUpdate
from rest_api.services.domain.promotion_service import PromotionService
from rest_api.services.permissions import PermissionContext

router = APIRouter(tags=["admin-promotions"])


def _handle_not_found(exc: NotFoundError) -> HTTPException:
    return HTTPException(status_code=404, detail=str(exc))


def _handle_validation(exc: ValidationError) -> HTTPException:
    return HTTPException(status_code=422, detail=str(exc))


def _handle_forbidden(exc: ForbiddenError) -> HTTPException:
    return HTTPException(status_code=403, detail=str(exc))


@router.get(
    "/promotions",
    response_model=list[PromotionOut],
    summary="List promotions (ADMIN/MANAGER)",
)
async def list_promotions(
    branch_id: Optional[int] = Query(default=None, description="Filter by branch ID"),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> list[PromotionOut]:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = PromotionService(db)

    if branch_id is not None:
        return await service.list_for_branch(
            tenant_id=ctx.tenant_id,
            branch_id=branch_id,
            limit=limit,
            offset=offset,
        )
    return await service.list_for_tenant(
        tenant_id=ctx.tenant_id,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/promotions/{promotion_id}",
    response_model=PromotionOut,
    summary="Get promotion by ID (ADMIN/MANAGER)",
)
async def get_promotion(
    promotion_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> PromotionOut:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = PromotionService(db)
    try:
        return await service.get_by_id(promotion_id=promotion_id, tenant_id=ctx.tenant_id)
    except NotFoundError as exc:
        raise _handle_not_found(exc)


@router.post(
    "/promotions",
    response_model=PromotionOut,
    status_code=201,
    summary="Create promotion (ADMIN/MANAGER)",
)
async def create_promotion(
    body: PromotionCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> PromotionOut:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = PromotionService(db)
    try:
        return await service.create(
            data=body,
            tenant_id=ctx.tenant_id,
            actor_user_id=ctx.user_id,
        )
    except ValidationError as exc:
        raise _handle_validation(exc)
    except ForbiddenError as exc:
        raise _handle_forbidden(exc)


@router.patch(
    "/promotions/{promotion_id}",
    response_model=PromotionOut,
    summary="Update promotion metadata (ADMIN/MANAGER)",
)
async def update_promotion(
    promotion_id: int,
    body: PromotionUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> PromotionOut:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = PromotionService(db)
    try:
        return await service.update(
            promotion_id=promotion_id,
            data=body,
            tenant_id=ctx.tenant_id,
            actor_user_id=ctx.user_id,
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)
    except ValidationError as exc:
        raise _handle_validation(exc)


@router.delete(
    "/promotions/{promotion_id}",
    status_code=204,
    summary="Soft-delete promotion (ADMIN only)",
)
async def delete_promotion(
    promotion_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> None:
    ctx = PermissionContext(user)
    ctx.require_admin()  # ADMIN only — 403 for MANAGER
    service = PromotionService(db)
    try:
        await service.soft_delete(
            promotion_id=promotion_id,
            tenant_id=ctx.tenant_id,
            actor_user_id=ctx.user_id,
            actor_roles=ctx.roles,
        )
    except ForbiddenError as exc:
        raise _handle_forbidden(exc)
    except NotFoundError as exc:
        raise _handle_not_found(exc)


# ── Branch linking ──────────────────────────────────────────────────────────────

@router.post(
    "/promotions/{promotion_id}/branches",
    response_model=PromotionOut,
    summary="Link branch to promotion (ADMIN/MANAGER)",
)
async def link_promotion_branch(
    promotion_id: int,
    branch_id: int = Query(..., description="Branch ID to link"),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> PromotionOut:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = PromotionService(db)
    try:
        return await service.link_branch(
            promotion_id=promotion_id,
            branch_id=branch_id,
            tenant_id=ctx.tenant_id,
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)
    except ForbiddenError as exc:
        raise _handle_forbidden(exc)


@router.delete(
    "/promotions/{promotion_id}/branches/{branch_id}",
    status_code=204,
    summary="Unlink branch from promotion (ADMIN/MANAGER)",
)
async def unlink_promotion_branch(
    promotion_id: int,
    branch_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> None:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = PromotionService(db)
    try:
        await service.unlink_branch(
            promotion_id=promotion_id,
            branch_id=branch_id,
            tenant_id=ctx.tenant_id,
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)


# ── Product linking ─────────────────────────────────────────────────────────────

@router.post(
    "/promotions/{promotion_id}/products",
    response_model=PromotionOut,
    summary="Link product to promotion (ADMIN/MANAGER)",
)
async def link_promotion_product(
    promotion_id: int,
    product_id: int = Query(..., description="Product ID to link"),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> PromotionOut:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = PromotionService(db)
    try:
        return await service.link_product(
            promotion_id=promotion_id,
            product_id=product_id,
            tenant_id=ctx.tenant_id,
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)
    except ForbiddenError as exc:
        raise _handle_forbidden(exc)


@router.delete(
    "/promotions/{promotion_id}/products/{product_id}",
    status_code=204,
    summary="Unlink product from promotion (ADMIN/MANAGER)",
)
async def unlink_promotion_product(
    promotion_id: int,
    product_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> None:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = PromotionService(db)
    try:
        await service.unlink_product(
            promotion_id=promotion_id,
            product_id=product_id,
            tenant_id=ctx.tenant_id,
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)
