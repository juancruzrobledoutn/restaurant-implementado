"""
ConnectionIndex — in-memory registry of all active WebSocket connections.

Indexing strategy:
  - _by_user[user_id] → connections (staff)
  - _by_branch[(tenant_id, branch_id)] → connections (for branch-wide broadcast)
  - _by_sector[(tenant_id, branch_id, sector_id)] → connections (waiter sector filter)
  - _by_session[session_id] → connections (diner)
  - _all → full set (for cleanup, revalidation)

Multi-tenant isolation is enforced by using (tenant_id, ...) tuples as keys.
A query for (tenant_id=1, branch_id=1) NEVER returns connections for
(tenant_id=2, branch_id=1).

Sharded Locks:
  get_tenant_branch_lock(tenant_id, branch_id) returns an asyncio.Lock per
  (tenant_id, branch_id) tuple stored in a WeakValueDictionary so unused
  locks are garbage-collected automatically.
"""
from __future__ import annotations

import asyncio
import weakref
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ws_gateway.components.connection.connection import Connection


class ConnectionIndex:
    """In-memory index for fast fan-out lookups."""

    def __init__(self) -> None:
        self._by_user: dict[int, set["Connection"]] = {}
        self._by_branch: dict[tuple[int, int], set["Connection"]] = {}
        self._by_sector: dict[tuple[int, int, int], set["Connection"]] = {}
        self._by_session: dict[int, set["Connection"]] = {}
        self._all: set["Connection"] = set()

        # Sharded locks: (tenant_id, branch_id) → asyncio.Lock
        # WeakValueDictionary allows GC when no code holds a reference
        self._branch_locks: weakref.WeakValueDictionary[
            tuple[int, int], asyncio.Lock
        ] = weakref.WeakValueDictionary()

    # ── Registration ──────────────────────────────────────────────────────────

    def register(self, conn: "Connection") -> None:
        """Add a connection to all relevant indexes."""
        self._all.add(conn)

        auth = conn.auth

        # User index (staff only)
        if auth.user_id is not None:
            self._by_user.setdefault(auth.user_id, set()).add(conn)

        # Branch indexes
        for branch_id in auth.branch_ids:
            key = (auth.tenant_id, branch_id)
            self._by_branch.setdefault(key, set()).add(conn)

            # Sector indexes (for waiters)
            for sector_id in auth.sector_ids:
                sector_key = (auth.tenant_id, branch_id, sector_id)
                self._by_sector.setdefault(sector_key, set()).add(conn)

        # Session index (diner only)
        if auth.session_id is not None:
            self._by_session.setdefault(auth.session_id, set()).add(conn)

    def unregister(self, conn: "Connection") -> None:
        """Remove a connection from all indexes."""
        self._all.discard(conn)

        auth = conn.auth

        if auth.user_id is not None:
            user_set = self._by_user.get(auth.user_id)
            if user_set:
                user_set.discard(conn)
                if not user_set:
                    del self._by_user[auth.user_id]

        for branch_id in auth.branch_ids:
            key = (auth.tenant_id, branch_id)
            branch_set = self._by_branch.get(key)
            if branch_set:
                branch_set.discard(conn)
                if not branch_set:
                    del self._by_branch[key]

            for sector_id in auth.sector_ids:
                sector_key = (auth.tenant_id, branch_id, sector_id)
                sector_set = self._by_sector.get(sector_key)
                if sector_set:
                    sector_set.discard(conn)
                    if not sector_set:
                        del self._by_sector[sector_key]

        if auth.session_id is not None:
            session_set = self._by_session.get(auth.session_id)
            if session_set:
                session_set.discard(conn)
                if not session_set:
                    del self._by_session[auth.session_id]

    # ── Queries ───────────────────────────────────────────────────────────────

    def get_by_branch(self, tenant_id: int, branch_id: int) -> frozenset["Connection"]:
        """Return all connections for a specific (tenant, branch) tuple."""
        key = (tenant_id, branch_id)
        return frozenset(self._by_branch.get(key, set()))

    def get_by_session(self, session_id: int) -> frozenset["Connection"]:
        """Return all diner connections for a session."""
        return frozenset(self._by_session.get(session_id, set()))

    def get_by_sector(
        self, tenant_id: int, branch_id: int, sector_id: int
    ) -> frozenset["Connection"]:
        """Return all connections for a specific sector."""
        key = (tenant_id, branch_id, sector_id)
        return frozenset(self._by_sector.get(key, set()))

    def get_by_user(self, user_id: int) -> frozenset["Connection"]:
        """Return all connections for a staff user."""
        return frozenset(self._by_user.get(user_id, set()))

    def count_total(self) -> int:
        """Total active connections across all tenants."""
        return len(self._all)

    def count_by_user(self, user_id: int) -> int:
        """Active connections for a specific user."""
        return len(self._by_user.get(user_id, set()))

    def get_all(self) -> frozenset["Connection"]:
        """Return all active connections (for cleanup sweeps)."""
        return frozenset(self._all)

    # ── Sharded Locks ─────────────────────────────────────────────────────────

    def get_tenant_branch_lock(self, tenant_id: int, branch_id: int) -> asyncio.Lock:
        """
        Return (or create) an asyncio.Lock for the given (tenant_id, branch_id) pair.

        Locks are stored in a WeakValueDictionary: when all coroutines that hold
        a strong reference to the lock complete, Python's GC reclaims the lock
        automatically — no stale lock accumulation.

        Usage:
            lock = index.get_tenant_branch_lock(tenant_id, branch_id)
            async with lock:
                # safe to mutate branch-scoped state
        """
        key = (tenant_id, branch_id)
        lock = self._branch_locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            self._branch_locks[key] = lock
        return lock
