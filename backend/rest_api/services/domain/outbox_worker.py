"""
OutboxWorker — background task that publishes pending OutboxEvent rows.

Architecture (C-10 D-07 — first real producer of outbox events):
  - Runs in-process inside rest_api's FastAPI lifespan.
  - Polls `outbox_event` where processed_at IS NULL.
  - Publishes each event to Redis via shared.infrastructure.events.publish_event.
  - Marks processed_at = now() on success.
  - On publish failure, leaves processed_at = NULL so the next poll retries.

Lifecycle:
  - start_worker(app): creates the asyncio Task stored on app.state.outbox_task.
  - stop_worker(app): sets app.state.outbox_stop = True and awaits the task
    (up to 10s) so any in-flight batch completes before returning.

Rules:
  - NEVER commit inside write_event — OutboxService already enforces this.
  - The worker OWNS its own commit per processed row (or per batch).
  - A worker crash MUST NOT delete the REST API — lifespan wraps start in
    try/except and logs errors without re-raising.
  - Single-instance assumption — multi-instance horizontal scaling would
    require a PostgreSQL advisory lock (deferred; documented in design.md §Risks).
"""
from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Awaitable, Callable

from fastapi import FastAPI
from sqlalchemy import select

from shared.config.logging import get_logger
from shared.config.settings import settings
from shared.infrastructure.db import SessionLocal, safe_commit
from shared.infrastructure.events import publish_event
from rest_api.models.outbox import OutboxEvent

logger = get_logger(__name__)


# Type alias — the publisher is async callable (event_type, payload) -> None.
# The default is shared.infrastructure.events.publish_event, but tests can inject
# a mock to avoid real Redis I/O.
OutboxPublisher = Callable[[str, dict], Awaitable[None]]


async def _process_batch(
    publisher: OutboxPublisher,
    batch_size: int,
) -> int:
    """
    Process a single batch of pending outbox events.

    Returns the number of events successfully published and marked processed.
    A row whose publish call raises is left with processed_at=NULL so the next
    batch retries it.
    """
    processed = 0
    async with SessionLocal() as db:
        # FOR UPDATE SKIP LOCKED prevents two worker instances from picking the
        # same row — safe even if horizontal scaling arrives. On SQLite (tests),
        # SKIP LOCKED is ignored — behaviour stays correct under single-instance.
        stmt = (
            select(OutboxEvent)
            .where(OutboxEvent.processed_at.is_(None))
            .order_by(OutboxEvent.created_at.asc(), OutboxEvent.id.asc())
            .limit(batch_size)
        )
        try:
            stmt = stmt.with_for_update(skip_locked=True)
        except Exception:
            # SQLite / some dialects don't support SKIP LOCKED — ignore.
            pass

        result = await db.execute(stmt)
        events: list[OutboxEvent] = list(result.scalars().all())

        for event in events:
            try:
                await publisher(event.event_type, event.payload)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "outbox_worker.publish_failed: id=%s event_type=%s error=%r",
                    event.id,
                    event.event_type,
                    exc,
                )
                continue  # leave processed_at NULL — retry next poll
            event.processed_at = datetime.now(UTC)
            processed += 1

        if processed:
            await safe_commit(db)
    return processed


async def _publish_via_shared(event_type: str, payload: dict) -> None:
    """Default publisher — wraps shared.infrastructure.events.publish_event."""
    # Channel is simply the event type; ws-gateway routes by event_type inside.
    await publish_event(event_type, payload)


async def _worker_loop(app: FastAPI) -> None:
    """
    Long-running task that processes outbox batches until app.state.outbox_stop.

    Sleeps OUTBOX_WORKER_INTERVAL_SECONDS between polls. A publish failure of
    an individual event never kills the loop — only task-level exceptions do,
    and those are logged and end the loop gracefully.
    """
    publisher: OutboxPublisher = getattr(
        app.state, "outbox_publisher", _publish_via_shared
    )
    interval = settings.OUTBOX_WORKER_INTERVAL_SECONDS
    batch_size = settings.OUTBOX_BATCH_SIZE

    logger.info(
        "outbox_worker.started interval=%ss batch_size=%s",
        interval,
        batch_size,
    )
    try:
        while not getattr(app.state, "outbox_stop", False):
            try:
                n = await _process_batch(publisher, batch_size)
                if n:
                    logger.debug("outbox_worker.batch processed=%s", n)
            except Exception as exc:  # noqa: BLE001
                # Don't kill the loop on transient errors (DB hiccup, etc.)
                logger.warning("outbox_worker.batch_failed: %r", exc)
            await asyncio.sleep(interval)
    finally:
        logger.info("outbox_worker.stopped")


def start_worker(app: FastAPI) -> None:
    """
    Start the outbox worker as an asyncio Task owned by the app lifespan.

    Safe to call multiple times — if already started, returns silently.
    Caller is responsible for wrapping in try/except to avoid killing the app
    on startup errors.
    """
    if getattr(app.state, "outbox_task", None) is not None:
        logger.warning("outbox_worker.start_worker: already running — skipping")
        return

    app.state.outbox_stop = False
    app.state.outbox_task = asyncio.create_task(_worker_loop(app))
    logger.info("outbox_worker.start_worker: task scheduled")


async def stop_worker(app: FastAPI, timeout: float = 10.0) -> None:
    """
    Signal the worker to stop and await its completion up to `timeout` seconds.

    If the worker doesn't finish in time, the task is cancelled. The current
    batch is either finished (graceful) or aborted (timeout). No unprocessed
    rows are lost — they remain with processed_at=NULL for the next boot.
    """
    task: asyncio.Task | None = getattr(app.state, "outbox_task", None)
    if task is None:
        return

    app.state.outbox_stop = True
    try:
        await asyncio.wait_for(task, timeout=timeout)
    except asyncio.TimeoutError:
        logger.warning("outbox_worker.stop_worker: timed out — cancelling")
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
    finally:
        app.state.outbox_task = None
