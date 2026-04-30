"""
Ingredients router — thin HTTP adapter for the ingredient hierarchy.

Endpoints under /api/admin/ingredients:
  GET    /                                            — list groups (paginated)
  POST   /                                            — create group
  GET    /{group_id}                                  — get group with children
  PUT    /{group_id}                                  — update group
  DELETE /{group_id}                                  — cascade soft-delete group

  GET    /{group_id}/items                            — list ingredients in group
  POST   /{group_id}/items                            — create ingredient
  GET    /{group_id}/items/{ingredient_id}            — get ingredient with subs
  PUT    /{group_id}/items/{ingredient_id}            — update ingredient
  DELETE /{group_id}/items/{ingredient_id}            — cascade soft-delete ingredient

  GET    /{group_id}/items/{ingredient_id}/subs       — list sub-ingredients
  POST   /{group_id}/items/{ingredient_id}/subs       — create sub-ingredient
  PUT    /{group_id}/items/{ingredient_id}/subs/{id}  — update sub-ingredient
  DELETE /{group_id}/items/{ingredient_id}/subs/{id}  — soft-delete sub-ingredient

All endpoints require ADMIN role (via PermissionContext).
Business logic lives entirely in IngredientService — routers are thin adapters only.
"""
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from shared.infrastructure.db import get_db
from shared.utils.exceptions import NotFoundError, ValidationError
from rest_api.core.dependencies import current_user
from rest_api.services.permissions import PermissionContext
from rest_api.services.domain.ingredient_service import IngredientService
from rest_api.schemas.ingredient import (
    IngredientGroupCreate,
    IngredientGroupOut,
    IngredientGroupUpdate,
    IngredientCreate,
    IngredientOut,
    IngredientUpdate,
    SubIngredientCreate,
    SubIngredientOut,
    SubIngredientUpdate,
)

router = APIRouter(tags=["ingredients"])


def _require_admin(user: dict) -> PermissionContext:
    """Dependency: parse user dict into PermissionContext and require ADMIN role."""
    ctx = PermissionContext(user)
    ctx.require_admin()
    return ctx


def _handle_service_error(exc: Exception) -> None:
    """Convert domain exceptions to appropriate HTTP errors."""
    if isinstance(exc, NotFoundError):
        raise HTTPException(status_code=404, detail=exc.message)
    if isinstance(exc, ValidationError):
        raise HTTPException(status_code=409, detail=exc.message)
    raise exc


# ── IngredientGroup endpoints ──────────────────────────────────────────────────

