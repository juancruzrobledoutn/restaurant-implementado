"""
ServiceCall model (C-11).

Table: service_call

A diner's "llamar al mozo" request — the operational counterpart of the
kitchen ticket. Diners create service calls via the pwaMenu; waiters
acknowledge and close them from the pwaWaiter.

State machine: CREATED → ACKED → CLOSED (ACKED is optional — CREATED can
go directly to CLOSED without an intermediate ack).

Rules (NON-NEGOTIABLE):
  - Uses AuditMixin (soft-delete with audit trail).
  - All FKs ondelete=RESTRICT — no accidental DB-level cascades.
  - branch_id and table_id denormalised from session chain for fast scoping
    and ws-payload enrichment without a join.
  - Duplicate-guard (one open call per session) is enforced at the service
    layer via SELECT ... FOR UPDATE on the session — not via a partial
    unique index (SQLite used in tests doesn't support partial indexes
    portably, see design.md §D-05).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.infrastructure.db import Base
from rest_api.models.mixins import AuditMixin


_VALID_SERVICE_CALL_STATUSES = ("CREATED", "ACKED", "CLOSED")


class ServiceCall(Base, AuditMixin):
    """
    A request from the diner to the waiter.

    Actor columns:
      - acked_by_id: user who acked (WAITER, MANAGER, ADMIN).
      - closed_by_id: user who closed (WAITER, MANAGER, ADMIN).

    Both are nullable — a call may go CREATED → CLOSED without passing
    through ACKED. In that case acked_by_id stays NULL.

    Timestamps:
      - created_at (from AuditMixin): when the diner pressed the button.
      - acked_at: set on ACK transition.
      - closed_at: set on CLOSE transition.
    """

    __tablename__ = "service_call"
    __table_args__ = (
        Index("ix_service_call_session_status", "session_id", "status"),
        Index("ix_service_call_branch_status", "branch_id", "status"),
        CheckConstraint(
            "status IN ('CREATED','ACKED','CLOSED')",
            name="ck_service_call_status_valid",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("table_session.id", ondelete="RESTRICT"),
        nullable=False,
    )
    table_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("app_table.id", ondelete="RESTRICT"),
        nullable=False,
    )
    branch_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("branch.id", ondelete="RESTRICT"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="CREATED",
        server_default=text("'CREATED'"),
    )

    # Actor columns (both nullable)
    acked_by_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=True,
        default=None,
    )
    closed_by_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=True,
        default=None,
    )

    # Transition timestamps
    acked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
    )
    closed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
    )

    # Relationships
    session: Mapped["TableSession"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "TableSession",
        back_populates="service_calls",
        lazy="select",
    )
    branch: Mapped["Branch"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Branch",
        lazy="select",
    )

    def __repr__(self) -> str:
        return (
            f"<ServiceCall id={self.id} session_id={self.session_id} "
            f"status={self.status!r} is_active={self.is_active}>"
        )
