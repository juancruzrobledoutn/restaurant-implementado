"""
ProductService — domain service for menu products and branch-product records.

Multi-tenant isolation: Product has no tenant_id.
Tenant is enforced by joining: product → subcategory → category → branch → tenant_id.

This service also handles BranchProduct management (task 6.4):
  create_branch_product, update_branch_product, delete_branch_product.
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config.logging import get_logger
from shared.infrastructure.db import safe_commit
from shared.utils.exceptions import NotFoundError, ValidationError
from rest_api.models.branch import Branch
from rest_api.models.menu import BranchProduct, Category, Product, Subcategory
from rest_api.schemas.menu import (
    BranchProductCreate,
    BranchProductResponse,
    BranchProductUpdate,
    ProductCreate,
    ProductResponse,
    ProductUpdate,
)
from rest_api.services.domain.menu_cache_service import MenuCacheService

logger = get_logger(__name__)


class ProductService:
    """
    Domain service for Product and BranchProduct CRUD.

    Tenant isolation via: product.subcategory_id → subcategory.category_id
                           → category.branch_id → branch.tenant_id.
    Cache invalidation fires on every mutation.
    Cascade soft-delete from Product propagates to BranchProduct records.
    """

    def __init__(self, db: AsyncSession) -> None:
        self._db = db
        self._cache = MenuCacheService()

    # ── Private helpers ────────────────────────────────────────────────────────

    async def _get_subcategory(self, subcategory_id: int, tenant_id: int) -> Subcategory:
        """Return active subcategory owned by tenant."""
        result = await self._db.execute(
            select(Subcategory)
            .join(Category, Category.id == Subcategory.category_id)
            .join(Branch, Branch.id == Category.branch_id)
            .where(
                Subcategory.id == subcategory_id,
                Subcategory.is_active.is_(True),
                Category.is_active.is_(True),
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
        )
        subcategory = result.scalar_one_or_none()
        if not subcategory:
            raise ValidationError(
                "subcategory_id inválido o no pertenece al tenant", field="subcategory_id"
            )
        return subcategory

    async def _get_product(self, product_id: int, tenant_id: int) -> Product:
        """Return active product owned by tenant."""
        result = await self._db.execute(
            select(Product)
            .join(Subcategory, Subcategory.id == Product.subcategory_id)
            .join(Category, Category.id == Subcategory.category_id)
            .join(Branch, Branch.id == Category.branch_id)
            .where(
                Product.id == product_id,
                Product.is_active.is_(True),
                Subcategory.is_active.is_(True),
                Category.is_active.is_(True),
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
        )
        product = result.scalar_one_or_none()
        if not product:
            raise NotFoundError("Product", product_id)
        return product

    async def _get_branch_slug_for_product(self, product: Product) -> str | None:
        """Look up branch slug via product → subcategory → category → branch chain."""
        result = await self._db.execute(
            select(Branch)
            .join(Category, Category.branch_id == Branch.id)
            .join(Subcategory, Subcategory.category_id == Category.id)
            .where(Subcategory.id == product.subcategory_id)
        )
        branch = result.scalar_one_or_none()
        return branch.slug if branch else None

    async def _get_branch_slug_for_branch_product(
        self, branch_product: BranchProduct
    ) -> str | None:
        """Look up branch slug from BranchProduct.branch_id."""
        branch = await self._db.scalar(
            select(Branch).where(Branch.id == branch_product.branch_id)
        )
        return branch.slug if branch else None

    async def _get_branch_product(self, bp_id: int, tenant_id: int) -> BranchProduct:
        """Return active BranchProduct, validating tenant via branch chain."""
        result = await self._db.execute(
            select(BranchProduct)
            .join(Branch, Branch.id == BranchProduct.branch_id)
            .where(
                BranchProduct.id == bp_id,
                BranchProduct.is_active.is_(True),
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
        )
        bp = result.scalar_one_or_none()
        if not bp:
            raise NotFoundError("BranchProduct", bp_id)
        return bp

    def _to_response(self, product: Product) -> ProductResponse:
        return ProductResponse.model_validate(product)

    def _bp_to_response(self, bp: BranchProduct) -> BranchProductResponse:
        return BranchProductResponse.model_validate(bp)

    # ── Product CRUD ───────────────────────────────────────────────────────────

    async def list_by_subcategory(
        self,
        tenant_id: int,
        subcategory_id: int,
        limit: int = 50,
        offset: int = 0,
    ) -> list[ProductResponse]:
        """List active products for a subcategory, ordered by id."""
        await self._get_subcategory(subcategory_id, tenant_id)  # validate tenant ownership

        result = await self._db.execute(
            select(Product)
            .where(
                Product.subcategory_id == subcategory_id,
                Product.is_active.is_(True),
            )
            .order_by(Product.id)
            .limit(min(limit, 100))
            .offset(offset)
        )
        return [self._to_response(p) for p in result.scalars().all()]

    async def get_by_id(self, product_id: int, tenant_id: int) -> ProductResponse:
        """Return a single product by ID, scoped to tenant."""
        product = await self._get_product(product_id, tenant_id)
        return self._to_response(product)

    async def create(
        self,
        data: ProductCreate,
        tenant_id: int,
        user_id: int,
    ) -> ProductResponse:
        """Create a new product. Validates subcategory exists and belongs to tenant."""
        subcategory = await self._get_subcategory(data.subcategory_id, tenant_id)

        product = Product(
            subcategory_id=data.subcategory_id,
            name=data.name,
            description=data.description,
            price=data.price,
            image=data.image,
            featured=data.featured,
            popular=data.popular,
        )
        self._db.add(product)
        await self._db.flush()
        await self._db.refresh(product)
        await safe_commit(self._db)

        # Cache invalidation — look up branch slug via subcategory chain
        branch_slug = await self._get_branch_slug_for_product(product)
        if branch_slug:
            await self._cache.invalidate(branch_slug)

        return self._to_response(product)

    async def update(
        self,
        product_id: int,
        data: ProductUpdate,
        tenant_id: int,
        user_id: int,
    ) -> ProductResponse:
        """Update product fields."""
        product = await self._get_product(product_id, tenant_id)
        branch_slug = await self._get_branch_slug_for_product(product)

        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(product, field, value)

        await self._db.flush()
        await self._db.refresh(product)
        await safe_commit(self._db)

        if branch_slug:
            await self._cache.invalidate(branch_slug)

        return self._to_response(product)

    async def delete(
        self,
        product_id: int,
        tenant_id: int,
        user_id: int,
    ) -> dict[str, Any]:
        """
        Soft-delete product and cascade to BranchProduct records.

        Explicit queries used to avoid lazy-loading in async SQLAlchemy.
        """
        from datetime import UTC, datetime

        product = await self._get_product(product_id, tenant_id)
        branch_slug = await self._get_branch_slug_for_product(product)
        now = datetime.now(UTC)

        # Soft-delete the product
        product.is_active = False
        product.deleted_at = now
        product.deleted_by_id = user_id

        # Cascade to active BranchProduct records
        bps_result = await self._db.execute(
            select(BranchProduct).where(
                BranchProduct.product_id == product_id,
                BranchProduct.is_active.is_(True),
            )
        )
        for bp in bps_result.scalars().all():
            bp.is_active = False
            bp.deleted_at = now
            bp.deleted_by_id = user_id

        await safe_commit(self._db)

        if branch_slug:
            await self._cache.invalidate(branch_slug)

        return {"affected": {"Product": 1}}

    # ── BranchProduct CRUD ─────────────────────────────────────────────────────

    async def list_branch_products(
        self,
        tenant_id: int,
        branch_id: int,
        limit: int = 50,
        offset: int = 0,
    ) -> list[BranchProductResponse]:
        """List active BranchProducts for a branch, ordered by id."""
        result = await self._db.execute(
            select(BranchProduct)
            .join(Branch, Branch.id == BranchProduct.branch_id)
            .where(
                BranchProduct.branch_id == branch_id,
                BranchProduct.is_active.is_(True),
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
            .order_by(BranchProduct.id)
            .limit(min(limit, 100))
            .offset(offset)
        )
        return [self._bp_to_response(bp) for bp in result.scalars().all()]

    async def create_branch_product(
        self,
        data: BranchProductCreate,
        tenant_id: int,
        user_id: int,
    ) -> BranchProductResponse:
        """
        Create a BranchProduct linking a product to a branch with pricing.

        Raises:
          ValidationError if product doesn't belong to tenant
          HTTP 409 (via ConflictError) if a BranchProduct already exists
        """
        # Validate product belongs to tenant
        product = await self._get_product(data.product_id, tenant_id)

        # Validate branch belongs to tenant
        branch = await self._db.scalar(
            select(Branch).where(
                Branch.id == data.branch_id,
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
        )
        if not branch:
            raise ValidationError("branch_id inválido o no pertenece al tenant", field="branch_id")

        # Check for duplicate — (product_id, branch_id) must be unique
        existing = await self._db.scalar(
            select(BranchProduct).where(
                BranchProduct.product_id == data.product_id,
                BranchProduct.branch_id == data.branch_id,
                BranchProduct.is_active.is_(True),
            )
        )
        if existing:
            raise ValidationError(
                f"Ya existe un BranchProduct para product_id={data.product_id} "
                f"en branch_id={data.branch_id}",
                field="product_id",
            )

        bp = BranchProduct(
            product_id=data.product_id,
            branch_id=data.branch_id,
            price_cents=data.price_cents,
            is_available=data.is_available,
        )
        self._db.add(bp)
        await self._db.flush()
        await self._db.refresh(bp)
        await safe_commit(self._db)

        await self._cache.invalidate(branch.slug)

        return self._bp_to_response(bp)

    async def update_branch_product(
        self,
        bp_id: int,
        data: BranchProductUpdate,
        tenant_id: int,
        user_id: int,
    ) -> BranchProductResponse:
        """Update BranchProduct price_cents and/or is_available."""
        bp = await self._get_branch_product(bp_id, tenant_id)
        branch_slug = await self._get_branch_slug_for_branch_product(bp)

        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(bp, field, value)

        await self._db.flush()
        await self._db.refresh(bp)
        await safe_commit(self._db)

        if branch_slug:
            await self._cache.invalidate(branch_slug)

        return self._bp_to_response(bp)

    async def delete_branch_product(
        self,
        bp_id: int,
        tenant_id: int,
        user_id: int,
    ) -> None:
        """Soft-delete a BranchProduct."""
        bp = await self._get_branch_product(bp_id, tenant_id)
        branch_slug = await self._get_branch_slug_for_branch_product(bp)

        bp.is_active = False
        bp.deleted_at = datetime.now(UTC)
        bp.deleted_by_id = user_id

        await self._db.flush()
        await safe_commit(self._db)

        if branch_slug:
            await self._cache.invalidate(branch_slug)
