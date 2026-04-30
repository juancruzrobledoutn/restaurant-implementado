"""
KitchenTicket and KitchenTicketItem models (C-11).

Tables:
  - kitchen_ticket: per-round work unit for the kitchen brigade, IN_PROGRESS →
    READY → DELIVERED. One row per round (enforced by a unique FK on round_id).
  - kitchen_ticket_item: one row per non-voided round_item at ticket creation.

State machine:
  IN_PROGRESS → READY → DELIVERED (driven from RoundService)
  Cancel of the parent round from SUBMITTED+ soft-deletes the ticket (is_active=False)
  — there is NO ticket CANCELED status.

Rules (NON-NEGOTIABLE):
  - Both models use AuditMixin (soft-delete with audit trail).
  - All FKs ondelete=RESTRICT — no accidental DB-level cascades.
  - Kitchen visibility filter lives at the service layer, not here.
  - branch_id on kitchen_ticket is denormalised from round.branch_id for
    fast scoping on the kitchen listing query.
  - One-ticket-per-round invariant enforced at the DB level via a unique
    constraint on kitchen_ticket.round_id.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
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


_VALID_TICKET_STATUSES = ("IN_PROGRESS", "READY", "DELIVERED")


class KitchenTicket(Base, AuditMixin):
    """
    A kitchen work unit, 1:1 with a Round once the round hits SUBMITTED.

    Timestamps:
      - created_at (from AuditMixin) — set when the ticket is born.
      - started_at — set when the parent round goes SUBMITTED → IN_KITCHEN.
        status stays IN_PROGRESS; the timestamp is the kitchen UI's "cooking since" signal.
      - ready_at — set when status transitions to READY.
      - delivered_at — set when status transitions to DELIVERED.

    branch_id is denormalised from Round.branch_id and is always equal to
    `round.branch_id`. Denormalisation lets the kitchen listing query filter
    without joining through round → session → table → branch.

    priority is reserved for a future "urgente" flag — no endpoint mutates
    it in C-11.
    """

    __tablename__ = "kitchen_ticket"
    __table_args__ = (
        # One ticket per round — self-enforcing at the DB layer.
        Index("uq_kitchen_ticket_round", "round_id", unique=True),
        Index("ix_kitchen_ticket_branch_status", "branch_id", "status"),
        CheckConstraint(
            "status IN ('IN_PROGRESS','READY','DELIVERED')",
            name="ck_kitchen_ticket_status_valid",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    round_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("round.id", ondelete="RESTRICT"),
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
        default="IN_PROGRESS",
        server_default=text("'IN_PROGRESS'"),
    )
    priority: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )

    # Transition timestamps
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
    )
    ready_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
    )
    delivered_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
    )

    # Relationships
    round: Mapped["Round"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Round",
        back_populates="ticket",
        lazy="select",
    )
    branch: Mapped["Branch"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Branch",
        lazy="select",
    )
    items: Mapped[list["KitchenTicketItem"]] = relationship(
        "KitchenTicketItem",
        back_populates="ticket",
        cascade="all, delete-orphan",
        lazy="select",
    )

    def __repr__(self) -> str:
        return (
            f"<KitchenTicket id={self.id} round_id={self.round_id} "
            f"status={self.status!r} is_active={self.is_active}>"
        )


class KitchenTicketItem(Base, AuditMixin):
    """
    A ticket line, 1:1 with a non-voided round_item at ticket creation.

    If the related round_item is voided AFTER the ticket is created
    (mid-flight void via the round void-item endpoint), this row STAYS in
    the DB so the kitchen keeps seeing "we started cooking this, stop now".
    The voided flag is sourced from round_item.is_voided in the API output.

    is_prepared and prepared_at are reserved for a future per-item
    "start cooking" toggle — no endpoint mutates them in C-11.
    """

    __tablename__ = "kitchen_ticket_item"
    __table_args__ = (
        Index("ix_kitchen_ticket_item_ticket", "ticket_id"),
        Index(
            "uq_kitchen_ticket_item_round_item",
            "ticket_id",
            "round_item_id",
            unique=True,
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    ticket_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("kitchen_ticket.id", ondelete="RESTRICT"),
        nullable=False,
    )
    round_item_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("round_item.id", ondelete="RESTRICT"),
        nullable=False,
    )
    is_prepared: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )
    prepared_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
    )

    # Relationships
    ticket: Mapped["KitchenTicket"] = relationship(
        "KitchenTicket",
        back_populates="items",
    )
    round_item: Mapped["RoundItem"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "RoundItem",
        lazy="select",
    )

    def __repr__(self) -> str:
        return (
            f"<KitchenTicketItem id={self.id} ticket_id={self.ticket_id} "
            f"round_item_id={self.round_item_id} is_prepared={self.is_prepared}>"
        )
