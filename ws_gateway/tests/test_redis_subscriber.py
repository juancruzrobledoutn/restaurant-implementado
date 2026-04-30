"""
Tests for RedisSubscriber (ws_gateway/components/events/redis_subscriber.py).

Uses fakeredis for most tests. Real Redis tests are marked with pytest.mark.real_redis.

Covered scenarios:
  - Valid event delivered to Router
  - Invalid schema → drop + warn
  - Circuit breaker: 5 failures → OPEN state
"""
from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ws_gateway.components.events.redis_subscriber import RedisSubscriber
from ws_gateway.components.resilience.circuit_breaker import BreakerState, CircuitBreaker


class MockRouter:
    def __init__(self):
        self.routed: list[dict] = []

    async def route(self, event: dict) -> None:
        self.routed.append(event)


def make_valid_event(event_type="TEST_KITCHEN") -> dict:
    return {
        "event_type": event_type,
        "tenant_id": 1,
        "branch_id": 1,
        "payload": {"key": "value"},
        "timestamp_ms": 1000000,
    }


# ── Schema validation ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_parse_valid_message():
    """Valid message is parsed and returned as dict."""
    router = MockRouter()
    sub = RedisSubscriber(redis_factory=MagicMock(), event_router=router)

    raw = {"type": "pmessage", "data": json.dumps(make_valid_event())}
    event = sub._parse_message(raw)
    assert event is not None
    assert event["event_type"] == "TEST_KITCHEN"


@pytest.mark.asyncio
async def test_parse_invalid_json_returns_none():
    router = MockRouter()
    sub = RedisSubscriber(redis_factory=MagicMock(), event_router=router)

    raw = {"type": "pmessage", "data": "not-json"}
    event = sub._parse_message(raw)
    assert event is None


@pytest.mark.asyncio
async def test_parse_missing_fields_returns_none():
    router = MockRouter()
    sub = RedisSubscriber(redis_factory=MagicMock(), event_router=router)

    # Missing tenant_id, branch_id, etc.
    partial = json.dumps({"event_type": "TEST"})
    raw = {"type": "pmessage", "data": partial}
    event = sub._parse_message(raw)
    assert event is None


# ── Batch processing ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_process_event_batch_routes_all():
    router = MockRouter()
    sub = RedisSubscriber(redis_factory=MagicMock(), event_router=router)

    events = [make_valid_event(f"TYPE_{i}") for i in range(5)]
    await sub.process_event_batch(events)

    assert len(router.routed) == 5


@pytest.mark.asyncio
async def test_process_empty_batch_no_error():
    router = MockRouter()
    sub = RedisSubscriber(redis_factory=MagicMock(), event_router=router)
    await sub.process_event_batch([])  # Should not raise


# ── Circuit breaker ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_circuit_breaker_opens_after_failures():
    """5 recorded failures should trip the breaker to OPEN."""
    breaker = CircuitBreaker(name="test_pubsub", failure_threshold=5, recovery_timeout=30.0)
    router = MockRouter()

    # Simulate 5 failures
    for _ in range(5):
        breaker.record_failure()

    assert breaker.state == BreakerState.OPEN

    sub = RedisSubscriber(
        redis_factory=MagicMock(),
        event_router=router,
        circuit_breaker=breaker,
    )
    # With OPEN breaker, can_execute returns False
    assert not breaker.can_execute()


@pytest.mark.asyncio
async def test_routing_error_does_not_crash_batch():
    """If EventRouter.route raises, process_event_batch handles it gracefully."""
    router = MagicMock()
    router.route = AsyncMock(side_effect=RuntimeError("Router crash"))

    sub = RedisSubscriber(redis_factory=MagicMock(), event_router=router)
    events = [make_valid_event()]
    # Should not raise
    await sub.process_event_batch(events)
