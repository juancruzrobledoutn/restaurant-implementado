"""
Email-based rate limiting service using Redis Lua atomic scripts.

Architecture note: this is a thin service layer that wraps the Lua script.
It is called by AuthService before processing login credentials.

Fail policy:
  - Redis unavailable → HTTP 503 (fail-closed: security over availability)
  - Limit exceeded    → HTTP 429 with descriptive detail
"""
import os
from pathlib import Path

import redis.asyncio as aioredis
from fastapi import HTTPException

from shared.config.logging import get_logger
from shared.config.settings import settings

logger = get_logger(__name__)

# Load Lua script once at module import time
_LUA_SCRIPT_PATH = Path(__file__).parent.parent.parent / "shared" / "security" / "rate_limit.lua"
_LUA_SCRIPT: str = _LUA_SCRIPT_PATH.read_text(encoding="utf-8")


def _get_redis() -> aioredis.Redis:
    return aioredis.from_url(settings.REDIS_URL, decode_responses=True)


async def check_email_rate_limit(email: str) -> None:
    """
    Enforce per-email rate limiting using an atomic Redis Lua script.

    Raises:
      HTTPException(429) if the email has exceeded LOGIN_RATE_LIMIT attempts
                          within LOGIN_RATE_WINDOW seconds.
      HTTPException(503) if Redis is unreachable (fail-closed policy).

    Does NOT raise if under the limit — caller continues normally.
    """
    key = f"rl:email:{email.lower()}"

    try:
        client = _get_redis()
        current = await client.eval(
            _LUA_SCRIPT,
            1,              # number of keys
            key,            # KEYS[1]
            settings.LOGIN_RATE_WINDOW,   # ARGV[1]
            settings.LOGIN_RATE_LIMIT,    # ARGV[2] (informational — Lua doesn't enforce this)
        )
        await client.aclose()
    except Exception as exc:
        logger.error("check_email_rate_limit: Redis unavailable for email=%r: %s", email, exc)
        raise HTTPException(
            status_code=503,
            detail="Service temporarily unavailable",
        ) from exc

    if int(current) > settings.LOGIN_RATE_LIMIT:
        logger.warning(
            "check_email_rate_limit: rate limit exceeded for email=%r (count=%s)",
            email,
            current,
        )
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts for this account",
        )
