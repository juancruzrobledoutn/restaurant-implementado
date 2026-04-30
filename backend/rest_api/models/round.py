"""
Round and RoundItem models (C-10).

Tables:
  - round: a round of orders for a table session, with a 7-state machine
  - round_item: individual line items within a round, with void support

State machine (canonical — see knowledge-base/01-negocio/04_reglas_de_negocio.md §2):
  PENDING → CONFIRMED → SUBMITTED → IN_KITCHEN → READY → SERVED
  CANCELED reachable from any non-terminal state.
  SERVED and CANCELED are terminal.

Rules (NON-NEGOTIABLE):
  - Both models use AuditMixin (soft-delete with audit trail).
    Note: a CANCELED round stays `is_active=True` — canceled is a state,
    not a soft-delete. Soft-delete (is_active=False) is reserved for retention.
  - All FKs ondelete=RESTRICT — no accidental DB-level cascades.
  - Prices in INTEGER cents only — never float.
  - round_number is unique per session, assigned by the service under lock.
  - Kitchen visibility filter at the service layer, not in models.
  - CANCELED with reason MUST have cancel_reason populated by the service.
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
    Integer,
    String,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.infrastructure.db import Base
from rest_api.models.mixins import AuditMixin


# Keep status / role CHECK constraints aligned with the canonical enum in
# shared.config.constants. The string tuple below is the source of truth for
# the DB CHECK — if either list changes, update both in the same commit.
_VALID_ROUND_STATUSES = (
    "PENDING",
    "CONFIRMED",
    "SUBMITTED",
    "IN_KITCHEN",
    "READY",
    "SERVED",
    "CANCELED",
)
_VALID_CREATED_BY_ROLES = ("DINER", "WAITER", "MANAGER", "ADMIN")


class Round(Base, AuditMixin):
    """
    A round of orders for a table session.

    Timestamps:
      - pending_at: server_default now() — set on insert (round is born in PENDING).
      - confirmed_at/submitted_at/in_kitchen_at/ready_at/served_at/canceled_at:
        nullable — set by the corresponding RoundService transition method.

    Actor columns:
      - created_by_role: who pressed "send" — DINER | WAITER | MANAGER | ADMIN.
      - created_by_diner_id: set when created_by_role='DINER'.
      - created_by_user_id: set when created_by_role in (WAITER, MANAGER, ADMIN).
      - confirmed_by_id: user who confirmed (WAITER+).
      - submitted_by_id: user who pushed to kitchen (MANAGER/ADMIN).
      - canceled_by_id: user who canceled (MANAGER/ADMIN).

    Branch is denormalised for fast scoping — always equal to
    `session.table.branch_id`.
    """

    __tablename__ = "round"
    __table_args__ = (
        Index("ix_round_session_active", "session_id", "is_active"),
        Index("ix_round_branch_status_submitted_at", "branch_id", "status", "submitted_at"),
        Index("uq_round_session_number", "session_id", "round_number", unique=True),
        CheckConstraint(
            "status IN ('PENDING','CONFIRMED','SUBMITTED','IN_KITCHEN','READY','SERVED','CANCELED')",
            name="ck_round_status_valid",
        ),
        CheckConstraint(
            "created_by_role IN ('DINER','WAITER','MANAGER','ADMIN')",
            name="ck_round_created_by_role_valid",
        ),
        CheckConstraint("round_number > 0", name="ck_round_number_positive"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("table_session.id", ondelete="RESTRICT"),
        nullable=False,
    )
    branch_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("branch.id", ondelete="RESTRICT"),
        nullable=False,
    )
    round_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="PENDING",
        server_default=text("'PENDING'"),
    )

    # Actor columns
    created_by_role: Mapped[str] = mapped_column(String(20), nullable=False)
    created_by_diner_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("diner.id", ondelete="RESTRICT"),
        nullable=True,
        default=None,
    )
    created_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=True,
        default=None,
    )
    confirmed_by_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=True,
        default=None,
    )
    submitted_by_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=True,
        default=None,
    )
    canceled_by_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=True,
        default=None,
    )
    cancel_reason: Mapped[str | None] = mapped_column(String(500), nullable=True, default=None)

    # Transition timestamps
    pending_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    confirmed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
    )
    submitted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
    )
    in_kitchen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
    )
    ready_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
    )
    served_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
    )
    canceled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
    )

    # Relationships
    session: Mapped["TableSession"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "TableSession",
        back_populates="rounds",
        lazy="select",
    )
    branch: Mapped["Branch"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Branch",
        lazy="select",
    )
    items: Mapped[list["RoundItem"]] = relationship(
        "RoundItem",
        back_populates="round",
        cascade="all, delete-orphan",
        lazy="select",
    )
    # C-11: 1:1 with kitchen_ticket (created eagerly on submit; uselist=False)
    ticket: Mapped["KitchenTicket | None"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "KitchenTicket",
        back_populates="round",
        uselist=False,
        lazy="select",
    )

    def __repr__(self) -> str:
        return (
            f"<Round id={self.id} session_id={self.session_id} "
            f"round_number={self.round_number} status={self.status!r} "
            f"is_active={self.is_active}>"
        )


class RoundItem(Base, AuditMixin):
    """
    An individual line item within a round.

    price_cents_snapshot is captured at ROUND CREATION (not submit) — it is the
    price the actor saw at the moment they pressed "send". Billing (C-12) uses
    this exact value regardless of later menu changes.

    Void fields (is_voided / void_reason / voided_at / voided_by_id) record
    mid-flight cancellations of a single item without affecting the parent
    round's status. Voided items are excluded from stock checks and billing.

    diner_id is nullable: waiter-created items may have no specific diner
    (e.g., shared appetizer for the table).
    """

    __tablename__ = "round_item"
    __table_args__ = (
        Index("ix_round_item_round", "round_id"),
        Index("ix_round_item_round_voided", "round_id", "is_voided"),
        Index("ix_round_item_product", "product_id"),
        CheckConstraint("quantity > 0", name="ck_round_item_quantity_positive"),
        CheckConstraint(
            "price_cents_snapshot >= 0",
            name="ck_round_item_price_nonnegative",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    round_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("round.id", ondelete="RESTRICT"),
        nullable=False,
    )
    product_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("product.id", ondelete="RESTRICT"),
        nullable=False,
    )
    diner_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("diner.id", ondelete="RESTRICT"),
        nullable=True,
        default=None,
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True, default=None)
    price_cents_snapshot: Mapped[int] = mapped_column(Integer, nullable=False)

    # Void support
    is_voided: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )
    void_reason: Mapped[str | None] = mapped_column(String(500), nullable=True, default=None)
    voided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
    )
    voided_by_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=True,
        default=None,
    )

    # Relationships
    round: Mapped["Round"] = relationship(
        "Round",
        back_populates="items",
    )
    product: Mapped["Product"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Product",
        back_populates="round_items",
        lazy="select",
    )
    diner: Mapped["Diner | None"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Diner",
        lazy="select",
    )

    def __repr__(self) -> str:
        return (
            f"<RoundItem id={self.id} round_id={self.round_id} "
            f"product_id={self.product_id} qty={self.quantity} "
            f"price={self.price_cents_snapshot} is_voided={self.is_voided}>"
        )
