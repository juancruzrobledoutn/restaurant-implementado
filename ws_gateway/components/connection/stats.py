"""
ConnectionStats — aggregated metrics for the WebSocket Gateway.

Consumed by:
  - GET /health/detailed (Redis + DLQ + circuit breaker states)
  - GET /ws/metrics (full stats — dev/staging only)
  - BroadcastObserver (writes latency samples)

All counters are incremented atomically via the GIL (single-process, async).
No locking needed for the simple int counters in CPython.
"""
from __future__ import annotations

import math
import time
from collections import deque


class ConnectionStats:
    """Live operational metrics for the WS Gateway instance."""

    def __init__(self) -> None:
        self.active_connections: int = 0
        self.total_connections_opened: int = 0
        self.total_connections_closed: int = 0
        self.messages_sent: int = 0
        self.messages_failed: int = 0

        # Circuit breaker states — dict[resource_name → state_str]
        self.circuit_breaker_states: dict[str, str] = {}

        # Worker pool stats — dict[worker_id → dict]
        self.worker_pool_stats: dict[str, dict] = {}

        # Broadcast latency samples (rolling window, last 1000 samples)
        self._latency_samples: deque[float] = deque(maxlen=1000)

    # ── Counters ──────────────────────────────────────────────────────────────

    def connection_opened(self) -> None:
        self.active_connections += 1
        self.total_connections_opened += 1

    def connection_closed(self) -> None:
        if self.active_connections > 0:
            self.active_connections -= 1
        self.total_connections_closed += 1

    def message_sent(self) -> None:
        self.messages_sent += 1

    def message_failed(self) -> None:
        self.messages_failed += 1

    def record_latency(self, latency_ms: float) -> None:
        """Record a broadcast latency sample (milliseconds)."""
        self._latency_samples.append(latency_ms)

    # ── Computed metrics ──────────────────────────────────────────────────────

    @property
    def broadcast_latency_p95(self) -> float | None:
        """95th percentile broadcast latency in ms. None if no samples."""
        if not self._latency_samples:
            return None
        sorted_samples = sorted(self._latency_samples)
        idx = int(math.ceil(0.95 * len(sorted_samples))) - 1
        return sorted_samples[max(0, idx)]

    # ── Snapshot ──────────────────────────────────────────────────────────────

    def snapshot(self) -> dict:
        """Return a JSON-serializable snapshot for health/metrics endpoints."""
        return {
            "active_connections": self.active_connections,
            "total_connections_opened": self.total_connections_opened,
            "total_connections_closed": self.total_connections_closed,
            "messages_sent": self.messages_sent,
            "messages_failed": self.messages_failed,
            "broadcast_latency_p95_ms": self.broadcast_latency_p95,
            "circuit_breaker_states": dict(self.circuit_breaker_states),
            "worker_pool_stats": dict(self.worker_pool_stats),
        }
