"""
ConnectionCleanup — background task for periodic stale/dead connection pruning.

Runs every CLEANUP_INTERVAL seconds and:
  1. Asks HeartbeatTracker.cleanup_stale() for stale connection IDs.
  2. Closes those connections with SERVER_ERROR (1011).
  3. Removes connections marked is_dead=True from the ConnectionIndex.
  4. Purges orphaned locks (WeakValueDictionary does this automatically via GC).
"""
from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

from ws_gateway.core.constants import CLEANUP_INTERVAL, WSCloseCode
from ws_gateway.core.logger import get_logger

if TYPE_CHECKING:
    from ws_gateway.components.connection.index import ConnectionIndex
    from ws_gateway.components.connection.heartbeat import HeartbeatTracker
    from ws_gateway.components.connection.lifecycle import ConnectionLifecycle

logger = get_logger(__name__)


class ConnectionCleanup:
    """Background cleanup task."""

    def __init__(
        self,
        index: "ConnectionIndex",
        heartbeat: "HeartbeatTracker",
        lifecycle: "ConnectionLifecycle",
        interval: float = CLEANUP_INTERVAL,
    ) -> None:
        self._index = index
        self._heartbeat = heartbeat
        self._lifecycle = lifecycle
        self._interval = interval
        self._task: asyncio.Task | None = None
        self._running = False

    async def start(self) -> None:
        self._running = True
        self._task = asyncio.create_task(self._loop(), name="connection_cleanup")
        logger.info("ConnectionCleanup started (interval=%.0fs)", self._interval)

    async def stop(self) -> None:
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("ConnectionCleanup stopped")

    async def _loop(self) -> None:
        while self._running:
            try:
                await self._sweep()
            except Exception as exc:
                logger.error("ConnectionCleanup sweep error: %s", exc, exc_info=True)
            await asyncio.sleep(self._interval)

    async def _sweep(self) -> None:
        """Run one cleanup sweep."""
        await self._close_stale_connections()
        self._remove_dead_connections()

    async def _close_stale_connections(self) -> None:
        """Close connections that haven't sent any message within HEARTBEAT_TIMEOUT."""
        stale_ids = self._heartbeat.cleanup_stale()
        if not stale_ids:
            return

        stale_set = set(stale_ids)
        all_conns = self._index.get_all()
        to_close = [c for c in all_conns if c.connection_id in stale_set]

        logger.info("ConnectionCleanup: closing %d stale connections", len(to_close))
        tasks = [
            self._lifecycle.disconnect(conn, code=WSCloseCode.SERVER_ERROR)
            for conn in to_close
            if not conn.is_dead
        ]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

        for conn_id in stale_ids:
            self._heartbeat.unregister(conn_id)

    def _remove_dead_connections(self) -> None:
        """Remove connections already marked dead from the index (without closing)."""
        dead_conns = [c for c in list(self._index._all) if c.is_dead]
        for conn in dead_conns:
            try:
                self._index.unregister(conn)
            except Exception as exc:
                logger.debug("ConnectionCleanup: unregister error for %s: %s", conn.connection_id, exc)

        if dead_conns:
            logger.debug("ConnectionCleanup: removed %d dead connections from index", len(dead_conns))
