"""
PromotionService — domain service for tenant-scoped promotion management.

Clean Architecture rules:
  - NEVER db.commit() directly → safe_commit(db)
  - NEVER is_active == True → is_active.is_(True)
  - ALWAYS filter by tenant_id
  - Soft delete only (ADMIN-only)

Design decisions (from design.md):
  - D-07: list_for_branch includes expired promotions (dashboard sees history)
  - Cross-tenant validation for branch links and product links (security check)
  - MANAGER cannot delete — ForbiddenError raised in service, not just router
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.config.constants import Roles
from shared.config.logging import get_logger
from shared.infrastructure.db import safe_commit
from shared.utils.exceptions import ForbiddenError, NotFoundError, ValidationError
from rest_api.models.branch import Branch
from rest_api.models.menu import Product, Subcategory, Category
from rest_api.models.promotion import Promotion, PromotionBranch, PromotionItem
from rest_api.schemas.promotion import (
    PromotionBranchOut,
    PromotionCreate,
    PromotionItemOut,
    PromotionOut,
    PromotionUpdate,
)

logger = get_logger(__name__)


def _promotion_to_out(promotion: Promotion) -> PromotionOut:
    """Convert Promotion ORM instance to PromotionOut schema."""
    branches: list[PromotionBranchOut] = []
    for pb in (promotion.branches or []):
        branch_name = pb.branch.name if pb.branch else ""
        branches.append(PromotionBranchOut(branch_id=pb.branch_id, branch_name=branch_name))

    items: list[PromotionItemOut] = []
    for pi in (promotion.items or []):
        product_name = pi.product.name if pi.product else ""
        items.append(PromotionItemOut(product_id=pi.product_id, product_name=product_name))

    return PromotionOut(
        id=promotion.id,
        tenant_id=promotion.tenant_id,
        name=promotion.name,
        description=promotion.description,
        price=promotion.price,
        start_date=promotion.start_date,
        start_time=promotion.start_time,
        end_date=promotion.end_date,
        end_time=promotion.end_time,
        promotion_type_id=promotion.promotion_type_id,
        is_active=promotion.is_active,
        created_at=promotion.created_at,
        updated_at=promotion.updated_at,
        branches=branches,
        items=items,
    )


_PROMO_OPTIONS = [
    selectinload(Promotion.branches).selectinload(PromotionBranch.branch),
    selectinload(Promotion.items).selectinload(PromotionItem.product),
]


class PromotionService:
    """
    Domain service for Promotion CRUD and branch/product linking.

    Multi-tenant isolation: all queries filter by tenant_id.
    Cross-tenant link validation: branch.tenant_id and product.tenant_id
    must match promotion.tenant_id before linking.
    """

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    # ── Private helpers ────────────────────────────────────────────────────────

    async def _get_promotion(self, promotion_id: int, tenant_id: int) -> Promotion:
        """Return active promotion belonging to tenant, else raise NotFoundError."""
        result = await self._db.execute(
            select(Promotion)
            .where(
                Promotion.id == promotion_id,
                Promotion.tenant_id == tenant_id,
                Promotion.is_active.is_(True),
            )
            .options(*_PROMO_OPTIONS)
        )
        promo = result.scalar_one_or_none()
        if not promo:
            raise NotFoundError("Promotion", promotion_id)
        return promo

    # ── CRUD ───────────────────────────────────────────────────────────────────

    async def create(
        self,
        data: PromotionCreate,
        tenant_id: int,
        actor_user_id: int,
    ) -> PromotionOut:
        """
        Create a promotion atomically with branch and product junctions.

        Cross-tenant validation: all branch_ids and product_ids must belong
        to the same tenant as the promotion.
        """
        # Validate all branch_ids belong to tenant
        for branch_id in data.branch_ids:
            branch = await self._db.scalar(
                select(Branch).where(
                    Branch.id == branch_id,
                    Branch.tenant_id == tenant_id,
                    Branch.is_active.is_(True),
                )
            )
            if not branch:
                raise ValidationError(
                    f"branch_id={branch_id} does not belong to this tenant",
                    field="branch_ids",
                )

        # Validate all product_ids belong to tenant (via subcategory → category → branch)
        for product_id in data.product_ids:
            product = await self._db.scalar(
                select(Product)
                .join(Subcategory, Subcategory.id == Product.subcategory_id)
                .join(Category, Category.id == Subcategory.category_id)
                .join(Branch, Branch.id == Category.branch_id)
                .where(
                    Product.id == product_id,
                    Product.is_active.is_(True),
                    Branch.tenant_id == tenant_id,
                )
            )
            if not product:
                raise ValidationError(
                    f"product_id={product_id} does not belong to this tenant",
                    field="product_ids",
                )

        promo = Promotion(
            tenant_id=tenant_id,
            name=data.name,
            description=data.description,
            price=data.price,
            start_date=data.start_date,
            start_time=data.start_time,
            end_date=data.end_date,
            end_time=data.end_time,
            promotion_type_id=data.promotion_type_id,
        )
        self._db.add(promo)
        await self._db.flush()

        for branch_id in data.branch_ids:
            self._db.add(PromotionBranch(promotion_id=promo.id, branch_id=branch_id))
        for product_id in data.product_ids:
            self._db.add(PromotionItem(promotion_id=promo.id, product_id=product_id))

        await self._db.flush()

        promo = await self._get_promotion(promo.id, tenant_id)
        await safe_commit(self._db)

        logger.debug(
            "promotion.create: id=%s tenant=%s branches=%s products=%s",
            promo.id, tenant_id, len(data.branch_ids), len(data.product_ids),
        )
        return _promotion_to_out(promo)

    async def update(
        self,
        promotion_id: int,
        data: PromotionUpdate,
        tenant_id: int,
        actor_user_id: int,
    ) -> PromotionOut:
        """Update promotion metadata only (not branch/product links)."""
        promo = await self._get_promotion(promotion_id, tenant_id)

        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(promo, field, value)

        await self._db.flush()
        promo = await self._get_promotion(promotion_id, tenant_id)
        await safe_commit(self._db)

        return _promotion_to_out(promo)

    async def soft_delete(
        self,
        promotion_id: int,
        tenant_id: int,
        actor_user_id: int,
        actor_roles: list[str],
    ) -> None:
        """Soft-delete a promotion. ADMIN only — raises ForbiddenError for MANAGER."""
        if Roles.ADMIN not in actor_roles:
            raise ForbiddenError("Only ADMIN can delete promotions")

        promo = await self._get_promotion(promotion_id, tenant_id)
        now = datetime.now(UTC)
        promo.is_active = False
        promo.deleted_at = now
        promo.deleted_by_id = actor_user_id

        await safe_commit(self._db)

    async def list_for_tenant(
        self,
        tenant_id: int,
        limit: int = 50,
        offset: int = 0,
    ) -> list[PromotionOut]:
        """List all active promotions for the tenant (paginated)."""
        result = await self._db.execute(
            select(Promotion)
            .where(
                Promotion.tenant_id == tenant_id,
                Promotion.is_active.is_(True),
            )
            .options(*_PROMO_OPTIONS)
            .order_by(Promotion.id)
            .limit(min(limit, 100))
            .offset(offset)
        )
        promos = result.scalars().unique().all()
        return [_promotion_to_out(p) for p in promos]

    async def list_for_branch(
        self,
        tenant_id: int,
        branch_id: int,
        limit: int = 50,
        offset: int = 0,
    ) -> list[PromotionOut]:
        """
        List all promotions linked to a branch, including expired (D-07).

        Dashboard needs historical view — all is_active promotions, regardless of dates.
        """
        result = await self._db.execute(
            select(Promotion)
            .join(
                PromotionBranch,
                (PromotionBranch.promotion_id == Promotion.id)
                & (PromotionBranch.branch_id == branch_id),
            )
            .where(
                Promotion.tenant_id == tenant_id,
                Promotion.is_active.is_(True),
            )
            .options(*_PROMO_OPTIONS)
            .order_by(Promotion.id)
            .limit(min(limit, 100))
            .offset(offset)
        )
        promos = result.scalars().unique().all()
        return [_promotion_to_out(p) for p in promos]

    async def get_by_id(self, promotion_id: int, tenant_id: int) -> PromotionOut:
        """Return a single promotion by ID, scoped to tenant."""
        promo = await self._get_promotion(promotion_id, tenant_id)
        return _promotion_to_out(promo)

    # ── Branch/Product linking ─────────────────────────────────────────────────

    async def link_branch(
        self, promotion_id: int, branch_id: int, tenant_id: int
    ) -> PromotionOut:
        """
        Link a branch to a promotion.

        Cross-tenant validation: branch.tenant_id must match promotion.tenant_id.
        """
        promo = await self._get_promotion(promotion_id, tenant_id)

        branch = await self._db.scalar(
            select(Branch).where(
                Branch.id == branch_id,
                Branch.tenant_id == tenant_id,
                Branch.is_active.is_(True),
            )
        )
        if not branch:
            raise ForbiddenError(
                f"branch_id={branch_id} does not belong to this tenant"
            )

        existing = await self._db.scalar(
            select(PromotionBranch).where(
                PromotionBranch.promotion_id == promotion_id,
                PromotionBranch.branch_id == branch_id,
            )
        )
        if not existing:
            self._db.add(PromotionBranch(promotion_id=promotion_id, branch_id=branch_id))
            await self._db.flush()

        promo = await self._get_promotion(promotion_id, tenant_id)
        await safe_commit(self._db)
        return _promotion_to_out(promo)

    async def unlink_branch(
        self, promotion_id: int, branch_id: int, tenant_id: int
    ) -> None:
        """Unlink a branch from a promotion (hard delete the junction record)."""
        await self._get_promotion(promotion_id, tenant_id)  # validate ownership

        pb = await self._db.scalar(
            select(PromotionBranch).where(
                PromotionBranch.promotion_id == promotion_id,
                PromotionBranch.branch_id == branch_id,
            )
        )
        if pb:
            await self._db.delete(pb)
            await safe_commit(self._db)

    async def link_product(
        self, promotion_id: int, product_id: int, tenant_id: int
    ) -> PromotionOut:
        """
        Link a product to a promotion.

        Cross-tenant validation: product → subcategory → category → branch → tenant_id
        must match promotion.tenant_id.
        """
        await self._get_promotion(promotion_id, tenant_id)

        product = await self._db.scalar(
            select(Product)
            .join(Subcategory, Subcategory.id == Product.subcategory_id)
            .join(Category, Category.id == Subcategory.category_id)
            .join(Branch, Branch.id == Category.branch_id)
            .where(
                Product.id == product_id,
                Product.is_active.is_(True),
                Branch.tenant_id == tenant_id,
            )
        )
        if not product:
            raise ForbiddenError(
                f"product_id={product_id} does not belong to this tenant"
            )

        existing = await self._db.scalar(
            select(PromotionItem).where(
                PromotionItem.promotion_id == promotion_id,
                PromotionItem.product_id == product_id,
            )
        )
        if not existing:
            self._db.add(PromotionItem(promotion_id=promotion_id, product_id=product_id))
            await self._db.flush()

        promo = await self._get_promotion(promotion_id, tenant_id)
        await safe_commit(self._db)
        return _promotion_to_out(promo)

    async def unlink_product(
        self, promotion_id: int, product_id: int, tenant_id: int
    ) -> None:
        """Unlink a product from a promotion (hard delete the junction record)."""
        await self._get_promotion(promotion_id, tenant_id)  # validate ownership

        pi = await self._db.scalar(
            select(PromotionItem).where(
                PromotionItem.promotion_id == promotion_id,
                PromotionItem.product_id == product_id,
            )
        )
        if pi:
            await self._db.delete(pi)
            await safe_commit(self._db)
