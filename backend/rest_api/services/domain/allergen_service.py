"""
AllergenService — domain service for allergen management.

Clean Architecture rules:
  - NEVER db.commit() directly → safe_commit(db)
  - NEVER is_active == True → is_active.is_(True)
  - ALWAYS filter by tenant_id without exception
  - Soft delete on allergens; hard-delete on ProductAllergen / AllergenCrossReaction
  - Cache invalidation after every mutation (allergens affect the public menu)

Multi-tenant isolation:
  Allergen.tenant_id is denormalized on the table — all queries scope to tenant_id directly.
  ProductAllergen cross-tenant validation is enforced by checking that both product and
  allergen belong to the same tenant before creating the link.

Cache strategy:
  - Allergen CRUD invalidates ALL branches of the tenant (allergens appear on all menus)
  - ProductAllergen link/unlink invalidates the specific branch the product belongs to
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.config.logging import get_logger
from shared.infrastructure.db import safe_commit
from shared.utils.exceptions import NotFoundError, ValidationError
from rest_api.models.allergen import Allergen, AllergenCrossReaction, ProductAllergen
from rest_api.models.menu import Product, Subcategory, Category
from rest_api.models.branch import Branch
from rest_api.schemas.allergen import (
    AllergenCreate,
    AllergenResponse,
    AllergenUpdate,
    CrossReactionCreate,
    CrossReactionResponse,
    ProductAllergenCreate,
    ProductAllergenResponse,
)
from rest_api.services.domain.menu_cache_service import MenuCacheService

logger = get_logger(__name__)


class AllergenService:
    """
    Domain service for allergen catalog and product-allergen linking.

    Business rules:
    - Allergens are tenant-scoped — ALL queries filter by tenant_id
    - Soft delete on allergens cascades to ProductAllergen and AllergenCrossReaction records
    - ProductAllergen is a hard-delete junction (no soft delete)
    - Cross-reactions are stored bidirectionally — create/delete both directions atomically
    - Cache invalidation fires on every mutation (public menu includes allergen data)
    """

    def __init__(self, db: AsyncSession) -> None:
        self._db = db
        self._cache = MenuCacheService()

    # ── Private helpers ────────────────────────────────────────────────────────

    async def _get_allergen(self, allergen_id: int, tenant_id: int) -> Allergen:
        """Return active allergen owned by tenant, else raise NotFoundError."""
        allergen = await self._db.scalar(
            select(Allergen).where(
                Allergen.id == allergen_id,
                Allergen.tenant_id == tenant_id,
                Allergen.is_active.is_(True),
            )
        )
        if not allergen:
            raise NotFoundError("Allergen", allergen_id)
        return allergen

    async def _get_product_with_tenant(self, product_id: int, tenant_id: int) -> Product:
        """Return product that belongs to tenant (via subcategory → category → branch chain)."""
        result = await self._db.execute(
            select(Product)
            .join(Subcategory, Subcategory.id == Product.subcategory_id)
            .join(Category, Category.id == Subcategory.category_id)
            .join(Branch, Branch.id == Category.branch_id)
            .where(
                Product.id == product_id,
                Product.is_active.is_(True),
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
        )
        product = result.scalar_one_or_none()
        if not product:
            raise NotFoundError("Product", product_id)
        return product

    async def _get_branch_slug_for_product(self, product_id: int) -> str | None:
        """Resolve product → subcategory → category → branch slug for cache invalidation."""
        result = await self._db.execute(
            select(Branch.slug)
            .join(Category, Category.branch_id == Branch.id)
            .join(Subcategory, Subcategory.category_id == Category.id)
            .join(Product, Product.subcategory_id == Subcategory.id)
            .where(Product.id == product_id)
        )
        row = result.first()
        return row[0] if row else None

    async def _invalidate_tenant_caches(self, tenant_id: int) -> None:
        """Invalidate Redis menu cache for ALL branches of the tenant."""
        result = await self._db.execute(
            select(Branch.slug).where(
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
        )
        slugs = [row[0] for row in result.all()]
        for slug in slugs:
            await self._cache.invalidate(slug)
            logger.debug("allergen_service: invalidated cache for branch slug=%r", slug)

    async def _invalidate_branch_cache(self, product_id: int) -> None:
        """Invalidate cache for the branch that contains the given product."""
        slug = await self._get_branch_slug_for_product(product_id)
        if slug:
            await self._cache.invalidate(slug)
            logger.debug("allergen_service: invalidated cache for slug=%r", slug)

    def _to_response(self, allergen: Allergen) -> AllergenResponse:
        return AllergenResponse.model_validate(allergen)

    def _to_product_allergen_response(self, pa: ProductAllergen) -> ProductAllergenResponse:
        return ProductAllergenResponse(
            id=pa.id,
            product_id=pa.product_id,
            allergen_id=pa.allergen_id,
            allergen_name=pa.allergen.name if pa.allergen else "",
            allergen_icon=pa.allergen.icon if pa.allergen else None,
            presence_type=pa.presence_type,
            risk_level=pa.risk_level,
        )

    def _to_cross_reaction_response(
        self, cr: AllergenCrossReaction
    ) -> CrossReactionResponse:
        return CrossReactionResponse(
            id=cr.id,
            allergen_id=cr.allergen_id,
            related_allergen_id=cr.related_allergen_id,
            related_allergen_name=cr.related_allergen.name if cr.related_allergen else "",
        )

    # ── Allergen CRUD ──────────────────────────────────────────────────────────

    async def list_all(
        self,
        tenant_id: int,
        limit: int = 50,
        offset: int = 0,
    ) -> list[AllergenResponse]:
        """List active allergens for the tenant, ordered by name."""
        result = await self._db.execute(
            select(Allergen)
            .where(
                Allergen.tenant_id == tenant_id,
                Allergen.is_active.is_(True),
            )
            .order_by(Allergen.name)
            .limit(min(limit, 200))
            .offset(offset)
        )
        allergens = result.scalars().all()
        return [self._to_response(a) for a in allergens]

    async def get_by_id(self, allergen_id: int, tenant_id: int) -> AllergenResponse:
        """Return a single allergen by ID, scoped to tenant."""
        allergen = await self._get_allergen(allergen_id, tenant_id)
        return self._to_response(allergen)

    async def create(
        self,
        data: AllergenCreate,
        tenant_id: int,
        user_id: int,
    ) -> AllergenResponse:
        """Create a new allergen for the tenant."""
        allergen = Allergen(
            tenant_id=tenant_id,
            name=data.name,
            icon=data.icon,
            description=data.description,
            is_mandatory=data.is_mandatory,
            severity=data.severity,
        )
        self._db.add(allergen)
        await self._db.flush()
        await self._db.refresh(allergen)
        await safe_commit(self._db)

        await self._invalidate_tenant_caches(tenant_id)
        logger.info(
            "allergen.create: id=%s name=%r tenant=%s user=%s",
            allergen.id, allergen.name, tenant_id, user_id,
        )
        return self._to_response(allergen)

    async def update(
        self,
        allergen_id: int,
        data: AllergenUpdate,
        tenant_id: int,
        user_id: int,
    ) -> AllergenResponse:
        """Update allergen fields. Validates tenant ownership."""
        allergen = await self._get_allergen(allergen_id, tenant_id)

        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(allergen, field, value)

        await self._db.flush()
        await self._db.refresh(allergen)
        await safe_commit(self._db)

        await self._invalidate_tenant_caches(tenant_id)
        logger.info(
            "allergen.update: id=%s tenant=%s user=%s fields=%s",
            allergen_id, tenant_id, user_id, list(update_data.keys()),
        )
        return self._to_response(allergen)

    async def delete(
        self,
        allergen_id: int,
        tenant_id: int,
        user_id: int,
    ) -> dict[str, Any]:
        """
        Soft-delete an allergen.

        Cascade hard-deletes all linked ProductAllergen records and
        AllergenCrossReaction records (both directions).
        Cache is invalidated for all tenant branches.
        """
        allergen = await self._get_allergen(allergen_id, tenant_id)
        now = datetime.now(UTC)

        # Hard-delete linked ProductAllergen records
        pa_result = await self._db.execute(
            select(ProductAllergen).where(ProductAllergen.allergen_id == allergen_id)
        )
        product_allergens = pa_result.scalars().all()
        for pa in product_allergens:
            await self._db.delete(pa)

        # Hard-delete cross-reaction records (both directions)
        cr_result = await self._db.execute(
            select(AllergenCrossReaction).where(
                (AllergenCrossReaction.allergen_id == allergen_id)
                | (AllergenCrossReaction.related_allergen_id == allergen_id)
            )
        )
        cross_reactions = cr_result.scalars().all()
        for cr in cross_reactions:
            await self._db.delete(cr)

        # Soft-delete the allergen itself
        allergen.is_active = False
        allergen.deleted_at = now
        allergen.deleted_by_id = user_id

        await safe_commit(self._db)
        await self._invalidate_tenant_caches(tenant_id)

        logger.info(
            "allergen.delete: id=%s tenant=%s user=%s linked_products=%s cross_reactions=%s",
            allergen_id, tenant_id, user_id, len(product_allergens), len(cross_reactions),
        )
        return {
            "affected": {
                "Allergen": 1,
                "ProductAllergen": len(product_allergens),
                "AllergenCrossReaction": len(cross_reactions),
            }
        }

    # ── Product-Allergen linking ────────────────────────────────────────────────

    async def link_product(
        self,
        product_id: int,
        data: ProductAllergenCreate,
        tenant_id: int,
    ) -> ProductAllergenResponse:
        """
        Link a product to an allergen.

        Validates:
          - Product belongs to the tenant
          - Allergen belongs to the tenant
          - Link doesn't already exist (409 on duplicate)
        """
        # Validate product belongs to tenant
        await self._get_product_with_tenant(product_id, tenant_id)

        # Validate allergen belongs to tenant
        allergen = await self._get_allergen(data.allergen_id, tenant_id)

        # Check uniqueness
        existing = await self._db.scalar(
            select(ProductAllergen).where(
                ProductAllergen.product_id == product_id,
                ProductAllergen.allergen_id == data.allergen_id,
            )
        )
        if existing:
            raise ValidationError(
                f"Product {product_id} is already linked to allergen {data.allergen_id}",
                field="allergen_id",
            )

        pa = ProductAllergen(
            product_id=product_id,
            allergen_id=data.allergen_id,
            presence_type=data.presence_type,
            risk_level=data.risk_level,
        )
        self._db.add(pa)
        await self._db.flush()
        # Manually load allergen for the response (selectin not triggered on fresh insert)
        pa.allergen = allergen
        await safe_commit(self._db)

        await self._invalidate_branch_cache(product_id)
        logger.info(
            "allergen.link_product: product=%s allergen=%s presence_type=%r tenant=%s",
            product_id, data.allergen_id, data.presence_type, tenant_id,
        )
        return self._to_product_allergen_response(pa)

    async def unlink_product(
        self,
        product_id: int,
        allergen_id: int,
        tenant_id: int,
    ) -> None:
        """
        Hard-delete the link between a product and an allergen.

        Validates product belongs to tenant before allowing unlinking.
        """
        await self._get_product_with_tenant(product_id, tenant_id)

        pa = await self._db.scalar(
            select(ProductAllergen).where(
                ProductAllergen.product_id == product_id,
                ProductAllergen.allergen_id == allergen_id,
            )
        )
        if not pa:
            raise NotFoundError("ProductAllergen", allergen_id)

        await self._db.delete(pa)
        await safe_commit(self._db)

        await self._invalidate_branch_cache(product_id)
        logger.info(
            "allergen.unlink_product: product=%s allergen=%s tenant=%s",
            product_id, allergen_id, tenant_id,
        )

    async def list_product_allergens(
        self,
        product_id: int,
        tenant_id: int,
    ) -> list[ProductAllergenResponse]:
        """Return all allergens linked to the given product."""
        await self._get_product_with_tenant(product_id, tenant_id)

        result = await self._db.execute(
            select(ProductAllergen)
            .where(ProductAllergen.product_id == product_id)
            .options(selectinload(ProductAllergen.allergen))
        )
        pas = result.scalars().all()
        return [self._to_product_allergen_response(pa) for pa in pas]

    # ── Cross-reaction methods ─────────────────────────────────────────────────

    async def create_cross_reaction(
        self,
        allergen_id: int,
        data: CrossReactionCreate,
        tenant_id: int,
    ) -> CrossReactionResponse:
        """
        Create a bidirectional cross-reaction between two allergens.

        Validates:
          - Both allergens exist and belong to tenant
          - Not a self-reference (400)
          - Link doesn't already exist (409)

        Creates TWO records: (allergen_id, related_id) and (related_id, allergen_id).
        Returns the first direction record.
        """
        if allergen_id == data.related_allergen_id:
            raise ValidationError(
                "An allergen cannot have a cross-reaction with itself",
                field="related_allergen_id",
            )

        allergen = await self._get_allergen(allergen_id, tenant_id)
        related = await self._get_allergen(data.related_allergen_id, tenant_id)

        # Check uniqueness (one direction is enough — both are always created together)
        existing = await self._db.scalar(
            select(AllergenCrossReaction).where(
                AllergenCrossReaction.allergen_id == allergen_id,
                AllergenCrossReaction.related_allergen_id == data.related_allergen_id,
            )
        )
        if existing:
            raise ValidationError(
                f"Cross-reaction between allergen {allergen_id} and "
                f"{data.related_allergen_id} already exists",
                field="related_allergen_id",
            )

        # Create both directions atomically
        cr_forward = AllergenCrossReaction(
            allergen_id=allergen_id,
            related_allergen_id=data.related_allergen_id,
        )
        cr_reverse = AllergenCrossReaction(
            allergen_id=data.related_allergen_id,
            related_allergen_id=allergen_id,
        )
        self._db.add(cr_forward)
        self._db.add(cr_reverse)
        await self._db.flush()
        cr_forward.related_allergen = related
        await safe_commit(self._db)

        logger.info(
            "allergen.create_cross_reaction: allergen=%s related=%s tenant=%s",
            allergen_id, data.related_allergen_id, tenant_id,
        )
        return self._to_cross_reaction_response(cr_forward)

    async def delete_cross_reaction(
        self,
        allergen_id: int,
        related_allergen_id: int,
        tenant_id: int,
    ) -> None:
        """
        Remove cross-reaction between two allergens — deletes both directions.
        """
        # Validate allergens belong to tenant
        await self._get_allergen(allergen_id, tenant_id)
        await self._get_allergen(related_allergen_id, tenant_id)

        # Delete both directions
        result = await self._db.execute(
            select(AllergenCrossReaction).where(
                (
                    (AllergenCrossReaction.allergen_id == allergen_id)
                    & (AllergenCrossReaction.related_allergen_id == related_allergen_id)
                )
                | (
                    (AllergenCrossReaction.allergen_id == related_allergen_id)
                    & (AllergenCrossReaction.related_allergen_id == allergen_id)
                )
            )
        )
        records = result.scalars().all()

        if not records:
            raise NotFoundError("AllergenCrossReaction", related_allergen_id)

        for cr in records:
            await self._db.delete(cr)

        await safe_commit(self._db)
        logger.info(
            "allergen.delete_cross_reaction: allergen=%s related=%s tenant=%s records=%s",
            allergen_id, related_allergen_id, tenant_id, len(records),
        )

    async def list_cross_reactions(
        self,
        allergen_id: int,
        tenant_id: int,
    ) -> list[CrossReactionResponse]:
        """Return all cross-reactions for the given allergen."""
        await self._get_allergen(allergen_id, tenant_id)

        result = await self._db.execute(
            select(AllergenCrossReaction)
            .where(AllergenCrossReaction.allergen_id == allergen_id)
            .options(selectinload(AllergenCrossReaction.related_allergen))
        )
        crs = result.scalars().all()
        return [self._to_cross_reaction_response(cr) for cr in crs]
