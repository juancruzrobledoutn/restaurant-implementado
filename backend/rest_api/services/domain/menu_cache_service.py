"""
MenuCacheService — Redis cache for the public menu endpoint.

Cache strategy:
  - Key: menu:{branch_slug}
  - Value: JSON string of the full nested menu response
  - TTL: 5 minutes (300 seconds)
  - Invalidation: any CRUD on category/subcategory/product/branch_product
    calls invalidate(branch_slug) to delete the key

Failure policy (fail-open for caching):
  - get_menu: Redis failure → log warning, return None (cache miss, DB fallback)
  - set_menu: Redis failure → log warning, skip caching (DB will be hit next time)
  - invalidate: Redis failure → log warning, skip (TTL will expire the stale key)

This is INTENTIONALLY different from auth (fail-closed). A stale menu is
acceptable for up to 5 minutes; a caching failure must never break writes.
"""
import json

import redis.asyncio as aioredis

from shared.config.logging import get_logger
from shared.config.settings import settings

logger = get_logger(__name__)

_MENU_CACHE_TTL = 300  # 5 minutes in seconds
_KEY_PREFIX = "menu"


def _make_key(branch_slug: str) -> str:
    return f"{_KEY_PREFIX}:{branch_slug}"


def _get_redis() -> aioredis.Redis:
    """Return a new Redis client. Caller is responsible for closing it."""
    return aioredis.from_url(settings.REDIS_URL, decode_responses=True)


class MenuCacheService:
    """
    Redis-backed cache service for public menu responses.

    Caches full nested menu JSON keyed by branch slug.
    All methods are async and silently handle Redis failures.
    """

    async def get_menu(self, branch_slug: str) -> dict | None:
        """
        Retrieve the cached menu for a branch.

        Returns:
            Parsed dict if cache hit, None on miss or Redis failure.
        """
        key = _make_key(branch_slug)
        try:
            client = _get_redis()
            try:
                raw = await client.get(key)
                if raw is None:
                    return None
                return json.loads(raw)
            finally:
                await client.aclose()
        except Exception as exc:
            logger.warning(
                "menu_cache.get_menu: Redis unavailable for slug=%r — cache miss: %s",
                branch_slug,
                exc,
            )
            return None

    async def set_menu(self, branch_slug: str, data: dict) -> None:
        """
        Store the menu for a branch in Redis with 5-minute TTL.

        Silently skips if Redis is unavailable.
        """
        key = _make_key(branch_slug)
        try:
            client = _get_redis()
            try:
                serialized = json.dumps(data, default=str)
                await client.set(key, serialized, ex=_MENU_CACHE_TTL)
            finally:
                await client.aclose()
        except Exception as exc:
            logger.warning(
                "menu_cache.set_menu: Redis unavailable for slug=%r — skipping cache: %s",
                branch_slug,
                exc,
            )

    async def invalidate(self, branch_slug: str) -> None:
        """
        Delete the cached menu for a branch.

        Called automatically after any CRUD operation that affects the menu.
        Silently skips if Redis is unavailable — TTL will handle eventual expiry.
        """
        key = _make_key(branch_slug)
        try:
            client = _get_redis()
            try:
                await client.delete(key)
                logger.debug("menu_cache.invalidate: deleted key=%r", key)
            finally:
                await client.aclose()
        except Exception as exc:
            logger.warning(
                "menu_cache.invalidate: Redis unavailable for slug=%r — skipping: %s",
                branch_slug,
                exc,
            )
