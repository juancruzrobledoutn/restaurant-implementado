"""
Catalogs router — thin HTTP adapters for tenant-scoped catalog lookup tables.

Generates four sub-routers using a factory pattern to avoid code duplication:
  /api/admin/cooking-methods     — CookingMethod CRUD
  /api/admin/flavor-profiles     — FlavorProfile CRUD
  /api/admin/texture-profiles    — TextureProfile CRUD
  /api/admin/cuisine-types       — CuisineType CRUD

All endpoints require ADMIN role.
Business logic is delegated to CatalogService (generic/parameterized).

Each sub-router has:
  GET    /         — list items (paginated)
  POST   /         — create item
  GET    /{id}     — get item
  PUT    /{id}     — update item
  DELETE /{id}     — soft-delete item
"""
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from shared.infrastructure.db import get_db
from shared.utils.exceptions import NotFoundError, ValidationError
from rest_api.core.dependencies import current_user
from rest_api.services.permissions import PermissionContext
from rest_api.services.domain.catalog_service import CatalogService
from rest_api.models.catalog import CookingMethod, CuisineType, FlavorProfile, TextureProfile
from rest_api.schemas.catalog import CatalogItemCreate, CatalogItemOut, CatalogItemUpdate


def _require_admin(user: dict) -> PermissionContext:
    ctx = PermissionContext(user)
    ctx.require_admin()
    return ctx


def _handle_service_error(exc: Exception) -> None:
    if isinstance(exc, NotFoundError):
        raise HTTPException(status_code=404, detail=exc.message)
    if isinstance(exc, ValidationError):
        raise HTTPException(status_code=409, detail=exc.message)
    raise exc


def _make_catalog_router(model: type, tag: str) -> APIRouter:
    """
    Factory: build a fully wired CRUD router for a catalog model.

    Usage:
        cooking_methods_router = _make_catalog_router(CookingMethod, "cooking-methods")
    """
    router = APIRouter(tags=[tag])

    @router.get(
        "",
        response_model=list[CatalogItemOut],
        summary=f"List all {tag}",
    )
    async def list_items(
        user: Annotated[dict, Depends(current_user)],
        db: Annotated[AsyncSession, Depends(get_db)],
        limit: int = Query(50, ge=1, le=200),
        offset: int = Query(0, ge=0),
    ) -> Any:
        ctx = _require_admin(user)
        svc = CatalogService(db=db, model=model)
        return await svc.list_items(tenant_id=ctx.tenant_id, limit=limit, offset=offset)

    @router.post(
        "",
        response_model=CatalogItemOut,
        status_code=status.HTTP_201_CREATED,
        summary=f"Create a {tag[:-1]} item",  # strip trailing 's'
    )
    async def create_item(
        body: CatalogItemCreate,
        user: Annotated[dict, Depends(current_user)],
        db: Annotated[AsyncSession, Depends(get_db)],
    ) -> Any:
        ctx = _require_admin(user)
        svc = CatalogService(db=db, model=model)
        try:
            return await svc.create_item(body, tenant_id=ctx.tenant_id)
        except Exception as exc:
            _handle_service_error(exc)

    @router.get(
        "/{item_id}",
        response_model=CatalogItemOut,
        summary=f"Get a {tag[:-1]} by ID",
    )
    async def get_item(
        item_id: int,
        user: Annotated[dict, Depends(current_user)],
        db: Annotated[AsyncSession, Depends(get_db)],
    ) -> Any:
        ctx = _require_admin(user)
        svc = CatalogService(db=db, model=model)
        try:
            return await svc.get_item(item_id, tenant_id=ctx.tenant_id)
        except Exception as exc:
            _handle_service_error(exc)

    @router.put(
        "/{item_id}",
        response_model=CatalogItemOut,
        summary=f"Update a {tag[:-1]}",
    )
    async def update_item(
        item_id: int,
        body: CatalogItemUpdate,
        user: Annotated[dict, Depends(current_user)],
        db: Annotated[AsyncSession, Depends(get_db)],
    ) -> Any:
        ctx = _require_admin(user)
        svc = CatalogService(db=db, model=model)
        try:
            return await svc.update_item(item_id, body, tenant_id=ctx.tenant_id)
        except Exception as exc:
            _handle_service_error(exc)

    @router.delete(
        "/{item_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        summary=f"Soft-delete a {tag[:-1]}",
    )
    async def delete_item(
        item_id: int,
        user: Annotated[dict, Depends(current_user)],
        db: Annotated[AsyncSession, Depends(get_db)],
    ) -> None:
        ctx = _require_admin(user)
        svc = CatalogService(db=db, model=model)
        try:
            await svc.delete_item(item_id, tenant_id=ctx.tenant_id, user_id=ctx.user_id)
        except Exception as exc:
            _handle_service_error(exc)

    return router


# ── Concrete routers — one per catalog model ───────────────────────────────────

cooking_methods_router = _make_catalog_router(CookingMethod, "cooking-methods")
flavor_profiles_router = _make_catalog_router(FlavorProfile, "flavor-profiles")
texture_profiles_router = _make_catalog_router(TextureProfile, "texture-profiles")
cuisine_types_router = _make_catalog_router(CuisineType, "cuisine-types")
