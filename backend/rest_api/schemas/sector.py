"""
Pydantic schemas for sector/table/assignment endpoints.

Design rules:
  - IDs are int (backend convention — frontend converts to string at boundary)
  - from_attributes = True on all response schemas for ORM-to-Pydantic coercion
  - Table status values: AVAILABLE | OCCUPIED | RESERVED | OUT_OF_SERVICE
  - Schemas are pure data — no business logic here

Schemas:
  Sector:      SectorCreate, SectorUpdate, SectorResponse
  Table:       TableCreate, TableUpdate, TableResponse
  Assignment:  AssignmentCreate, AssignmentResponse
  Public:      PublicBranchResponse
"""
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, field_validator

VALID_TABLE_STATUSES = {"AVAILABLE", "OCCUPIED", "RESERVED", "OUT_OF_SERVICE"}


# ── Sector ────────────────────────────────────────────────────────────────────

class SectorCreate(BaseModel):
    """Request body for POST /api/admin/sectors."""

    branch_id: int
    name: str

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Sector name cannot be empty")
        return v.strip()


class SectorUpdate(BaseModel):
    """Request body for PUT /api/admin/sectors/{id}."""

    name: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("Sector name cannot be empty")
        return v.strip() if v else v


class SectorResponse(BaseModel):
    """Response schema for BranchSector."""

    id: int
    branch_id: int
    name: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Table ─────────────────────────────────────────────────────────────────────

class TableCreate(BaseModel):
    """Request body for POST /api/admin/tables."""

    branch_id: int
    sector_id: int
    number: int
    code: str
    capacity: int

    @field_validator("code")
    @classmethod
    def code_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Table code cannot be empty")
        return v.strip().upper()

    @field_validator("number")
    @classmethod
    def number_positive(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("Table number must be positive")
        return v

    @field_validator("capacity")
    @classmethod
    def capacity_positive(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("Table capacity must be positive")
        return v


class TableUpdate(BaseModel):
    """Request body for PUT /api/admin/tables/{id}."""

    number: Optional[int] = None
    code: Optional[str] = None
    capacity: Optional[int] = None
    status: Optional[str] = None

    @field_validator("code")
    @classmethod
    def code_not_empty(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("Table code cannot be empty")
        return v.strip().upper() if v else v

    @field_validator("status")
    @classmethod
    def status_valid(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_TABLE_STATUSES:
            raise ValueError(
                f"Invalid status. Must be one of: {', '.join(sorted(VALID_TABLE_STATUSES))}"
            )
        return v

    @field_validator("number")
    @classmethod
    def number_positive(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v <= 0:
            raise ValueError("Table number must be positive")
        return v

    @field_validator("capacity")
    @classmethod
    def capacity_positive(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v <= 0:
            raise ValueError("Table capacity must be positive")
        return v


class TableResponse(BaseModel):
    """Response schema for Table."""

    id: int
    branch_id: int
    sector_id: int
    number: int
    code: str
    capacity: int
    status: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Waiter Assignments ────────────────────────────────────────────────────────

class AssignmentCreate(BaseModel):
    """Request body for POST /api/admin/sectors/{sector_id}/assignments."""

    user_id: int
    date: date


class AssignmentUserDetail(BaseModel):
    """Minimal user details embedded in assignment response."""

    id: int
    email: str
    full_name: str

    model_config = {"from_attributes": True}


class AssignmentResponse(BaseModel):
    """Response schema for WaiterSectorAssignment."""

    id: int
    user_id: int
    sector_id: int
    date: date
    user: Optional[AssignmentUserDetail] = None

    model_config = {"from_attributes": True}


# ── Public ────────────────────────────────────────────────────────────────────

class PublicBranchResponse(BaseModel):
    """
    Minimal branch info for public listing.

    Only exposes safe fields — no internal IDs beyond what is needed for routing.
    """

    id: int
    name: str
    address: str
    slug: str

    model_config = {"from_attributes": True}
