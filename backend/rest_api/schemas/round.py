"""
Pydantic schemas for the round endpoints (C-10).

Design rules:
  - IDs are int (backend convention — frontend converts to string at boundary)
  - from_attributes = True on response schemas for ORM-to-Pydantic coercion
  - Prices in integer cents — never float
  - Literal types constrain status inputs so FastAPI returns 422 on invalid values
  - StockShortage/StockInsufficientDetail carry the structured 409 body for the
    stock-insufficient path on submit
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


# ── Round and RoundItem outputs ───────────────────────────────────────────────


class RoundItemOutput(BaseModel):
    """Response schema for a single round item."""

    id: int
    round_id: int
    product_id: int
    diner_id: Optional[int] = None
    quantity: int
    notes: Optional[str] = None
    price_cents_snapshot: int
    is_voided: bool
    void_reason: Optional[str] = None
    voided_at: Optional[datetime] = None
    voided_by_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RoundOutput(BaseModel):
    """Response schema for a round (without items — use RoundWithItemsOutput for embed)."""

    id: int
    session_id: int
    branch_id: int
    round_number: int
    status: str
    created_by_role: str
    created_by_diner_id: Optional[int] = None
    created_by_user_id: Optional[int] = None
    confirmed_by_id: Optional[int] = None
    submitted_by_id: Optional[int] = None
    canceled_by_id: Optional[int] = None
    cancel_reason: Optional[str] = None
    pending_at: datetime
    confirmed_at: Optional[datetime] = None
    submitted_at: Optional[datetime] = None
    in_kitchen_at: Optional[datetime] = None
    ready_at: Optional[datetime] = None
    served_at: Optional[datetime] = None
    canceled_at: Optional[datetime] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RoundWithItemsOutput(RoundOutput):
    """Round response with embedded items — used on create / get-by-id."""

    items: list[RoundItemOutput] = Field(default_factory=list)


class KitchenRoundItemOutput(BaseModel):
    """Kitchen-facing item — product name resolved, no internal IDs exposed."""

    product_name: str
    quantity: int
    notes: Optional[str] = None
    is_voided: bool


class KitchenRoundOutput(BaseModel):
    """Kitchen-facing round — enriched with table/sector/diner context."""

    id: int
    session_id: int
    branch_id: int
    status: str
    submitted_at: Optional[datetime] = None
    table_number: int
    sector_name: Optional[str] = None
    diner_count: int
    items: list[KitchenRoundItemOutput] = Field(default_factory=list)


# ── Diner-side inputs ─────────────────────────────────────────────────────────


class DinerCreateRoundInput(BaseModel):
    """Body for POST /api/diner/rounds. All fields optional."""

    notes: Optional[str] = Field(default=None, max_length=500)


# ── Waiter-side inputs ────────────────────────────────────────────────────────


class WaiterCreateRoundItemInput(BaseModel):
    """A single item in a waiter's quick-command round."""

    product_id: int = Field(..., gt=0)
    quantity: int = Field(..., ge=1)
    notes: Optional[str] = Field(default=None, max_length=500)
    diner_id: Optional[int] = Field(default=None, gt=0)


class WaiterCreateRoundInput(BaseModel):
    """Body for POST /api/waiter/sessions/{session_id}/rounds."""

    items: list[WaiterCreateRoundItemInput] = Field(..., min_length=1)


# ── Status-transition inputs ──────────────────────────────────────────────────


class WaiterRoundStatusUpdateInput(BaseModel):
    """Body for PATCH /api/waiter/rounds/{id}. Only CONFIRMED is accepted."""

    status: Literal["CONFIRMED"]


class AdminRoundStatusUpdateInput(BaseModel):
    """Body for PATCH /api/admin/rounds/{id}. SUBMITTED or CANCELED."""

    status: Literal["SUBMITTED", "CANCELED"]
    cancel_reason: Optional[str] = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _check_cancel_reason(self) -> "AdminRoundStatusUpdateInput":
        if self.status == "CANCELED" and (
            self.cancel_reason is None or not self.cancel_reason.strip()
        ):
            raise ValueError("cancel_reason is required when status is CANCELED")
        return self


class KitchenRoundStatusUpdateInput(BaseModel):
    """Body for PATCH /api/kitchen/rounds/{id}. IN_KITCHEN or READY."""

    status: Literal["IN_KITCHEN", "READY"]


# ── Void-item input ───────────────────────────────────────────────────────────


class VoidItemInput(BaseModel):
    """Body for POST /api/waiter/rounds/{round_id}/void-item."""

    round_item_id: int = Field(..., gt=0)
    void_reason: str = Field(..., min_length=1, max_length=500)

    @field_validator("void_reason")
    @classmethod
    def _strip_void_reason(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError("void_reason cannot be empty or whitespace-only")
        return stripped


# ── Admin round output schemas (C-25) ────────────────────────────────────────


class RoundAdminOutput(BaseModel):
    """
    Admin-facing round — enriched with denormalised table/sector/diner context.
    Used by GET /api/admin/rounds (list) and GET /api/admin/rounds/{id} (summary).

    Design (design.md D10):
      - items_count and total_cents exclude voided items
      - All IDs are int (frontend converts to string at boundary)
    """

    id: int
    round_number: int
    session_id: int
    branch_id: int
    status: str
    # Denorm for UI
    table_id: int
    table_code: str
    table_number: int
    sector_id: Optional[int] = None
    sector_name: Optional[str] = None
    diner_id: Optional[int] = None
    diner_name: Optional[str] = None
    items_count: int
    total_cents: int
    # State-machine timestamps
    pending_at: datetime
    confirmed_at: Optional[datetime] = None
    submitted_at: Optional[datetime] = None
    in_kitchen_at: Optional[datetime] = None
    ready_at: Optional[datetime] = None
    served_at: Optional[datetime] = None
    canceled_at: Optional[datetime] = None
    cancel_reason: Optional[str] = None
    created_by_role: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RoundAdminListFilters(BaseModel):
    """Query-param filters for GET /api/admin/rounds."""

    branch_id: int = Field(..., gt=0)
    date: Optional[str] = Field(default=None, description="YYYY-MM-DD local date")
    sector_id: Optional[int] = Field(default=None, gt=0)
    status: Optional[
        Literal[
            "PENDING",
            "CONFIRMED",
            "SUBMITTED",
            "IN_KITCHEN",
            "READY",
            "SERVED",
            "CANCELED",
        ]
    ] = None
    table_code: Optional[str] = Field(default=None, max_length=50)
    limit: int = Field(default=50, ge=1, le=200)
    offset: int = Field(default=0, ge=0)


class RoundAdminListOutput(BaseModel):
    """Paginated list response for GET /api/admin/rounds."""

    items: list[RoundAdminOutput]
    total: int
    limit: int
    offset: int


class RoundAdminWithItemsOutput(RoundAdminOutput):
    """Detail output — RoundAdminOutput + embedded items for the detail modal."""

    items: list[RoundItemOutput] = Field(default_factory=list)


# ── Stock-insufficient 409 detail body ────────────────────────────────────────


class StockShortage(BaseModel):
    """One shortage entry in a stock-insufficient 409 response."""

    resource: Literal["product", "ingredient"]
    product_id: Optional[int] = None
    product_name: Optional[str] = None
    ingredient_id: Optional[int] = None
    ingredient_name: Optional[str] = None
    requested: int
    available: int


class StockInsufficientDetail(BaseModel):
    """Detail body for HTTP 409 when stock is insufficient on submit."""

    code: Literal["stock_insufficient"] = "stock_insufficient"
    shortages: list[StockShortage]
