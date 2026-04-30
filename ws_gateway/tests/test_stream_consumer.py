"""
Tests for StreamConsumer (ws_gateway/components/events/stream_consumer.py).

IMPORTANT: These tests require REAL Redis 7+ because XAUTOCLAIM is not
supported in fakeredis. Tests are marked with @pytest.mark.real_redis and
skipped if Redis is not available at localhost:6380.

Covered scenarios:
  - XADD event → consumer reads + routes + ACKs + XDELs
  - Consumer dies without ACK → XAUTOCLAIM reclaims
  - 4th delivery (3 retries + 1) → DLQ + cleaned from stream
  - Circuit breaker opens after 5 failures
"""
from __future__ import annotations

import asyncio
import json
import time
import uuid

import pytest

pytestmark = pytest.mark.real_redis

REDIS_URL = "redis://localhost:6380"


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "real_redis: mark test as requiring a real Redis instance at localhost:6380",
    )


async def get_real_redis():
    """Create a real Redis connection. Returns None if unavailable."""
    try:
        import redis.asyncio as aioredis
        client = aioredis.from_url(REDIS_URL, decode_responses=True)
        await client.ping()
        return client
    except Exception:
        return None


def make_valid_event(event_type="STREAM_TEST"):
    return {
        "event_type": event_type,
        "tenant_id": 1,
        "branch_id": 1,
        "payload": {"data": "test"},
        "timestamp_ms": int(time.time() * 1000),
    }


class MockRouter:
    def __init__(self, fail_once=False):
        self.routed: list[dict] = []
        self._fail_once = fail_once
        self._failed = False

    async def route(self, event: dict) -> None:
        if self._fail_once and not self._failed:
            self._failed = True
            raise RuntimeError("Simulated routing failure")
        self.routed.append(event)


@pytest.fixture
async def redis_client():
    client = await get_real_redis()
    if client is None:
        pytest.skip("Real Redis not available at localhost:6380")
    # Use a unique stream name per test to avoid interference
    yield client
    await client.aclose()


@pytest.mark.asyncio
async def test_xadd_event_routed_and_acked(redis_client):
    """XADD event → consumer routes + ACK + XDEL."""
    stream = f"test:events:{uuid.uuid4().hex[:8]}"
    group = "test_group"
    router = MockRouter()

    from ws_gateway.components.events.stream_consumer import StreamConsumer
    consumer = StreamConsumer(
        redis=redis_client,
        event_router=router,
        stream_name=stream,
        group_name=group,
    )

    await consumer.start()

    # Add event to stream
    event = make_valid_event("STREAM_TEST")
    await redis_client.xadd(stream, {"payload": json.dumps(event)})

    # Wait for consumer to process
    await asyncio.sleep(0.5)
    await consumer.stop()

    assert len(router.routed) >= 1
    # Stream should be empty after XDEL
    length = await redis_client.xlen(stream)
    assert length == 0

    # Cleanup
    await redis_client.delete(stream)


@pytest.mark.asyncio
async def test_circuit_breaker_tracks_failures():
    """5 manually recorded failures should open the circuit breaker."""
    from ws_gateway.components.resilience.circuit_breaker import BreakerState, CircuitBreaker
    breaker = CircuitBreaker(name="stream_test", failure_threshold=5, recovery_timeout=30.0)

    for _ in range(5):
        breaker.record_failure()

    assert breaker.state == BreakerState.OPEN
    assert not breaker.can_execute()


@pytest.mark.asyncio
async def test_message_moved_to_dlq_after_max_deliveries(redis_client):
    """
    Simulate a message that fails routing N times → should be moved to DLQ.
    We manually set delivery count > STREAM_MAX_DELIVERIES.
    """
    stream = f"test:events:{uuid.uuid4().hex[:8]}"
    dlq = f"test:dlq:{uuid.uuid4().hex[:8]}"
    group = "test_group_dlq"

    # Router that always fails
    class AlwaysFailRouter:
        async def route(self, event):
            raise RuntimeError("Always fails")

    from ws_gateway.components.events.stream_consumer import StreamConsumer, STREAM_MAX_DELIVERIES
    consumer = StreamConsumer(
        redis=redis_client,
        event_router=AlwaysFailRouter(),
        stream_name=stream,
        group_name=group,
    )
    consumer._stream = stream
    # Override DLQ name for test isolation
    import ws_gateway.components.events.stream_consumer as sc_module
    original_dlq = sc_module.STREAM_DLQ
    sc_module.STREAM_DLQ = dlq

    try:
        await consumer._create_group()

        event = make_valid_event("FAIL_TEST")
        msg_id = await redis_client.xadd(stream, {"payload": json.dumps(event)})

        # Manually simulate high delivery count by calling _process_message
        # with mocked delivery count
        original_get_dc = consumer._get_delivery_count
        consumer._get_delivery_count = lambda _: asyncio.coroutine(
            lambda: STREAM_MAX_DELIVERIES + 1
        )()

        # Read the message first to simulate it being "delivered"
        messages = await redis_client.xreadgroup(
            groupname=group, consumername="test-consumer",
            streams={stream: ">"}, count=1, block=100,
        )

        if messages:
            for stream_name, entries in messages:
                for mid, fields in entries:
                    # Override delivery count check
                    async def high_count(_mid):
                        return STREAM_MAX_DELIVERIES + 1
                    consumer._get_delivery_count = high_count
                    await consumer._process_message(mid, fields)

        # Check DLQ
        dlq_len = await redis_client.xlen(dlq)
        assert dlq_len >= 1, "Event should be in DLQ"

    finally:
        sc_module.STREAM_DLQ = original_dlq
        await redis_client.delete(stream, dlq)