@router.get(
    "",
    response_model=list[IngredientGroupOut],
    summary="List all ingredient groups for the authenticated tenant",
)
async def list_groups(
    user: Annotated[dict, Depends(current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> Any:
    ctx = _require_admin(user)
    svc = IngredientService(db)
    return await svc.list_groups(tenant_id=ctx.tenant_id, limit=limit, offset=offset)


@router.post(
    "",
    response_model=IngredientGroupOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create an ingredient group",
)
async def create_group(
    body: IngredientGroupCreate,
    user: Annotated[dict, Depends(current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Any:
    ctx = _require_admin(user)
    svc = IngredientService(db)
    try:
        return await svc.create_group(body, tenant_id=ctx.tenant_id)
    except Exception as exc:
        _handle_service_error(exc)


@router.get(
    "/{group_id}",
    response_model=IngredientGroupOut,
    summary="Get an ingredient group with all its child ingredients",
)
async def get_group(
    group_id: int,
    user: Annotated[dict, Depends(current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Any:
    ctx = _require_admin(user)
    svc = IngredientService(db)
    try:
        return await svc.get_group(group_id, tenant_id=ctx.tenant_id)
    except Exception as exc:
        _handle_service_error(exc)


@router.put(
    "/{group_id}",
    response_model=IngredientGroupOut,
    summary="Update an ingredient group",
)
async def update_group(
    group_id: int,
    body: IngredientGroupUpdate,
    user: Annotated[dict, Depends(current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Any:
    ctx = _require_admin(user)
    svc = IngredientService(db)
    try:
        return await svc.update_group(group_id, body, tenant_id=ctx.tenant_id)
    except Exception as exc:
        _handle_service_error(exc)


@router.delete(
    "/{group_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Cascade soft-delete an ingredient group (and all its children)",
)
async def delete_group(
    group_id: int,
    user: Annotated[dict, Depends(current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    ctx = _require_admin(user)
    svc = IngredientService(db)
    try:
        await svc.delete_group(group_id, tenant_id=ctx.tenant_id, user_id=ctx.user_id)
    except Exception as exc:
        _handle_service_error(exc)


# ── Ingredient endpoints ───────────────────────────────────────────────────────

@router.get(
    "/{group_id}/items",
    response_model=list[IngredientOut],
    summary="List ingredients in a group",
)
async def list_ingredients(
    group_id: int,
    user: Annotated[dict, Depends(current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> Any:
    ctx = _require_admin(user)
    svc = IngredientService(db)
    try:
        return await svc.list_ingredients(
            group_id=group_id, tenant_id=ctx.tenant_id, limit=limit, offset=offset
        )
    except Exception as exc:
        _handle_service_error(exc)


@router.post(
    "/{group_id}/items",
    response_model=IngredientOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create an ingredient within a group",
)
async def create_ingredient(
    group_id: int,
    body: IngredientCreate,
    user: Annotated[dict, Depends(current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Any:
    ctx = _require_admin(user)
    svc = IngredientService(db)
    try:
        return await svc.create_ingredient(group_id, body, tenant_id=ctx.tenant_id)
    except Exception as exc:
        _handle_service_error(exc)


@router.get(
    "/{group_id}/items/{ingredient_id}",
    response_model=IngredientOut,
    summary="Get an ingredient with its sub-ingredients",
)
async def get_ingredient(
    group_id: int,
    ingredient_id: int,
    user: Annotated[dict, Depends(current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Any:
    ctx = _require_admin(user)
    svc = IngredientService(db)
    try:
        return await svc.get_ingredient(group_id, ingredient_id, tenant_id=ctx.tenant_id)
    except Exception as exc:
        _handle_service_error(exc)


@router.put(
    "/{group_id}/items/{ingredient_id}",
    response_model=IngredientOut,
    summary="Update an ingredient",
)
async def update_ingredient(
    group_id: int,
    ingredient_id: int,
    body: IngredientUpdate,
    user: Annotated[dict, Depends(current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Any:
    ctx = _require_admin(user)
    svc = IngredientService(db)
    try:
        return await svc.update_ingredient(
            group_id, ingredient_id, body, tenant_id=ctx.tenant_id
        )
    except Exception as exc:
        _handle_service_error(exc)


@router.delete(
    "/{group_id}/items/{ingredient_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Cascade soft-delete an ingredient (and its sub-ingredients)",
)
async def delete_ingredient(
    group_id: int,
    ingredient_id: int,
    user: Annotated[dict, Depends(current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    ctx = _require_admin(user)
    svc = IngredientService(db)
    try:
        await svc.delete_ingredient(
            group_id, ingredient_id, tenant_id=ctx.tenant_id, user_id=ctx.user_id
        )
    except Exception as exc:
        _handle_service_error(exc)


# ── SubIngredient endpoints ────────────────────────────────────────────────────

@router.get(
    "/{group_id}/items/{ingredient_id}/subs",
    response_model=list[SubIngredientOut],
    summary="List sub-ingredients for an ingredient",
)
async def list_sub_ingredients(
    group_id: int,
    ingredient_id: int,
    user: Annotated[dict, Depends(current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> Any:
    ctx = _require_admin(user)
    svc = IngredientService(db)
    try:
        return await svc.list_sub_ingredients(
            group_id, ingredient_id, tenant_id=ctx.tenant_id, limit=limit, offset=offset
        )
    except Exception as exc:
        _handle_service_error(exc)


@router.post(
    "/{group_id}/items/{ingredient_id}/subs",
    response_model=SubIngredientOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a sub-ingredient within an ingredient",
)
async def create_sub_ingredient(
    group_id: int,
    ingredient_id: int,
    body: SubIngredientCreate,
    user: Annotated[dict, Depends(current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Any:
    ctx = _require_admin(user)
    svc = IngredientService(db)
    try:
        return await svc.create_sub_ingredient(
            group_id, ingredient_id, body, tenant_id=ctx.tenant_id
        )
    except Exception as exc:
        _handle_service_error(exc)


@router.put(
    "/{group_id}/items/{ingredient_id}/subs/{sub_id}",
    response_model=SubIngredientOut,
    summary="Update a sub-ingredient",
)
async def update_sub_ingredient(
    group_id: int,
    ingredient_id: int,
    sub_id: int,
    body: SubIngredientUpdate,
    user: Annotated[dict, Depends(current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Any:
    ctx = _require_admin(user)
    svc = IngredientService(db)
    try:
        return await svc.update_sub_ingredient(
            group_id, ingredient_id, sub_id, body, tenant_id=ctx.tenant_id
        )
    except Exception as exc:
        _handle_service_error(exc)


@router.delete(
    "/{group_id}/items/{ingredient_id}/subs/{sub_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete a sub-ingredient",
)
async def delete_sub_ingredient(
    group_id: int,
    ingredient_id: int,
    sub_id: int,
    user: Annotated[dict, Depends(current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    ctx = _require_admin(user)
    svc = IngredientService(db)
    try:
        await svc.delete_sub_ingredient(
            group_id, ingredient_id, sub_id,
            tenant_id=ctx.tenant_id, user_id=ctx.user_id
        )
    except Exception as exc:
        _handle_service_error(exc)
