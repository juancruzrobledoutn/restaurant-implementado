"""
Public menu router — unauthenticated endpoint for the diner-facing PWA.

GET /api/public/menu/{slug}:
  1. Lookup branch by slug (tenant-agnostic — slug is globally unique in DB)
  2. Check Redis cache (menu:{slug}) → return if hit
  3. If cache miss: query full nested menu with eager loading
  4. Filter: active categories, active subcategories, active products,
             active BranchProduct with is_available=True
  5. Serialize to nested JSON (includes allergens per product)
  6. Store in Redis (5-min TTL)
  7. Return 200

GET /api/public/menu/{slug}/allergens:
  Returns aggregated allergen list for the branch with per-presence_type counts.
  Only includes allergens linked to active, available products.

Returns 404 if branch not found or is_active=False.

NO authentication required — these are the public menu endpoints for diners.
"""
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends
from sqlalchemy.orm import selectinload

from shared.config.logging import get_logger
from shared.infrastructure.db import get_db
from rest_api.models.allergen import Allergen, ProductAllergen
from rest_api.models.branch import Branch
from rest_api.models.menu import BranchProduct, Category, Product, Subcategory
from rest_api.schemas.allergen import PublicAllergenResponse
from rest_api.schemas.menu import (
    PublicBranchInfo,
    PublicCategoryResponse,
    PublicMenuResponse,
    PublicProductAllergenItem,
    PublicProductResponse,
    PublicSubcategoryResponse,
)
from rest_api.services.domain.menu_cache_service import MenuCacheService

router = APIRouter(tags=["public-menu"])
logger = get_logger(__name__)


async def _build_menu(branch: Branch, db: AsyncSession) -> dict[str, Any]:
    """
    Build the full nested menu dict for a branch from the database.

    Queries categories → subcategories → products → branch_products with
    eager loading to avoid N+1 queries. Only includes active + available items.
    """
    # Query categories with nested eager loading (includes product_allergens → allergen)
    result = await db.execute(
        select(Category)
        .where(
            Category.branch_id == branch.id,
            Category.is_active.is_(True),
        )
        .order_by(Category.order)
        .options(
            selectinload(Category.subcategories).selectinload(
                Subcategory.products
            ).selectinload(
                Product.branch_products
            ),
            selectinload(Category.subcategories).selectinload(
                Subcategory.products
            ).selectinload(
                Product.product_allergens
            ).selectinload(
                ProductAllergen.allergen
            ),
        )
    )
    categories = result.scalars().unique().all()

    # Build nested response structure
    category_responses = []
    for cat in categories:
        if not cat.is_active:
            continue

        subcat_responses = []
        for subcat in sorted(
            (s for s in cat.subcategories if s.is_active),
            key=lambda s: s.order,
        ):
            product_responses = []
            for product in (p for p in subcat.products if p.is_active):
                # Find the BranchProduct for this branch
                bp = next(
                    (
                        bp for bp in product.branch_products
                        if bp.branch_id == branch.id
                        and bp.is_active
                        and bp.is_available
                    ),
                    None,
                )
                if bp is None:
                    # Product not available at this branch
                    continue

                # Build allergen items for this product
                allergen_items = [
                    PublicProductAllergenItem(
                        id=pa.allergen.id,
                        name=pa.allergen.name,
                        icon=pa.allergen.icon,
                        presence_type=pa.presence_type,
                        risk_level=pa.risk_level,
                    )
                    for pa in product.product_allergens
                    if pa.allergen and pa.allergen.is_active
                ]

                product_responses.append(
                    PublicProductResponse(
                        id=product.id,
                        name=product.name,
                        description=product.description,
                        price_cents=bp.price_cents,
                        is_available=bp.is_available,
                        image=product.image,
                        featured=product.featured,
                        popular=product.popular,
                        allergens=allergen_items,
                    )
                )

            subcat_responses.append(
                PublicSubcategoryResponse(
                    id=subcat.id,
                    name=subcat.name,
                    image=subcat.image,
                    order=subcat.order,
                    products=product_responses,
                )
            )

        category_responses.append(
            PublicCategoryResponse(
                id=cat.id,
                name=cat.name,
                icon=cat.icon,
                image=cat.image,
                order=cat.order,
                subcategories=subcat_responses,
            )
        )

    menu = PublicMenuResponse(
        branch=PublicBranchInfo(
            id=branch.id,
            name=branch.name,
            slug=branch.slug,
            address=branch.address,
        ),
        categories=category_responses,
    )
    return menu.model_dump()


