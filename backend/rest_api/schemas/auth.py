"""
Pydantic schemas for the auth endpoints.

Design rules:
  - IDs are `int` at the API boundary (frontend converts to string)
  - `totp_code` is Optional — only required when 2FA is enabled
  - `UserResponse` is derived from DB — not from JWT claims (fresh from DB)
  - Schemas are pure data — no business logic allowed here
"""
from typing import Optional

from pydantic import BaseModel, EmailStr, field_validator


class LoginRequest(BaseModel):
    """Request body for POST /api/auth/login."""

    email: EmailStr
    password: str
    totp_code: Optional[str] = None

    @field_validator("password")
    @classmethod
    def password_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Password cannot be empty")
        return v


class UserResponse(BaseModel):
    """Authenticated user information returned in login and /me responses."""

    id: int
    email: str
    full_name: str
    tenant_id: int
    branch_ids: list[int]
    roles: list[str]
    is_2fa_enabled: bool

    model_config = {"from_attributes": True}


class LoginResponse(BaseModel):
    """Successful login response — access token + user info."""

    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class TwoFactorRequiredResponse(BaseModel):
    """Returned when 2FA is enabled but no totp_code was provided."""

    requires_2fa: bool = True


class TwoFactorSetupResponse(BaseModel):
    """Returned by POST /api/auth/2fa/setup — contains the TOTP secret and URI."""

    secret: str
    provisioning_uri: str


class TwoFactorVerifyRequest(BaseModel):
    """Request body for POST /api/auth/2fa/verify and POST /api/auth/2fa/disable."""

    totp_code: str

    @field_validator("totp_code")
    @classmethod
    def code_is_digits(cls, v: str) -> str:
        if not v.isdigit() or len(v) != 6:
            raise ValueError("TOTP code must be exactly 6 digits")
        return v


class ChangePasswordRequest(BaseModel):
    """Request body for POST /api/auth/change-password (C-28)."""

    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("new_password must be at least 8 characters")
        if len(v) > 128:
            raise ValueError("new_password must be at most 128 characters")
        return v
