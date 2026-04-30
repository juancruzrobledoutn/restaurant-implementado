"""
Recipes router — thin HTTP adapter for recipe management.

Endpoints under /api/recipes:
  GET    /           — list recipes (KITCHEN, MANAGER, ADMIN)
  POST   /           — create recipe (KITCHEN, MANAGER, ADMIN)
  GET    /{id}       — get recipe detail (KITCHEN, MANAGER, ADMIN)
  PUT    /{id}       — update recipe (KITCHEN, MANAGER, ADMIN)
  DELETE /{id}       — soft-delete recipe (ADMIN only)

RBAC:
  - Read / Create / Update: KITCHEN, MANAGER, ADMIN
  - Delete: ADMIN only

All business logic is delegated to RecipeService.
"""
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from shared.infrastructure.db import get_db
from shared.utils.exceptions import NotFoundError, ValidationError
from rest_api.core.dependencies import current_user
from rest_api.services.permissions import PermissionContext
from rest_api.services.domain.recipe_service import RecipeService
from rest_api.schemas.recipe import RecipeCreate, RecipeOut, RecipeUpdate

router = APIRouter(tags=["recipes"])


def _require_read_write(user: dict) -> PermissionContext:
    """Require KITCHEN, MANAGER, or ADMIN role for read/create/update operations."""
    ctx = PermissionContext(user)
    ctx.require_management()
    return ctx


def _require_admin(user: dict) -> PermissionContext:
    """Require ADMIN role for delete operations."""
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


@router.get(
    "",
    response_model=list[RecipeOut],
    summary="List all recipes for the tenant",
)
async def list_recipes(
    user: Annotated[dict, Depends(current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> Any:
    ctx = _require_read_write(user)
    svc = RecipeService(db)
    return await svc.list_recipes(tenant_id=ctx.tenant_id, limit=limit, offset=offset)


@router.post(
    "",
    response_model=RecipeOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a recipe",
)
async def create_recipe(
    body: RecipeCreate,
    user: Annotated[dict, Depends(current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Any:
    ctx = _require_read_write(user)
    svc = RecipeService(db)
    try:
        return await svc.create_recipe(body, tenant_id=ctx.tenant_id)
    except Exception as exc:
        _handle_service_error(exc)


@router.get(
    "/{recipe_id}",
    response_model=RecipeOut,
    summary="Get a recipe with ingredient details",
)
async def get_recipe(
    recipe_id: int,
    user: Annotated[dict, Depends(current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Any:
    ctx = _require_read_write(user)
    svc = RecipeService(db)
    try:
        return await svc.get_recipe(recipe_id, tenant_id=ctx.tenant_id)
    except Exception as exc:
        _handle_service_error(exc)


@router.put(
    "/{recipe_id}",
    response_model=RecipeOut,
    summary="Update a recipe (ingredient list replaced atomically if provided)",
)
async def update_recipe(
    recipe_id: int,
    body: RecipeUpdate,
    user: Annotated[dict, Depends(current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Any:
    ctx = _require_read_write(user)
    svc = RecipeService(db)
    try:
        return await svc.update_recipe(recipe_id, body, tenant_id=ctx.tenant_id)
    except Exception as exc:
        _handle_service_error(exc)


@router.delete(
    "/{recipe_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete a recipe (ADMIN only)",
)
async def delete_recipe(
    recipe_id: int,
    user: Annotated[dict, Depends(current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    ctx = _require_admin(user)
    svc = RecipeService(db)
    try:
        await svc.delete_recipe(recipe_id, tenant_id=ctx.tenant_id, user_id=ctx.user_id)
    except Exception as exc:
        _handle_service_error(exc)
