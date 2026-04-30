"""
Pydantic schemas for billing endpoints (C-12).

Schemas:
  Output:
    - AllocationOut: serializes an allocation row
    - ChargeOut: serializes a charge with computed remaining_cents
    - PaymentOut: serializes a payment with its allocations
    - CheckOut: full check with charges and payments
    - PaymentStatusOut: lightweight payment status check
    - MPPreferenceOut: response from MercadoPago preference creation

  Input:
    - CheckRequestBody: split method + optional custom amounts
    - ManualPaymentBody: cash/card/transfer payment from waiter
    - MPPreferenceBody: create MP preference for a check
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


# ─────────────────────────────────────────────────────────────────────────────
# Output schemas
# ─────────────────────────────────────────────────────────────────────────────


class AllocationOut(BaseModel):
    """Serialized allocation linking a payment to a charge."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    charge_id: int
    payment_id: int
    amount_cents: int


class ChargeOut(BaseModel):
    """
    Serialized charge with remaining_cents.

    remaining_cents is a computed field — it must be set explicitly before
    serialization because it is NOT a model column.
    It is calculated by BillingService._remaining_cents() and injected.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    check_id: int
    diner_id: int | None
    amount_cents: int
    description: str | None
    remaining_cents: int
    allocations: list[AllocationOut] = []


class PaymentOut(BaseModel):
    """Serialized payment with its allocations."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    check_id: int
    amount_cents: int
    method: str
    status: str
    external_id: str | None
    created_at: datetime
    allocations: list[AllocationOut] = []


class CheckOut(BaseModel):
    """
    Full billing check output.

    Charges include computed remaining_cents per charge.
    Payments include their FIFO allocations.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    branch_id: int
    tenant_id: int
    total_cents: int
    status: str
    created_at: datetime
    charges: list[ChargeOut] = []
    payments: list[PaymentOut] = []


class PaymentStatusOut(BaseModel):
    """Lightweight payment status response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    status: str
    amount_cents: int
    method: str


class MPPreferenceOut(BaseModel):
    """MercadoPago preference response — sent to frontend to redirect/render checkout."""

    preference_id: str
    init_point: str


# ─────────────────────────────────────────────────────────────────────────────
# Input schemas
# ─────────────────────────────────────────────────────────────────────────────


class CheckRequestBody(BaseModel):
    """
    Request body for POST /api/billing/check/request.

    split_method:
      - "equal_split": total divided equally among all diners. Last diner
        absorbs rounding residual.
      - "by_consumption": each diner's charge = sum of their round items.
        Shared items (diner_id=None) are split equally.
      - "custom": caller provides explicit per-diner amounts via custom_split.

    custom_split: dict mapping diner_id (int) → amount_cents (int).
    Only required when split_method="custom". Sum must equal total_cents.
    """

    split_method: Literal["equal_split", "by_consumption", "custom"] = "equal_split"
    custom_split: dict[int, int] | None = None


class ManualPaymentBody(BaseModel):
    """
    Request body for POST /api/waiter/payments/manual.

    Used by waiters to register cash, card, or bank transfer payments.
    reference is an optional note (e.g., card terminal receipt ID).
    """

    check_id: int
    amount_cents: int
    method: Literal["cash", "card", "transfer"]
    reference: str | None = None


class MPPreferenceBody(BaseModel):
    """
    Request body for POST /api/billing/payment/preference.

    Creates a MercadoPago preference and returns init_point for redirect.
    """

    check_id: int
