"""
AuthService — domain service for all authentication operations.

Architecture rules:
  - NEVER put business logic in routers — everything goes through here
  - NEVER db.commit() directly — use safe_commit(db)
  - NEVER Model.is_active == True — use Model.is_active.is_(True)
  - ALWAYS filter by tenant_id where applicable
  - Constant-time password check even when user not found (prevents user enumeration)

Methods:
  authenticate(email, password, totp_code, db) → LoginResponse | TwoFactorRequiredResponse
  refresh(refresh_token, db)                    → LoginResponse
  logout(jti, exp)                              → dict
  get_me(user_id, db)                           → UserResponse
  setup_2fa(user_id, db)                        → TwoFactorSetupResponse
  verify_2fa(user_id, totp_code, db)            → dict
  disable_2fa(user_id, totp_code, db)           → dict
"""
from datetime import UTC, datetime
from typing import Union

import pyotp
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.config.logging import get_logger
from shared.infrastructure.db import safe_commit
from shared.security.auth import (
    blacklist_token,
    create_access_token,
    create_refresh_token,
    get_nuclear_revocation_time,
    is_blacklisted,
    nuclear_revoke,
    verify_jwt,
)
from shared.security.password import hash_password, verify_password
from rest_api.models.user import User, UserBranchRole
from rest_api.schemas.auth import (
    LoginResponse,
    TwoFactorRequiredResponse,
    TwoFactorSetupResponse,
    UserResponse,
)
from rest_api.services.rate_limit_service import check_email_rate_limit

# Password policy constants (aligned with SecurityPolicy from C-03)
_MIN_PASSWORD_LENGTH = 8
_MAX_PASSWORD_LENGTH = 128

logger = get_logger(__name__)

# Dummy hash used for constant-time comparison when user is not found.
# This prevents user enumeration via timing attacks.
# Generated at module load: ensures a valid bcrypt hash passlib can call verify() on.
_DUMMY_HASH: str = hash_password("__dummy_timing_protection__")


async def _get_user_with_roles(
    email: str, db: AsyncSession
) -> User | None:
    """
    Query a User by email, eagerly loading their branch_roles.
    Returns None if not found or inactive.
    """
    result = await db.execute(
        select(User)
        .where(User.email == email, User.is_active.is_(True))
        .options(selectinload(User.branch_roles))
    )
    return result.scalar_one_or_none()


def _build_user_dict(user: User) -> dict:
    """Convert a User ORM instance to the dict format used by JWT and PermissionContext."""
    branch_ids = list({br.branch_id for br in user.branch_roles})
    roles = list({br.role for br in user.branch_roles})
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "tenant_id": user.tenant_id,
        "branch_ids": branch_ids,
        "roles": roles,
        "is_2fa_enabled": user.is_2fa_enabled,
    }


def _build_user_response(user: User) -> UserResponse:
    """Build a UserResponse from a User ORM instance (branch_roles must be loaded)."""
    d = _build_user_dict(user)
    return UserResponse(
        id=d["id"],
        email=d["email"],
        full_name=d["full_name"],
        tenant_id=d["tenant_id"],
        branch_ids=d["branch_ids"],
        roles=d["roles"],
        is_2fa_enabled=d["is_2fa_enabled"],
    )


