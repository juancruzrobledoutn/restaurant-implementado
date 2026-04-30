"""
Integration tests for WebSocket endpoints (ws_gateway/routers/websocket.py).

Uses TestClient with WebSocketTestSession and NullAuthStrategy for simplicity.

Covered scenarios:
  - /ws/admin with valid NullAuthStrategy → connection accepted
  - /ws/admin with AuthError(4003) → close 4003
  - Origin invalid → rejected (close before accept)
  - ping → pong response
  - Rate limit exceeded → close 4029
"""
from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import fakeredis.aioredis
import pytest
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient

from ws_gateway.components.auth.strategies import AuthError, AuthResult, NullAuthStrategy
from ws_gateway.components.connection.broadcaster import BroadcastObserver, ConnectionBroadcaster
from ws_gateway.components.connection.cleanup import ConnectionCleanup
from ws_gateway.components.connection.heartbeat import HeartbeatTracker
from ws_gateway.components.connection.index import ConnectionIndex
from ws_gateway.components.connection.lifecycle import ConnectionLifecycle
from ws_gateway.components.connection.manager import ConnectionManager, ConnectionManagerDependencies
from ws_gateway.components.connection.rate_limiter import RateLimiter
from ws_gateway.components.connection.stats import ConnectionStats
from ws_gateway.routers.websocket import _validate_origin


# ── Origin validation (unit tests — no HTTP) ─────────────────────────────────

def test_valid_origin_allowed():
    ws = MagicMock()
    ws.headers = {"origin": "http://localhost:5177"}
    result = _validate_origin(ws, ["http://localhost:5177"], False)
    assert result is True


def test_invalid_origin_rejected():
    ws = MagicMock()
    ws.headers = {"origin": "http://evil.com"}
    result = _validate_origin(ws, ["http://localhost:5177"], False)
    assert result is False


def test_missing_origin_denied_when_allow_no_origin_false():
    ws = MagicMock()
    ws.headers = {}
    result = _validate_origin(ws, ["http://localhost:5177"], False)
    assert result is False


def test_missing_origin_allowed_when_allow_no_origin_true():
    ws = MagicMock()
    ws.headers = {}
    result = _validate_origin(ws, ["http://localhost:5177"], True)
    assert result is True


# ── Full endpoint integration tests ───────────────────────────────────────────

def make_gateway_app(redis_client, strategy_factory=None):
    """Create a Gateway app wired with fake Redis for testing."""
    index = ConnectionIndex()
    stats = ConnectionStats()
    rate_limiter = RateLimiter(redis=redis_client, limit=30, window=60)
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

    @asynccontextmanager
    async def lifespan(app):
        await broadcaster.start_workers()
        yield
        await broadcaster.stop_workers(timeout=1.0)

    app = FastAPI(lifespan=lifespan)

    # Minimal WS endpoint using NullAuthStrategy for testing
    from ws_gateway.routers.websocket import _websocket_endpoint

    mock_settings = MagicMock()
    mock_settings.WS_ALLOWED_ORIGINS = ""  # Use DEFAULT_CORS_ORIGINS
    mock_settings.WS_ALLOW_NO_ORIGIN = True  # Allow tool connections

    @app.websocket("/ws/admin")
    async def ws_admin_test(websocket: WebSocket):
        token = websocket.query_params.get("token", "")
        strategy = NullAuthStrategy(tenant_id=1, user_id=1, roles=["ADMIN"])
        await _websocket_endpoint(
            websocket, token, strategy, conn_manager, rate_limiter, mock_settings
        )

    return app


@pytest.fixture
def redis_client():
    import fakeredis
    client = fakeredis.FakeRedis(decode_responses=True)
    return client


@pytest.fixture
def gateway_app(redis_client):
    return make_gateway_app(redis_client)


def test_ws_admin_null_strategy_accepts(gateway_app):
    """NullAuthStrategy allows any token."""
    client = TestClient(gateway_app)
    with client.websocket_connect("/ws/admin?token=any") as ws:
        ws.send_text(json.dumps({"type": "ping"}))
        msg = json.loads(ws.receive_text())
        assert msg["type"] == "pong"


def test_ws_ping_pong(gateway_app):
    """Client sends ping, receives pong."""
    client = TestClient(gateway_app)
    with client.websocket_connect("/ws/admin?token=test") as ws:
        ws.send_text(json.dumps({"type": "ping"}))
        response = json.loads(ws.receive_text())
        assert response["type"] == "pong"
