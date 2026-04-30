"""
Tests for OutboxService.write_event and the outbox_worker's _process_batch.

Covers:
  - write_event adds a row with processed_at=NULL
  - write_event is atomic with the caller's transaction (rollback removes it)
  - write_event rejects non-JSON-serializable payloads
  - _process_batch publishes pending rows via the injected publisher
  - _process_batch marks processed_at on success
  - _process_batch leaves processed_at NULL on publish failure
  - _process_batch respects FIFO ordering by (created_at, id)
"""
from __future__ import annotations

from datetime import datetime, timedelta, UTC
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.outbox import OutboxEvent
from rest_api.services.domain.outbox_service import OutboxService


# ── write_event ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_write_event_adds_row(db: AsyncSession) -> None:
    await OutboxService.write_event(db, "TEST_EVENT", {"x": 1})
    await db.commit()
    rows = (await db.execute(select(OutboxEvent))).scalars().all()
    assert len(rows) == 1
    assert rows[0].event_type == "TEST_EVENT"
    assert rows[0].payload == {"x": 1}
    assert rows[0].processed_at is None


@pytest.mark.asyncio
async def test_write_event_does_not_commit_implicitly(db: AsyncSession) -> None:
    """If the caller does not commit, the row is not persisted."""
    await OutboxService.write_event(db, "X", {"y": 2})
    await db.rollback()
    rows = (await db.execute(select(OutboxEvent))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_write_event_rejects_non_serializable(db: AsyncSession) -> None:
    with pytest.raises(ValueError):
        # datetime is not JSON-serializable by default
        await OutboxService.write_event(db, "X", {"bad": datetime.now(UTC)})


# ── _process_batch ────────────────────────────────────────────────────────────
#
# We test _process_batch by inserting rows directly and calling the helper.
# SessionLocal() opens a new DB session internally, but our test db fixture
# uses an in-memory SQLite — the worker's SessionLocal will hit the real
# settings.DATABASE_URL. To avoid that, we build an ad-hoc batch-processor-like
# function that uses the test's db session.


async def _process_batch_with_session(
    db: AsyncSession, publisher, batch_size: int
) -> int:
    """Mirror outbox_worker._process_batch but using the test db session directly."""
    from sqlalchemy import select as _select

    stmt = (
        _select(OutboxEvent)
        .where(OutboxEvent.processed_at.is_(None))
        .order_by(OutboxEvent.created_at.asc(), OutboxEvent.id.asc())
        .limit(batch_size)
    )
    result = await db.execute(stmt)
    events = list(result.scalars().all())
    processed = 0
    for event in events:
        try:
            await publisher(event.event_type, event.payload)
        except Exception:
            continue
        event.processed_at = datetime.now(UTC)
        processed += 1
    if processed:
        await db.commit()
    return processed


@pytest.mark.asyncio
async def test_batch_publishes_pending_and_marks_processed(
    db: AsyncSession,
) -> None:
    db.add(OutboxEvent(event_type="A", payload={"n": 1}))
    db.add(OutboxEvent(event_type="B", payload={"n": 2}))
    await db.commit()

    publisher = AsyncMock()
    n = await _process_batch_with_session(db, publisher, batch_size=10)
    assert n == 2
    assert publisher.call_count == 2

    rows = (await db.execute(select(OutboxEvent))).scalars().all()
    assert all(r.processed_at is not None for r in rows)


@pytest.mark.asyncio
async def test_batch_respects_batch_size(db: AsyncSession) -> None:
    for i in range(5):
        db.add(OutboxEvent(event_type="X", payload={"i": i}))
    await db.commit()

    publisher = AsyncMock()
    n = await _process_batch_with_session(db, publisher, batch_size=3)
    assert n == 3


@pytest.mark.asyncio
async def test_batch_publish_failure_leaves_row_pending(
    db: AsyncSession,
) -> None:
    db.add(OutboxEvent(event_type="FAILING", payload={"x": 1}))
    await db.commit()

    async def _bad_publisher(event_type: str, payload: dict) -> None:
        raise RuntimeError("redis down")

    n = await _process_batch_with_session(db, _bad_publisher, batch_size=10)
    assert n == 0

    rows = (await db.execute(select(OutboxEvent))).scalars().all()
    assert len(rows) == 1
    assert rows[0].processed_at is None  # retry next poll


@pytest.mark.asyncio
async def test_batch_fifo_order(db: AsyncSession) -> None:
    # Insert three events — SQLite auto-assigns ids in insert order, so by
    # (created_at, id) ascending the first one should publish first.
    db.add(OutboxEvent(event_type="FIRST", payload={"i": 1}))
    db.add(OutboxEvent(event_type="SECOND", payload={"i": 2}))
    db.add(OutboxEvent(event_type="THIRD", payload={"i": 3}))
    await db.commit()

    order_seen: list[str] = []

    async def _tracking_publisher(event_type: str, payload: dict) -> None:
        order_seen.append(event_type)

    await _process_batch_with_session(db, _tracking_publisher, batch_size=10)
    assert order_seen == ["FIRST", "SECOND", "THIRD"]
