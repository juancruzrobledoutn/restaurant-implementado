"""
Auth router — thin HTTP adapter.

ALL business logic is delegated to AuthService. This router only:
  - Parses HTTP request (body, cookies, headers)
  - Calls AuthService methods
  - Sets/clears cookies on the Response
  - Returns HTTP responses

Endpoints:
  POST /login          — authenticate, issue tokens
  POST /refresh        — rotate tokens using refresh cookie
  POST /logout         — blacklist token, clear cookie
  GET  /me             — return user info from DB
  POST /2fa/setup      — generate TOTP secret
  POST /2fa/verify     — activate 2FA
  POST /2fa/disable    — deactivate 2FA

Rate limiting:
  /login and /refresh are decorated with @limiter.limit("5/minute") per IP.
  Per-email rate limiting is handled inside AuthService → check_email_rate_limit().
"""
from typing import Annotated, Any, Union

from fastapi import APIRouter, Cookie, Depends, Request, Response

from shared.config.settings import settings
from shared.infrastructure.db import get_db
from rest_api.core.dependencies import current_user
from rest_api.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    LoginResponse,
    TwoFactorRequiredResponse,
    TwoFactorSetupResponse,
    TwoFactorVerifyRequest,
    UserResponse,
)
from rest_api.core.limiter import limiter
from rest_api.services.auth_service import AuthService
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(tags=["auth"])
auth_service = AuthService()

_REFRESH_COOKIE_NAME = "refresh_token"
_REFRESH_COOKIE_PATH = "/api/auth"


def _set_refresh_cookie(response: Response, token: str) -> None:
    """Set the refresh token HttpOnly cookie on the response."""
    response.set_cookie(
        key=_REFRESH_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        domain=settings.COOKIE_DOMAIN,
        path=_REFRESH_COOKIE_PATH,
        max_age=settings.REFRESH_TOKEN_TTL,
    )


def _clear_refresh_cookie(response: Response) -> None:
    """Clear the refresh token cookie (set to empty with max-age=0)."""
    response.set_cookie(
        key=_REFRESH_COOKIE_NAME,
        value="",
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        domain=settings.COOKIE_DOMAIN,
        path=_REFRESH_COOKIE_PATH,
        max_age=0,
    )


@router.post(
    "/login",
    response_model=Union[LoginResponse, TwoFactorRequiredResponse],
    summary="Authenticate user and issue tokens",
)
@limiter.limit(f"{settings.LOGIN_RATE_LIMIT if settings.ENVIRONMENT == 'production' else 100}/minute")
async def login(
    body: LoginRequest,
    response: Response,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Any:
    """
    Authenticate via email + password (+ optional TOTP code).

    On success: returns access_token + user info, sets refresh_token cookie.
    If 2FA is required but no code provided: returns {requires_2fa: true} without tokens.
    Rate limited: 5 req/min per IP (slowapi) + 5 per email (Redis Lua).
    """
    result = await auth_service.authenticate(
        email=body.email,
        password=body.password,
        totp_code=body.totp_code,
        db=db,
    )

    # authenticate() returns a tuple (LoginResponse, refresh_token) OR TwoFactorRequiredResponse
    if isinstance(result, TwoFactorRequiredResponse):
        return result

    login_response, refresh_token = result
    _set_refresh_cookie(response, refresh_token)
    return login_response


@router.post(
    "/refresh",
    response_model=LoginResponse,
    summary="Rotate tokens using refresh cookie",
)
@limiter.limit(f"{settings.LOGIN_RATE_LIMIT if settings.ENVIRONMENT == 'production' else 100}/minute")
async def refresh(
    response: Response,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    refresh_token: Annotated[str | None, Cookie()] = None,
) -> Any:
    """
    Issue a new access token using the refresh token cookie.

    Rotation: old refresh token is blacklisted, new tokens are issued.
    If the old refresh token is replayed (already blacklisted), nuclear revocation fires.
    Rate limited: 5 req/min per IP (slowapi).
    """
    if not refresh_token:
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Refresh token missing")

    login_response, new_refresh = await auth_service.refresh(refresh_token, db)
    _set_refresh_cookie(response, new_refresh)
    return login_response


@router.post(
    "/logout",
    summary="Blacklist current token and clear cookie",
)
async def logout(
    response: Response,
    user: Annotated[dict, Depends(current_user)],
) -> dict:
    """
    Logout the authenticated user.

    Blacklists the current access token's jti in Redis.
    Clears the refresh_token cookie.
    """
    result = await auth_service.logout(jti=user["jti"], exp=user["exp"])
    _clear_refresh_cookie(response)
    return result


@router.get(
    "/me",
    response_model=UserResponse,
    summary="Return current user info from database",
)
async def me(
    user: Annotated[dict, Depends(current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserResponse:
    """
    Return the authenticated user's info — always fetched fresh from DB.

    This ensures deleted/deactivated users are caught even with valid tokens.
    """
    return await auth_service.get_me(user_id=user["user_id"], db=db)


# ── 2FA Endpoints ──────────────────────────────────────────────────────────────

@router.post(
    "/change-password",
    summary="Change the authenticated user's password",
)
async def change_password(
    body: ChangePasswordRequest,
    user: Annotated[dict, Depends(current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """
    Change the current user's password.

    Requires current_password to verify identity.
    new_password must satisfy the SecurityPolicy (8-128 chars, ≥1 digit, ≥1 uppercase).
    Does NOT invalidate existing tokens (by design — see design.md Decision #5).
    Emits USER_PASSWORD_CHANGED audit log.
    """
    return await auth_service.change_password(
        user_id=user["user_id"],
        current_password=body.current_password,
        new_password=body.new_password,
        db=db,
    )


@router.post(
    "/2fa/setup",
    response_model=TwoFactorSetupResponse,
    summary="Generate TOTP secret (does not enable 2FA yet)",
)
async def setup_2fa(
    user: Annotated[dict, Depends(current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TwoFactorSetupResponse:
    """
    Generate a TOTP secret and provisioning URI.

    2FA is NOT enabled yet — call /2fa/verify with a valid code to activate it.
    Returns HTTP 400 if 2FA is already enabled.
    """
    return await auth_service.setup_2fa(user_id=user["user_id"], db=db)


@router.post(
    "/2fa/verify",
    summary="Verify TOTP code and enable 2FA",
)
async def verify_2fa(
    body: TwoFactorVerifyRequest,
    user: Annotated[dict, Depends(current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """
    Validate a TOTP code and set is_2fa_enabled=True.

    Returns HTTP 400 if setup was not done or code is invalid.
    """
    return await auth_service.verify_2fa(
        user_id=user["user_id"],
        totp_code=body.totp_code,
        db=db,
    )


@router.post(
    "/2fa/disable",
    summary="Disable 2FA (requires current TOTP code)",
)
async def disable_2fa(
    body: TwoFactorVerifyRequest,
    user: Annotated[dict, Depends(current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """
    Disable 2FA after verifying the current TOTP code.

    Requires a valid code to prevent disabling 2FA from a hijacked session.
    Returns HTTP 400 if 2FA is not enabled or code is invalid.
    """
    return await auth_service.disable_2fa(
        user_id=user["user_id"],
        totp_code=body.totp_code,
        db=db,
    )
