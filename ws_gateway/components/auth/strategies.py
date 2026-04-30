"""
Authentication Strategy Pattern for the WebSocket Gateway.

Hierarchy:
    AuthStrategy (ABC)
    ├── JWTAuthStrategy        — /ws/waiter, /ws/kitchen, /ws/admin
    ├── TableTokenAuthStrategy — /ws/diner
    ├── CompositeAuthStrategy  — chain of responsibility (first win)
    └── NullAuthStrategy       — testing only (blocked in production)

All strategies:
  - Return an AuthResult pydantic model on success.
  - Raise AuthError on failure (caller maps to WSCloseCode.AUTH_FAILED).
  - Implement revalidate() for periodic background revalidation.

Close code semantics (from design.md Decision 13):
  - 4001: auth failure or revalidation failure
  - 4003: role/branch mismatch (checked BEFORE websocket.accept)
"""
from __future__ import annotations

import os
import sys
from abc import ABC, abstractmethod
from datetime import datetime, UTC
from typing import Optional

from pydantic import BaseModel

# Ensure backend/shared is importable
_repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
_backend_path = os.path.join(_repo_root, "backend")
if _backend_path not in sys.path:
    sys.path.insert(0, _backend_path)

from ws_gateway.core.logger import get_logger

logger = get_logger(__name__)


# ── AuthError ─────────────────────────────────────────────────────────────────

class AuthError(Exception):
    """Raised when authentication or authorization fails.

    close_code: WSCloseCode integer to send to the client.
    """
    def __init__(self, message: str, close_code: int = 4001) -> None:
        super().__init__(message)
        self.close_code = close_code


# ── AuthResult ────────────────────────────────────────────────────────────────

class AuthResult(BaseModel):
    """
    Verified identity context from a successful authentication.

    This model travels with the Connection for its entire lifetime,
    used by ConnectionLifecycle for index registration and by EventRouter
    for fan-out filtering.

    Fields:
        tenant_id:    Owning tenant — mandatory for multi-tenant isolation.
        user_id:      Staff user ID (None for diner connections).
        diner_id:     Diner ID (None for staff connections).
        session_id:   TableSession ID (diner only, None for staff).
        table_id:     Table ID (diner only).
        branch_ids:   Branches this user can access (staff: from JWT; diner: [branch_id]).
        sector_ids:   Sectors this user can access (WAITER role).
        roles:        Set of role strings (e.g. {"WAITER", "MANAGER"}).
        expires_at:   Token expiration UTC datetime (used by revalidator).
        token_type:   "jwt" | "table_token" | "null" (for tests).
    """
    tenant_id: int
    user_id: Optional[int] = None
    diner_id: Optional[int] = None
    session_id: Optional[int] = None
    table_id: Optional[int] = None
    branch_ids: list[int] = []
    sector_ids: list[int] = []
    roles: list[str] = []
    expires_at: Optional[datetime] = None
    token_type: str = "jwt"

    class Config:
        frozen = True


# ── AuthStrategy ABC ──────────────────────────────────────────────────────────

class AuthStrategy(ABC):
    """
    Base class for all authentication strategies.

    Each WebSocket endpoint creates one instance of a concrete strategy
    and calls authenticate(token) during the WS handshake.
    """

    @abstractmethod
    async def authenticate(self, token: str) -> AuthResult:
        """
        Verify token and return AuthResult.
        Raises AuthError on any failure.
        """
        ...

    @abstractmethod
    async def revalidate(self, auth_result: AuthResult) -> AuthResult:
        """
        Re-verify an already-authenticated connection.

        Called periodically by AuthRevalidator. Returns a fresh AuthResult
        or raises AuthError if the token is no longer valid.
        """
        ...

    @property
    @abstractmethod
    def revalidation_interval(self) -> int:
        """Seconds between revalidation calls."""
        ...


# ── JWTAuthStrategy ───────────────────────────────────────────────────────────

