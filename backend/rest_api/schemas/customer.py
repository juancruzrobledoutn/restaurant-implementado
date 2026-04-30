"""
Customer schemas (C-19) — Pydantic models for customer loyalty API.

Privacy rules:
  - CustomerProfileOut NEVER exposes raw device_id (only device_hint: first 7 chars)
  - OptInIn requires consent_granted=True server-side (even with client-side validation)
  - All schemas are used in /api/customer/* router (X-Table-Token auth)
"""
from __future__ import annotations

from pydantic import BaseModel, EmailStr, field_validator


class CustomerOut(BaseModel):
    """Minimal customer output — no PII."""
    id: str
    opted_in: bool

    model_config = {"from_attributes": True}


class CustomerProfileOut(BaseModel):
    """
    Full customer profile output.

    NEVER includes raw device_id — only a short deterministic prefix (device_hint)
    for client-side identification / caching. The hint is NOT reversible.
    """
    id: str
    device_hint: str | None = None  # first 7 chars of device_id — NOT the full ID
    name: str | None = None
    email: str | None = None
    opted_in: bool
    consent_version: str | None = None

    model_config = {"from_attributes": False}


class OptInIn(BaseModel):
    """
    Opt-in consent payload.

    consent_granted MUST be True — a False value returns 400 consent_required.
    The field is explicitly checked server-side even if validated client-side.
    """
    name: str
    email: str
    consent_version: str
    consent_granted: bool

    @field_validator("name")
    @classmethod
    def name_min_length(cls, v: str) -> str:
        if len(v.strip()) < 2:
            raise ValueError("name must be at least 2 characters")
        return v.strip()

    @field_validator("email")
    @classmethod
    def email_format(cls, v: str) -> str:
        # Basic format check — authoritative validation is server-side
        v = v.strip().lower()
        if "@" not in v or "." not in v.split("@")[-1]:
            raise ValueError("invalid email format")
        return v


class VisitOut(BaseModel):
    """Single visit entry in visit history."""
    session_id: str
    branch_id: str
    status: str
    visited_at: str

    model_config = {"from_attributes": False}


class PreferenceOut(BaseModel):
    """Single preference entry — product with total quantity ordered."""
    product_id: str
    product_name: str
    total_quantity: int

    model_config = {"from_attributes": False}
