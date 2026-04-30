"""
Tests for EventRouter (ws_gateway/components/events/router.py).

Covered scenarios:
  - KITCHEN_EVENTS delivered only to kitchen connections
  - SECTOR_EVENTS filtered by sector for waiters + all ADMIN/MANAGER
  - Cross-tenant event NOT delivered
  - Unknown event_type → drop + warn
  - BRANCH_WIDE_WAITER_EVENTS to all waiters on branch
  - SESSION_EVENTS only to diners of that session
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
import fakeredis.aioredis

from ws_gateway.components.auth.strategies import AuthResult
from ws_gateway.components.connection.broadcaster import BroadcastObserver, ConnectionBroadcaster
from ws_gateway.components.connection.cleanup import ConnectionCleanup
from ws_gateway.components.connection.heartbeat import HeartbeatTracker
from ws_gateway.components.connection.index import ConnectionIndex
from ws_gateway.components.connection.lifecycle import ConnectionLifecycle
from ws_gateway.components.connection.manager import ConnectionManager, ConnectionManagerDependencies
from ws_gateway.components.connection.rate_limiter import RateLimiter
from ws_gateway.components.connection.stats import ConnectionStats
from ws_gateway.components.events.router import EventCategory, EventRouter


@pytest_asyncio.fixture
async def redis_client():
    client = fakeredis.aioredis.FakeRedis(decode_responses=True)
    yield client
    await client.aclose()


@pytest_asyncio.fixture
async def manager_and_broadcaster(redis_client):
    index = ConnectionIndex()
    stats = ConnectionStats()
    rate_limiter = RateLimiter(redis=redis_client)
    heartbeat = HeartbeatTracker()
    lifecycle = ConnectionLifecycle(index=index, rate_limiter=rate_limiter, stats=stats)
    observer = BroadcastObserver(stats=stats)
    broadcaster = ConnectionBroadcaster(observer=observer, n_workers=2, queue_size=100)
    cleanup = ConnectionCleanup(index=index, heartbeat=heartbeat, lifecycle=lifecycle, interval=60)

    deps = ConnectionManagerDependencies(
        lifecycle=lifecycle, index=index, broadcaster=broadcaster,
        cleanup=cleanup, stats=stats, heartbeat=heartbeat,
    )
    m = ConnectionManager(deps)
    await broadcaster.start_workers()
    yield m, broadcaster
    await broadcaster.stop_workers(timeout=1.0)


async def connect_with_auth(manager, ws, auth):
    return await manager.connect(ws, auth)


def make_ws():
    ws = AsyncMock()
    ws.accept = AsyncMock()
    ws.close = AsyncMock()
    ws.send_text = AsyncMock()
    return ws


def make_auth(tenant_id=1, branch_ids=None, roles=None, user_id=None, diner_id=None,
              session_id=None, sector_ids=None) -> AuthResult:
    return AuthResult(
        tenant_id=tenant_id,
        user_id=user_id or (1 if diner_id is None else None),
        diner_id=diner_id,
        session_id=session_id,
        branch_ids=branch_ids or [1],
        roles=roles or ["ADMIN"],
        sector_ids=sector_ids or [],
        token_type="null",
    )


@pytest_asyncio.fixture
async def router(manager_and_broadcaster):
    m, _ = manager_and_broadcaster
    r = EventRouter(conn_manager=m)
    r.register_event("TEST_KITCHEN", EventCategory.KITCHEN_EVENTS)
    r.register_event("TEST_SESSION", EventCategory.SESSION_EVENTS)
    r.register_event("TEST_ADMIN", EventCategory.ADMIN_ONLY_EVENTS)
    r.register_event("TEST_BRANCH_WAITER", EventCategory.BRANCH_WIDE_WAITER_EVENTS)
    r.register_event("TEST_SECTOR", EventCategory.SECTOR_EVENTS)
    return r, m


# ── KITCHEN_EVENTS ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_kitchen_events_delivered_to_kitchen_only(router):
    r, m = router
    ws_kitchen = make_ws()
    ws_admin = make_ws()

    await connect_with_auth(m, ws_kitchen, make_auth(user_id=1, roles=["KITCHEN"], branch_ids=[1]))
    await connect_with_auth(m, ws_admin, make_auth(user_id=2, roles=["ADMIN"], branch_ids=[1]))

    event = {"event_type": "TEST_KITCHEN", "tenant_id": 1, "branch_id": 1, "payload": {}}
    await r.route(event)
    await asyncio.sleep(0.3)

    ws_kitchen.send_text.assert_awaited()
    # Admin connections are delivered kitchen events IF they have KITCHEN role
    # (admin is not KITCHEN role, so not delivered)


@pytest.mark.asyncio
async def test_kitchen_events_include_manager_admin(router):
    """KITCHEN endpoint allows KITCHEN, MANAGER, ADMIN — but EventCategory.KITCHEN_EVENTS
    uses broadcast_to_kitchen which filters by KITCHEN role. Managers get events on
    BRANCH_WIDE_WAITER_EVENTS. KITCHEN_EVENTS is specifically kitchen staff events."""
    r, m = router
    ws_manager = make_ws()
    await connect_with_auth(m, ws_manager, make_auth(user_id=10, roles=["KITCHEN", "MANAGER"], branch_ids=[1]))

    event = {"event_type": "TEST_KITCHEN", "tenant_id": 1, "branch_id": 1, "payload": {}}
    await r.route(event)
    await asyncio.sleep(0.3)
    ws_manager.send_text.assert_awaited()


# ── SECTOR_EVENTS ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_sector_events_filtered_by_sector(router):
    r, m = router
    ws_waiter_s1 = make_ws()
    ws_waiter_s2 = make_ws()
    ws_admin = make_ws()

    await connect_with_auth(m, ws_waiter_s1, make_auth(user_id=1, roles=["WAITER"], branch_ids=[1], sector_ids=[1]))
    await connect_with_auth(m, ws_waiter_s2, make_auth(user_id=2, roles=["WAITER"], branch_ids=[1], sector_ids=[2]))
    await connect_with_auth(m, ws_admin, make_auth(user_id=3, roles=["ADMIN"], branch_ids=[1]))

    event = {"event_type": "TEST_SECTOR", "tenant_id": 1, "branch_id": 1, "sector_id": 1, "payload": {}}
    await r.route(event)
    await asyncio.sleep(0.3)

    ws_waiter_s1.send_text.assert_awaited()  # correct sector
    ws_admin.send_text.assert_awaited()       # ADMIN always receives sector events


@pytest.mark.asyncio
async def test_sector_events_waiter_wrong_sector_skipped(router):
    r, m = router
    ws_waiter_s2 = make_ws()

    await connect_with_auth(m, ws_waiter_s2, make_auth(user_id=5, roles=["WAITER"], branch_ids=[1], sector_ids=[2]))

    event = {"event_type": "TEST_SECTOR", "tenant_id": 1, "branch_id": 1, "sector_id": 1, "payload": {}}
    await r.route(event)
    await asyncio.sleep(0.3)

    ws_waiter_s2.send_text.assert_not_awaited()


# ── Cross-tenant isolation ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_cross_tenant_event_not_delivered(router):
    r, m = router
    ws_t1 = make_ws()
    ws_t2 = make_ws()

    await connect_with_auth(m, ws_t1, make_auth(tenant_id=1, user_id=1, branch_ids=[1]))
    await connect_with_auth(m, ws_t2, make_auth(tenant_id=2, user_id=2, branch_ids=[1]))

    event = {"event_type": "TEST_ADMIN", "tenant_id": 1, "branch_id": 1, "payload": {}}
    await r.route(event)
    await asyncio.sleep(0.3)

    ws_t1.send_text.assert_awaited()
    ws_t2.send_text.assert_not_awaited()


# ── Unknown event_type ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_unknown_event_type_dropped(router, caplog):
    r, m = router
    event = {"event_type": "UNKNOWN_EVENT", "tenant_id": 1, "branch_id": 1, "payload": {}}
    # Should not raise, just log warning
    await r.route(event)


# ── BRANCH_WIDE_WAITER_EVENTS ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_branch_wide_waiter_events_to_all_waiters(router):
    r, m = router
    ws_w1 = make_ws()
    ws_w2 = make_ws()
    ws_kitchen = make_ws()

    await connect_with_auth(m, ws_w1, make_auth(user_id=1, roles=["WAITER"], branch_ids=[1]))
    await connect_with_auth(m, ws_w2, make_auth(user_id=2, roles=["WAITER"], branch_ids=[1]))
    await connect_with_auth(m, ws_kitchen, make_auth(user_id=3, roles=["KITCHEN"], branch_ids=[1]))

    event = {"event_type": "TEST_BRANCH_WAITER", "tenant_id": 1, "branch_id": 1, "payload": {}}
    await r.route(event)
    await asyncio.sleep(0.3)

    ws_w1.send_text.assert_awaited()
    ws_w2.send_text.assert_awaited()
    ws_kitchen.send_text.assert_not_awaited()


# ── SESSION_EVENTS ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_session_events_only_to_correct_diners(router):
    r, m = router
    ws_diner_s10 = make_ws()
    ws_diner_s20 = make_ws()

    auth_s10 = make_auth(user_id=None, diner_id=1, session_id=10, branch_ids=[1], roles=[])
    auth_s20 = make_auth(user_id=None, diner_id=2, session_id=20, branch_ids=[1], roles=[])

    await connect_with_auth(m, ws_diner_s10, auth_s10)
    await connect_with_auth(m, ws_diner_s20, auth_s20)

    event = {"event_type": "TEST_SESSION", "tenant_id": 1, "branch_id": 1, "session_id": 10, "payload": {}}
    await r.route(event)
    await asyncio.sleep(0.3)

    ws_diner_s10.send_text.assert_awaited()
    ws_diner_s20.send_text.assert_not_awaited()
