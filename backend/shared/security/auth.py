"""
JWT authentication utilities for the Integrador backend.

Functions:
  create_access_token(user)  — builds a 15-min access JWT
  create_refresh_token(user) — builds a 7-day refresh JWT
  verify_jwt(token, expected_type) — decode, validate, return payload
  blacklist_token(jti, ttl)  — store jti in Redis blacklist
  is_blacklisted(jti)        — check Redis blacklist (fail-closed)
  nuclear_revoke(user_id)    — invalidate ALL tokens for a user

Security rules:
  - NEVER return 200 when blacklist check fails — fail-closed means 401
  - ALWAYS check is_blacklisted after signature verification
  - nuclear_revoke stores a timestamp; tokens issued before it are invalid
"""
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
import redis.asyncio as aioredis

from shared.config.logging import get_logger
from shared.config.settings import settings

logger = get_logger(__name__)

_ISSUER = "integrador"
_AUDIENCE = "integrador-api"


def _get_redis() -> aioredis.Redis:
    """Return a Redis client. Created lazily per-call (connection pool is shared)."""
    return aioredis.from_url(settings.REDIS_URL, decode_responses=True)


def _build_payload(user: dict[str, Any], token_type: str, ttl_seconds: int) -> dict[str, Any]:
    """Build a JWT payload dict from a user context dict."""
    now = datetime.now(UTC)
    return {
        "sub": str(user["id"]),
        "tenant_id": user["tenant_id"],
        "branch_ids": user.get("branch_ids", []),
        "roles": user.get("roles", []),
        "email": user["email"],
        "jti": str(uuid.uuid4()),
        "type": token_type,
        "iss": _ISSUER,
        "aud": _AUDIENCE,
        "iat": now,
        "exp": now + timedelta(seconds=ttl_seconds),
    }


def create_access_token(user: dict[str, Any]) -> str:
    """
    Create a JWT access token for the given user dict.

    Expected user dict keys: id, tenant_id, branch_ids, roles, email
    Returns a signed HS256 JWT string. Expires after ACCESS_TOKEN_TTL seconds (15 min).
    """
    payload = _build_payload(user, token_type="access", ttl_seconds=settings.ACCESS_TOKEN_TTL)
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(user: dict[str, Any]) -> str:
    """
    Create a JWT refresh token for the given user dict.

    Returns a signed HS256 JWT string. Expires after REFRESH_TOKEN_TTL seconds (7 days).
    """
    payload = _build_payload(user, token_type="refresh", ttl_seconds=settings.REFRESH_TOKEN_TTL)
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def verify_jwt(token: str, expected_type: str) -> dict[str, Any]:
    """
    Decode and validate a JWT token.

    Validates:
      - HS256 signature with JWT_SECRET
      - expiration (exp claim)
      - issuer and audience
      - `type` claim matches `expected_type`
      - all required claims present

    Raises:
      jwt.ExpiredSignatureError  — token has expired
      jwt.InvalidTokenError       — signature, claims, or type mismatch

    Returns the decoded payload dict on success.
    """
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
            issuer=_ISSUER,
            audience=_AUDIENCE,
        )
    except jwt.ExpiredSignatureError:
        raise
    except jwt.InvalidTokenError:
        raise

    # Validate required claims
    required_claims = {"sub", "tenant_id", "branch_ids", "roles", "email", "jti", "type"}
    missing = required_claims - payload.keys()
    if missing:
        raise jwt.InvalidTokenError(f"Token missing required claims: {missing}")

    # Validate token type
    if payload.get("type") != expected_type:
        raise jwt.InvalidTokenError(
            f"Token type mismatch: expected={expected_type!r}, got={payload.get('type')!r}"
        )

    return payload


async def blacklist_token(jti: str, ttl: int) -> None:
    """
    Add a token's jti to the Redis blacklist.

    Key format: blacklist:{jti}
    TTL should equal the token's remaining lifetime in seconds.
    If TTL <= 0, the token is already expired — skip storing.
    """
    if ttl <= 0:
        return
    try:
        client = _get_redis()
        await client.setex(f"blacklist:{jti}", ttl, "1")
        await client.aclose()
    except Exception as exc:
        logger.error("blacklist_token: Redis error for jti=%s: %s", jti, exc)
        raise


async def is_blacklisted(jti: str) -> bool:
    """
    Check if a token's jti is in the Redis blacklist.

    Fail-closed: if Redis is unreachable, returns True (reject the token).
    This is the security default — availability yields to security.
    """
    try:
        client = _get_redis()
        result = await client.exists(f"blacklist:{jti}")
        await client.aclose()
        return bool(result)
    except Exception as exc:
        logger.error(
            "is_blacklisted: Redis unavailable, failing closed for jti=%s: %s", jti, exc
        )
        return True


async def nuclear_revoke(user_id: int) -> None:
    """
    Revoke ALL tokens for a user by storing a timestamp in Redis.

    Any token with iat before this timestamp will be rejected.
    Key format: nuclear:{user_id}
    TTL: REFRESH_TOKEN_TTL (7 days) — covers the longest possible token lifetime.

    Called when token reuse is detected (stolen refresh token replay).
    """
    try:
        now = datetime.now(UTC)
        client = _get_redis()
        await client.setex(
            f"nuclear:{user_id}",
            settings.REFRESH_TOKEN_TTL,
            now.isoformat(),
        )
        await client.aclose()
        logger.warning("nuclear_revoke: all tokens revoked for user_id=%s at %s", user_id, now)
    except Exception as exc:
        logger.error("nuclear_revoke: Redis error for user_id=%s: %s", user_id, exc)
        raise


async def get_nuclear_revocation_time(user_id: int) -> datetime | None:
    """
    Return the nuclear revocation timestamp for a user, or None if not set.

    Fail-closed: if Redis is unavailable, returns datetime.now(UTC) — which will
    invalidate all tokens (since all iat values will be before "now").
    """
    try:
        client = _get_redis()
        value = await client.get(f"nuclear:{user_id}")
        await client.aclose()
        if value is None:
            return None
        return datetime.fromisoformat(value)
    except Exception as exc:
        logger.error(
            "get_nuclear_revocation_time: Redis unavailable, failing closed for user_id=%s: %s",
            user_id,
            exc,
        )
        # Fail-closed: treat as if nuclear revocation is at "now" → all tokens invalid
        return datetime.now(UTC)
