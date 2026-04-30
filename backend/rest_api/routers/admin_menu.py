"""
Admin menu CRUD router — thin HTTP adapter.

Clean Architecture rules:
  - ZERO business logic here — everything delegates to domain services
  - Only: parse request, build PermissionContext, call service, return response
  - NEVER query DB directly from a router

Endpoints:
  Categories:
    POST   /categories           → create category (ADMIN/MANAGER)
    GET    /categories           → list by branch_id (any authenticated)
    GET    /categories/{id}      → get single (any authenticated)
    PUT    /categories/{id}      → update (ADMIN/MANAGER)
    DELETE /categories/{id}      → soft-delete + cascade (ADMIN only)

  Subcategories:
    POST   /subcategories        → create (ADMIN/MANAGER)
    GET    /subcategories        → list by category_id (any authenticated)
    GET    /subcategories/{id}   → get single (any authenticated)
    PUT    /subcategories/{id}   → update (ADMIN/MANAGER)
    DELETE /subcategories/{id}   → soft-delete + cascade (ADMIN only)

  Products:
    POST   /products             → create (ADMIN/MANAGER)
    GET    /products             → list by subcategory_id (any authenticated)
    GET    /products/{id}        → get single (any authenticated)
    PUT    /products/{id}        → update (ADMIN/MANAGER)
    DELETE /products/{id}        → soft-delete + cascade (ADMIN only)

  Branch Products:
    POST   /branch-products      → create (ADMIN/MANAGER)
    GET    /branch-products      → list by branch_id (any authenticated)
    PUT    /branch-products/{id} → update price/availability (ADMIN/MANAGER)
    DELETE /branch-products/{id} → soft-delete (ADMIN only)

RBAC per spec:
  - Create/Update: require_management() → ADMIN or MANAGER
  - Delete: require_admin() → ADMIN only
  - Read (list/get): require_management() for admin access (KITCHEN/WAITER: 403)
"""
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from shared.infrastructure.db import get_db
from shared.utils.exceptions import NotFoundError, ValidationError
from rest_api.core.dependencies import current_user
from rest_api.schemas.menu import (
    BranchProductCreate,
    BranchProductResponse,
    BranchProductUpdate,
    CategoryCreate,
    CategoryResponse,
    CategoryUpdate,
    ProductCreate,
    ProductResponse,
    ProductUpdate,
    SubcategoryCreate,
    SubcategoryResponse,
    SubcategoryUpdate,
)
from rest_api.services.domain.category_service import CategoryService
from rest_api.services.domain.product_service import ProductService
from rest_api.services.domain.subcategory_service import SubcategoryService
from rest_api.services.permissions import PermissionContext

router = APIRouter(tags=["admin-menu"])


def _handle_not_found(exc: NotFoundError) -> HTTPException:
    return HTTPException(status_code=404, detail=str(exc))


def _handle_validation(exc: ValidationError) -> HTTPException:
    return HTTPException(status_code=422, detail=str(exc))


def _handle_conflict(exc: ValidationError) -> HTTPException:
    """ValidationError that represents a uniqueness conflict → 409."""
    return HTTPException(status_code=409, detail=str(exc))


# ── Categories ────────────────────────────────────────────────────────────────

@router.post(
    "/categories",
    response_model=CategoryResponse,
    status_code=201,
    summary="Create a menu category (ADMIN/MANAGER)",
)
async def create_category(
    body: CategoryCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[dict, Depends(current_user)],
) -> CategoryResponse:
    ctx = PermissionContext(user)
    ctx.require_management()
    ctx.require_branch_access(body.branch_id)
    service = CategoryService(db)
    try:
        return await service.create(data=body, tenant_id=ctx.tenant_id, user_id=ctx.user_id)
    except ValidationError as exc:
        raise _handle_validation(exc)


