"""
Pydantic schemas for table session, diner, and cart item endpoints (C-08).

Design rules:
  - IDs are int (backend convention — frontend converts to string at boundary)
  - from_attributes = True on all response schemas for ORM-to-Pydantic coercion
  - DinerRegisterInput uses min_length/max_length validators (no business logic here)
  - PublicJoinResponse is the payload returned by POST /api/public/tables/code/{code}/join
  - DinerSessionView is the payload returned by GET /api/diner/session
"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator


# ── TableSession ──────────────────────────────────────────────────────────────

class TableSessionOutput(BaseModel):
    """Response schema for a table session."""

    id: int
    table_id: int
    branch_id: int
    status: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DinerOutput(BaseModel):
    """Minimal diner info for embedding in session views."""

    id: int
    session_id: int
    name: str
    device_id: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class TableSessionWithDinersOutput(TableSessionOutput):
    """Session response with embedded diner list."""

    diners: list[DinerOutput] = []


# ── CartItem ──────────────────────────────────────────────────────────────────

class CartItemOutput(BaseModel):
    """Response schema for a cart item."""

    id: int
    session_id: int
    diner_id: int
    product_id: int
    quantity: int
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Diner input ───────────────────────────────────────────────────────────────

class DinerRegisterInput(BaseModel):
    """Request body for joining a table (public endpoint)."""

    name: str
    device_id: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError("name cannot be empty")
        if len(stripped) > 255:
            raise ValueError("name must be 255 characters or fewer")
        return stripped


# ── Public join response ──────────────────────────────────────────────────────

class TablePublicOutput(BaseModel):
    """Minimal public table info — safe fields only, no internal sector IDs."""

    id: int
    code: str
    sector_id: int
    branch_id: int
    capacity: int

    model_config = {"from_attributes": True}


class PublicJoinResponse(BaseModel):
    """Response from POST /api/public/tables/code/{code}/join."""

    table_token: str
    session_id: int
    diner_id: int
    table: TablePublicOutput


# ── Diner session view ────────────────────────────────────────────────────────

class BranchPublicOutput(BaseModel):
    """Minimal branch info for diner session view."""

    id: int
    name: str
    slug: str

    model_config = {"from_attributes": True}


class TableForDinerOutput(BaseModel):
    """Table info for diner session view."""

    id: int
    code: str
    capacity: int
    status: str

    model_config = {"from_attributes": True}


class DinerSessionView(BaseModel):
    """
    Full diner session view for GET /api/diner/session.

    Contains everything the pwaMenu needs to render the session:
    the session itself, table info, branch slug for WS routing,
    all diners at the table, and this diner's cart items.
    """

    session: TableSessionOutput
    table: TableForDinerOutput
    branch_slug: str
    diners: list[DinerOutput]
    my_cart_items: list[CartItemOutput]
