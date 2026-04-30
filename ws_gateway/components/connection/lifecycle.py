"""
ConnectionLifecycle — accept/disconnect with anti-deadlock lock ordering.

Lock ordering (CRITICAL — must match in every caller to prevent deadlocks):
  1. tenant_branch_lock(tenant_id, branch_id)  — coarsest grain (per branch)
  2. (user or diner lock omitted in this implementation — per-user locking not needed
     since count_by_user is protected by GIL in CPython)
  3. index registration (no additional lock needed — we hold tenant_branch_lock)

This ordering is documented here and in ConnectionManager. Any code that acquires
multiple locks MUST acquire them in this order.

Rejection codes (sent BEFORE websocket.accept()):
  - 4029: MAX_CONNECTIONS reached, MAX_CONNECTIONS_PER_USER reached, or user is abusive.
  - Auth failures are handled upstream (in the router) before calling accept().
"""
from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

from ws_gateway.core.constants import MAX_CONNECTIONS, MAX_CONNECTIONS_PER_USER, WSCloseCode
from ws_gateway.core.logger import get_logger

if TYPE_CHECKING:
    from ws_gateway.components.auth.strategies import AuthResult, AuthStrategy
    from ws_gateway.components.connection.connection import Connection
    from ws_gateway.components.connection.index import ConnectionIndex
    from ws_gateway.components.connection.rate_limiter import RateLimiter
    from ws_gateway.components.connection.stats import ConnectionStats

logger = get_logger(__name__)


class ConnectionLifecycle:
    """
    Manages the connect/disconnect lifecycle with locking and limit enforcement.

    Lock ordering (anti-deadlock contract):
      Always acquire tenant_branch_lock FIRST before modifying the index.
      Never acquire a finer-grained lock while holding a coarser one acquired
      in a different order elsewhere.
    """

    def __init__(
        self,
        index: "ConnectionIndex",
        rate_limiter: "RateLimiter",
        stats: "ConnectionStats",
    ) -> None:
        self._index = index
        self._rate_limiter = rate_limiter
        self._stats = stats

    async def accept(
        self,
        websocket,
        auth: "AuthResult",
        strategy: "AuthStrategy | None" = None,
    ) -> "Connection":
        """
        Accept a new WebSocket connection.

        Steps (in order):
          1. Check global connection cap (MAX_CONNECTIONS).
          2. Check per-user cap (MAX_CONNECTIONS_PER_USER).
          3. Check abusive flag in Redis.
          4. await websocket.accept() — HTTP 101 Switching Protocols.
          5. Acquire tenant_branch_lock for the primary branch.
          6. Register in ConnectionIndex.
          7. Update ConnectionStats.
          8. Return the Connection object.

        Raises:
          ConnectionRejectedError with close_code on any pre-accept rejection.
          The caller must NOT call websocket.accept() if this raises.
        """
        from ws_gateway.components.connection.connection import Connection

        # Step 1: global cap
        if self._index.count_total() >= MAX_CONNECTIONS:
            logger.warning("ConnectionLifecycle: global limit reached (%d)", MAX_CONNECTIONS)
            raise ConnectionRejectedError(
                "Global connection limit reached",
                close_code=WSCloseCode.RATE_LIMITED,
            )

        # Step 2: per-user cap
        user_id = auth.user_id if auth.user_id is not None else auth.diner_id
        if user_id is not None:
            user_count = self._index.count_by_user(user_id)
            if user_count >= MAX_CONNECTIONS_PER_USER:
                logger.warning(
                    "ConnectionLifecycle: user %s at limit (%d)", user_id, user_count
                )
                raise ConnectionRejectedError(
                    f"User {user_id} has reached max connections ({MAX_CONNECTIONS_PER_USER})",
                    close_code=WSCloseCode.RATE_LIMITED,
                )

        # Step 3: abusive check
        if user_id is not None and await self._rate_limiter.is_abusive(user_id):
            logger.warning("ConnectionLifecycle: user %s is flagged abusive", user_id)
            raise ConnectionRejectedError(
                f"User {user_id} is temporarily blocked",
                close_code=WSCloseCode.RATE_LIMITED,
            )

        # Step 4: accept the WebSocket
        await websocket.accept()

        # Step 5-6: acquire lock and register
        conn = Connection(websocket=websocket, auth=auth, _strategy=strategy)
        tenant_id = auth.tenant_id
        primary_branch = auth.branch_ids[0] if auth.branch_ids else 0

        lock = self._index.get_tenant_branch_lock(tenant_id, primary_branch)
        async with lock:
            self._index.register(conn)

        # Step 7: update stats
        self._stats.connection_opened()

        logger.info(
            "ConnectionLifecycle: accepted connection_id=%s user=%s tenant=%s",
            conn.connection_id, user_id, tenant_id,
        )
        return conn

    async def disconnect(
        self,
        conn: "Connection",
        code: int = WSCloseCode.NORMAL,
    ) -> None:
        """
        Disconnect a connection gracefully.

        Steps (reverse of accept):
          1. Mark connection as dead.
          2. Acquire tenant_branch_lock.
          3. Unregister from ConnectionIndex.
          4. Update ConnectionStats.
          5. Close the WebSocket with the given code.
        """
        if conn.is_dead:
            # Already disconnected — avoid duplicate close
            return

        conn.mark_dead()

        tenant_id = conn.auth.tenant_id
        primary_branch = conn.auth.branch_ids[0] if conn.auth.branch_ids else 0

        lock = self._index.get_tenant_branch_lock(tenant_id, primary_branch)
        async with lock:
            self._index.unregister(conn)

        self._stats.connection_closed()

        try:
            await conn.websocket.close(code=code)
        except Exception as exc:
            logger.debug(
                "ConnectionLifecycle: close() raised for connection_id=%s: %s",
                conn.connection_id,
                exc,
            )

        logger.info(
            "ConnectionLifecycle: closed connection_id=%s code=%d",
            conn.connection_id,
            code,
        )


class ConnectionRejectedError(Exception):
    """Raised by ConnectionLifecycle.accept() when a connection must be denied."""

    def __init__(self, message: str, close_code: int = WSCloseCode.RATE_LIMITED) -> None:
        super().__init__(message)
        self.close_code = close_code