@router.get(
    "/categories",
    response_model=list[CategoryResponse],
    summary="List categories by branch (ADMIN/MANAGER)",
)
async def list_categories(
    branch_id: int = Query(..., description="Filter by branch ID"),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> list[CategoryResponse]:
    ctx = PermissionContext(user)
    ctx.require_management()
    ctx.require_branch_access(branch_id)
    service = CategoryService(db)
    try:
        return await service.list_by_branch(
            tenant_id=ctx.tenant_id,
            branch_id=branch_id,
            limit=limit,
            offset=offset,
        )
    except (NotFoundError, ValidationError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get(
    "/categories/{category_id}",
    response_model=CategoryResponse,
    summary="Get a category by ID (ADMIN/MANAGER)",
)
async def get_category(
    category_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> CategoryResponse:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = CategoryService(db)
    try:
        return await service.get_by_id(category_id=category_id, tenant_id=ctx.tenant_id)
    except NotFoundError as exc:
        raise _handle_not_found(exc)


@router.put(
    "/categories/{category_id}",
    response_model=CategoryResponse,
    summary="Update a category (ADMIN/MANAGER)",
)
async def update_category(
    category_id: int,
    body: CategoryUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> CategoryResponse:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = CategoryService(db)
    try:
        # Validate user has access to the category's branch
        existing = await service.get_by_id(category_id=category_id, tenant_id=ctx.tenant_id)
        ctx.require_branch_access(existing.branch_id)
        return await service.update(
            category_id=category_id,
            data=body,
            tenant_id=ctx.tenant_id,
            user_id=ctx.user_id,
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)
    except ValidationError as exc:
        raise _handle_validation(exc)


@router.delete(
    "/categories/{category_id}",
    summary="Delete a category + cascade (ADMIN only)",
)
async def delete_category(
    category_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> dict[str, Any]:
    ctx = PermissionContext(user)
    ctx.require_admin()  # Delete is ADMIN-only per spec
    service = CategoryService(db)
    try:
        existing = await service.get_by_id(category_id=category_id, tenant_id=ctx.tenant_id)
        ctx.require_branch_access(existing.branch_id)
        return await service.delete(
            category_id=category_id,
            tenant_id=ctx.tenant_id,
            user_id=ctx.user_id,
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)


# ── Subcategories ─────────────────────────────────────────────────────────────

@router.post(
    "/subcategories",
    response_model=SubcategoryResponse,
    status_code=201,
    summary="Create a subcategory (ADMIN/MANAGER)",
)
async def create_subcategory(
    body: SubcategoryCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> SubcategoryResponse:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = SubcategoryService(db)
    try:
        return await service.create(data=body, tenant_id=ctx.tenant_id, user_id=ctx.user_id)
    except ValidationError as exc:
        raise _handle_validation(exc)


@router.get(
    "/subcategories",
    response_model=list[SubcategoryResponse],
    summary="List subcategories by category (ADMIN/MANAGER)",
)
async def list_subcategories(
    category_id: int = Query(..., description="Filter by category ID"),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> list[SubcategoryResponse]:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = SubcategoryService(db)
    try:
        return await service.list_by_category(
            tenant_id=ctx.tenant_id,
            category_id=category_id,
            limit=limit,
            offset=offset,
        )
    except (NotFoundError, ValidationError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get(
    "/subcategories/{subcategory_id}",
    response_model=SubcategoryResponse,
    summary="Get a subcategory by ID (ADMIN/MANAGER)",
)
async def get_subcategory(
    subcategory_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> SubcategoryResponse:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = SubcategoryService(db)
    try:
        return await service.get_by_id(
            subcategory_id=subcategory_id, tenant_id=ctx.tenant_id
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)


@router.put(
    "/subcategories/{subcategory_id}",
    response_model=SubcategoryResponse,
    summary="Update a subcategory (ADMIN/MANAGER)",
)
async def update_subcategory(
    subcategory_id: int,
    body: SubcategoryUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> SubcategoryResponse:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = SubcategoryService(db)
    try:
        return await service.update(
            subcategory_id=subcategory_id,
            data=body,
            tenant_id=ctx.tenant_id,
            user_id=ctx.user_id,
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)
    except ValidationError as exc:
        raise _handle_validation(exc)


@router.delete(
    "/subcategories/{subcategory_id}",
    summary="Delete a subcategory + cascade (ADMIN only)",
)
async def delete_subcategory(
    subcategory_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> dict[str, Any]:
    ctx = PermissionContext(user)
    ctx.require_admin()
    service = SubcategoryService(db)
    try:
        return await service.delete(
            subcategory_id=subcategory_id,
            tenant_id=ctx.tenant_id,
            user_id=ctx.user_id,
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)


# ── Products ──────────────────────────────────────────────────────────────────

@router.post(
    "/products",
    response_model=ProductResponse,
    status_code=201,
    summary="Create a product (ADMIN/MANAGER)",
)
async def create_product(
    body: ProductCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> ProductResponse:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = ProductService(db)
    try:
        return await service.create(data=body, tenant_id=ctx.tenant_id, user_id=ctx.user_id)
    except ValidationError as exc:
        raise _handle_validation(exc)


@router.get(
    "/products",
    response_model=list[ProductResponse],
    summary="List products by subcategory (ADMIN/MANAGER)",
)
async def list_products(
    subcategory_id: int = Query(..., description="Filter by subcategory ID"),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> list[ProductResponse]:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = ProductService(db)
    try:
        return await service.list_by_subcategory(
            tenant_id=ctx.tenant_id,
            subcategory_id=subcategory_id,
            limit=limit,
            offset=offset,
        )
    except (NotFoundError, ValidationError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get(
    "/products/{product_id}",
    response_model=ProductResponse,
    summary="Get a product by ID (ADMIN/MANAGER)",
)
async def get_product(
    product_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> ProductResponse:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = ProductService(db)
    try:
        return await service.get_by_id(product_id=product_id, tenant_id=ctx.tenant_id)
    except NotFoundError as exc:
        raise _handle_not_found(exc)


@router.put(
    "/products/{product_id}",
    response_model=ProductResponse,
    summary="Update a product (ADMIN/MANAGER)",
)
async def update_product(
    product_id: int,
    body: ProductUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> ProductResponse:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = ProductService(db)
    try:
        return await service.update(
            product_id=product_id,
            data=body,
            tenant_id=ctx.tenant_id,
            user_id=ctx.user_id,
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)
    except ValidationError as exc:
        raise _handle_validation(exc)


@router.delete(
    "/products/{product_id}",
    summary="Delete a product + cascade (ADMIN only)",
)
async def delete_product(
    product_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> dict[str, Any]:
    ctx = PermissionContext(user)
    ctx.require_admin()
    service = ProductService(db)
    try:
        return await service.delete(
            product_id=product_id,
            tenant_id=ctx.tenant_id,
            user_id=ctx.user_id,
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)


# ── Branch Products ───────────────────────────────────────────────────────────

@router.post(
    "/branch-products",
    response_model=BranchProductResponse,
    status_code=201,
    summary="Create a branch-product record (ADMIN/MANAGER)",
)
async def create_branch_product(
    body: BranchProductCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> BranchProductResponse:
    ctx = PermissionContext(user)
    ctx.require_management()
    ctx.require_branch_access(body.branch_id)
    service = ProductService(db)
    try:
        return await service.create_branch_product(
            data=body, tenant_id=ctx.tenant_id, user_id=ctx.user_id
        )
    except ValidationError as exc:
        # Duplicate check → 409
        if "Ya existe" in str(exc):
            raise _handle_conflict(exc)
        raise _handle_validation(exc)


@router.get(
    "/branch-products",
    response_model=list[BranchProductResponse],
    summary="List branch-products by branch (ADMIN/MANAGER)",
)
async def list_branch_products(
    branch_id: int = Query(..., description="Filter by branch ID"),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> list[BranchProductResponse]:
    ctx = PermissionContext(user)
    ctx.require_management()
    ctx.require_branch_access(branch_id)
    service = ProductService(db)
    return await service.list_branch_products(
        tenant_id=ctx.tenant_id,
        branch_id=branch_id,
        limit=limit,
        offset=offset,
    )


@router.put(
    "/branch-products/{bp_id}",
    response_model=BranchProductResponse,
    summary="Update branch-product price/availability (ADMIN/MANAGER)",
)
async def update_branch_product(
    bp_id: int,
    body: BranchProductUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> BranchProductResponse:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = ProductService(db)
    try:
        return await service.update_branch_product(
            bp_id=bp_id,
            data=body,
            tenant_id=ctx.tenant_id,
            user_id=ctx.user_id,
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)
    except ValidationError as exc:
        raise _handle_validation(exc)


@router.delete(
    "/branch-products/{bp_id}",
    status_code=204,
    summary="Delete a branch-product record (ADMIN only)",
)
async def delete_branch_product(
    bp_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(current_user),
) -> None:
    ctx = PermissionContext(user)
    ctx.require_admin()
    service = ProductService(db)
    try:
        await service.delete_branch_product(
            bp_id=bp_id,
            tenant_id=ctx.tenant_id,
            user_id=ctx.user_id,
        )
    except NotFoundError as exc:
        raise _handle_not_found(exc)
