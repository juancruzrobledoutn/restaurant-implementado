"""
Redis event publishing utilities.

These are stubs — full implementation is done in the WebSocket change.
Redis Streams are used for domain events; direct PUBLISH for real-time notifications.
"""
from typing import Any

import redis.asyncio as aioredis

from shared.config.logging import get_logger
from shared.config.settings import settings

logger = get_logger(__name__)

_redis_pool: aioredis.Redis | None = None


async def get_redis_pool() -> aioredis.Redis:
    """Return the shared Redis connection pool (lazy init)."""
    global _redis_pool
    if _redis_pool is None:
        _redis_pool = aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
        )
    return _redis_pool


async def publish_event(channel: str, payload: dict[str, Any]) -> None:
    """
    Publish a domain event to a Redis channel.

    Stub — full implementation with Streams and outbox pattern in C-ws_gateway.
    """
    import json

    redis = await get_redis_pool()
    message = json.dumps(payload)
    await redis.publish(channel, message)
    logger.debug("Published event to %s: %s", channel, message)
