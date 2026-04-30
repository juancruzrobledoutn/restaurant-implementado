"""
Tests for ConnectionManager facade (ws_gateway/components/connection/manager.py).

Covered scenarios:
  - connect() delegates to lifecycle + heartbeat
  - disconnect() delegates correctly
  - broadcast_to_branch() fan-out correct
  - broadcast_to_kitchen() filters by KITCHEN role
  - broadcast_to_admin_only() filters ADMIN/MANAGER
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import fakeredis.aioredis
import pytest
import pytest_asyncio

from ws_gateway.components.auth.strategies import AuthResult
from ws_gateway.components.connection.broadcaster import BroadcastObserver, ConnectionBroadcaster
from ws_gateway.components.connection.cleanup import ConnectionCleanup
from ws_gateway.components.connection.heartbeat import HeartbeatTracker
from ws_gateway.components.connection.index import ConnectionIndex
from ws_gateway.components.connection.lifecycle import ConnectionLifecycle
from ws_gateway.components.connection.manager import ConnectionManager, ConnectionManagerDependencies
from ws_gateway.components.connection.rate_limiter import RateLimiter
from ws_gateway.components.connection.stats import ConnectionStats


@pytest_asyncio.fixture
async def redis_client():
    client = fakeredis.aioredis.FakeRedis(decode_responses=True)
    yield client
    await client.aclose()


@pytest_asyncio.fixture
async def manager(redis_client):
    index = ConnectionIndex()
    stats = ConnectionStats()
    rate_limiter = RateLimiter(redis=redis_client)
    heartbeat = HeartbeatTracker()
    lifecycle = ConnectionLifecycle(index=index, rate_limiter=rate_limiter, stats=stats)
    observer = BroadcastObserver(stats=stats)
    broadcaster = ConnectionBroadcaster(observer=observer, n_workers=2, queue_size=100)
    cleanup = ConnectionCleanup(index=index, heartbeat=heartbeat, lifecycle=lifecycle, interval=60)

    deps = ConnectionManagerDependencies(
        lifecycle=lifecycle,
        index=index,
        broadcaster=broadcaster,
        cleanup=cleanup,
        stats=stats,
        heartbeat=heartbeat,
    )
    m = ConnectionManager(deps)
    await broadcaster.start_workers()
    yield m
    await broadcaster.stop_workers(timeout=1.0)


def make_websocket():
    ws = AsyncMock()
    ws.accept = AsyncMock()
    ws.close = AsyncMock()
    ws.send_text = AsyncMock()
    return ws


def make_auth(user_id=1, branch_ids=None, roles=None, tenant_id=1) -> AuthResult:
    return AuthResult(
        tenant_id=tenant_id,
        user_id=user_id,
        branch_ids=branch_ids or [1],
        roles=roles or ["ADMIN"],
        token_type="null",
    )


# ── connect / disconnect ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_connect_returns_connection(manager):
    ws = make_websocket()
    auth = make_auth()
    conn = await manager.connect(ws, auth)
    assert conn is not None
    assert not conn.is_dead


@pytest.mark.asyncio
async def test_disconnect_removes_connection(manager):
    ws = make_websocket()
    auth = make_auth(user_id=2)
    conn = await manager.connect(ws, auth)
    await manager.disconnect(conn, code=1000)
    assert conn.is_dead


# ── Broadcast fan-out ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_broadcast_to_branch_delivers_to_all(manager):
    conns = []
    for i in range(3):
        ws = make_websocket()
        auth = make_auth(user_id=i + 10, branch_ids=[5], tenant_id=1)
        conn = await manager.connect(ws, auth)
        conns.append((conn, ws))

    await manager.broadcast_to_branch(tenant_id=1, branch_id=5, message={"type": "test"})
    await asyncio.sleep(0.3)

    for conn, ws in conns:
        ws.send_text.assert_awaited()


@pytest.mark.asyncio
async def test_broadcast_to_kitchen_filters_roles(manager):
    ws_kitchen = make_websocket()
    ws_admin = make_websocket()

    auth_k = make_auth(user_id=20, branch_ids=[7], roles=["KITCHEN"])
    auth_a = make_auth(user_id=21, branch_ids=[7], roles=["ADMIN"])

    await manager.connect(ws_kitchen, auth_k)
    await manager.connect(ws_admin, auth_a)

    await manager.broadcast_to_kitchen(tenant_id=1, branch_id=7, message={"type": "order"})
    await asyncio.sleep(0.3)

    ws_kitchen.send_text.assert_awaited()
    ws_admin.send_text.assert_not_awaited()


@pytest.mark.asyncio
async def test_broadcast_to_admin_only(manager):
    ws_waiter = make_websocket()
    ws_manager = make_websocket()

    auth_w = make_auth(user_id=30, branch_ids=[8], roles=["WAITER"])
    auth_m = make_auth(user_id=31, branch_ids=[8], roles=["MANAGER"])

    await manager.connect(ws_waiter, auth_w)
    await manager.connect(ws_manager, auth_m)

    await manager.broadcast_to_admin_only(tenant_id=1, branch_id=8, message={"type": "admin"})
    await asyncio.sleep(0.3)

    ws_manager.send_text.assert_awaited()
    ws_waiter.send_text.assert_not_awaited()
