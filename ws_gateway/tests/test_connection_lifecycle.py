"""
Tests for ConnectionLifecycle (ws_gateway/components/connection/lifecycle.py).

Covered scenarios:
  - accept OK → Connection returned
  - 4th connection for same user → ConnectionRejectedError(4029)
  - Connection 1001 global → ConnectionRejectedError(4029)
  - User flagged abusive → ConnectionRejectedError(4029)
  - Lock ordering: 20 concurrent connects on same branch → no deadlocks in <2s
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import fakeredis.aioredis
import pytest
import pytest_asyncio

from ws_gateway.components.auth.strategies import AuthResult
from ws_gateway.components.connection.heartbeat import HeartbeatTracker
from ws_gateway.components.connection.index import ConnectionIndex
from ws_gateway.components.connection.lifecycle import (
    ConnectionLifecycle,
    ConnectionRejectedError,
)
from ws_gateway.components.connection.rate_limiter import RateLimiter
from ws_gateway.components.connection.stats import ConnectionStats


@pytest_asyncio.fixture
async def redis():
    client = fakeredis.aioredis.FakeRedis(decode_responses=True)
    yield client
    await client.aclose()


@pytest.fixture
def index():
    return ConnectionIndex()


@pytest.fixture
def stats():
    return ConnectionStats()


@pytest_asyncio.fixture
async def lifecycle(redis, index, stats):
    rate_limiter = RateLimiter(redis=redis, limit=30, window=1)
    return ConnectionLifecycle(index=index, rate_limiter=rate_limiter, stats=stats)


def make_websocket():
    ws = AsyncMock()
    ws.accept = AsyncMock()
    ws.close = AsyncMock()
    return ws


def make_auth(user_id=1, tenant_id=1, branch_ids=None) -> AuthResult:
    return AuthResult(
        tenant_id=tenant_id,
        user_id=user_id,
        branch_ids=branch_ids or [1],
        roles=["ADMIN"],
        token_type="null",
    )


# ── Happy path ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_accept_returns_connection(lifecycle, index):
    ws = make_websocket()
    auth = make_auth(user_id=1)
    conn = await lifecycle.accept(ws, auth)

    assert conn is not None
    assert not conn.is_dead
    ws.accept.assert_awaited_once()
    assert conn in index._all


# ── Per-user limit ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_fourth_connection_rejected(lifecycle):
    """4th connection for same user → ConnectionRejectedError(4029)."""
    auth = make_auth(user_id=10)
    ws_list = [make_websocket() for _ in range(3)]

    for ws in ws_list:
        await lifecycle.accept(ws, auth)

    ws_4th = make_websocket()
    with pytest.raises(ConnectionRejectedError) as exc_info:
        await lifecycle.accept(ws_4th, auth)

    assert exc_info.value.close_code == 4029
    ws_4th.accept.assert_not_awaited()


# ── Global limit ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_global_connection_limit_rejected(redis, stats):
    """When global limit is reached, new connections are rejected."""
    from ws_gateway.components.connection import lifecycle as lc_module
    index = ConnectionIndex()
    rate_limiter = RateLimiter(redis=redis)
    lifecycle_obj = ConnectionLifecycle(index=index, rate_limiter=rate_limiter, stats=stats)

    original_max = lc_module.MAX_CONNECTIONS
    try:
        lc_module.MAX_CONNECTIONS = 2
        for i in range(2):
            ws = make_websocket()
            auth = make_auth(user_id=i + 100, branch_ids=[i + 1])
            await lifecycle_obj.accept(ws, auth)

        ws_over = make_websocket()
        auth_over = make_auth(user_id=999, branch_ids=[99])
        with pytest.raises(ConnectionRejectedError) as exc_info:
            await lifecycle_obj.accept(ws_over, auth_over)

        assert exc_info.value.close_code == 4029
    finally:
        lc_module.MAX_CONNECTIONS = original_max


# ── Abusive user ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_abusive_user_rejected(lifecycle, redis):
    """User flagged abusive → connection rejected."""
    await redis.setex("ws:abusive:50", 60, "1")  # mark user 50 abusive
    auth = make_auth(user_id=50)
    ws = make_websocket()

    with pytest.raises(ConnectionRejectedError) as exc_info:
        await lifecycle.accept(ws, auth)

    assert exc_info.value.close_code == 4029
    ws.accept.assert_not_awaited()


# ── Disconnect ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_disconnect_removes_from_index(lifecycle, index):
    ws = make_websocket()
    auth = make_auth(user_id=1)
    conn = await lifecycle.accept(ws, auth)

    await lifecycle.disconnect(conn, code=1000)

    assert conn.is_dead
    assert conn not in index._all


# ── Lock ordering / concurrency ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_concurrent_connects_no_deadlock(redis, stats):
    """20 concurrent connections on same branch must complete in < 2 seconds."""
    index = ConnectionIndex()
    rate_limiter = RateLimiter(redis=redis)
    lifecycle_obj = ConnectionLifecycle(index=index, rate_limiter=rate_limiter, stats=stats)

    async def connect_one(user_id):
        ws = make_websocket()
        auth = make_auth(user_id=user_id, branch_ids=[1])
        return await lifecycle_obj.accept(ws, auth)

    import time
    start = time.monotonic()
    conns = await asyncio.wait_for(
        asyncio.gather(*[connect_one(i) for i in range(20)]),
        timeout=2.0,
    )
    elapsed = time.monotonic() - start

    assert len(conns) == 20
    assert elapsed < 2.0
