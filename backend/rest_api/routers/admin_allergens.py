"""
Admin allergens router — thin HTTP adapter.

Clean Architecture rules:
  - ZERO business logic here — everything delegates to AllergenService
  - Only: parse request, build PermissionContext, call service, return response
  - NEVER query DB directly from a router

Endpoints:
  Allergen CRUD:
    POST   /allergens                           → create allergen (ADMIN/MANAGER)
    GET    /allergens                           → list all for tenant (any management)
    GET    /allergens/{id}                      → get single (any management)
    PUT    /allergens/{id}                      → update (ADMIN/MANAGER)
    DELETE /allergens/{id}                      → soft-delete + cascade (ADMIN only)

  Product-Allergen linking:
    POST   /products/{product_id}/allergens     → link allergen (ADMIN/MANAGER)
    GET    /products/{product_id}/allergens     → list product allergens (any management)
    DELETE /products/{product_id}/allergens/{allergen_id} → unlink (ADMIN/MANAGER)

  Cross-reactions:
    POST   /allergens/{id}/cross-reactions      → create bidirectional (ADMIN/MANAGER)
    GET    /allergens/{id}/cross-reactions      → list (any management)
    DELETE /allergens/{id}/cross-reactions/{related_id} → delete both directions (ADMIN/MANAGER)

RBAC per spec:
  - CRITICO governance — no code changes without review
  - Create/Update/Link: require_management() → ADMIN or MANAGER
  - Delete: require_admin() → ADMIN only (allergens and cross-reactions)
  - Unlink product-allergen: require_management() (MANAGER allowed)
  - Read (list/get): require_management() — KITCHEN/WAITER: 403
"""
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from shared.infrastructure.db import get_db
from shared.utils.exceptions import NotFoundError, ValidationError
from rest_api.core.dependencies import current_user
from rest_api.schemas.allergen import (
    AllergenCreate,
    AllergenResponse,
    AllergenUpdate,
    CrossReactionCreate,
    CrossReactionResponse,
    ProductAllergenCreate,
    ProductAllergenResponse,
)
from rest_api.services.domain.allergen_service import AllergenService
from rest_api.services.permissions import PermissionContext

router = APIRouter(tags=["admin-allergens"])


def _handle_not_found(exc: NotFoundError) -> HTTPException:
    return HTTPException(status_code=404, detail=str(exc))


def _handle_validation(exc: ValidationError) -> HTTPException:
    return HTTPException(status_code=422, detail=str(exc))


def _handle_conflict(exc: ValidationError) -> HTTPException:
    """ValidationError that represents a uniqueness conflict → 409."""
    return HTTPException(status_code=409, detail=str(exc))


# ── Allergen CRUD ──────────────────────────────────────────────────────────────

