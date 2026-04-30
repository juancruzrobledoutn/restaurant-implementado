"""
Pydantic schemas for push subscription endpoints.

Design rules:
  - from_attributes = True on response schemas for ORM coercion
  - endpoint validated as a URL-like string with minimum length
  - Keys (p256dh_key, auth_key) validated for minimum length (security)

Schemas:
  PushSubscriptionIn   — body for POST /api/waiter/notifications/subscribe
  PushSubscriptionOut  — response (no keys in response — endpoint is enough)
"""
from pydantic import BaseModel, field_validator


class PushSubscriptionIn(BaseModel):
    """
    Request body for POST /api/waiter/notifications/subscribe.

    endpoint must look like a URL (starts with https://).
    Key fields are base64url-encoded VAPID keys from the browser's
    PushSubscription.getKey() method.
    """

    endpoint: str
    p256dh_key: str
    auth_key: str

    @field_validator("endpoint")
    @classmethod
    def endpoint_looks_like_url(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 10:
            raise ValueError("endpoint must be at least 10 characters")
        if not v.startswith("https://"):
            raise ValueError("endpoint must start with https://")
        return v

    @field_validator("p256dh_key")
    @classmethod
    def p256dh_key_min_length(cls, v: str) -> str:
        if len(v) < 10:
            raise ValueError("p256dh_key must be at least 10 characters")
        return v

    @field_validator("auth_key")
    @classmethod
    def auth_key_min_length(cls, v: str) -> str:
        if len(v) < 10:
            raise ValueError("auth_key must be at least 10 characters")
        return v


class PushSubscriptionOut(BaseModel):
    """Response schema for a push subscription (keys not exposed)."""

    id: int
    endpoint: str
    is_active: bool

    model_config = {"from_attributes": True}
