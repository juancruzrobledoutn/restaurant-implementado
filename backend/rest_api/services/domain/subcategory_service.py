"""
SubcategoryService — domain service for menu subcategories.

Multi-tenant isolation: Subcategory has no tenant_id column.
Tenant is enforced by joining: subcategory → category → branch → tenant_id.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config.logging import get_logger
from shared.infrastructure.db import safe_commit
from shared.utils.exceptions import NotFoundError, ValidationError
from rest_api.models.branch import Branch
from rest_api.models.menu import Category, Subcategory
from rest_api.schemas.menu import (
    SubcategoryCreate,
    SubcategoryResponse,
    SubcategoryUpdate,
)
from rest_api.services.domain.menu_cache_service import MenuCacheService

logger = get_logger(__name__)


class SubcategoryService:
    """
    Domain service for Subcategory CRUD.

    Tenant isolation via: subcategory.category_id → category.branch_id → branch.tenant_id.
    Cache invalidation fires on every mutation.
    Cascade soft-delete propagates to Products.
    """

    def __init__(self, db: AsyncSession) -> None:
        self._db = db
        self._cache = MenuCacheService()

    # ── Private helpers ────────────────────────────────────────────────────────

    async def _get_category(self, category_id: int, tenant_id: int) -> Category:
        """Return active category owned by tenant."""
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
            raise ValidationError(
                "category_id inválido o no pertenece al tenant", field="category_id"
            )
        return category

    async def _get_subcategory(self, subcategory_id: int, tenant_id: int) -> Subcategory:
        """Return active subcategory owned by tenant (via category → branch chain)."""
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
            raise NotFoundError("Subcategory", subcategory_id)
        return subcategory

    async def _get_branch_slug_for_subcategory(self, subcategory: Subcategory) -> str | None:
        """Return the branch slug for cache invalidation."""
        result = await self._db.execute(
            select(Branch)
            .join(Category, Category.branch_id == Branch.id)
            .where(Category.id == subcategory.category_id)
        )
        branch = result.scalar_one_or_none()
        return branch.slug if branch else None

    def _to_response(self, subcategory: Subcategory) -> SubcategoryResponse:
        return SubcategoryResponse.model_validate(subcategory)

    # ── CRUD ───────────────────────────────────────────────────────────────────

    async def list_by_category(
        self,
        tenant_id: int,
        category_id: int,
        limit: int = 50,
        offset: int = 0,
    ) -> list[SubcategoryResponse]:
        """List active subcategories for a category, ordered by `order` field."""
        await self._get_category(category_id, tenant_id)  # validate tenant ownership

        result = await self._db.execute(
            select(Subcategory)
            .where(
                Subcategory.category_id == category_id,
                Subcategory.is_active.is_(True),
            )
            .order_by(Subcategory.order)
            .limit(min(limit, 100))
            .offset(offset)
        )
        return [self._to_response(s) for s in result.scalars().all()]

    async def get_by_id(self, subcategory_id: int, tenant_id: int) -> SubcategoryResponse:
        """Return a single subcategory by ID, scoped to tenant."""
        subcategory = await self._get_subcategory(subcategory_id, tenant_id)
        return self._to_response(subcategory)

    async def create(
        self,
        data: SubcategoryCreate,
        tenant_id: int,
        user_id: int,
    ) -> SubcategoryResponse:
        """Create a new subcategory. Validates parent category exists and is active."""
        category = await self._get_category(data.category_id, tenant_id)

        subcategory = Subcategory(
            category_id=data.category_id,
            name=data.name,
            image=data.image,
            order=data.order,
        )
        self._db.add(subcategory)
        await self._db.flush()
        await self._db.refresh(subcategory)
        await safe_commit(self._db)

        # Cache invalidation — look up branch slug via category
        branch_result = await self._db.execute(
            select(Branch).where(Branch.id == category.branch_id)
        )
        branch = branch_result.scalar_one_or_none()
        if branch:
            await self._cache.invalidate(branch.slug)

        return self._to_response(subcategory)

    async def update(
        self,
        subcategory_id: int,
        data: SubcategoryUpdate,
        tenant_id: int,
        user_id: int,
    ) -> SubcategoryResponse:
        """Update subcategory fields."""
        subcategory = await self._get_subcategory(subcategory_id, tenant_id)
        branch_slug = await self._get_branch_slug_for_subcategory(subcategory)

        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(subcategory, field, value)

        await self._db.flush()
        await self._db.refresh(subcategory)
        await safe_commit(self._db)

        if branch_slug:
            await self._cache.invalidate(branch_slug)

        return self._to_response(subcategory)

    async def delete(
        self,
        subcategory_id: int,
        tenant_id: int,
        user_id: int,
    ) -> dict[str, Any]:
        """
        Soft-delete subcategory and cascade to its products.

        Explicit queries used instead of cascade_soft_delete() to avoid
        lazy-loading issues in async SQLAlchemy.
        """
        from datetime import UTC, datetime

        from rest_api.models.menu import Product

        subcategory = await self._get_subcategory(subcategory_id, tenant_id)
        branch_slug = await self._get_branch_slug_for_subcategory(subcategory)
        now = datetime.now(UTC)

        # Soft-delete the subcategory
        subcategory.is_active = False
        subcategory.deleted_at = now
        subcategory.deleted_by_id = user_id

        # Cascade to active products
        prods_result = await self._db.execute(
            select(Product).where(
                Product.subcategory_id == subcategory_id,
                Product.is_active.is_(True),
            )
        )
        for product in prods_result.scalars().all():
            product.is_active = False
            product.deleted_at = now
            product.deleted_by_id = user_id

        await safe_commit(self._db)

        if branch_slug:
            await self._cache.invalidate(branch_slug)

        return {"affected": {"Subcategory": 1}}
