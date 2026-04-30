"""
AdminBillingService — read-only aggregation for admin billing views (C-26).

Architecture (design.md D2):
  - Separate from BillingService to avoid inflating its responsibility.
  - BillingService: owns the transactional lifecycle (request, pay, allocate).
  - AdminBillingService: read-only queries with paginaton, filters, and aggregations.
  - Both share the same models and DB — zero logic duplication.

Business rules enforced here:
  - Max date range: 90 days (raise ValidationError if exceeded).
  - Tenant isolation: all queries filter by tenant_id.
  - Branch isolation: branch_id must be provided by the caller (router validates
    that the requesting user has access to that branch via PermissionContext).
  - covered_cents: SUM of all Allocation.amount_cents for a check's charges.
    Computed via correlated scalar subquery — avoids N+1.
  - Payments: join with app_check to filter by branch_id + tenant_id.
  - Order: created_at DESC for both checks and payments.

Rules (NON-NEGOTIABLE):
  - NEVER db.commit() — read-only service.
  - NEVER is_active == True — use .is_(True).
  - ALWAYS filter by tenant_id.
  - Prices in INTEGER cents only — never float.
"""
from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config.logging import get_logger
from shared.utils.exceptions import ValidationError
from rest_api.models.billing import Allocation, Charge, Check, Payment
from rest_api.schemas.admin_billing import (
    CheckSummaryOut,
    PaginatedChecksOut,
    PaymentSummaryOut,
    PaginatedPaymentsOut,
)

logger = get_logger(__name__)

_MAX_RANGE_DAYS = 90


def _date_bounds(from_: date, to: date) -> tuple[datetime, datetime]:
    """
    Convert from_/to dates to half-open UTC datetime bounds:
    [from_ 00:00:00 UTC, to+1 00:00:00 UTC).
    """
    start = datetime(from_.year, from_.month, from_.day, tzinfo=timezone.utc)
    end = datetime(to.year, to.month, to.day, tzinfo=timezone.utc) + timedelta(days=1)
    return start, end


class AdminBillingService:
    """
    Read-only aggregation service for admin billing views.

    All methods are async and return Pydantic output schemas.
    No writes, no commits — pure SELECT.
    """

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    # ─── Public API ────────────────────────────────────────────────────────────

    async def list_checks(
        self,
        *,
        tenant_id: int,
        branch_id: int,
        from_: date,
        to: date,
        status: str | None,
        page: int,
        page_size: int,
    ) -> PaginatedChecksOut:
        """
        List checks for a branch with pagination and optional status filter.

        covered_cents is computed via a correlated scalar subquery (one extra query
        per check is avoided by using a subquery in the SELECT list).

        Raises:
            ValidationError: if to - from_ > 90 days.
        """
        self._validate_range(from_, to)
        start, end = _date_bounds(from_, to)

        # Correlated subquery: SUM of allocations for each check
        # Joins via Charge.check_id → Allocation.charge_id
        covered_subq = (
            select(func.coalesce(func.sum(Allocation.amount_cents), 0))
            .join(Charge, Charge.id == Allocation.charge_id)
            .where(Charge.check_id == Check.id)
            .correlate(Check)
            .scalar_subquery()
        )

        # Base query
        base_where = [
            Check.tenant_id == tenant_id,
            Check.branch_id == branch_id,
            Check.created_at >= start,
            Check.created_at < end,
        ]
        if status is not None:
            base_where.append(Check.status == status)

        # Count query
        count_result = await self._db.execute(
            select(func.count()).select_from(Check).where(*base_where)
        )
        total = count_result.scalar_one()

        # Data query with covered_cents subquery
        offset = (page - 1) * page_size
        rows_result = await self._db.execute(
            select(
                Check.id,
                Check.session_id,
                Check.branch_id,
                Check.total_cents,
                covered_subq.label("covered_cents"),
                Check.status,
                Check.created_at,
            )
            .where(*base_where)
            .order_by(Check.created_at.desc())
            .limit(page_size)
            .offset(offset)
        )
        rows = rows_result.all()

        items = [
            CheckSummaryOut(
                id=row.id,
                session_id=row.session_id,
                branch_id=row.branch_id,
                total_cents=row.total_cents,
                covered_cents=int(row.covered_cents),
                status=row.status,
                created_at=row.created_at,
            )
            for row in rows
        ]

        total_pages = max(1, math.ceil(total / page_size)) if total > 0 else 1

        logger.info(
            "admin_billing.list_checks: tenant=%s branch=%s date=%s→%s status=%r "
            "page=%s total=%s",
            tenant_id, branch_id, from_, to, status, page, total,
        )

        return PaginatedChecksOut(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=total_pages,
        )

    async def list_payments(
        self,
        *,
        tenant_id: int,
        branch_id: int,
        from_: date,
        to: date,
        method: str | None,
        status: str | None,
        page: int,
        page_size: int,
    ) -> PaginatedPaymentsOut:
        """
        List payments for a branch with pagination and optional method/status filters.

        Joins Payment with Check (app_check) to filter by branch_id + tenant_id
        without duplicating tenant isolation logic.

        Raises:
            ValidationError: if to - from_ > 90 days.
        """
        self._validate_range(from_, to)
        start, end = _date_bounds(from_, to)

        # Base where — join through check for branch/tenant scoping
        base_where = [
            Check.tenant_id == tenant_id,
            Check.branch_id == branch_id,
            Payment.created_at >= start,
            Payment.created_at < end,
            Payment.is_active.is_(True),
        ]
        if method is not None:
            base_where.append(Payment.method == method)
        if status is not None:
            base_where.append(Payment.status == status)

        # Count
        count_result = await self._db.execute(
            select(func.count())
            .select_from(Payment)
            .join(Check, Check.id == Payment.check_id)
            .where(*base_where)
        )
        total = count_result.scalar_one()

        # Data
        offset = (page - 1) * page_size
        rows_result = await self._db.execute(
            select(
                Payment.id,
                Payment.check_id,
                Payment.amount_cents,
                Payment.method,
                Payment.status,
                Payment.created_at,
            )
            .join(Check, Check.id == Payment.check_id)
            .where(*base_where)
            .order_by(Payment.created_at.desc())
            .limit(page_size)
            .offset(offset)
        )
        rows = rows_result.all()

        items = [
            PaymentSummaryOut(
                id=row.id,
                check_id=row.check_id,
                amount_cents=row.amount_cents,
                method=row.method,
                status=row.status,
                created_at=row.created_at,
            )
            for row in rows
        ]

        total_pages = max(1, math.ceil(total / page_size)) if total > 0 else 1

        logger.info(
            "admin_billing.list_payments: tenant=%s branch=%s date=%s→%s method=%r status=%r "
            "page=%s total=%s",
            tenant_id, branch_id, from_, to, method, status, page, total,
        )

        return PaginatedPaymentsOut(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=total_pages,
        )

    # ─── Private helpers ────────────────────────────────────────────────────────

    def _validate_range(self, from_: date, to: date) -> None:
        """Raise ValidationError if the date range exceeds 90 days."""
        if (to - from_).days > _MAX_RANGE_DAYS:
            raise ValidationError(
                f"El rango de fechas no puede superar {_MAX_RANGE_DAYS} dias. "
                f"Rango solicitado: {(to - from_).days} dias.",
                field="from",
            )
        if from_ > to:
            raise ValidationError(
                "La fecha de inicio (from) no puede ser posterior a la fecha de fin (to).",
                field="from",
            )
