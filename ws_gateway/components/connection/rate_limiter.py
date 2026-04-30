"""
Rate Limiter — sliding window per connection using Redis + atomic Lua script.

Key design:
  - Key: ws:ratelimit:{user_or_diner_id}:{device_id}
  - Lua script does INCR + conditional EXPIRE atomically
  - Counter persists across reconnects (same user_id + device_id = same key)
  - Exceeding limit → close code 4029

Abusive flag:
  - mark_abusive(user_id, ttl=60) → SETEX ws:abusive:{user_id} 60 "1"
  - is_abusive(user_id) → EXISTS check (fail-open: if Redis error, allow connection)
  - New connections rejected with 4029 if user is flagged abusive
"""
from __future__ import annotations

from ws_gateway.core.constants import (
    ABUSIVE_KEY,
    ABUSIVE_TTL,
    RATE_LIMIT_KEY,
    RATE_LIMIT_MSGS,
    RATE_LIMIT_WINDOW,
)
from ws_gateway.core.logger import get_logger

logger = get_logger(__name__)

# Lua script: atomic INCR + EXPIRE (only on first increment to preserve window)
# Returns the count after increment.
_LUA_RATE_LIMIT = """
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local count = redis.call('INCR', key)
if count == 1 then
    redis.call('EXPIRE', key, window)
end
return count
"""


class RateLimiter:
    """
    Redis-backed sliding window rate limiter for WebSocket messages.

    Args:
        redis: An async Redis client (from dependencies.get_redis_pool()).
        limit: Max messages per window (default: RATE_LIMIT_MSGS=30).
        window: Window duration in seconds (default: RATE_LIMIT_WINDOW=1).
    """

    def __init__(
        self,
        redis,
        limit: int = RATE_LIMIT_MSGS,
        window: int = RATE_LIMIT_WINDOW,
    ) -> None:
        self._redis = redis
        self._limit = limit
        self._window = window

    async def check_and_increment(self, user_id: int | str, device_id: str) -> bool:
        """
        Increment the message counter for this (user_id, device_id) pair.

        Returns:
          True  → under limit (message allowed)
          False → over limit (caller should close with 4029)
        """
        key = RATE_LIMIT_KEY.format(user_id, device_id)
        try:
            count = await self._redis.eval(_LUA_RATE_LIMIT, 1, key, self._limit, self._window)
            allowed = int(count) <= self._limit
            if not allowed:
                logger.warning(
                    "RateLimiter: limit exceeded user_id=%s device_id=%s count=%s",
                    user_id, device_id, count,
                )
            return allowed
        except Exception as exc:
            logger.error("RateLimiter: Redis error for key %s: %s", key, exc)
            # Fail-open for rate limiting: allow the message if Redis is unavailable
            return True

    async def mark_abusive(self, user_id: int | str, ttl: int = ABUSIVE_TTL) -> None:
        """Flag a user as abusive for `ttl` seconds. New connections are rejected."""
        key = ABUSIVE_KEY.format(user_id)
        try:
            await self._redis.setex(key, ttl, "1")
            logger.warning("RateLimiter: marked user_id=%s as abusive for %ds", user_id, ttl)
        except Exception as exc:
            logger.error("RateLimiter: could not mark abusive for user_id=%s: %s", user_id, exc)

    async def is_abusive(self, user_id: int | str) -> bool:
        """Check if a user is currently flagged as abusive. Fail-open on Redis error."""
        key = ABUSIVE_KEY.format(user_id)
        try:
            return bool(await self._redis.exists(key))
        except Exception as exc:
            logger.error("RateLimiter: is_abusive check failed for user_id=%s: %s", user_id, exc)
            return False  # Fail-open: let the connection through if Redis unavailable
