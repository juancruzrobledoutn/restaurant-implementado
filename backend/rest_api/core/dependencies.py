"""
FastAPI dependencies for authentication and payment gateway injection.

current_user: extracts and validates the JWT from Authorization header,
  checks the Redis blacklist, checks nuclear revocation, and returns the
  user context dict for use in routers and permission checks.

get_payment_gateway (C-12): returns a PaymentGateway instance for injection
  into billing routers. Returns MercadoPagoGateway in all environments.

Usage:
    from rest_api.core.dependencies import current_user, get_payment_gateway

    @router.get("/protected")
    async def protected_endpoint(user: dict = Depends(current_user)):
        ctx = PermissionContext(user)
        ctx.require_management()
        ...

    @router.post("/payment/preference")
    async def create_preference(
        body: MPPreferenceBody,
        gateway: PaymentGateway = Depends(get_payment_gateway),
    ):
        ...

Rules:
  - NEVER bypass current_user for protected endpoints
  - ALWAYS use PermissionContext for authorization checks after current_user
  - current_user raises 401 on ANY failure — never returns partial data
  - NEVER instantiate MercadoPagoGateway directly in routers — always use get_payment_gateway()
"""
from datetime import UTC, datetime
from typing import Annotated, Any

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from shared.config.logging import get_logger
from shared.security.auth import get_nuclear_revocation_time, is_blacklisted, verify_jwt
from rest_api.services.payment_gateway import PaymentGateway

logger = get_logger(__name__)

_bearer_scheme = HTTPBearer(auto_error=False)


async def current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)],
) -> dict[str, Any]:
    """
    FastAPI dependency: extract and validate the JWT access token.

    Steps:
      1. Extract Bearer token from Authorization header
      2. Verify signature, expiration, and claims via verify_jwt()
      3. Check token is not blacklisted in Redis (fail-closed)
      4. Check nuclear revocation timestamp in Redis (fail-closed)
      5. Return user context dict

    Returns dict with keys:
      user_id, email, tenant_id, branch_ids, roles, jti

    Raises:
      HTTP 401 on any failure (missing, expired, invalid, blacklisted, revoked)
    """
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = credentials.credentials

    try:
        payload = verify_jwt(token, expected_type="access")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Invalid token")

    jti = payload["jti"]

    # Blacklist check — fail-closed (is_blacklisted returns True on Redis error)
    if await is_blacklisted(jti):
        raise HTTPException(status_code=401, detail="Token revoked")

    # Nuclear revocation check — fail-closed
    user_id = int(payload["sub"])
    revocation_time = await get_nuclear_revocation_time(user_id)
    if revocation_time is not None:
        token_iat = payload.get("iat")
        if isinstance(token_iat, datetime):
            token_issued_at = token_iat
        else:
            token_issued_at = datetime.fromtimestamp(token_iat, tz=UTC)

        if token_issued_at <= revocation_time:
            raise HTTPException(status_code=401, detail="Token revoked")

    return {
        "user_id": user_id,
        "email": payload["email"],
        "tenant_id": payload["tenant_id"],
        "branch_ids": payload["branch_ids"],
        "roles": payload["roles"],
        "jti": jti,
        "exp": payload["exp"],
    }


def get_payment_gateway() -> PaymentGateway:
    """
    FastAPI dependency factory — returns the active PaymentGateway implementation.

    Returns MercadoPagoGateway in all environments. Tests override this via
    app.dependency_overrides[get_payment_gateway] = lambda: MockGateway().

    Usage in a router:
        @router.post("/payment/preference")
        async def create_preference(
            gateway: PaymentGateway = Depends(get_payment_gateway),
        ):
            ...

    Raises:
        RuntimeError: If MERCADOPAGO_ACCESS_TOKEN is not configured at startup.
                      This is caught by validate_mp_settings() in settings.py.
    """
    # Import here to avoid circular at module level when testing
    from rest_api.services.mercadopago_gateway import MercadoPagoGateway
    return MercadoPagoGateway()
