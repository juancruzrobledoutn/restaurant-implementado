"""
Pydantic schemas for kitchen-ticket endpoints (C-11).

Design rules:
  - IDs are int (backend convention)
  - from_attributes = True on response schemas for ORM-to-Pydantic coercion
  - Literal types constrain status inputs so FastAPI returns 422 on invalid values
  - Nested output carries enough context (round/session/table/sector) that the
    kitchen board renders with one request
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


# ── Nested item output (derived from KitchenTicketItem + RoundItem + Product) ─


class KitchenTicketItemOutput(BaseModel):
    """One line of a kitchen ticket — flattened view for the kitchen UI."""

    id: int
    round_item_id: int
    product_id: int
    product_name: str
    quantity: int
    notes: Optional[str] = None
    is_voided: bool = False

    model_config = {"from_attributes": True}


# ── Ticket output (nested with round/session/table info) ──────────────────────


class KitchenTicketOutput(BaseModel):
    """Response for a single ticket on the kitchen board."""

    id: int
    round_id: int
    round_number: int
    session_id: int
    table_id: int
    table_number: Optional[str] = None
    sector_name: Optional[str] = None
    branch_id: int
    status: str
    priority: bool = False
    started_at: Optional[datetime] = None
    ready_at: Optional[datetime] = None
    delivered_at: Optional[datetime] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    items: list[KitchenTicketItemOutput] = Field(default_factory=list)

    model_config = {"from_attributes": True}


# ── Status update input ───────────────────────────────────────────────────────


class KitchenTicketStatusUpdateInput(BaseModel):
    """Body for PATCH /api/kitchen/tickets/{id}. READY or DELIVERED."""

    status: Literal["READY", "DELIVERED"]