class AuthService:
    """
    Domain service encapsulating all authentication and 2FA logic.

    All methods are async and accept a db session.
    """

    async def authenticate(
        self,
        email: str,
        password: str,
        totp_code: str | None,
        db: AsyncSession,
    ) -> Union[LoginResponse, TwoFactorRequiredResponse]:
        """
        Authenticate a user via email + password (+ optional TOTP code).

        Flow:
          1. Check email-based rate limit (Redis Lua script)
          2. Query user by email
          3. Verify password (constant-time even if user not found)
          4. If 2FA enabled and no totp_code → return TwoFactorRequiredResponse
          5. If 2FA enabled and totp_code provided → verify it
          6. Issue tokens, update last_login_at, return LoginResponse

        Raises:
          HTTPException(401) on invalid credentials or inactive user
          HTTPException(429) on rate limit exceeded
          HTTPException(503) on Redis unavailable
        """
        # Rate limit check FIRST — before hitting the database
        await check_email_rate_limit(email)

        user = await _get_user_with_roles(email, db)

        # Constant-time path: always call verify_password even when user is None
        # This prevents timing attacks that reveal whether an email exists
        password_to_check = user.hashed_password if user else _DUMMY_HASH
        is_valid = verify_password(password, password_to_check)

        if not user or not is_valid:
            raise HTTPException(status_code=401, detail="Invalid credentials")

        # 2FA check
        if user.is_2fa_enabled:
            if not totp_code:
                return TwoFactorRequiredResponse()

            if not user.totp_secret:
                raise HTTPException(status_code=401, detail="Invalid credentials")

            totp = pyotp.TOTP(user.totp_secret)
            if not totp.verify(totp_code, valid_window=1):
                raise HTTPException(status_code=401, detail="Invalid TOTP code")

        # Issue tokens
        user_dict = _build_user_dict(user)
        access_token = create_access_token(user_dict)
        refresh_token = create_refresh_token(user_dict)

        # Update last_login_at
        user.last_login_at = datetime.now(UTC)
        await safe_commit(db)

        return LoginResponse(
            access_token=access_token,
            token_type="bearer",
            user=_build_user_response(user),
        ), refresh_token  # type: ignore[return-value]
        # Note: caller (router) unpacks the tuple and sets the refresh cookie

    async def refresh(
        self,
        refresh_token: str,
        db: AsyncSession,
    ) -> tuple[LoginResponse, str]:
        """
        Rotate tokens using a valid refresh token.

        Flow:
          1. Verify refresh JWT
          2. Check if token is blacklisted → if yes, trigger nuclear revocation
          3. Issue new access + refresh tokens
          4. Blacklist old refresh token

        Returns: (LoginResponse, new_refresh_token)

        Raises:
          HTTPException(401) on expired, invalid, missing, or blacklisted token
        """
        if not refresh_token:
            raise HTTPException(status_code=401, detail="Refresh token missing")

        try:
            payload = verify_jwt(refresh_token, expected_type="refresh")
        except Exception:
            raise HTTPException(status_code=401, detail="Refresh token expired")

        jti = payload["jti"]
        user_id = int(payload["sub"])

        # Check if this specific refresh token has already been used (stolen token replay)
        if await is_blacklisted(jti):
            # Nuclear revocation: invalidate ALL tokens for this user
            logger.warning(
                "refresh: blacklisted refresh token replayed for user_id=%s — nuclear revoke",
                user_id,
            )
            await nuclear_revoke(user_id)
            raise HTTPException(status_code=401, detail="Token reuse detected")

        # Load fresh user data from DB
        result = await db.execute(
            select(User)
            .where(User.id == user_id, User.is_active.is_(True))
            .options(selectinload(User.branch_roles))
        )
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=401, detail="User not found")

        user_dict = _build_user_dict(user)

        # Issue new tokens BEFORE blacklisting the old one
        new_access = create_access_token(user_dict)
        new_refresh = create_refresh_token(user_dict)

        # Blacklist the old refresh token
        try:
            exp = payload.get("exp", 0)
            remaining_ttl = int(exp - datetime.now(UTC).timestamp())
            await blacklist_token(jti, remaining_ttl)
        except Exception as exc:
            logger.error("refresh: failed to blacklist old refresh token jti=%s: %s", jti, exc)
            # Don't block the refresh — the user would be locked out
            # The old token will eventually expire naturally

        return LoginResponse(
            access_token=new_access,
            token_type="bearer",
            user=_build_user_response(user),
        ), new_refresh

    async def logout(self, jti: str, exp: int) -> dict:
        """
        Blacklist the current access token and clear the refresh cookie.

        `exp` is the epoch timestamp from the JWT claims.
        Returns {"detail": "Logged out"} on success.
        """
        remaining_ttl = int(exp - datetime.now(UTC).timestamp())
        try:
            await blacklist_token(jti, remaining_ttl)
        except Exception as exc:
            logger.error("logout: failed to blacklist jti=%s: %s", jti, exc)
            # Best-effort: if Redis is down, token will expire naturally
        return {"detail": "Logged out"}

    async def get_me(self, user_id: int, db: AsyncSession) -> UserResponse:
        """
        Return the authenticated user's info from the database (not just JWT claims).

        Raises HTTPException(401) if user not found or inactive.
        """
        result = await db.execute(
            select(User)
            .where(User.id == user_id, User.is_active.is_(True))
            .options(selectinload(User.branch_roles))
        )
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return _build_user_response(user)

    # ── 2FA Methods ───────────────────────────────────────────────────────────

    async def setup_2fa(self, user_id: int, db: AsyncSession) -> TwoFactorSetupResponse:
        """
        Generate a TOTP secret and store it on the user (but don't enable 2FA yet).

        The user must call verify_2fa with a valid code to activate 2FA.

        Raises:
          HTTPException(400) if 2FA is already enabled
          HTTPException(401) if user not found
        """
        result = await db.execute(
            select(User).where(User.id == user_id, User.is_active.is_(True))
        )
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=401, detail="User not found")

        if user.is_2fa_enabled:
            raise HTTPException(status_code=400, detail="2FA already enabled")

        secret = pyotp.random_base32()
        user.totp_secret = secret
        await safe_commit(db)

        totp = pyotp.TOTP(secret)
        provisioning_uri = totp.provisioning_uri(
            name=user.email,
            issuer_name="Integrador",
        )

        return TwoFactorSetupResponse(secret=secret, provisioning_uri=provisioning_uri)

    async def verify_2fa(self, user_id: int, totp_code: str, db: AsyncSession) -> dict:
        """
        Verify a TOTP code and activate 2FA if valid.

        Raises:
          HTTPException(400) if no secret is set (setup not done)
          HTTPException(400) if TOTP code is invalid
          HTTPException(401) if user not found
        """
        result = await db.execute(
            select(User).where(User.id == user_id, User.is_active.is_(True))
        )
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=401, detail="User not found")

        if not user.totp_secret:
            raise HTTPException(status_code=400, detail="2FA not set up")

        totp = pyotp.TOTP(user.totp_secret)
        if not totp.verify(totp_code, valid_window=1):
            raise HTTPException(status_code=400, detail="Invalid TOTP code")

        user.is_2fa_enabled = True
        await safe_commit(db)
        return {"detail": "2FA enabled"}

    async def change_password(
        self,
        user_id: int,
        current_password: str,
        new_password: str,
        db: AsyncSession,
    ) -> dict:
        """
        Change a user's password after verifying the current one.

        Security rules:
          - Verify current_password in constant-time (always call verify_password)
          - Validate new_password against SecurityPolicy (8-128 chars, ≥1 digit, ≥1 uppercase)
          - new_password must differ from current_password
          - Rotate password_updated_at to UTC now
          - Emit structured audit log (USER_PASSWORD_CHANGED) with user_id + tenant_id
          - safe_commit(db) — NEVER db.commit() directly
          - Does NOT invalidate existing JWT tokens (by design — see design.md Decision #5)

        Raises:
          HTTPException(400) if current_password is incorrect
          HTTPException(400) if new_password fails policy validation
          HTTPException(400) if new_password equals current_password
          HTTPException(401) if user not found or inactive
        """
        result = await db.execute(
            select(User).where(User.id == user_id, User.is_active.is_(True))
        )
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=401, detail="User not found")

        # Constant-time verification — always call verify_password
        is_valid = verify_password(current_password, user.hashed_password)
        if not is_valid:
            raise HTTPException(status_code=400, detail="Current password is incorrect")

        # Policy validation
        policy_errors = []
        if len(new_password) < _MIN_PASSWORD_LENGTH:
            policy_errors.append(f"Password must be at least {_MIN_PASSWORD_LENGTH} characters")
        if len(new_password) > _MAX_PASSWORD_LENGTH:
            policy_errors.append(f"Password must be at most {_MAX_PASSWORD_LENGTH} characters")
        if not any(c.isdigit() for c in new_password):
            policy_errors.append("Password must contain at least one digit")
        if not any(c.isupper() for c in new_password):
            policy_errors.append("Password must contain at least one uppercase letter")

        if policy_errors:
            raise HTTPException(status_code=400, detail={"rules": policy_errors})

        # Prevent reuse of the same password
        if verify_password(new_password, user.hashed_password):
            raise HTTPException(
                status_code=400,
                detail="New password must differ from the current password",
            )

        user.hashed_password = hash_password(new_password)
        user.password_updated_at = datetime.now(UTC)
        await safe_commit(db)

        logger.info(
            "USER_PASSWORD_CHANGED",
            extra={"user_id": user_id, "tenant_id": user.tenant_id},
        )

        return {"detail": "Password changed successfully"}

    async def disable_2fa(self, user_id: int, totp_code: str, db: AsyncSession) -> dict:
        """
        Disable 2FA after verifying the current TOTP code.

        Requires a valid code to prevent disabling 2FA from a hijacked session
        (attacker would need access to the TOTP device too).

        Raises:
          HTTPException(400) if 2FA is not enabled
          HTTPException(400) if TOTP code is invalid
          HTTPException(401) if user not found
        """
        result = await db.execute(
            select(User).where(User.id == user_id, User.is_active.is_(True))
        )
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=401, detail="User not found")

        if not user.is_2fa_enabled:
            raise HTTPException(status_code=400, detail="2FA not enabled")

        totp = pyotp.TOTP(user.totp_secret)
        if not totp.verify(totp_code, valid_window=1):
            raise HTTPException(status_code=400, detail="Invalid TOTP code")

        user.is_2fa_enabled = False
        user.totp_secret = None
        await safe_commit(db)
        return {"detail": "2FA disabled"}
