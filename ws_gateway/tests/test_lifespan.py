"""
Tests for lifespan management (ws_gateway/main.py lifespan).

These tests verify that startup/shutdown lifecycle works correctly
using a minimal mock environment.

Covered scenarios:
  - Startup initializes all components without error
  - Shutdown completes within timeout
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.mark.asyncio
async def test_components_can_start_and_stop():
    """Test that broadcaster, cleanup, and revalidator can start/stop cleanly."""
    import fakeredis.aioredis
    from ws_gateway.components.connection.broadcaster import BroadcastObserver, ConnectionBroadcaster
    from ws_gateway.components.connection.cleanup import ConnectionCleanup
    from ws_gateway.components.connection.heartbeat import HeartbeatTracker
    from ws_gateway.components.connection.index import ConnectionIndex
    from ws_gateway.components.connection.lifecycle import ConnectionLifecycle
    from ws_gateway.components.connection.manager import ConnectionManager, ConnectionManagerDependencies
    from ws_gateway.components.connection.rate_limiter import RateLimiter
    from ws_gateway.components.connection.stats import ConnectionStats
    from ws_gateway.components.auth.revalidation import AuthRevalidator

    redis = fakeredis.aioredis.FakeRedis(decode_responses=True)

    index = ConnectionIndex()
    stats = ConnectionStats()
    rate_limiter = RateLimiter(redis=redis)
    heartbeat = HeartbeatTracker()
    lifecycle = ConnectionLifecycle(index=index, rate_limiter=rate_limiter, stats=stats)
    observer = BroadcastObserver(stats=stats)
    broadcaster = ConnectionBroadcaster(observer=observer, n_workers=2, queue_size=100)
    cleanup = ConnectionCleanup(index=index, heartbeat=heartbeat, lifecycle=lifecycle, interval=60)

    deps = ConnectionManagerDependencies(
        lifecycle=lifecycle, index=index, broadcaster=broadcaster,
        cleanup=cleanup, stats=stats, heartbeat=heartbeat,
    )
    conn_manager = ConnectionManager(deps)
    revalidator = AuthRevalidator(conn_index=index, sweep_interval=60)

    # Startup
    await broadcaster.start_workers()
    await cleanup.start()
    await revalidator.start()

    # All running
    assert broadcaster._running
    assert cleanup._running
    assert revalidator._running

    # Shutdown
    await revalidator.stop()
    await cleanup.stop()
    await broadcaster.stop_workers(timeout=1.0)

    # All stopped
    assert not broadcaster._running
    assert not cleanup._running
    assert not revalidator._running

    await redis.aclose()


@pytest.mark.asyncio
async def test_disconnect_all_on_shutdown():
    """disconnect_all() closes all active connections with code 1001."""
    import fakeredis.aioredis
    from ws_gateway.components.connection.broadcaster import BroadcastObserver, ConnectionBroadcaster
    from ws_gateway.components.connection.cleanup import ConnectionCleanup
    from ws_gateway.components.connection.heartbeat import HeartbeatTracker
    from ws_gateway.components.connection.index import ConnectionIndex
    from ws_gateway.components.connection.lifecycle import ConnectionLifecycle
    from ws_gateway.components.connection.manager import ConnectionManager, ConnectionManagerDependencies
    from ws_gateway.components.connection.rate_limiter import RateLimiter
    from ws_gateway.components.connection.stats import ConnectionStats
    from ws_gateway.components.auth.strategies import AuthResult

    redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    index = ConnectionIndex()
    stats = ConnectionStats()
    rate_limiter = RateLimiter(redis=redis)
    heartbeat = HeartbeatTracker()
    lifecycle = ConnectionLifecycle(index=index, rate_limiter=rate_limiter, stats=stats)
    observer = BroadcastObserver(stats=stats)
    broadcaster = ConnectionBroadcaster(observer=observer, n_workers=2, queue_size=50)
    cleanup = ConnectionCleanup(index=index, heartbeat=heartbeat, lifecycle=lifecycle)
    deps = ConnectionManagerDependencies(
        lifecycle=lifecycle, index=index, broadcaster=broadcaster,
        cleanup=cleanup, stats=stats, heartbeat=heartbeat,
    )
    conn_manager = ConnectionManager(deps)
    await broadcaster.start_workers()

    # Connect 3 mock connections
    from unittest.mock import AsyncMock
    for i in range(3):
        ws = AsyncMock()
        ws.accept = AsyncMock()
        ws.close = AsyncMock()
        auth = AuthResult(tenant_id=1, user_id=i+1, branch_ids=[1], token_type="null")
        await conn_manager.connect(ws, auth)

    assert conn_manager.index.count_total() == 3

    # Disconnect all (shutdown simulation)
    await conn_manager.disconnect_all(code=1001)

    # All connections removed
    assert conn_manager.index.count_total() == 0

    await broadcaster.stop_workers(timeout=1.0)
    await redis.aclose()
