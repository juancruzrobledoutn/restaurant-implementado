"""
OutboxService — transactional outbox write helper.

Architecture (D-01, D-02 from design.md):
  - This service provides ONLY the write helper write_event().
  - The background worker that reads pending events and publishes to Redis
    Streams is implemented in a LATER change (C-10).
  - Until then, OutboxEvent.processed_at remains NULL for any written events.

IMPORTANT: Caller owns the commit.
  write_event() adds the OutboxEvent to the current session but does NOT
  commit. The caller must call safe_commit(db) after all business operations
  within the same transaction. This guarantees atomicity: if the business
  operation rolls back, the event record is also rolled back.

Usage:
    from rest_api.services.domain.outbox_service import OutboxService

    event = OutboxService.write_event(
        db=db,
        event_type="ROUND_SUBMITTED",
        payload={"round_id": 42, "branch_id": 1},
    )
    # ... other business operations ...
    await safe_commit(db)  # caller commits, event persists atomically
"""
from __future__ import annotations

import json

from sqlalchemy.ext.asyncio import AsyncSession

from shared.config.logging import get_logger
from rest_api.models.outbox import OutboxEvent

logger = get_logger(__name__)


class OutboxService:
    """
    Stateless helper for writing events to the transactional outbox.

    All methods are static — no state, no DB session stored on the class.
    The caller always owns the DB session and the commit.
    """

    @staticmethod
    async def write_event(
        db: AsyncSession,
        event_type: str,
        payload: dict,
    ) -> OutboxEvent:
        """
        Write a domain event to the outbox within the caller's transaction.

        CALLER OWNS THE COMMIT — use safe_commit(db) after business operations.
        The background processor (implemented in a later change) reads pending
        events (processed_at IS NULL) and publishes them to Redis Streams.

        Args:
            db: Current async session — the event is added to this session.
            event_type: String identifier for the event (e.g. "ROUND_SUBMITTED").
            payload: Dict that MUST be JSON-serializable (validated here).

        Returns:
            OutboxEvent instance added to the session (not yet committed).

        Raises:
            ValueError: If payload is not JSON-serializable.
        """
        # Validate JSON-serializability before DB interaction
        try:
            json.dumps(payload)
        except (TypeError, ValueError) as exc:
            raise ValueError(
                f"OutboxService.write_event: payload is not JSON-serializable: {exc}"
            ) from exc

        event = OutboxEvent(
            event_type=event_type,
            payload=payload,
        )
        db.add(event)
        logger.debug(
            "outbox.write_event: event_type=%s payload_keys=%s",
            event_type,
            list(payload.keys()),
        )
        return event
