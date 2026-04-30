"""
RedisSubscriber — Redis Pub/Sub subscriber for best-effort event delivery.

Subscribes to channel patterns and delivers events to EventRouter.
Circuit breaker protects against Redis failures.
Reconnection uses DecorrelatedJitter backoff.

Channels (pattern subscriptions):
  - branch:*:waiters
  - branch:*:kitchen
  - branch:*:admin
  - sector:*:waiters
  - session:*

Required event schema (minimum fields):
  - event_type: str
  - tenant_id: int
  - branch_id: int
  - payload: dict
  - timestamp_ms: int

Events missing these fields are dropped with a warning.
"""
from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING

from ws_gateway.core.constants import PUBSUB_PATTERNS
from ws_gateway.core.logger import get_logger
from ws_gateway.components.resilience.backoff import DecorrelatedJitter

if TYPE_CHECKING:
    from ws_gateway.components.events.router import EventRouter
    from ws_gateway.components.resilience.circuit_breaker import CircuitBreaker

logger = get_logger(__name__)

REQUIRED_FIELDS = {"event_type", "tenant_id", "branch_id", "payload", "timestamp_ms"}


class RedisSubscriber:
    """
    Pub/Sub subscriber that delivers events to EventRouter.

    Args:
        redis_factory: Callable that creates a new Redis connection (for pubsub).
        event_router: EventRouter to deliver validated events.
        circuit_breaker: Optional CircuitBreaker to protect Redis calls.
        batch_window_ms: Time window (ms) to collect events for batch processing.
    """

    def __init__(
        self,
        redis_factory,
        event_router: "EventRouter",
        circuit_breaker: "CircuitBreaker | None" = None,
        batch_window_ms: float = 50.0,
    ) -> None:
        self._redis_factory = redis_factory
        self._router = event_router
        self._breaker = circuit_breaker
        self._batch_window_ms = batch_window_ms
        self._task: asyncio.Task | None = None
        self._running = False

    async def start(self) -> None:
        self._running = True
        self._task = asyncio.create_task(self._connect_loop(), name="redis_subscriber")
        logger.info("RedisSubscriber started")

    async def stop(self) -> None:
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("RedisSubscriber stopped")

    # ── Internal ──────────────────────────────────────────────────────────────

    async def _connect_loop(self) -> None:
        """Outer reconnection loop with DecorrelatedJitter backoff."""
        jitter = DecorrelatedJitter(base=1.0, cap=30.0)
        while self._running:
            try:
                if self._breaker and not self._breaker.can_execute():
                    delay = jitter.next_delay()
                    logger.warning(
                        "RedisSubscriber: circuit breaker OPEN, waiting %.1fs", delay
                    )
                    await asyncio.sleep(delay)
                    continue

                await self._subscribe_and_listen()
                if self._breaker:
                    self._breaker.record_success()
                jitter.reset()

            except asyncio.CancelledError:
                raise
            except Exception as exc:
                if self._breaker:
                    self._breaker.record_failure()
                delay = jitter.next_delay()
                logger.error(
                    "RedisSubscriber: connection failed (%s), retrying in %.1fs", exc, delay
                )
                if self._running:
                    await asyncio.sleep(delay)

    async def _subscribe_and_listen(self) -> None:
        """Connect, subscribe to patterns, and process messages."""
        redis = self._redis_factory()
        pubsub = redis.pubsub()
        try:
            await pubsub.psubscribe(*PUBSUB_PATTERNS)
            logger.info("RedisSubscriber: subscribed to %d patterns", len(PUBSUB_PATTERNS))
            await self._listen_loop(pubsub)
        finally:
            try:
                await pubsub.punsubscribe()
                await pubsub.aclose()
            except Exception:
                pass
            try:
                await redis.aclose()
            except Exception:
                pass

    async def _listen_loop(self, pubsub) -> None:
        """Inner message loop. Collects batches for parallel processing."""
        batch: list[dict] = []
        batch_start = asyncio.get_event_loop().time()

        async for raw in pubsub.listen():
            if not self._running:
                break

            if raw["type"] not in ("pmessage", "message"):
                continue

            event = self._parse_message(raw)
            if event is None:
                continue

            batch.append(event)
            elapsed_ms = (asyncio.get_event_loop().time() - batch_start) * 1000

            if elapsed_ms >= self._batch_window_ms:
                await self.process_event_batch(batch)
                batch = []
                batch_start = asyncio.get_event_loop().time()

        # Flush remaining batch
        if batch:
            await self.process_event_batch(batch)

    def _parse_message(self, raw: dict) -> dict | None:
        """Parse a raw Pub/Sub message. Returns None if invalid."""
        try:
            data = raw.get("data", "")
            if isinstance(data, bytes):
                data = data.decode("utf-8")
            event = json.loads(data)
        except (json.JSONDecodeError, AttributeError) as exc:
            logger.warning("RedisSubscriber: malformed message (not JSON): %s", exc)
            return None

        missing = REQUIRED_FIELDS - event.keys()
        if missing:
            logger.warning(
                "RedisSubscriber: event missing fields %s — dropping: %s",
                missing,
                str(event)[:200],
            )
            return None

        return event

    async def process_event_batch(self, events: list[dict]) -> None:
        """Process a batch of events in parallel."""
        if not events:
            return
        await asyncio.gather(
            *[self._route_one(e) for e in events],
            return_exceptions=True,
        )

    async def _route_one(self, event: dict) -> None:
        """Route one event to EventRouter, catching any routing errors."""
        try:
            await self._router.route(event)
        except Exception as exc:
            logger.error("RedisSubscriber: routing error for event %s: %s", event.get("event_type"), exc)
