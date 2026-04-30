"""
Connection — dataclass representing a single active WebSocket connection.

Each instance is created by ConnectionLifecycle.accept() and lives until
ConnectionLifecycle.disconnect() is called (or the connection drops).

The `auth` field is the verified AuthResult from the authentication strategy.
It is the source of truth for tenant_id, roles, branch_ids, etc. throughout
the connection's lifetime.
"""
from __future__ import annotations

import uuid
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ws_gateway.components.auth.strategies import AuthResult, AuthStrategy


@dataclass
class Connection:
    """
    Represents one active WebSocket connection.

    Fields:
        websocket:             The starlette WebSocket object.
        auth:                  Verified identity from the auth strategy.
        connection_id:         Unique UUID4 string — stable for the connection's lifetime.
        opened_at:             time.monotonic() timestamp of connection acceptance.
        last_revalidated_at:   time.monotonic() timestamp of last token revalidation.
        is_dead:               True if the connection is closing or has failed.
        _strategy:             The AuthStrategy used to authenticate this connection.
                               Used by AuthRevalidator for periodic revalidation.
    """
    websocket: object
    auth: "AuthResult"
    connection_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    opened_at: float = field(default_factory=time.monotonic)
    last_revalidated_at: float = field(default_factory=time.monotonic)
    is_dead: bool = False
    _strategy: "AuthStrategy | None" = field(default=None, repr=False)

    def mark_dead(self) -> None:
        """Mark this connection as dead. Thread-safe (single GIL write)."""
        self.is_dead = True

    def __hash__(self) -> int:
        return hash(self.connection_id)

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Connection):
            return NotImplemented
        return self.connection_id == other.connection_id
