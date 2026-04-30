"""
ConnectionManager — facade for all connection-related operations.

Architecture (Composition Pattern):
  ConnectionManager delegates to 5 cohesive sub-components:
    1. ConnectionLifecycle  — accept/disconnect with lock ordering
    2. ConnectionIndex      — in-memory registry (by user, branch, sector, session)
    3. ConnectionBroadcaster — worker pool + fallback batch
    4. ConnectionCleanup    — stale/dead connection pruning
    5. ConnectionStats      — aggregated metrics

Lock ordering (canonical, anti-deadlock):
  All code that acquires multiple locks MUST follow this order:
    1. tenant_branch_lock(tenant_id, branch_id)   [coarsest]
    (additional per-user or per-connection locks not used in C-09)

The facade exposes one method per public action (connect, disconnect,
broadcast_to_branch, etc.) so WS endpoints interact with a single object.

Usage:
    manager = ConnectionManager(ConnectionManagerDependencies(...))
    conn = await manager.connect(websocket, auth, strategy)
    await manager.broadcast_to_branch(tenant_id=1, branch_id=2, message={...})
    await manager.disconnect(conn)
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from ws_gateway.core.logger import get_logger

if TYPE_CHECKING:
    from ws_gateway.components.auth.strategies import AuthResult, AuthStrategy
    from ws_gateway.components.connection.broadcaster import ConnectionBroadcaster
    from ws_gateway.components.connection.cleanup import ConnectionCleanup
    from ws_gateway.components.connection.connection import Connection
    from ws_gateway.components.connection.heartbeat import HeartbeatTracker
    from ws_gateway.components.connection.index import ConnectionIndex
    from ws_gateway.components.connection.lifecycle import ConnectionLifecycle
    from ws_gateway.components.connection.stats import ConnectionStats

logger = get_logger(__name__)


@dataclass
class ConnectionManagerDependencies:
    """Dependency container for ConnectionManager — injected at startup."""
    lifecycle: "ConnectionLifecycle"
    index: "ConnectionIndex"
    broadcaster: "ConnectionBroadcaster"
    cleanup: "ConnectionCleanup"
    stats: "ConnectionStats"
    heartbeat: "HeartbeatTracker"


class ConnectionManager:
    """
    Facade over all connection sub-components.

    Exposes a clean, high-level API to WS endpoints and event routers.
    All lock ordering is enforced inside the sub-components; this facade
    adds no additional locks.
    """

    def __init__(self, deps: ConnectionManagerDependencies) -> None:
        self._lifecycle = deps.lifecycle
        self._index = deps.index
        self._broadcaster = deps.broadcaster
        self._cleanup = deps.cleanup
        self._stats = deps.stats
        self._heartbeat = deps.heartbeat

    # ── Connection lifecycle ──────────────────────────────────────────────────

    async def connect(
        self,
        websocket,
        auth: "AuthResult",
        strategy: "AuthStrategy | None" = None,
    ) -> "Connection":
        """Accept a new WebSocket connection. Raises ConnectionRejectedError if rejected."""
        conn = await self._lifecycle.accept(websocket, auth, strategy)
        self._heartbeat.register(conn.connection_id)
        return conn

    async def disconnect(self, conn: "Connection", code: int = 1000) -> None:
        """Disconnect and clean up a connection."""
        self._heartbeat.unregister(conn.connection_id)
        await self._lifecycle.disconnect(conn, code=code)

    async def disconnect_all(self, code: int = 1001) -> None:
        """Disconnect all active connections (graceful shutdown)."""
        all_conns = list(self._index.get_all())
        logger.info("ConnectionManager: disconnecting all %d connections with code=%d", len(all_conns), code)
        import asyncio
        tasks = [self.disconnect(conn, code=code) for conn in all_conns if not conn.is_dead]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    # ── Broadcast methods ─────────────────────────────────────────────────────

    async def broadcast_to_branch(
        self, tenant_id: int, branch_id: int, message: dict
    ) -> None:
        """Send a message to all connections on a branch."""
        conns = self._index.get_by_branch(tenant_id, branch_id)
        await self._broadcaster.broadcast(conns, message)

    async def broadcast_to_session(self, session_id: int, message: dict) -> None:
        """Send a message to all diner connections for a session."""
        conns = self._index.get_by_session(session_id)
        await self._broadcaster.broadcast(conns, message)

    async def broadcast_to_sector(
        self, tenant_id: int, branch_id: int, sector_id: int, message: dict
    ) -> None:
        """Send a message to connections in a specific sector."""
        conns = self._index.get_by_sector(tenant_id, branch_id, sector_id)
        await self._broadcaster.broadcast(conns, message)

    async def broadcast_to_user(self, user_id: int, message: dict) -> None:
        """Send a message to all connections of a specific user."""
        conns = self._index.get_by_user(user_id)
        await self._broadcaster.broadcast(conns, message)

    async def broadcast_to_kitchen(
        self, tenant_id: int, branch_id: int, message: dict
    ) -> None:
        """
        Send a message to kitchen connections on a branch.
        Kitchen connections are those with KITCHEN role.
        """
        conns = frozenset(
            c for c in self._index.get_by_branch(tenant_id, branch_id)
            if "KITCHEN" in c.auth.roles
        )
        await self._broadcaster.broadcast(conns, message)

    async def broadcast_to_admin_only(
        self, tenant_id: int, branch_id: int, message: dict
    ) -> None:
        """Send to ADMIN/MANAGER connections only."""
        admin_roles = {"ADMIN", "MANAGER"}
        conns = frozenset(
            c for c in self._index.get_by_branch(tenant_id, branch_id)
            if set(c.auth.roles) & admin_roles
        )
        await self._broadcaster.broadcast(conns, message)

    # ── Heartbeat ─────────────────────────────────────────────────────────────

    def update_heartbeat(self, connection_id: str) -> None:
        """Update last-seen timestamp for a connection (called on every message)."""
        self._heartbeat.update(connection_id)

    # ── Stats ─────────────────────────────────────────────────────────────────

    def get_stats(self) -> dict:
        """Return a serializable stats snapshot for /ws/metrics."""
        return self._stats.snapshot()

    @property
    def index(self) -> "ConnectionIndex":
        """Expose the index for EventRouter fan-out."""
        return self._index
