"""
Prometheus metrics for the WebSocket Gateway (C-23: monitoring-production).

Metrics exposed at GET /metrics (Prometheus text format):

  websocket_connections_active (gauge)
    — Number of currently active WebSocket connections.
    — Labels: none (total across all roles).

  websocket_messages_total (counter)
    — Total WebSocket messages received from clients.
    — Labels: direction ("inbound" | "outbound"), role ("waiter" | "kitchen" | "admin" | "diner")

  websocket_connections_total (counter)
    — Cumulative WebSocket connections accepted since process start.
    — Labels: role

  websocket_errors_total (counter)
    — Total errors during WebSocket handling.
    — Labels: error_type

Usage:
    from ws_gateway.core.metrics import (
        ws_connections_active,
        ws_messages_total,
        ws_connections_total,
        ws_errors_total,
    )

    # On connection open:
    ws_connections_active.inc()
    ws_connections_total.labels(role="waiter").inc()

    # On message received:
    ws_messages_total.labels(direction="inbound", role="waiter").inc()

    # On connection close:
    ws_connections_active.dec()

    # On error:
    ws_errors_total.labels(error_type="auth_failed").inc()
"""
from prometheus_client import Counter, Gauge, REGISTRY  # noqa: F401

# ─── Gauges ──────────────────────────────────────────────────────────────────

ws_connections_active = Gauge(
    name="websocket_connections_active",
    documentation="Number of currently active WebSocket connections",
)

# ─── Counters ────────────────────────────────────────────────────────────────

ws_messages_total = Counter(
    name="websocket_messages_total",
    documentation="Total WebSocket messages by direction and role",
    labelnames=["direction", "role"],
)

ws_connections_total = Counter(
    name="websocket_connections_total",
    documentation="Total WebSocket connections accepted since process start, by role",
    labelnames=["role"],
)

ws_errors_total = Counter(
    name="websocket_errors_total",
    documentation="Total errors during WebSocket handling, by error type",
    labelnames=["error_type"],
)
