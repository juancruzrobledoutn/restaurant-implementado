"""
StreamConsumer — Redis Streams consumer group for critical event delivery.

Message lifecycle (CRITICAL — documented here as the canonical reference):
  1. XREADGROUP reads up to STREAM_READ_COUNT messages with BLOCK 100ms.
  2. For each message: parse JSON → EventRouter.route()
  3. On success: XACK events:critical ws_gateway_group msg_id
                 XDEL events:critical msg_id
  4. On failure: do NOT ACK — message stays pending for retry.
  5. Every STREAM_AUTOCLAIM_INTERVAL seconds: XAUTOCLAIM reclaims messages
     pending more than STREAM_AUTOCLAIM_MIN_IDLE_MS from crashed consumers.
  6. If delivery_count > STREAM_MAX_DELIVERIES (3):
     XADD events:dlq * payload {...} reason {...}
     XACK events:critical ws_gateway_group msg_id
     XDEL events:critical msg_id
     (message moves to DLQ instead of being retried indefinitely)

Circuit breaker (stream_circuit_breaker) is SEPARATE from the Pub/Sub breaker.
A Redis Streams failure does not trip the Pub/Sub circuit and vice versa.

Note: StreamConsumer tests require REAL Redis 7+ (XAUTOCLAIM not in fakeredis).
"""
from __future__ import annotations

import asyncio
import json
import time
import uuid
from typing import TYPE_CHECKING

from ws_gateway.core.constants import (
    STREAM_AUTOCLAIM_COUNT,
    STREAM_AUTOCLAIM_INTERVAL,
    STREAM_AUTOCLAIM_MIN_IDLE_MS,
    STREAM_BLOCK_MS,
    STREAM_CRITICAL,
    STREAM_DLQ,
    STREAM_GROUP,
    STREAM_MAX_DELIVERIES,
    STREAM_READ_COUNT,
)
from ws_gateway.core.logger import get_logger
from ws_gateway.components.resilience.backoff import DecorrelatedJitter

if TYPE_CHECKING:
    from ws_gateway.components.events.router import EventRouter
    from ws_gateway.components.resilience.circuit_breaker import CircuitBreaker

logger = get_logger(__name__)