@router.post(
    "/allergens",
    response_model=AllergenResponse,
    status_code=201,
    summary="Create an allergen (ADMIN/MANAGER)",
)
async def create_allergen(
    body: AllergenCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> AllergenResponse:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = AllergenService(db)
    try:
        return await service.create(data=body, tenant_id=ctx.tenant_id, user_id=ctx.user_id)
    except ValidationError as exc:
        raise _handle_validation(exc)


@router.get(
    "/allergens",
    response_model=list[AllergenResponse],
    summary="List all allergens for the tenant (ADMIN/MANAGER)",
)
async def list_allergens(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> list[AllergenResponse]:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = AllergenService(db)
    return await service.list_all(
        tenant_id=ctx.tenant_id,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/allergens/{allergen_id}",
    response_model=AllergenResponse,
    summary="Get an allergen by ID (ADMIN/MANAGER)",
)
async def get_allergen(
    allergen_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> AllergenResponse:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = AllergenService(db)
    try:
        return await service.get_by_id(allergen_id=allergen_id, tenant_id=ctx.tenant_id)
    except NotFoundError as exc:
        raise _handle_not_found(exc)


@router.put(
    "/allergens/{allergen_id}",
    response_model=AllergenResponse,
    summary="Update an allergen (ADMIN/MANAGER)",
)
async def update_allergen(
    allergen_id: int,
    body: AllergenUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> AllergenResponse:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = AllergenService(db)
    try:
        return await service.update(
            allergen_id=allergen_id,
            data=body,
            tenant_id=ctx.tenant_id,
            user_id=ctx.user_id,
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)
    except ValidationError as exc:
        raise _handle_validation(exc)


@router.delete(
    "/allergens/{allergen_id}",
    summary="Soft-delete an allergen + cascade (ADMIN only)",
)
async def delete_allergen(
    allergen_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> dict[str, Any]:
    ctx = PermissionContext(user)
    ctx.require_admin()  # Delete is ADMIN-only per spec and CRITICO governance
    service = AllergenService(db)
    try:
        return await service.delete(
            allergen_id=allergen_id,
            tenant_id=ctx.tenant_id,
            user_id=ctx.user_id,
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)


# ── Product-Allergen linking ────────────────────────────────────────────────────

@router.post(
    "/products/{product_id}/allergens",
    response_model=ProductAllergenResponse,
    status_code=201,
    summary="Link an allergen to a product (ADMIN/MANAGER)",
)
async def link_product_allergen(
    product_id: int,
    body: ProductAllergenCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> ProductAllergenResponse:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = AllergenService(db)
    try:
        return await service.link_product(
            product_id=product_id,
            data=body,
            tenant_id=ctx.tenant_id,
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)
    except ValidationError as exc:
        # Duplicate link → 409
        if "already linked" in str(exc):
            raise _handle_conflict(exc)
        raise _handle_validation(exc)


@router.get(
    "/products/{product_id}/allergens",
    response_model=list[ProductAllergenResponse],
    summary="List allergens linked to a product (ADMIN/MANAGER)",
)
async def list_product_allergens(
    product_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> list[ProductAllergenResponse]:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = AllergenService(db)
    try:
        return await service.list_product_allergens(
            product_id=product_id,
            tenant_id=ctx.tenant_id,
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)


@router.delete(
    "/products/{product_id}/allergens/{allergen_id}",
    status_code=204,
    summary="Unlink an allergen from a product (ADMIN/MANAGER)",
)
async def unlink_product_allergen(
    product_id: int,
    allergen_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> None:
    ctx = PermissionContext(user)
    ctx.require_management()  # MANAGER is allowed to unlink per spec
    service = AllergenService(db)
    try:
        await service.unlink_product(
            product_id=product_id,
            allergen_id=allergen_id,
            tenant_id=ctx.tenant_id,
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)


# ── Cross-reactions ────────────────────────────────────────────────────────────

@router.post(
    "/allergens/{allergen_id}/cross-reactions",
    response_model=CrossReactionResponse,
    status_code=201,
    summary="Create a cross-reaction between two allergens (ADMIN/MANAGER)",
)
async def create_cross_reaction(
    allergen_id: int,
    body: CrossReactionCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> CrossReactionResponse:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = AllergenService(db)
    try:
        return await service.create_cross_reaction(
            allergen_id=allergen_id,
            data=body,
            tenant_id=ctx.tenant_id,
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)
    except ValidationError as exc:
        if "already exists" in str(exc):
            raise _handle_conflict(exc)
        # self-reference → 400
        if "itself" in str(exc):
            raise HTTPException(status_code=400, detail=str(exc))
        raise _handle_validation(exc)


@router.get(
    "/allergens/{allergen_id}/cross-reactions",
    response_model=list[CrossReactionResponse],
    summary="List cross-reactions for an allergen (ADMIN/MANAGER)",
)
async def list_cross_reactions(
    allergen_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> list[CrossReactionResponse]:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = AllergenService(db)
    try:
        return await service.list_cross_reactions(
            allergen_id=allergen_id,
            tenant_id=ctx.tenant_id,
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)


@router.delete(
    "/allergens/{allergen_id}/cross-reactions/{related_id}",
    status_code=204,
    summary="Delete a cross-reaction between two allergens (ADMIN/MANAGER)",
)
async def delete_cross_reaction(
    allergen_id: int,
    related_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> None:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = AllergenService(db)
    try:
        await service.delete_cross_reaction(
            allergen_id=allergen_id,
            related_allergen_id=related_id,
            tenant_id=ctx.tenant_id,
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)
