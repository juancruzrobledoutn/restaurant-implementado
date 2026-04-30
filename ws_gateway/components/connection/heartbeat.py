"""
HeartbeatTracker — tracks the last activity time per connection.

Protocol:
  - Client sends {"type": "ping"} every HEARTBEAT_INTERVAL (30s) seconds.
  - Server responds {"type": "pong"}.
  - ANY message (not just ping) resets the timer.
  - If no message in HEARTBEAT_TIMEOUT (60s) → connection is stale.
  - ConnectionCleanup calls cleanup_stale() every CLEANUP_INTERVAL (60s).

Data structure:
  _last_seen: dict[connection_id, float]  (time.monotonic() timestamps)
"""
from __future__ import annotations

import time

from ws_gateway.core.constants import HEARTBEAT_TIMEOUT
from ws_gateway.core.logger import get_logger

logger = get_logger(__name__)


class HeartbeatTracker:
    """Tracks last-seen timestamps for WebSocket connections."""

    def __init__(self) -> None:
        self._last_seen: dict[str, float] = {}

    def register(self, connection_id: str) -> None:
        """Register a new connection with the current time."""
        self._last_seen[connection_id] = time.monotonic()

    def unregister(self, connection_id: str) -> None:
        """Remove a connection from tracking (called on disconnect)."""
        self._last_seen.pop(connection_id, None)

    def update(self, connection_id: str) -> None:
        """Reset the timer for a connection. Called on every incoming message."""
        self._last_seen[connection_id] = time.monotonic()

    def is_stale(self, connection_id: str, timeout: float = HEARTBEAT_TIMEOUT) -> bool:
        """
        Return True if no message was received within `timeout` seconds.

        Returns True (stale) if the connection_id is not tracked at all.
        """
        last = self._last_seen.get(connection_id)
        if last is None:
            return True
        return (time.monotonic() - last) >= timeout

    def cleanup_stale(self, timeout: float = HEARTBEAT_TIMEOUT) -> list[str]:
        """
        Return a list of connection_ids that haven't sent a message in `timeout` seconds.

        The caller is responsible for closing these connections and calling unregister().
        This method only identifies stale connections — it does NOT remove them from
        _last_seen (to avoid mutation-during-iteration issues).
        """
        now = time.monotonic()
        stale = [
            conn_id
            for conn_id, last in self._last_seen.items()
            if (now - last) >= timeout
        ]
        if stale:
            logger.info("HeartbeatTracker: found %d stale connections", len(stale))
        return stale
