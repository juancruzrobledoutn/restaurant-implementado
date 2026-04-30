"""
OutboxEvent model — transactional outbox pattern for reliable event publishing.

Table: outbox_event
Purpose: Persists domain events atomically within a DB transaction.
         A background worker (implemented in a later change) reads pending
         events (processed_at IS NULL) and publishes them to Redis Streams.

Architecture decision (D-01): this model lives in C-13 even though the first
real producer arrives in C-10. This decouples the infrastructure from the
business-logic changes.

Rules:
  - NEVER call db.commit() after write_event directly — caller owns the commit
  - NEVER delete events — mark processed_at when consumed by the worker
  - payload MUST be JSON-serializable (enforced in OutboxService.write_event)
"""
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Index, JSON, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from shared.infrastructure.db import Base


class OutboxEvent(Base):
    """
    Transactional outbox event record.

    Lifecycle:
      1. write_event() adds a row within the same DB transaction as the
         business operation — guarantees atomicity.
      2. processed_at=NULL means the event is pending.
      3. A background worker (C-10) sets processed_at when published to Redis.

    Indexes:
      - ix_outbox_pending: partial index on rows WHERE processed_at IS NULL
        → fast polling for the background worker.
      - ix_outbox_event_type_created: composite index for monitoring queries.
    """

    __tablename__ = "outbox_event"
    __table_args__ = (
        Index(
            "ix_outbox_pending",
            "processed_at",
            postgresql_where=text("processed_at IS NULL"),
        ),
        Index("ix_outbox_event_type_created", "event_type", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    processed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
    )

    def __repr__(self) -> str:
        return (
            f"<OutboxEvent id={self.id} event_type={self.event_type!r} "
            f"processed_at={self.processed_at}>"
        )
