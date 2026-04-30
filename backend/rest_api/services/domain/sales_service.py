"""
SalesService — read-only aggregator for daily sales KPIs (C-16).

Architecture:
  - Not a BranchScopedService — it is a pure read-only aggregator.
  - Constructor receives db: AsyncSession.
  - All methods filter by tenant_id (via Branch join) and branch_id.
  - Prices in integer cents only — never float.

Performance choices:
  - get_daily_kpis: uses three correlated subqueries (revenue, orders, diners)
    instead of eager loading. Each subquery is index-friendly:
      ix_app_check_tenant_id, ix_app_check_session_id, ix_payment_check_id.
    A single large JOIN with GROUP BY would be harder to optimize and prone to
    double-counting when checks have multiple payments. Subqueries isolate each
    aggregate cleanly.
  - get_top_products: single GROUP BY query with JOIN chain; ORDER BY revenue DESC.
    Bounded by temporal filter + branch_id index on check.

Rules (NON-NEGOTIABLE):
  - NEVER db.commit() — read-only service, no mutations.
  - NEVER is_active == True — use .is_(True).
  - ALWAYS filter by tenant_id.
  - ALWAYS cap limit to 50.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config.logging import get_logger
from rest_api.models.billing import Check, Payment
from rest_api.models.branch import Branch
from rest_api.models.menu import Product
from rest_api.models.round import Round, RoundItem
from rest_api.models.table_session import Diner, TableSession
from rest_api.schemas.sales import DailyKPIsOutput, TopProductOutput

logger = get_logger(__name__)


class SalesService:
    """
    Read-only aggregator for daily sales KPIs and top products.

    Filters:
      - All queries scoped to branch_id and tenant_id.
      - Check.status == 'PAID' is mandatory for revenue queries.
      - RoundItem.is_voided.is_(False) is mandatory for top_products.
    """

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def get_daily_kpis(
        self,
        branch_id: int,
        target_date: date,
        tenant_id: int,
    ) -> DailyKPIsOutput:
        """
        Aggregate daily revenue KPIs for a branch on a given date.

        Temporal bounds: [target_date 00:00:00 UTC, target_date+1 00:00:00 UTC).
        The AuditMixin.created_at column on Check is used as the event timestamp.

        Returns zero-value DailyKPIsOutput when there are no PAID checks.
        """
        # Temporal boundary — half-open interval [start, end)
        start = datetime(
            target_date.year, target_date.month, target_date.day,
            tzinfo=timezone.utc,
        )
        from datetime import timedelta
        end = start + timedelta(days=1)

        # Base filter: PAID checks for this branch on this date, tenant-verified
        base_q = (
            select(Check.id)
            .join(Branch, Check.branch_id == Branch.id)
            .where(
                Check.branch_id == branch_id,
                Check.is_active.is_(True),
                Check.status == "PAID",
                Branch.tenant_id == tenant_id,
                Check.created_at >= start,
                Check.created_at < end,
            )
        )
        check_ids_result = await self._db.execute(base_q)
        check_ids = [row[0] for row in check_ids_result.all()]

        if not check_ids:
            return DailyKPIsOutput(
                revenue_cents=0,
                orders=0,
                average_ticket_cents=0,
                diners=0,
            )

        orders = len(check_ids)

        # Revenue: sum of APPROVED payments on these checks
        revenue_q = select(func.coalesce(func.sum(Payment.amount_cents), 0)).where(
            Payment.check_id.in_(check_ids),
            Payment.status == "APPROVED",
            Payment.is_active.is_(True),
        )
        revenue_result = await self._db.execute(revenue_q)
        revenue_cents: int = revenue_result.scalar_one()

        average_ticket_cents = revenue_cents // orders if orders > 0 else 0

        # Diners: count distinct Diner.id via Check → TableSession → Diner
        diners_q = (
            select(func.count(distinct(Diner.id)))
            .join(TableSession, Diner.session_id == TableSession.id)
            .join(Check, Check.session_id == TableSession.id)
            .where(
                Check.id.in_(check_ids),
                Diner.is_active.is_(True),
            )
        )
        diners_result = await self._db.execute(diners_q)
        diners: int = diners_result.scalar_one()

        logger.debug(
            "sales.daily_kpis branch=%d date=%s orders=%d revenue=%d diners=%d",
            branch_id, target_date, orders, revenue_cents, diners,
        )

        return DailyKPIsOutput(
            revenue_cents=revenue_cents,
            orders=orders,
            average_ticket_cents=average_ticket_cents,
            diners=diners,
        )

    async def get_top_products(
        self,
        branch_id: int,
        target_date: date,
        tenant_id: int,
        limit: int = 10,
    ) -> list[TopProductOutput]:
        """
        Return top-selling products ordered by revenue (price_cents_snapshot * quantity).

        Joins: RoundItem → Round → TableSession → Check (status=PAID) → Branch.
        Excludes voided items.
        Limit is capped at 50 to bound result set size.
        """
        limit = min(limit, 50)

        # Temporal boundary
        start = datetime(
            target_date.year, target_date.month, target_date.day,
            tzinfo=timezone.utc,
        )
        from datetime import timedelta
        end = start + timedelta(days=1)

        revenue_expr = func.sum(
            RoundItem.price_cents_snapshot * RoundItem.quantity
        )

        q = (
            select(
                RoundItem.product_id,
                Product.name.label("product_name"),
                func.sum(RoundItem.quantity).label("quantity_sold"),
                revenue_expr.label("revenue_cents"),
            )
            .join(Product, RoundItem.product_id == Product.id)
            .join(Round, RoundItem.round_id == Round.id)
            .join(TableSession, Round.session_id == TableSession.id)
            .join(Check, Check.session_id == TableSession.id)
            .join(Branch, Check.branch_id == Branch.id)
            .where(
                Check.branch_id == branch_id,
                Check.is_active.is_(True),
                Check.status == "PAID",
                Branch.tenant_id == tenant_id,
                RoundItem.is_voided.is_(False),
                RoundItem.is_active.is_(True),
                Check.created_at >= start,
                Check.created_at < end,
            )
            .group_by(RoundItem.product_id, Product.name)
            .order_by(revenue_expr.desc())
            .limit(limit)
        )

        result = await self._db.execute(q)
        rows = result.all()

        return [
            TopProductOutput(
                product_id=row.product_id,
                product_name=row.product_name,
                quantity_sold=row.quantity_sold,
                revenue_cents=row.revenue_cents,
            )
            for row in rows
        ]
