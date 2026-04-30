"""
Tenant settings schemas (C-28).

Design decisions:
  - TenantSettingsResponse NEVER includes privacy_salt (GDPR / security).
  - Only ADMIN can update tenant settings.
  - /me endpoint uses tenant_id from JWT — no IDOR risk.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, field_validator


class TenantSettingsUpdate(BaseModel):
    """PATCH body for tenant settings. All fields optional."""

    name: Optional[str] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("name cannot be blank")
        return v


class TenantSettingsResponse(BaseModel):
    """
    Tenant settings response.
    privacy_salt is EXPLICITLY excluded — it is a security field and
    must NEVER appear in any API response.
    """

    id: int
    name: str

    model_config = {"from_attributes": True}
