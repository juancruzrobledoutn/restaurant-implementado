"""
CategoryService — domain service for menu categories.

Clean Architecture rules:
  - NEVER db.commit() directly → safe_commit(db)
  - NEVER is_active == True → is_active.is_(True)
  - ALWAYS filter by tenant_id (via branch.tenant_id join)
  - Soft delete only — no physical deletes
  - Cache invalidation after every mutation

Multi-tenant isolation:
  Category has no tenant_id column — tenant is enforced by joining through
  Branch (category.branch_id → branch.tenant_id). Every query scopes to
  tenant by checking branch.tenant_id == tenant_id.
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
from rest_api.models.menu import Category, Subcategory
from rest_api.schemas.menu import CategoryCreate, CategoryResponse, CategoryUpdate
from rest_api.services.domain.menu_cache_service import MenuCacheService

logger = get_logger(__name__)


class CategoryService:
    """
    Domain service for Category CRUD.

    All methods enforce tenant isolation via branch.tenant_id.
    Cache invalidation fires on every mutation.
    Cascade soft-delete propagates to Subcategories → Products.
    """

    def __init__(self, db: AsyncSession) -> None:
        self._db = db
        self._cache = MenuCacheService()

    # ── Private helpers ────────────────────────────────────────────────────────

    async def _get_branch(self, branch_id: int, tenant_id: int) -> Branch:
        """Return branch if it belongs to the tenant, else raise ValidationError."""
        branch = await self._db.scalar(
            select(Branch).where(
                Branch.id == branch_id,
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
        )
        if not branch:
            raise ValidationError("branch_id inválido o no pertenece al tenant", field="branch_id")
        return branch

    async def _get_category(self, category_id: int, tenant_id: int) -> Category:
        """Return active category owned by tenant, else raise NotFoundError."""
        # Join through branch to enforce tenant isolation
        result = await self._db.execute(
            select(Category)
            .join(Branch, Branch.id == Category.branch_id)
            .where(
                Category.id == category_id,
                Category.is_active.is_(True),
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
        )
        category = result.scalar_one_or_none()
        if not category:
            raise NotFoundError("Category", category_id)
        return category

    async def _get_branch_slug(self, branch_id: int) -> str | None:
        """Return the slug for a branch ID (for cache invalidation)."""
        branch = await self._db.scalar(
            select(Branch).where(Branch.id == branch_id)
        )
        return branch.slug if branch else None

    def _to_response(self, category: Category) -> CategoryResponse:
        return CategoryResponse.model_validate(category)

    # ── CRUD ───────────────────────────────────────────────────────────────────

    async def list_by_branch(
        self,
        tenant_id: int,
        branch_id: int,
        limit: int = 50,
        offset: int = 0,
    ) -> list[CategoryResponse]:
        """List active categories for a branch, ordered by `order` field."""
        # Validate branch belongs to tenant first
        await self._get_branch(branch_id, tenant_id)

        result = await self._db.execute(
            select(Category)
            .where(
                Category.branch_id == branch_id,
                Category.is_active.is_(True),
            )
            .order_by(Category.order)
            .limit(min(limit, 100))
            .offset(offset)
        )
        categories = result.scalars().all()
        return [self._to_response(c) for c in categories]

    async def get_by_id(self, category_id: int, tenant_id: int) -> CategoryResponse:
        """Return a single category by ID, scoped to tenant."""
        category = await self._get_category(category_id, tenant_id)
        return self._to_response(category)

    async def create(
        self,
        data: CategoryCreate,
        tenant_id: int,
        user_id: int,
    ) -> CategoryResponse:
        """Create a new category. Validates branch belongs to tenant."""
        branch = await self._get_branch(data.branch_id, tenant_id)

        category = Category(
            branch_id=data.branch_id,
            name=data.name,
            icon=data.icon,
            image=data.image,
            order=data.order,
        )
        self._db.add(category)
        await self._db.flush()
        await self._db.refresh(category)
        await safe_commit(self._db)

        # Cache invalidation
        await self._cache.invalidate(branch.slug)
        logger.debug(
            "category.create: id=%s branch=%s tenant=%s", category.id, branch.slug, tenant_id
        )

        return self._to_response(category)

    async def update(
        self,
        category_id: int,
        data: CategoryUpdate,
        tenant_id: int,
        user_id: int,
    ) -> CategoryResponse:
        """Update category fields. Validates tenant ownership."""
        category = await self._get_category(category_id, tenant_id)
        branch_slug = await self._get_branch_slug(category.branch_id)

        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(category, field, value)

        await self._db.flush()
        await self._db.refresh(category)
        await safe_commit(self._db)

        if branch_slug:
            await self._cache.invalidate(branch_slug)

        return self._to_response(category)

    async def delete(
        self,
        category_id: int,
        tenant_id: int,
        user_id: int,
    ) -> dict[str, Any]:
        """
        Soft-delete a category and cascade to its subcategories and products.

        Returns dict with affected counts per entity type.
        We do explicit queries instead of relying on cascade_soft_delete()
        because lazy loading doesn't work in async SQLAlchemy without greenlet.
        """
        from datetime import UTC, datetime

        from rest_api.models.menu import Product

        category = await self._get_category(category_id, tenant_id)
        branch_slug = await self._get_branch_slug(category.branch_id)
        now = datetime.now(UTC)

        # Soft-delete the category
        category.is_active = False
        category.deleted_at = now
        category.deleted_by_id = user_id

        # Get all active subcategories
        subcats_result = await self._db.execute(
            select(Subcategory).where(
                Subcategory.category_id == category_id,
                Subcategory.is_active.is_(True),
            )
        )
        subcategories = subcats_result.scalars().all()

        for subcat in subcategories:
            subcat.is_active = False
            subcat.deleted_at = now
            subcat.deleted_by_id = user_id

            # Get all active products for this subcategory
            prods_result = await self._db.execute(
                select(Product).where(
                    Product.subcategory_id == subcat.id,
                    Product.is_active.is_(True),
                )
            )
            products = prods_result.scalars().all()
            for product in products:
                product.is_active = False
                product.deleted_at = now
                product.deleted_by_id = user_id

        await safe_commit(self._db)

        if branch_slug:
            await self._cache.invalidate(branch_slug)

        return {"affected": {"Category": 1}}
