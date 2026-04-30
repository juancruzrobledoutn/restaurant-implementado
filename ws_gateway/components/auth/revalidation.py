"""
AuthRevalidator — background task that periodically re-checks connection tokens.

For each active connection the revalidator checks:
  - Is it time to revalidate? (now - last_revalidated_at > strategy.revalidation_interval)
  - If yes: call strategy.revalidate(auth_result).
  - If revalidation raises AuthError: close the connection with 4001.
  - If successful: update conn.last_revalidated_at.

The task runs as an asyncio background loop with configurable sweep interval.
"""
from __future__ import annotations

import asyncio
import time

from ws_gateway.core.logger import get_logger

logger = get_logger(__name__)


class AuthRevalidator:
    """
    Periodic token revalidation background task.

    Args:
        conn_index:   ConnectionIndex to iterate active connections.
        sweep_interval: Seconds between each sweep (default: 30).
    """

    def __init__(self, conn_index, sweep_interval: float = 30.0) -> None:
        self._index = conn_index
        self._sweep_interval = sweep_interval
        self._task: asyncio.Task | None = None
        self._running = False

    async def start(self) -> None:
        """Start the background revalidation loop."""
        self._running = True
        self._task = asyncio.create_task(self._loop(), name="auth_revalidator")
        logger.info("AuthRevalidator started (sweep_interval=%.0fs)", self._sweep_interval)

    async def stop(self) -> None:
        """Stop the revalidation loop gracefully."""
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("AuthRevalidator stopped")

    # ── Internal ──────────────────────────────────────────────────────────────

    async def _loop(self) -> None:
        while self._running:
            try:
                await self._sweep()
            except Exception as exc:
                logger.error("AuthRevalidator sweep error: %s", exc, exc_info=True)
            await asyncio.sleep(self._sweep_interval)

    async def _sweep(self) -> None:
        """Iterate all connections and revalidate stale ones."""
        from ws_gateway.components.auth.strategies import AuthError

        connections = list(self._index._all)
        now = time.monotonic()
        tasks = []

        for conn in connections:
            if conn.is_dead:
                continue
            if not hasattr(conn, "_strategy"):
                continue  # Connection without strategy (tests / misconfigured)

            last = conn.last_revalidated_at
            interval = conn._strategy.revalidation_interval
            if (now - last) >= interval:
                tasks.append(self._revalidate_one(conn, now))

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _revalidate_one(self, conn, now: float) -> None:
        """Revalidate a single connection. Close with 4001 on failure."""
        from ws_gateway.components.auth.strategies import AuthError
        from ws_gateway.core.constants import WSCloseCode

        try:
            new_auth = await conn._strategy.revalidate(conn.auth)
            # Update auth result (rebuild Connection-like update if needed)
            object.__setattr__(conn, "auth", new_auth)
            conn.last_revalidated_at = now
            logger.debug("Revalidated connection %s ok", conn.connection_id)
        except AuthError as exc:
            logger.warning(
                "Revalidation failed for connection %s: %s — closing with 4001",
                conn.connection_id,
                exc,
            )
            conn.mark_dead()
            try:
                await conn.websocket.close(code=WSCloseCode.AUTH_FAILED)
            except Exception:
                pass
        except Exception as exc:
            logger.error(
                "Unexpected revalidation error for connection %s: %s",
                conn.connection_id,
                exc,
                exc_info=True,
            )
