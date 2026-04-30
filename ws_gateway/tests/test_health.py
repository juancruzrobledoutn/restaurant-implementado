"""
Tests for health endpoints (ws_gateway/routers/health.py).

Covered scenarios:
  - GET /health → 200
  - GET /health/detailed with Redis OK → 200
  - GET /health/detailed with Redis down → 503
  - GET /ws/metrics in production without token → 404
  - GET /ws/metrics with correct WS_METRICS_TOKEN → 200
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from ws_gateway.routers.health import router as health_router


def make_test_app():
    app = FastAPI()
    app.include_router(health_router)
    return app


@pytest.fixture
def client():
    app = make_test_app()
    return TestClient(app)


# ── /health ───────────────────────────────────────────────────────────────────

def test_health_returns_200(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


# ── /health/detailed ──────────────────────────────────────────────────────────

def test_health_detailed_redis_ok():
    app = make_test_app()

    mock_redis = AsyncMock()
    mock_redis.ping = AsyncMock(return_value=True)
    mock_redis.xlen = AsyncMock(return_value=0)
    mock_redis.xpending = AsyncMock(return_value={"pending": 0})

    mock_conn_manager = MagicMock()
    mock_conn_manager.get_stats = MagicMock(return_value={"active_connections": 5})

    with patch("ws_gateway.core.dependencies.get_redis_pool", return_value=mock_redis), \
         patch("ws_gateway.core.dependencies.get_connection_manager", return_value=mock_conn_manager), \
         patch("ws_gateway.core.dependencies._circuit_breakers", {}):

        client = TestClient(app)
        response = client.get("/health/detailed")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["checks"]["redis"] == "ok"


def test_health_detailed_redis_down():
    app = make_test_app()

    mock_redis = AsyncMock()
    mock_redis.ping = AsyncMock(side_effect=ConnectionError("Redis is down"))
    mock_redis.xlen = AsyncMock(side_effect=ConnectionError("Redis is down"))
    mock_redis.xpending = AsyncMock(side_effect=ConnectionError("Redis is down"))

    with patch("ws_gateway.core.dependencies.get_redis_pool", return_value=mock_redis), \
         patch("ws_gateway.core.dependencies.get_connection_manager", side_effect=RuntimeError("not init")), \
         patch("ws_gateway.core.dependencies._circuit_breakers", {}):

        client = TestClient(app)
        response = client.get("/health/detailed")

    assert response.status_code == 503
    assert response.json()["status"] == "degraded"


# ── /ws/metrics ───────────────────────────────────────────────────────────────

def test_ws_metrics_production_without_token_returns_404():
    app = make_test_app()

    mock_settings = MagicMock()
    mock_settings.ENVIRONMENT = "production"
    mock_settings.WS_METRICS_TOKEN = "secret-token"

    with patch("ws_gateway.core.dependencies.get_settings", return_value=mock_settings), \
         patch("ws_gateway.core.dependencies.get_connection_manager", side_effect=RuntimeError()):

        client = TestClient(app)
        response = client.get("/ws/metrics")

    assert response.status_code == 404


def test_ws_metrics_production_with_correct_token():
    app = make_test_app()

    mock_settings = MagicMock()
    mock_settings.ENVIRONMENT = "production"
    mock_settings.WS_METRICS_TOKEN = "my-secret"

    mock_conn_manager = MagicMock()
    mock_conn_manager.get_stats = MagicMock(return_value={"active_connections": 0})

    with patch("ws_gateway.core.dependencies.get_settings", return_value=mock_settings), \
         patch("ws_gateway.core.dependencies.get_connection_manager", return_value=mock_conn_manager), \
         patch("ws_gateway.core.dependencies._circuit_breakers", {}):

        client = TestClient(app)
        response = client.get("/ws/metrics?token=my-secret")

    assert response.status_code == 200


def test_ws_metrics_dev_accessible_without_token():
    app = make_test_app()

    mock_settings = MagicMock()
    mock_settings.ENVIRONMENT = "development"
    mock_settings.WS_METRICS_TOKEN = ""

    mock_conn_manager = MagicMock()
    mock_conn_manager.get_stats = MagicMock(return_value={"active_connections": 0})

    with patch("ws_gateway.core.dependencies.get_settings", return_value=mock_settings), \
         patch("ws_gateway.core.dependencies.get_connection_manager", return_value=mock_conn_manager), \
         patch("ws_gateway.core.dependencies._circuit_breakers", {}):

        client = TestClient(app)
        response = client.get("/ws/metrics")

    assert response.status_code == 200
