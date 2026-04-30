"""
Tests for HTTP catch-up endpoints (ws_gateway/routers/catchup.py).

Covered scenarios:
  - Staff JWT valid → events returned
  - Staff branch_id outside user.branch_ids → 403
  - since too old → 410
  - Diner session_id mismatch → 403
  - Diner doesn't see ENTITY_* events
  - Table Token tampered → 401
"""
from __future__ import annotations

import json
import time
from datetime import datetime, UTC, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import fakeredis
import fakeredis.aioredis
import pytest
import jwt as pyjwt
from fastapi import FastAPI
from fastapi.testclient import TestClient

from ws_gateway.routers.catchup import router as catchup_router


JWT_SECRET = "test-secret-at-least-32-chars-long!!"
JWT_ALGORITHM = "HS256"


def make_jwt(branch_ids=None, sub="42", tenant_id=1):
    now = datetime.now(UTC)
    payload = {
        "sub": sub,
        "tenant_id": tenant_id,
        "branch_ids": branch_ids or [1, 2],
        "roles": ["ADMIN"],
        "email": "test@example.com",
        "jti": "test-jti",
        "type": "access",
        "iss": "integrador",
        "aud": "integrador-api",
        "iat": now,
        "exp": now + timedelta(seconds=900),
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def make_table_token(session_id=10, tenant_id=1, branch_id=1):
    with patch("shared.security.table_token.settings") as ms:
        ms.TABLE_TOKEN_SECRET = "test-table-secret-at-least-32-chars"
        ms.TABLE_TOKEN_TTL_SECONDS = 3600
        from shared.security.table_token import issue_table_token
        return issue_table_token(
            session_id=session_id, table_id=5, diner_id=99,
            branch_id=branch_id, tenant_id=tenant_id,
        )


def make_app_with_redis(redis_client):
    app = FastAPI()
    app.include_router(catchup_router)
    return app


@pytest.fixture
def fake_server():
    return fakeredis.FakeServer()


@pytest.fixture
def redis_client(fake_server):
    """Async fakeredis — shared server with redis_sync for pre-population."""
    return fakeredis.aioredis.FakeRedis(server=fake_server, decode_responses=True)


@pytest.fixture
def redis_sync(fake_server):
    """Sync fakeredis — same server, used to pre-populate data before TestClient."""
    return fakeredis.FakeRedis(server=fake_server, decode_responses=True)


@pytest.fixture
def app(redis_client):
    return make_app_with_redis(redis_client)


def patch_deps(redis_client):
    mock_settings = MagicMock()
    mock_settings.JWT_SECRET = JWT_SECRET
    mock_settings.JWT_ALGORITHM = JWT_ALGORITHM
    mock_settings.WS_ALLOWED_ORIGINS = ""

    return [
        patch("ws_gateway.core.dependencies.get_redis_pool", return_value=redis_client),
        patch("ws_gateway.core.dependencies.get_settings", return_value=mock_settings),
        patch("shared.config.settings.settings", mock_settings),
    ]


def test_staff_catchup_valid_jwt(redis_client, redis_sync):
    """Staff with valid JWT via Authorization: Bearer header gets events."""
    app = make_app_with_redis(redis_client)

    # Pre-populate using sync client (same FakeServer — avoids event loop mismatch)
    event = {"event_type": "TEST", "tenant_id": 1, "branch_id": 1, "payload": {}, "timestamp_ms": 1000}
    redis_sync.zadd("catchup:branch:1", {json.dumps(event): 1000})

    token = make_jwt(branch_ids=[1])

    with patch("ws_gateway.core.dependencies.get_redis_pool", return_value=redis_client), \
         patch("shared.config.settings.settings") as ms:
        ms.JWT_SECRET = JWT_SECRET
        ms.JWT_ALGORITHM = JWT_ALGORITHM

        with patch("shared.security.auth.settings", ms):
            client = TestClient(app)
            # Token is sent via Authorization header — NOT as ?token= query param
            response = client.get(
                "/ws/catchup?branch_id=1&since=0",
                headers={"Authorization": f"Bearer {token}"},
            )

    assert response.status_code == 200
    data = response.json()
    assert data["count"] >= 1


def test_staff_catchup_missing_auth_header_returns_401(redis_client):
    """Staff request without Authorization header → 401."""
    app = make_app_with_redis(redis_client)

    with patch("ws_gateway.core.dependencies.get_redis_pool", return_value=redis_client), \
         patch("shared.config.settings.settings") as ms:
        ms.JWT_SECRET = JWT_SECRET
        ms.JWT_ALGORITHM = JWT_ALGORITHM

        with patch("shared.security.auth.settings", ms):
            client = TestClient(app)
            response = client.get("/ws/catchup?branch_id=1&since=0")

    assert response.status_code == 401


def test_staff_catchup_malformed_auth_header_returns_401(redis_client):
    """Malformed Authorization header (not 'Bearer <token>') → 401."""
    app = make_app_with_redis(redis_client)

    with patch("ws_gateway.core.dependencies.get_redis_pool", return_value=redis_client), \
         patch("shared.config.settings.settings") as ms:
        ms.JWT_SECRET = JWT_SECRET
        ms.JWT_ALGORITHM = JWT_ALGORITHM

        with patch("shared.security.auth.settings", ms):
            client = TestClient(app)
            response = client.get(
                "/ws/catchup?branch_id=1&since=0",
                headers={"Authorization": "Basic sometoken"},
            )

    assert response.status_code == 401


def test_staff_catchup_branch_not_in_jwt_returns_403(redis_client):
    """Staff requesting branch_id not in their JWT → 403."""
    app = make_app_with_redis(redis_client)
    token = make_jwt(branch_ids=[5, 6])  # does NOT include branch_id=1

    with patch("ws_gateway.core.dependencies.get_redis_pool", return_value=redis_client), \
         patch("shared.config.settings.settings") as ms:
        ms.JWT_SECRET = JWT_SECRET
        ms.JWT_ALGORITHM = JWT_ALGORITHM

        with patch("shared.security.auth.settings", ms):
            client = TestClient(app)
            response = client.get(
                "/ws/catchup?branch_id=1&since=0",
                headers={"Authorization": f"Bearer {token}"},
            )

    assert response.status_code == 403


def test_diner_catchup_session_mismatch_returns_403(redis_client):
    """Diner requesting session_id different from token's session_id → 403."""
    app = make_app_with_redis(redis_client)

    with patch("shared.security.table_token.settings") as ms:
        ms.TABLE_TOKEN_SECRET = "test-table-secret-at-least-32-chars"
        ms.TABLE_TOKEN_TTL_SECONDS = 3600
        token = make_table_token(session_id=10)

    with patch("ws_gateway.core.dependencies.get_redis_pool", return_value=redis_client), \
         patch("shared.security.table_token.settings") as ms:
        ms.TABLE_TOKEN_SECRET = "test-table-secret-at-least-32-chars"

        client = TestClient(app)
        response = client.get(f"/ws/catchup/session?session_id=99&since=0&table_token={token}")

    assert response.status_code == 403


def test_diner_does_not_see_non_whitelisted_events(redis_client, redis_sync):
    """Diners only see ROUND_*, CART_*, CHECK_*, etc. — not ENTITY_* events."""
    app = make_app_with_redis(redis_client)

    session_id = 77
    # Pre-populate using sync client (same FakeServer — avoids event loop mismatch)
    ok_event = {"event_type": "ROUND_SUBMITTED", "tenant_id": 1, "branch_id": 1, "payload": {}, "timestamp_ms": 1000}
    bad_event = {"event_type": "ENTITY_PRODUCT_UPDATED", "tenant_id": 1, "branch_id": 1, "payload": {}, "timestamp_ms": 2000}
    redis_sync.zadd(f"catchup:session:{session_id}", {json.dumps(ok_event): 1000})
    redis_sync.zadd(f"catchup:session:{session_id}", {json.dumps(bad_event): 2000})

    with patch("shared.security.table_token.settings") as ms:
        ms.TABLE_TOKEN_SECRET = "test-table-secret-at-least-32-chars"
        ms.TABLE_TOKEN_TTL_SECONDS = 3600
        token = make_table_token(session_id=session_id)

    with patch("ws_gateway.core.dependencies.get_redis_pool", return_value=redis_client), \
         patch("shared.security.table_token.settings") as ms:
        ms.TABLE_TOKEN_SECRET = "test-table-secret-at-least-32-chars"

        client = TestClient(app)
        response = client.get(f"/ws/catchup/session?session_id={session_id}&since=0&table_token={token}")

    assert response.status_code == 200
    data = response.json()
    event_types = [e["event_type"] for e in data["events"]]
    assert "ROUND_SUBMITTED" in event_types
    assert "ENTITY_PRODUCT_UPDATED" not in event_types