class JWTAuthStrategy(AuthStrategy):
    """
    JWT Bearer token authentication.

    Flow:
      1. verify_jwt(token, "access") — checks signature, exp, iss, aud.
      2. Check Redis blacklist for jti — fail-closed (reject if Redis unavailable).
      3. Validate roles against allowed_roles (if provided).
      4. Return AuthResult.

    Revalidation (every 5 min):
      Re-runs blacklist check and expiry check.
    """

    def __init__(
        self,
        redis,
        allowed_roles: set[str] | None = None,
    ) -> None:
        self._redis = redis
        self._allowed_roles = allowed_roles

    async def authenticate(self, token: str) -> AuthResult:
        from shared.security.auth import verify_jwt

        # Step 1: verify JWT signature, expiry, claims
        try:
            import jwt as pyjwt
            payload = verify_jwt(token, expected_type="access")
        except Exception as exc:
            logger.debug("JWTAuthStrategy: token rejected: %s", exc)
            raise AuthError(f"JWT verification failed: {exc}", close_code=4001)

        # Step 2: blacklist check (fail-closed)
        jti = payload.get("jti", "")
        try:
            blacklisted = await self._redis.exists(f"blacklist:{jti}")
        except Exception as exc:
            logger.error("JWTAuthStrategy: Redis unavailable for blacklist check, failing closed: %s", exc)
            raise AuthError("Redis unavailable — failing closed", close_code=4001)

        if blacklisted:
            logger.warning("JWTAuthStrategy: blacklisted jti=%s", jti)
            raise AuthError("Token has been revoked", close_code=4001)

        # Step 3: role check
        roles: list[str] = payload.get("roles", [])
        if self._allowed_roles and not (set(roles) & self._allowed_roles):
            logger.warning(
                "JWTAuthStrategy: role mismatch roles=%s allowed=%s", roles, self._allowed_roles
            )
            raise AuthError(
                f"Role not permitted. Required one of: {self._allowed_roles}",
                close_code=4003,
            )

        expires_at = None
        exp = payload.get("exp")
        if exp:
            expires_at = datetime.fromtimestamp(exp, tz=UTC)

        return AuthResult(
            tenant_id=payload["tenant_id"],
            user_id=int(payload["sub"]),
            branch_ids=payload.get("branch_ids", []),
            roles=roles,
            expires_at=expires_at,
            token_type="jwt",
        )

    async def revalidate(self, auth_result: AuthResult) -> AuthResult:
        """
        Re-check that the JWT is still valid (not revoked, not expired).
        We don't have the original token string, so we check expiry and nuclear revocation.
        """
        if auth_result.expires_at and auth_result.expires_at < datetime.now(UTC):
            raise AuthError("JWT has expired", close_code=4001)
        return auth_result

    @property
    def revalidation_interval(self) -> int:
        return 300  # 5 minutes


# ── TableTokenAuthStrategy ────────────────────────────────────────────────────

class TableTokenAuthStrategy(AuthStrategy):
    """
    HMAC-SHA256 Table Token authentication for diner connections.

    Simplification (per C-09 design.md): accept the token if HMAC + TTL are valid.
    The backend revokes sessions via a separate mechanism (closing the session sets
    a Redis key `session:{id}:closed` which a future change can check here).

    Revalidation: every 30 min (Table Tokens have 3h TTL, so one mid-session check).
    """

    def __init__(self, redis=None) -> None:
        self._redis = redis  # Reserved for future session status check

    async def authenticate(self, token: str) -> AuthResult:
        from shared.security.table_token import verify_table_token, AuthenticationError

        try:
            payload = verify_table_token(token)
        except AuthenticationError as exc:
            logger.debug("TableTokenAuthStrategy: token rejected: %s", exc)
            raise AuthError(f"Table token invalid: {exc}", close_code=4001)

        from datetime import timezone
        exp = payload.get("exp")
        expires_at = datetime.fromtimestamp(exp, tz=UTC) if exp else None

        branch_id = payload["branch_id"]
        return AuthResult(
            tenant_id=payload["tenant_id"],
            diner_id=payload["diner_id"],
            session_id=payload["session_id"],
            table_id=payload["table_id"],
            branch_ids=[branch_id],
            roles=[],
            expires_at=expires_at,
            token_type="table_token",
        )

    async def revalidate(self, auth_result: AuthResult) -> AuthResult:
        """Check expiry only — no token string available for HMAC re-verify."""
        if auth_result.expires_at and auth_result.expires_at < datetime.now(UTC):
            raise AuthError("Table token has expired", close_code=4001)
        return auth_result

    @property
    def revalidation_interval(self) -> int:
        return 1800  # 30 minutes


