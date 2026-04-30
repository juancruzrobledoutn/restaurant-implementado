"""
Pydantic schemas for staff management endpoints.

Design rules:
  - IDs are int (backend convention)
  - Password NEVER in any response schema
  - from_attributes = True on all response schemas for ORM coercion
  - role validated against UserRole enum from constants

Schemas:
  RoleAssignmentIn  — branch_id + role for create/update requests
  RoleAssignmentOut — branch_id + branch_name + role for responses
  StaffCreate       — full create body including password + assignments
  StaffUpdate       — all-optional update body (password optional)
  StaffOut          — response (no password field ever)
"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, field_validator

from shared.config.constants import Roles


class RoleAssignmentIn(BaseModel):
    """A role assignment for a specific branch (used in create/update)."""

    branch_id: int
    role: str

    @field_validator("role")
    @classmethod
    def role_must_be_valid(cls, v: str) -> str:
        valid = {r.value for r in Roles}
        if v not in valid:
            raise ValueError(f"role must be one of: {', '.join(sorted(valid))}")
        return v


class RoleAssignmentOut(BaseModel):
    """Role assignment embedded in staff response."""

    branch_id: int
    branch_name: str
    role: str

    model_config = {"from_attributes": True}


class StaffCreate(BaseModel):
    """Request body for POST /api/admin/staff."""

    email: EmailStr
    password: str
    first_name: str
    last_name: str
    assignments: list[RoleAssignmentIn] = []

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("password must be at least 8 characters")
        return v

    @field_validator("first_name", "last_name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Name fields cannot be empty")
        return v.strip()


class StaffUpdate(BaseModel):
    """Request body for PATCH /api/admin/staff/{id} — all fields optional."""

    email: Optional[EmailStr] = None
    password: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and len(v) < 8:
            raise ValueError("password must be at least 8 characters")
        return v

    @field_validator("first_name", "last_name")
    @classmethod
    def name_not_empty(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("Name fields cannot be empty")
        return v.strip() if v else v


class StaffOut(BaseModel):
    """
    Response schema for staff user.

    IMPORTANT: password/hashed_password is NEVER included here.
    The full_name field on the User model is split into first_name/last_name
    for the API response — stored as 'first_name last_name' in DB.
    """

    id: int
    email: str
    first_name: str
    last_name: str
    is_active: bool
    created_at: datetime
    assignments: list[RoleAssignmentOut] = []

    model_config = {"from_attributes": True}
