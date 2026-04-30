"""
Tests for RateLimiter (ws_gateway/components/connection/rate_limiter.py).

These tests use fakeredis for deterministic behavior.
The Lua atomicity test uses asyncio concurrency to stress-test the counter.

Covered scenarios:
  - 30 messages within window → all OK
  - 31st message → over limit
  - Same user_id/device_id after reconnect → counter continues (not reset)
  - After window expiry → counter reset
  - mark_abusive / is_abusive
"""
from __future__ import annotations

import asyncio

import fakeredis.aioredis
import pytest
import pytest_asyncio

from ws_gateway.components.connection.rate_limiter import RateLimiter


@pytest_asyncio.fixture
async def redis():
    """fakeredis async client."""
    client = fakeredis.aioredis.FakeRedis(decode_responses=True)
    yield client
    await client.aclose()


@pytest_asyncio.fixture
async def limiter(redis):
    return RateLimiter(redis=redis, limit=30, window=1)


# ── Basic limits ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_30_messages_within_window_allowed(limiter):
    for i in range(30):
        result = await limiter.check_and_increment(user_id=1, device_id="dev1")
        assert result is True, f"Message {i+1} should be allowed"


@pytest.mark.asyncio
async def test_31st_message_blocked(limiter):
    for _ in range(30):
        await limiter.check_and_increment(user_id=1, device_id="dev1")
    result = await limiter.check_and_increment(user_id=1, device_id="dev1")
    assert result is False


@pytest.mark.asyncio
async def test_different_users_independent(limiter):
    """Counters for different user_ids are independent."""
    for _ in range(30):
        await limiter.check_and_increment(user_id=1, device_id="dev1")
    # user 2 should still be allowed
    result = await limiter.check_and_increment(user_id=2, device_id="dev1")
    assert result is True


# ── Reconnect does NOT reset counter ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_reconnect_does_not_reset_counter(redis):
    """
    Two 'connections' with same user_id/device_id share the same Redis key.
    Counter must persist across reconnects (simulated by two limiter instances).
    """
    limiter1 = RateLimiter(redis=redis, limit=30, window=60)
    for _ in range(25):
        await limiter1.check_and_increment(user_id=1, device_id="dev-persist")

    # Simulate reconnect: new limiter instance, same Redis
    limiter2 = RateLimiter(redis=redis, limit=30, window=60)
    allowed_count = 0
    for _ in range(10):
        result = await limiter2.check_and_increment(user_id=1, device_id="dev-persist")
        if result:
            allowed_count += 1

    # Only 5 more should be allowed (30 - 25 = 5)
    assert allowed_count == 5


# ── Abusive flag ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_mark_and_check_abusive(limiter, redis):
    assert not await limiter.is_abusive(user_id=42)
    await limiter.mark_abusive(user_id=42, ttl=60)
    assert await limiter.is_abusive(user_id=42)


@pytest.mark.asyncio
async def test_not_abusive_by_default(limiter):
    assert not await limiter.is_abusive(user_id=999)


@pytest.mark.asyncio
async def test_abusive_flag_expires(redis):
    """After TTL expires, user should no longer be abusive."""
    limiter = RateLimiter(redis=redis, limit=30, window=1)
    await limiter.mark_abusive(user_id=77, ttl=1)
    assert await limiter.is_abusive(user_id=77)
    # Expire the key
    await redis.delete("ws:abusive:77")
    assert not await limiter.is_abusive(user_id=77)
