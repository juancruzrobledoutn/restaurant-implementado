"""
Pydantic schemas for waiter assignment endpoints.

Design rules:
  - IDs are int (backend convention)
  - from_attributes = True on all response schemas for ORM coercion
  - Dates are Python date objects (not strings)

Schemas:
  UserMini                   — minimal user info embedded in responses
  SectorMini                 — minimal sector info embedded in responses
  WaiterAssignmentCreate     — body for POST /api/admin/waiter-assignments
  WaiterAssignmentOut        — full response with nested user + sector
  VerifyBranchAssignmentOut  — response for GET /api/waiter/verify-branch-assignment
"""
from datetime import date
from typing import Optional

from pydantic import BaseModel


class UserMini(BaseModel):
    """Minimal user details embedded in assignment response."""

    id: int
    email: str
    full_name: str

    model_config = {"from_attributes": True}


class SectorMini(BaseModel):
    """Minimal sector details embedded in assignment response."""

    id: int
    name: str

    model_config = {"from_attributes": True}


class WaiterAssignmentCreate(BaseModel):
    """Request body for POST /api/admin/waiter-assignments."""

    user_id: int
    sector_id: int
    date: date


class WaiterAssignmentOut(BaseModel):
    """Response schema for WaiterSectorAssignment."""

    id: int
    user_id: int
    sector_id: int
    date: date
    user: Optional[UserMini] = None
    sector: Optional[SectorMini] = None

    model_config = {"from_attributes": True}


class VerifyBranchAssignmentOut(BaseModel):
    """
    Response for GET /api/waiter/verify-branch-assignment.

    Decision D-03: ALWAYS returns HTTP 200 with this payload.
    Never returns 403/404 — prevents information leakage about tenants.

    assigned=True → waiter is assigned to the branch today.
    assigned=False → waiter is not assigned (UI shows "access denied" message).
    """

    assigned: bool
    sector_id: Optional[int] = None
    sector_name: Optional[str] = None