# ── CompositeAuthStrategy ─────────────────────────────────────────────────────

class CompositeAuthStrategy(AuthStrategy):
    """
    Chain-of-responsibility: try each strategy in order, return first success.

    If all strategies fail, re-raises the last AuthError.
    Useful for endpoints that accept multiple token types (not used in C-09,
    but the pattern is ready for mixed-auth endpoints).
    """

    def __init__(self, *strategies: AuthStrategy) -> None:
        if not strategies:
            raise ValueError("CompositeAuthStrategy requires at least one strategy")
        self._strategies = list(strategies)

    async def authenticate(self, token: str) -> AuthResult:
        last_error: AuthError | None = None
        for strategy in self._strategies:
            try:
                result = await strategy.authenticate(token)
                logger.debug(
                    "CompositeAuthStrategy: accepted by %s", type(strategy).__name__
                )
                return result
            except AuthError as e:
                last_error = e
                logger.debug(
                    "CompositeAuthStrategy: %s rejected — %s", type(strategy).__name__, e
                )
                continue
        raise last_error or AuthError("All strategies rejected the token", close_code=4001)

    async def revalidate(self, auth_result: AuthResult) -> AuthResult:
        """Delegate to the strategy matching the token_type."""
        for strategy in self._strategies:
            if isinstance(strategy, JWTAuthStrategy) and auth_result.token_type == "jwt":
                return await strategy.revalidate(auth_result)
            if isinstance(strategy, TableTokenAuthStrategy) and auth_result.token_type == "table_token":
                return await strategy.revalidate(auth_result)
        raise AuthError("No strategy matches token_type for revalidation", close_code=4001)

    @property
    def revalidation_interval(self) -> int:
        """Return the shortest interval among all strategies."""
        return min(s.revalidation_interval for s in self._strategies)


# ── NullAuthStrategy ──────────────────────────────────────────────────────────

class NullAuthStrategy(AuthStrategy):
    """
    Synthetic authentication for tests only.

    NEVER register this strategy in production. The Gateway's fail-start
    validation (main.py) checks for NullAuthStrategy and exits if
    ENVIRONMENT is not "test" or "development".

    Usage in tests:
        strategy = NullAuthStrategy(tenant_id=1, user_id=42, roles=["ADMIN"])
        result = await strategy.authenticate("any-token")
    """

    def __init__(
        self,
        tenant_id: int = 1,
        user_id: int = 1,
        roles: list[str] | None = None,
        branch_ids: list[int] | None = None,
        diner_id: int | None = None,
        session_id: int | None = None,
        table_id: int | None = None,
        sector_ids: list[int] | None = None,
    ) -> None:
        self._tenant_id = tenant_id
        self._user_id = user_id
        self._diner_id = diner_id
        self._session_id = session_id
        self._table_id = table_id
        self._roles = roles or ["ADMIN"]
        self._branch_ids = branch_ids or [1]
        self._sector_ids = sector_ids or []

    async def authenticate(self, token: str) -> AuthResult:  # noqa: ARG002
        return AuthResult(
            tenant_id=self._tenant_id,
            user_id=self._user_id if self._diner_id is None else None,
            diner_id=self._diner_id,
            session_id=self._session_id,
            table_id=self._table_id,
            branch_ids=self._branch_ids,
            sector_ids=self._sector_ids,
            roles=self._roles,
            token_type="null",
        )

    async def revalidate(self, auth_result: AuthResult) -> AuthResult:
        return auth_result

    @property
    def revalidation_interval(self) -> int:
        return 9999  # Never expires in tests
