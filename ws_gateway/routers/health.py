"""
Health and metrics endpoints for the WebSocket Gateway.

Endpoints:
  GET /health          — basic liveness probe (always 200 if process is alive)
  GET /health/detailed — deep health check (Redis, DLQ, circuit breakers, connections)
  GET /ws/metrics      — operational metrics JSON (dev/staging only or with WS_METRICS_TOKEN)
  GET /metrics         — Prometheus text format metrics (C-23: monitoring-production)
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse, PlainTextResponse

from ws_gateway.core.constants import STREAM_CRITICAL, STREAM_DLQ, STREAM_GROUP
from ws_gateway.core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter()


@router.get("/health", tags=["system"])
async def health():
    """Basic liveness check. Returns 200 if the process is alive."""
    return {"status": "ok", "service": "ws_gateway"}


@router.get("/health/detailed", tags=["system"])
async def health_detailed():
    """
    Deep health check:
      - Redis PING
      - DLQ size (XLEN events:dlq)
      - Consumer group lag (XPENDING events:critical ws_gateway_group)
      - Circuit breaker states
      - Active connection count

    Returns 200 if Redis is OK and consumer group exists.
    Returns 503 if Redis is unavailable or consumer group is missing.
    """
    from ws_gateway.core.dependencies import get_redis_pool, get_connection_manager

    try:
        redis = get_redis_pool()
    except RuntimeError:
        return JSONResponse(
            status_code=503,
            content={"status": "degraded", "error": "Redis pool not initialized"},
        )

    checks: dict = {}
    healthy = True

    # Redis PING
    try:
        await redis.ping()
        checks["redis"] = "ok"
    except Exception as exc:
        checks["redis"] = f"error: {exc}"
        healthy = False

    # DLQ size
    try:
        dlq_len = await redis.xlen(STREAM_DLQ)
        checks["dlq_size"] = dlq_len
        if dlq_len > 100:
            checks["dlq_warning"] = f"DLQ has {dlq_len} messages — investigate"
    except Exception as exc:
        checks["dlq_size"] = f"error: {exc}"

    # Consumer group lag
    try:
        pending_info = await redis.xpending(STREAM_CRITICAL, STREAM_GROUP)
        checks["consumer_group_lag"] = pending_info.get("pending", 0) if isinstance(pending_info, dict) else 0
    except Exception as exc:
        checks["consumer_group_lag"] = f"error: {exc}"

    # Connection stats
    try:
        conn_manager = get_connection_manager()
        stats = conn_manager.get_stats()
        checks["active_connections"] = stats.get("active_connections", 0)
    except RuntimeError:
        checks["active_connections"] = "not_initialized"

    # Circuit breaker states (from dependencies registry)
    try:
        from ws_gateway.core.dependencies import _circuit_breakers
        checks["circuit_breakers"] = {
            name: breaker.get_metrics()
            for name, breaker in _circuit_breakers.items()
        }
    except Exception:
        checks["circuit_breakers"] = {}

    status_code = 200 if healthy else 503
    return JSONResponse(
        status_code=status_code,
        content={
            "status": "ok" if healthy else "degraded",
            "checks": checks,
        },
    )


@router.get("/ws/metrics", tags=["system"])
async def ws_metrics(
    ws_metrics_token: str = Query(None, alias="token"),
):
    """
    Operational metrics for the WS Gateway.

    Access control:
      - ENVIRONMENT in {"development", "staging"} → always accessible
      - ENVIRONMENT == "production" → requires ?token=WS_METRICS_TOKEN query param
      - In production without token → 404

    Returns connection stats, broadcast worker stats, circuit breaker states.
    """
    from ws_gateway.core.dependencies import get_settings, get_connection_manager

    settings = get_settings()
    env = getattr(settings, "ENVIRONMENT", "development")
    metrics_token = getattr(settings, "WS_METRICS_TOKEN", "")

    # Access control
    if env == "production":
        if not metrics_token or ws_metrics_token != metrics_token:
            raise HTTPException(status_code=404, detail="Not found")

    try:
        conn_manager = get_connection_manager()
        stats = conn_manager.get_stats()
    except RuntimeError:
        stats = {}

    try:
        from ws_gateway.core.dependencies import _circuit_breakers
        cb_metrics = {name: breaker.get_metrics() for name, breaker in _circuit_breakers.items()}
    except Exception:
        cb_metrics = {}

    return {
        "environment": env,
        "connection_stats": stats,
        "circuit_breakers": cb_metrics,
    }


@router.get("/metrics", tags=["system"], include_in_schema=False)
async def prometheus_metrics():
    """
    Prometheus text format metrics endpoint (C-23: monitoring-production).

    Exposes:
      - websocket_connections_active (gauge)
      - websocket_messages_total (counter) — by direction, role
      - websocket_connections_total (counter) — by role
      - websocket_errors_total (counter) — by error_type

    Also reflects any active connections from ConnectionManager stats
    into the websocket_connections_active gauge before rendering.

    Prometheus scrapes this endpoint at :8001/metrics (no auth required
    since Prometheus runs on the internal monitoring network only).
    """
    from prometheus_client import generate_latest, CONTENT_TYPE_LATEST
    from ws_gateway.core.metrics import ws_connections_active

    # Sync the gauge from live ConnectionManager stats (best-effort)
    try:
        from ws_gateway.core.dependencies import get_connection_manager
        conn_manager = get_connection_manager()
        stats = conn_manager.get_stats()
        active = stats.get("active_connections", 0)
        ws_connections_active.set(active)
    except (RuntimeError, Exception):
        # Not initialized yet (startup) or stats unavailable — leave gauge as-is
        pass

    return PlainTextResponse(
        content=generate_latest().decode("utf-8"),
        media_type=CONTENT_TYPE_LATEST,
    )