class StreamConsumer:
    """
    Redis Streams consumer group reader.

    Args:
        redis: Async Redis client (aioredis).
        event_router: EventRouter for dispatching messages.
        circuit_breaker: Optional CircuitBreaker protecting Redis calls.
        consumer_id: Unique ID for this consumer (default: uuid4).
        stream_name: Stream to read (default: events:critical).
        group_name: Consumer group name (default: ws_gateway_group).
    """

    def __init__(
        self,
        redis,
        event_router: "EventRouter",
        circuit_breaker: "CircuitBreaker | None" = None,
        consumer_id: str | None = None,
        stream_name: str = STREAM_CRITICAL,
        group_name: str = STREAM_GROUP,
    ) -> None:
        self._redis = redis
        self._router = event_router
        self._breaker = circuit_breaker
        self._consumer_id = consumer_id or f"consumer-{uuid.uuid4()}"
        self._stream = stream_name
        self._group = group_name
        self._task: asyncio.Task | None = None
        self._autoclaim_task: asyncio.Task | None = None
        self._running = False

    async def start(self) -> None:
        """Create consumer group (if not exists) and start read + autoclaim loops."""
        await self._create_group()
        self._running = True
        self._task = asyncio.create_task(self._read_loop(), name="stream_consumer_read")
        self._autoclaim_task = asyncio.create_task(
            self._autoclaim_loop(), name="stream_consumer_autoclaim"
        )
        logger.info(
            "StreamConsumer started: stream=%s group=%s consumer=%s",
            self._stream, self._group, self._consumer_id,
        )

    async def stop(self) -> None:
        """Stop the consumer. Pending ACKs are NOT flushed (re-claimed on next start)."""
        self._running = False
        for task in [self._task, self._autoclaim_task]:
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        logger.info("StreamConsumer stopped: consumer=%s", self._consumer_id)

    # ── Internal ──────────────────────────────────────────────────────────────

    async def _create_group(self) -> None:
        """Create the consumer group if it doesn't already exist."""
        try:
            await self._redis.xgroup_create(
                self._stream, self._group, id="$", mkstream=True
            )
            logger.info("StreamConsumer: created group %s on %s", self._group, self._stream)
        except Exception as exc:
            error_msg = str(exc).lower()
            if "busygroup" in error_msg:
                logger.debug("StreamConsumer: group %s already exists", self._group)
            else:
                logger.error("StreamConsumer: could not create group: %s", exc)

    async def _read_loop(self) -> None:
        """Main read loop: XREADGROUP → route → ACK/DLQ."""
        jitter = DecorrelatedJitter(base=0.1, cap=5.0)
        while self._running:
            try:
                if self._breaker and not self._breaker.can_execute():
                    await asyncio.sleep(jitter.next_delay())
                    continue

                messages = await self._redis.xreadgroup(
                    groupname=self._group,
                    consumername=self._consumer_id,
                    streams={self._stream: ">"},
                    count=STREAM_READ_COUNT,
                    block=STREAM_BLOCK_MS,
                )

                if messages:
                    if self._breaker:
                        self._breaker.record_success()
                    jitter.reset()
                    for stream_name, entries in messages:
                        for msg_id, fields in entries:
                            await self._process_message(msg_id, fields)

            except asyncio.CancelledError:
                raise
            except Exception as exc:
                if self._breaker:
                    self._breaker.record_failure()
                delay = jitter.next_delay()
                logger.error(
                    "StreamConsumer: read error (%s), retrying in %.1fs", exc, delay
                )
                if self._running:
                    await asyncio.sleep(delay)

    async def _autoclaim_loop(self) -> None:
        """Periodic XAUTOCLAIM to reclaim stale pending messages from dead consumers."""
        while self._running:
            await asyncio.sleep(STREAM_AUTOCLAIM_INTERVAL)
            if not self._running:
                break
            try:
                await self._autoclaim()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.error("StreamConsumer: autoclaim error: %s", exc)

    async def _autoclaim(self) -> None:
        """Run XAUTOCLAIM to reclaim messages idle > STREAM_AUTOCLAIM_MIN_IDLE_MS."""
        try:
            result = await self._redis.xautoclaim(
                self._stream,
                self._group,
                self._consumer_id,
                STREAM_AUTOCLAIM_MIN_IDLE_MS,
                "0-0",
                count=STREAM_AUTOCLAIM_COUNT,
            )
            # result format depends on Redis version: (next_id, entries, [deleted_ids])
            entries = result[1] if isinstance(result, (list, tuple)) and len(result) > 1 else []
            if entries:
                logger.info("StreamConsumer: XAUTOCLAIM reclaimed %d messages", len(entries))
                for msg_id, fields in entries:
                    await self._process_message(msg_id, fields)
        except Exception as exc:
            logger.error("StreamConsumer: XAUTOCLAIM failed: %s", exc)

    async def _process_message(self, msg_id: str, fields: dict) -> None:
        """
        Process a single stream message.

        On success: XACK + XDEL
        On permanent failure (delivery_count > max): move to DLQ + XACK + XDEL
        On transient failure: do nothing (leave pending for re-claim)
        """
        # Parse payload
        try:
            payload_str = fields.get("payload") or fields.get(b"payload", "")
            if isinstance(payload_str, bytes):
                payload_str = payload_str.decode("utf-8")
            event = json.loads(payload_str)
        except (json.JSONDecodeError, AttributeError) as exc:
            logger.error("StreamConsumer: malformed message %s: %s", msg_id, exc)
            # Treat as permanent failure → DLQ
            await self._move_to_dlq(msg_id, fields, reason=f"malformed_json: {exc}")
            return

        # Check delivery count
        delivery_count = await self._get_delivery_count(msg_id)
        if delivery_count > STREAM_MAX_DELIVERIES:
            logger.warning(
                "StreamConsumer: message %s exceeded max deliveries (%d) → DLQ",
                msg_id, STREAM_MAX_DELIVERIES,
            )
            await self._move_to_dlq(msg_id, fields, reason="max_deliveries_exceeded")
            return

        # Route the event
        try:
            await self._router.route(event)
            # Success: ACK + DEL
            await self._redis.xack(self._stream, self._group, msg_id)
            await self._redis.xdel(self._stream, msg_id)
            logger.debug("StreamConsumer: processed and ACKed %s", msg_id)
        except Exception as exc:
            logger.error(
                "StreamConsumer: routing failed for message %s: %s (will retry)",
                msg_id, exc,
            )
            # Do NOT ACK — message stays pending for re-delivery

    async def _get_delivery_count(self, msg_id: str) -> int:
        """Get the delivery count for a pending message from XPENDING."""
        try:
            pending = await self._redis.xpending_range(
                self._stream, self._group,
                min=msg_id, max=msg_id, count=1,
            )
            if pending:
                return pending[0].get("times_delivered", 0)
            return 0
        except Exception:
            return 0

    async def _move_to_dlq(self, msg_id: str, fields: dict, reason: str) -> None:
        """Move a message to the Dead Letter Queue and remove from main stream."""
        try:
            dlq_payload = {
                "original_msg_id": msg_id,
                "stream": self._stream,
                "fields": {k.decode() if isinstance(k, bytes) else k: v.decode() if isinstance(v, bytes) else v
                           for k, v in fields.items()},
                "reason": reason,
                "moved_at": int(time.time() * 1000),
            }
            await self._redis.xadd(STREAM_DLQ, {"payload": json.dumps(dlq_payload)})
            await self._redis.xack(self._stream, self._group, msg_id)
            await self._redis.xdel(self._stream, msg_id)
            logger.info("StreamConsumer: moved %s to DLQ (reason: %s)", msg_id, reason)
        except Exception as exc:
            logger.error("StreamConsumer: failed to move %s to DLQ: %s", msg_id, exc)
