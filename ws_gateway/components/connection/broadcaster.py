"""
ConnectionBroadcaster — Worker Pool pattern for fan-out WebSocket broadcasts.

Architecture:
  - 10 permanent worker coroutines consume from an asyncio.Queue(maxsize=5000).
  - Each worker sends one message at a time with a 5s timeout.
  - If send times out or fails → mark connection dead, record failure.
  - If queue is full (backpressure) → fallback batch mode with asyncio.gather
    in chunks of 50, logging a warning.

BroadcastObserver collects per-worker metrics and feeds ConnectionStats.
"""
from __future__ import annotations

import asyncio
import json
import time
from typing import TYPE_CHECKING

from ws_gateway.core.constants import (
    BROADCAST_BATCH_SIZE,
    BROADCAST_QUEUE_SIZE,
    BROADCAST_SEND_TIMEOUT,
    BROADCAST_WORKERS,
)
from ws_gateway.core.logger import get_logger

if TYPE_CHECKING:
    from ws_gateway.components.connection.connection import Connection
    from ws_gateway.components.connection.stats import ConnectionStats

logger = get_logger(__name__)


# ── BroadcastObserver ─────────────────────────────────────────────────────────

class BroadcastObserver:
    """Collects broadcast metrics per worker and feeds ConnectionStats."""

    def __init__(self, stats: "ConnectionStats | None" = None) -> None:
        self._stats = stats
        self._worker_metrics: dict[str, dict] = {}

    def record_success(self, worker_id: str, latency_ms: float) -> None:
        wm = self._worker_metrics.setdefault(worker_id, {"sent": 0, "failed": 0})
        wm["sent"] += 1
        if self._stats:
            self._stats.message_sent()
            self._stats.record_latency(latency_ms)

    def record_failure(self, worker_id: str, reason: str) -> None:
        wm = self._worker_metrics.setdefault(worker_id, {"sent": 0, "failed": 0})
        wm["failed"] += 1
        if self._stats:
            self._stats.message_failed()
        logger.warning("Broadcaster worker=%s failure: %s", worker_id, reason)

    def get_stats(self) -> dict:
        return dict(self._worker_metrics)


# ── ConnectionBroadcaster ─────────────────────────────────────────────────────

class ConnectionBroadcaster:
    """
    Worker pool broadcaster.

    Args:
        observer: BroadcastObserver for metrics.
        n_workers: Number of parallel worker coroutines (default: 10).
        queue_size: asyncio.Queue maxsize (default: 5000).
    """

    def __init__(
        self,
        observer: "BroadcastObserver | None" = None,
        n_workers: int = BROADCAST_WORKERS,
        queue_size: int = BROADCAST_QUEUE_SIZE,
    ) -> None:
        self._observer = observer or BroadcastObserver()
        self._n_workers = n_workers
        self._queue: asyncio.Queue = asyncio.Queue(maxsize=queue_size)
        self._workers: list[asyncio.Task] = []
        self._running = False

    async def start_workers(self, n: int | None = None) -> None:
        """Start background worker coroutines."""
        count = n or self._n_workers
        self._running = True
        for i in range(count):
            task = asyncio.create_task(
                self._worker_loop(f"worker-{i}"),
                name=f"broadcaster_worker_{i}",
            )
            self._workers.append(task)
        logger.info("ConnectionBroadcaster: started %d workers", count)

    async def stop_workers(self, timeout: float = 5.0) -> None:
        """
        Graceful shutdown: stop accepting new items, drain the queue, cancel workers.
        """
        self._running = False
        # Signal all workers to exit by sending sentinel values
        for _ in self._workers:
            try:
                self._queue.put_nowait(None)  # Sentinel
            except asyncio.QueueFull:
                pass

        # Wait for workers to drain
        try:
            await asyncio.wait_for(
                asyncio.gather(*self._workers, return_exceptions=True),
                timeout=timeout,
            )
        except asyncio.TimeoutError:
            logger.warning("ConnectionBroadcaster: workers did not drain in %.1fs, cancelling", timeout)
            for t in self._workers:
                t.cancel()

        self._workers.clear()
        logger.info("ConnectionBroadcaster: all workers stopped")

    def enqueue(self, connection: "Connection", message: dict) -> bool:
        """
        Try to enqueue a single (connection, message) pair.

        Returns True if enqueued, False if the queue is full.
        """
        try:
            self._queue.put_nowait((connection, message))
            return True
        except asyncio.QueueFull:
            return False

    async def broadcast(self, connections: "frozenset | set", message: dict) -> None:
        """
        Fan-out a message to all connections.

        Primary path: enqueue each connection.
        Fallback: if queue is full, use _broadcast_batch directly.
        """
        if not connections:
            return

        overflowed: list["Connection"] = []
        for conn in connections:
            if conn.is_dead:
                continue
            if not self.enqueue(conn, message):
                overflowed.append(conn)

        if overflowed:
            logger.warning(
                "ConnectionBroadcaster: queue full, %d connections falling back to batch mode",
                len(overflowed),
            )
            await self._broadcast_batch(overflowed, message)

    # ── Internal ──────────────────────────────────────────────────────────────

    async def _worker_loop(self, worker_id: str) -> None:
        """Permanent worker that processes (connection, message) pairs."""
        while True:
            try:
                item = await asyncio.wait_for(self._queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                if not self._running:
                    break  # Exit only after timeout when not running (queue drained)
                continue

            if item is None:  # Sentinel → shutdown
                self._queue.task_done()
                break

            conn, msg = item
            if conn.is_dead:
                self._queue.task_done()
                continue

            await self._send_one(conn, msg, worker_id)
            self._queue.task_done()

    async def _send_one(self, conn: "Connection", message: dict, worker_id: str) -> None:
        """Send a single message to a connection with timeout."""
        start = time.monotonic()
        try:
            await asyncio.wait_for(
                conn.websocket.send_text(json.dumps(message)),
                timeout=BROADCAST_SEND_TIMEOUT,
            )
            latency_ms = (time.monotonic() - start) * 1000
            self._observer.record_success(worker_id, latency_ms)
        except asyncio.TimeoutError:
            conn.mark_dead()
            self._observer.record_failure(worker_id, "send_timeout")
        except Exception as exc:
            conn.mark_dead()
            self._observer.record_failure(worker_id, str(exc))

    async def _broadcast_batch(
        self, connections: "list[Connection]", message: dict
    ) -> None:
        """Fallback batch broadcast using asyncio.gather in chunks of BROADCAST_BATCH_SIZE."""
        worker_id = "batch_fallback"

        def chunks(lst, n):
            for i in range(0, len(lst), n):
                yield lst[i : i + n]

        for chunk in chunks(connections, BROADCAST_BATCH_SIZE):
            results = await asyncio.gather(
                *[self._send_one(c, message, worker_id) for c in chunk],
                return_exceptions=True,
            )
            for r in results:
                if isinstance(r, Exception):
                    logger.error("Batch broadcast error: %s", r)
