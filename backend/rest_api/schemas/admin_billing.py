"""
Pydantic schemas for admin billing endpoints (C-26).

Schemas:
  Output:
    - CheckSummaryOut: lightweight check row for listing (no nested charges/payments)
    - PaginatedChecksOut: paginated wrapper for check listing
    - PaymentSummaryOut: lightweight payment row for listing
    - PaginatedPaymentsOut: paginated wrapper for payment listing

  Input / Query params:
    - AdminChecksQuery: branch_id, date range, optional status filter, page/page_size
    - AdminPaymentsQuery: branch_id, date range, optional method/status filter, page/page_size

Design decisions (design.md D1, D3):
  - These are administrative read-only schemas — they do NOT accept Table Token.
  - Page-based pagination (page/page_size) — consistent with usePagination hook.
  - Default from_/to = today (server-side).
  - page_size clamped to 100 (enforced by Field(ge=1, le=100)).
  - 90-day max range enforced in AdminBillingService.list_checks / list_payments.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


# ─────────────────────────────────────────────────────────────────────────────
# Output schemas
# ─────────────────────────────────────────────────────────────────────────────


class CheckSummaryOut(BaseModel):
    """
    Lightweight check summary for admin listing.

    Does NOT include nested charges or payments — those are fetched
    lazily via GET /api/billing/check/{session_id} when the modal opens (D7).

    covered_cents: sum of all APPROVED payment allocations for this check.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    branch_id: int
    total_cents: int
    covered_cents: int
    status: str
    created_at: datetime


class PaginatedChecksOut(BaseModel):
    """Paginated response for admin checks listing."""

    items: list[CheckSummaryOut]
    total: int
    page: int
    page_size: int
    total_pages: int


class PaymentSummaryOut(BaseModel):
    """
    Lightweight payment summary for admin listing.

    Includes check_id so the frontend can open CheckDetailModal from a
    payment row. external_id is omitted from listing (only in detail modal).
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    check_id: int
    amount_cents: int
    method: str
    status: str
    created_at: datetime


class PaginatedPaymentsOut(BaseModel):
    """Paginated response for admin payments listing."""

    items: list[PaymentSummaryOut]
    total: int
    page: int
    page_size: int
    total_pages: int


# ─────────────────────────────────────────────────────────────────────────────
# Query param schemas (used as FastAPI Depends)
# ─────────────────────────────────────────────────────────────────────────────


def _today() -> date:
    """Return today's date in UTC."""
    from datetime import timezone
    return datetime.now(tz=timezone.utc).date()


class AdminChecksQuery(BaseModel):
    """
    Query parameters for GET /api/admin/checks.

    Defaults:
      - from_ / to: today (half-open: [from_ 00:00, to+1 00:00))
      - page: 1
      - page_size: 20

    Constraints:
      - page_size clamped to [1, 100]
      - Range validation (to - from_ <= 90 days) is enforced in AdminBillingService
    """

    branch_id: int = Field(..., description="Branch to query (required)")
    from_: date = Field(default_factory=_today, alias="from", description="Start date (inclusive)")
    to: date = Field(default_factory=_today, description="End date (inclusive)")
    status: Literal["REQUESTED", "PAID"] | None = Field(None, description="Filter by check status")
    page: int = Field(1, ge=1, description="Page number (1-based)")
    page_size: int = Field(20, ge=1, le=100, description="Items per page (max 100)")

    model_config = ConfigDict(populate_by_name=True)


class AdminPaymentsQuery(BaseModel):
    """
    Query parameters for GET /api/admin/payments.

    Defaults: same as AdminChecksQuery.
    Additional filters: method, status (payment status).
    """

    branch_id: int = Field(..., description="Branch to query (required)")
    from_: date = Field(default_factory=_today, alias="from", description="Start date (inclusive)")
    to: date = Field(default_factory=_today, description="End date (inclusive)")
    method: Literal["cash", "card", "transfer", "mercadopago"] | None = Field(
        None, description="Filter by payment method"
    )
    status: Literal["PENDING", "APPROVED", "REJECTED", "FAILED"] | None = Field(
        None, description="Filter by payment status"
    )
    page: int = Field(1, ge=1, description="Page number (1-based)")
    page_size: int = Field(20, ge=1, le=100, description="Items per page (max 100)")

    model_config = ConfigDict(populate_by_name=True)