@router.get(
    "/menu/{slug}",
    response_model=PublicMenuResponse,
    summary="Get the full public menu for a branch by slug (no auth required)",
)
async def get_public_menu(
    slug: str,
    db: AsyncSession = Depends(get_db),
) -> PublicMenuResponse:
    """
    Return the full nested menu for a branch, served from Redis cache if available.

    Cache key: menu:{slug}, TTL: 5 minutes.
    Cache is automatically invalidated on any admin CRUD operation on the menu.

    Returns 404 if branch not found or inactive.
    """
    cache = MenuCacheService()

    # 1. Cache check
    cached = await cache.get_menu(slug)
    if cached is not None:
        logger.debug("public_menu: cache hit for slug=%r", slug)
        return PublicMenuResponse(**cached)

    # 2. DB lookup — branch by slug
    branch = await db.scalar(
        select(Branch).where(
            Branch.slug == slug,
            Branch.is_active.is_(True),
        )
    )
    if not branch:
        raise HTTPException(status_code=404, detail=f"Menu not found for slug '{slug}'")

    # 3. Build full menu from DB
    logger.debug("public_menu: cache miss for slug=%r — querying DB", slug)
    menu_data = await _build_menu(branch, db)

    # 4. Store in cache
    await cache.set_menu(slug, menu_data)

    return PublicMenuResponse(**menu_data)


@router.get(
    "/menu/{slug}/allergens",
    response_model=list[PublicAllergenResponse],
    summary="Get allergen catalog for a branch with presence counts (no auth required)",
)
async def get_public_menu_allergens(
    slug: str,
    db: AsyncSession = Depends(get_db),
) -> list[PublicAllergenResponse]:
    """
    Return the list of allergens present in the branch's active menu,
    with counts per presence_type (contains / may_contain / free_from).

    Only includes allergens linked to active, available products for the branch.
    Returns 404 if branch not found or inactive.
    """
    # Lookup branch
    branch = await db.scalar(
        select(Branch).where(
            Branch.slug == slug,
            Branch.is_active.is_(True),
        )
    )
    if not branch:
        raise HTTPException(status_code=404, detail=f"Menu not found for slug '{slug}'")

    # Query active products available at this branch, with their allergen links
    # Join path: BranchProduct → Product → ProductAllergen → Allergen
    result = await db.execute(
        select(
            Allergen.id,
            Allergen.name,
            Allergen.icon,
            Allergen.description,
            Allergen.is_mandatory,
            Allergen.severity,
            ProductAllergen.presence_type,
            func.count(ProductAllergen.id).label("count"),
        )
        .join(ProductAllergen, ProductAllergen.allergen_id == Allergen.id)
        .join(Product, Product.id == ProductAllergen.product_id)
        .join(BranchProduct, BranchProduct.product_id == Product.id)
        .join(Subcategory, Subcategory.id == Product.subcategory_id)
        .join(Category, Category.id == Subcategory.category_id)
        .where(
            Category.branch_id == branch.id,
            Category.is_active.is_(True),
            Subcategory.is_active.is_(True),
            Product.is_active.is_(True),
            BranchProduct.branch_id == branch.id,
            BranchProduct.is_active.is_(True),
            BranchProduct.is_available.is_(True),
            Allergen.is_active.is_(True),
        )
        .group_by(
            Allergen.id,
            Allergen.name,
            Allergen.icon,
            Allergen.description,
            Allergen.is_mandatory,
            Allergen.severity,
            ProductAllergen.presence_type,
        )
        .order_by(Allergen.name)
    )
    rows = result.all()

    # Aggregate counts per allergen per presence_type
    allergen_map: dict[int, dict] = {}
    for row in rows:
        aid = row.id
        if aid not in allergen_map:
            allergen_map[aid] = {
                "id": aid,
                "name": row.name,
                "icon": row.icon,
                "description": row.description,
                "is_mandatory": row.is_mandatory,
                "severity": row.severity,
                "contains_count": 0,
                "may_contain_count": 0,
                "free_from_count": 0,
            }
        if row.presence_type == "contains":
            allergen_map[aid]["contains_count"] += row.count
        elif row.presence_type == "may_contain":
            allergen_map[aid]["may_contain_count"] += row.count
        elif row.presence_type == "free_from":
            allergen_map[aid]["free_from_count"] += row.count

    return [PublicAllergenResponse(**data) for data in allergen_map.values()]
