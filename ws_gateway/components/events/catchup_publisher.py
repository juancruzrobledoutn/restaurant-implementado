"""
CatchupPublisher — persists events to Redis sorted sets for catch-up queries.

For each event processed by EventRouter:
  1. ZADD catchup:branch:{branch_id} {timestamp_ms} {event_json}
  2. ZREMRANGEBYRANK catchup:branch:{branch_id} 0 -101   (keep last 100)
  3. EXPIRE catchup:branch:{branch_id} 300

If event has a session_id:
  4. ZADD catchup:session:{session_id} {timestamp_ms} {event_json}
  5. ZREMRANGEBYRANK catchup:session:{session_id} 0 -101
  6. EXPIRE catchup:session:{session_id} 300

All operations are protected by the catchup_circuit_breaker.

Called by EventRouter.route() BEFORE broadcast — so events are stored
even if the WebSocket fan-out fails.
"""
from __future__ import annotations

import json
import time
from typing import TYPE_CHECKING

from ws_gateway.core.constants import (
    CATCHUP_BRANCH_KEY,
    CATCHUP_MAX_EVENTS,
    CATCHUP_SESSION_KEY,
    CATCHUP_TTL,
)
from ws_gateway.core.logger import get_logger

if TYPE_CHECKING:
    from ws_gateway.components.resilience.circuit_breaker import CircuitBreaker

logger = get_logger(__name__)


class CatchupPublisher:
    """
    Writes events to Redis sorted sets for HTTP catch-up endpoints.

    Args:
        redis: Async Redis client.
        circuit_breaker: Optional CircuitBreaker — skip Redis if OPEN.
    """

    def __init__(self, redis, circuit_breaker: "CircuitBreaker | None" = None) -> None:
        self._redis = redis
        self._breaker = circuit_breaker

    async def publish_for_catchup(self, event: dict) -> None:
        """
        Persist an event to the branch (and optionally session) catchup sorted set.

        Silently logs errors rather than raising — catch-up persistence failure
        must not interrupt the broadcast pipeline.
        """
        if self._breaker and not self._breaker.can_execute():
            logger.debug("CatchupPublisher: circuit breaker OPEN, skipping")
            return

        branch_id = event.get("branch_id")
        session_id = event.get("session_id")
        timestamp_ms = event.get("timestamp_ms") or int(time.time() * 1000)

        try:
            event_json = json.dumps(event, default=str)
        except (TypeError, ValueError) as exc:
            logger.error("CatchupPublisher: cannot serialize event: %s", exc)
            return

        try:
            await self._write_catchup(
                CATCHUP_BRANCH_KEY.format(branch_id), timestamp_ms, event_json
            )
            if session_id is not None:
                await self._write_catchup(
                    CATCHUP_SESSION_KEY.format(session_id), timestamp_ms, event_json
                )
            if self._breaker:
                self._breaker.record_success()
        except Exception as exc:
            if self._breaker:
                self._breaker.record_failure()
            logger.error("CatchupPublisher: Redis write failed: %s", exc)

    async def _write_catchup(self, key: str, score: int, value: str) -> None:
        """
        Atomic write to a catchup sorted set:
          ZADD key score value
          ZREMRANGEBYRANK key 0 -101   (keeps latest 100)
          EXPIRE key 300
        """
        pipe = self._redis.pipeline()
        pipe.zadd(key, {value: score})
        pipe.zremrangebyrank(key, 0, -(CATCHUP_MAX_EVENTS + 1))
        pipe.expire(key, CATCHUP_TTL)
        await pipe.execute()
