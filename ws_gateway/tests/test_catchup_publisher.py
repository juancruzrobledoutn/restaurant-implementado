"""
Tests for CatchupPublisher (ws_gateway/components/events/catchup_publisher.py).

Uses fakeredis for Redis operations.

Covered scenarios:
  - ZADD + ZREMRANGEBYRANK keeps max 100 events
  - EXPIRE 300s set on the key
  - Dual write to branch + session keys when session_id present
"""
from __future__ import annotations

import json

import fakeredis.aioredis
import pytest
import pytest_asyncio

from ws_gateway.components.events.catchup_publisher import CatchupPublisher


@pytest_asyncio.fixture
async def redis():
    client = fakeredis.aioredis.FakeRedis(decode_responses=True)
    yield client
    await client.aclose()


@pytest_asyncio.fixture
async def publisher(redis):
    return CatchupPublisher(redis=redis)


def make_event(branch_id=1, session_id=None, timestamp_ms=1000):
    e = {
        "event_type": "TEST_EVENT",
        "tenant_id": 1,
        "branch_id": branch_id,
        "payload": {},
        "timestamp_ms": timestamp_ms,
    }
    if session_id is not None:
        e["session_id"] = session_id
    return e


# ── Basic write ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_event_written_to_branch_key(publisher, redis):
    event = make_event(branch_id=5, timestamp_ms=12345)
    await publisher.publish_for_catchup(event)

    items = await redis.zrange("catchup:branch:5", 0, -1, withscores=True)
    assert len(items) == 1


@pytest.mark.asyncio
async def test_branch_key_has_expire(publisher, redis):
    event = make_event(branch_id=7)
    await publisher.publish_for_catchup(event)

    ttl = await redis.ttl("catchup:branch:7")
    assert 0 < ttl <= 300


# ── Max 100 events ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_zadd_zremrangebyrank_keeps_max_100(publisher, redis):
    """Writing 101 events should result in exactly 100 in the sorted set."""
    for i in range(101):
        event = make_event(branch_id=10, timestamp_ms=i)
        await publisher.publish_for_catchup(event)

    count = await redis.zcard("catchup:branch:10")
    assert count == 100


# ── Dual write ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_dual_write_to_branch_and_session(publisher, redis):
    event = make_event(branch_id=3, session_id=42, timestamp_ms=9999)
    await publisher.publish_for_catchup(event)

    branch_count = await redis.zcard("catchup:branch:3")
    session_count = await redis.zcard("catchup:session:42")

    assert branch_count == 1
    assert session_count == 1


@pytest.mark.asyncio
async def test_no_session_write_without_session_id(publisher, redis):
    event = make_event(branch_id=6)  # No session_id
    await publisher.publish_for_catchup(event)

    # No session keys should exist
    keys = await redis.keys("catchup:session:*")
    assert len(keys) == 0


# ── Session expire ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_session_key_has_expire(publisher, redis):
    event = make_event(branch_id=1, session_id=99)
    await publisher.publish_for_catchup(event)

    ttl = await redis.ttl("catchup:session:99")
    assert 0 < ttl <= 300
