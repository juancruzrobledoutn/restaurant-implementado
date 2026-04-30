"""
Pydantic schemas for service-call endpoints (C-11).

Design rules:
  - IDs are int (backend convention)
  - from_attributes = True on response schemas
  - Literal types constrain status inputs for FastAPI to 422 on invalid values
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel


# ── Service call output ───────────────────────────────────────────────────────


class ServiceCallOutput(BaseModel):
    """Standard response for a service call."""

    id: int
    session_id: int
    table_id: int
    branch_id: int
    status: str
    acked_by_id: Optional[int] = None
    closed_by_id: Optional[int] = None
    acked_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Status update input (waiter side) ─────────────────────────────────────────


class ServiceCallStatusUpdateInput(BaseModel):
    """Body for PATCH /api/waiter/service-calls/{id}. ACKED or CLOSED."""

    status: Literal["ACKED", "CLOSED"]


# ── Duplicate-guard detail body (409) ─────────────────────────────────────────


class ServiceCallDuplicateError(BaseModel):
    """Detail body for HTTP 409 when an open call already exists."""

    code: Literal["service_call_already_open"] = "service_call_already_open"
    existing_service_call_id: int
