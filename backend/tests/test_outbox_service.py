"""
Tests for OutboxService.write_event.

Coverage:
  - write_event adds to session without committing
  - Atomicity: write + business row, rollback → both absent
  - JSON-serialization failure raises ValueError
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.outbox import OutboxEvent
from rest_api.models.tenant import Tenant
from rest_api.services.domain.outbox_service import OutboxService


# ── Tests ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_write_event_adds_to_session(db: AsyncSession) -> None:
    """write_event() adds the event to the session but does not commit."""
    event = await OutboxService.write_event(
        db=db,
        event_type="TEST_EVENT",
        payload={"key": "value"},
    )
    assert event.id is None or event.id > 0  # flush may or may not assign ID yet

    # Check the event is in the session's new objects or identity map
    # by flushing explicitly and checking it has an ID
    await db.flush()
    assert event.id is not None
    assert event.event_type == "TEST_EVENT"
    assert event.payload == {"key": "value"}
    assert event.processed_at is None


@pytest.mark.asyncio
async def test_write_event_event_type_and_payload_stored(db: AsyncSession) -> None:
    """write_event stores event_type and payload correctly."""
    payload = {"round_id": 42, "branch_id": 1, "items": [1, 2, 3]}
    await OutboxService.write_event(db=db, event_type="ROUND_SUBMITTED", payload=payload)
    await db.flush()

    result = await db.execute(
        select(OutboxEvent).where(OutboxEvent.event_type == "ROUND_SUBMITTED")
    )
    stored = result.scalar_one()
    assert stored.payload == payload
    assert stored.processed_at is None


@pytest.mark.asyncio
async def test_write_event_processed_at_is_null(db: AsyncSession) -> None:
    """Newly written events have processed_at=NULL (pending for worker)."""
    await OutboxService.write_event(
        db=db, event_type="PENDING_EVENT", payload={"test": True}
    )
    await db.flush()

    result = await db.execute(
        select(OutboxEvent).where(OutboxEvent.event_type == "PENDING_EVENT")
    )
    event = result.scalar_one()
    assert event.processed_at is None


@pytest.mark.asyncio
async def test_write_event_atomicity_with_business_row(db: AsyncSession) -> None:
    """
    Atomicity test: if the caller rolls back after write_event,
    the event record is also rolled back.
    """
    # Write event and a business row (Tenant) in the same transaction
    event = await OutboxService.write_event(
        db=db, event_type="ATOMIC_TEST", payload={"test": True}
    )
    tenant = Tenant(name="Atomic Test Tenant")
    db.add(tenant)
    await db.flush()

    event_id = event.id
    tenant_id = tenant.id

    # Rollback — both should be gone
    await db.rollback()

    # Verify event is gone
    event_result = await db.execute(
        select(OutboxEvent).where(OutboxEvent.id == event_id)
    )
    assert event_result.scalar_one_or_none() is None

    # Verify tenant is gone
    tenant_result = await db.execute(
        select(Tenant).where(Tenant.id == tenant_id)
    )
    assert tenant_result.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_write_event_non_serializable_payload_raises_value_error(
    db: AsyncSession,
) -> None:
    """write_event raises ValueError when payload is not JSON-serializable."""
    with pytest.raises(ValueError, match="not JSON-serializable"):
        await OutboxService.write_event(
            db=db,
            event_type="BAD_EVENT",
            payload={"bad": object()},  # object() is not JSON-serializable
        )


@pytest.mark.asyncio
async def test_write_event_with_set_in_payload_raises_value_error(
    db: AsyncSession,
) -> None:
    """Sets are not JSON-serializable — write_event raises ValueError."""
    with pytest.raises(ValueError):
        await OutboxService.write_event(
            db=db,
            event_type="BAD_EVENT",
            payload={"ids": {1, 2, 3}},  # set is not JSON-serializable
        )


@pytest.mark.asyncio
async def test_write_event_nested_dict_payload_ok(db: AsyncSession) -> None:
    """Nested dicts and lists are valid JSON — write_event succeeds."""
    payload = {
        "event": "ORDER_PLACED",
        "data": {"items": [{"id": 1, "qty": 2}, {"id": 3, "qty": 1}]},
        "meta": {"timestamp": "2026-04-17T12:00:00Z"},
    }
    event = await OutboxService.write_event(
        db=db, event_type="COMPLEX_EVENT", payload=payload
    )
    await db.flush()
    assert event.id is not None
