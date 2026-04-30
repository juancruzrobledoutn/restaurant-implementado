"""
Seed: C-13 staff management demo data.

Data created:
  - Demo Promotion linked to tenant 1, branch 1, and the first active product
  - WaiterSectorAssignment for waiter@demo.com in the first active sector today

Idempotency:
  - Promotion: checked by (tenant_id, name)
  - WaiterSectorAssignment: checked by (user_id, sector_id, date)
  - If no product or sector exists yet, the seed skips gracefully and logs a warning
"""
from datetime import date, time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config.logging import get_logger
from rest_api.models.menu import Category, Product, Subcategory
from rest_api.models.promotion import Promotion, PromotionBranch, PromotionItem
from rest_api.models.sector import BranchSector, WaiterSectorAssignment
from rest_api.models.user import User

logger = get_logger(__name__)

# Demo promotion constants
_PROMO_NAME = "Demo Summer Sale"
_PROMO_DESCRIPTION = "50% off selected items — demo promotion"
_PROMO_PRICE = 50_00  # 50.00 in cents
_PROMO_START_DATE = date(2026, 6, 1)
_PROMO_START_TIME = time(9, 0)
_PROMO_END_DATE = date(2026, 8, 31)
_PROMO_END_TIME = time(23, 59)

_WAITER_EMAIL = "waiter@demo.com"


async def seed_staff_management(
    db: AsyncSession,
    tenant_id: int,
    branch_id: int,
) -> None:
    """
    Create C-13 demo data: one Promotion and one WaiterSectorAssignment.

    Args:
        db: AsyncSession (caller owns the commit)
        tenant_id: the tenant to scope the promotion to
        branch_id: the branch to link the promotion and sector to
    """
    await _seed_promotion(db, tenant_id=tenant_id, branch_id=branch_id)
    await _seed_waiter_assignment(db, branch_id=branch_id)


async def _seed_promotion(
    db: AsyncSession,
    tenant_id: int,
    branch_id: int,
) -> None:
    """
    Create a demo promotion linked to the given branch and the first active product.
    Idempotent: skips if a promotion with the same name already exists for this tenant.
    """
    # Check if the demo promotion already exists
    result = await db.execute(
        select(Promotion).where(
            Promotion.tenant_id == tenant_id,
            Promotion.name == _PROMO_NAME,
            Promotion.is_active.is_(True),
        )
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        logger.info("seed: demo promotion already exists id=%s", existing.id)
        return

    # Find the first active product via the category → subcategory hierarchy
    product_result = await db.execute(
        select(Product)
        .join(Subcategory, Product.subcategory_id == Subcategory.id)
        .join(Category, Subcategory.category_id == Category.id)
        .where(
            Category.branch_id == branch_id,
            Category.is_active.is_(True),
            Subcategory.is_active.is_(True),
            Product.is_active.is_(True),
        )
        .order_by(Product.id.asc())
        .limit(1)
    )
    product = product_result.scalar_one_or_none()

    if product is None:
        logger.warning(
            "seed: no active product found for branch_id=%s — "
            "skipping demo promotion product link",
            branch_id,
        )

    # Create the promotion
    promo = Promotion(
        tenant_id=tenant_id,
        name=_PROMO_NAME,
        description=_PROMO_DESCRIPTION,
        price=_PROMO_PRICE,
        start_date=_PROMO_START_DATE,
        start_time=_PROMO_START_TIME,
        end_date=_PROMO_END_DATE,
        end_time=_PROMO_END_TIME,
    )
    db.add(promo)
    await db.flush()
    logger.info("seed: created demo promotion id=%s name=%r", promo.id, promo.name)

    # Link to branch
    promo_branch = PromotionBranch(promotion_id=promo.id, branch_id=branch_id)
    db.add(promo_branch)
    await db.flush()
    logger.info("seed: linked promotion id=%s to branch_id=%s", promo.id, branch_id)

    # Link to first product if available
    if product is not None:
        promo_item = PromotionItem(promotion_id=promo.id, product_id=product.id)
        db.add(promo_item)
        await db.flush()
        logger.info(
            "seed: linked promotion id=%s to product_id=%s", promo.id, product.id
        )


async def _seed_waiter_assignment(
    db: AsyncSession,
    branch_id: int,
) -> None:
    """
    Assign waiter@demo.com to the first active sector of the branch for today.
    Idempotent: skips if the same (user_id, sector_id, date) already exists.
    """
    today = date.today()

    # Find waiter@demo.com
    user_result = await db.execute(
        select(User).where(
            User.email == _WAITER_EMAIL,
            User.is_active.is_(True),
        )
    )
    waiter = user_result.scalar_one_or_none()
    if waiter is None:
        logger.warning(
            "seed: user %r not found — skipping waiter sector assignment",
            _WAITER_EMAIL,
        )
        return

    # Find the first active sector in this branch
    sector_result = await db.execute(
        select(BranchSector).where(
            BranchSector.branch_id == branch_id,
            BranchSector.is_active.is_(True),
        ).order_by(BranchSector.id.asc()).limit(1)
    )
    sector = sector_result.scalar_one_or_none()
    if sector is None:
        logger.warning(
            "seed: no active sector found for branch_id=%s — "
            "skipping waiter sector assignment",
            branch_id,
        )
        return

    # Check if assignment already exists
    existing_result = await db.execute(
        select(WaiterSectorAssignment).where(
            WaiterSectorAssignment.user_id == waiter.id,
            WaiterSectorAssignment.sector_id == sector.id,
            WaiterSectorAssignment.date == today,
        )
    )
    if existing_result.scalar_one_or_none() is not None:
        logger.info(
            "seed: waiter assignment already exists for user_id=%s sector_id=%s date=%s",
            waiter.id,
            sector.id,
            today,
        )
        return

    assignment = WaiterSectorAssignment(
        user_id=waiter.id,
        sector_id=sector.id,
        date=today,
    )
    db.add(assignment)
    await db.flush()
    logger.info(
        "seed: assigned waiter user_id=%s to sector_id=%s for date=%s",
        waiter.id,
        sector.id,
        today,
    )
