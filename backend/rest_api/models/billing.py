"""
Billing models (C-12): Check, Charge, Payment, Allocation.

State machines:
  - app_check: REQUESTED → PAID
  - payment: PENDING → APPROVED | REJECTED

Architecture decisions:
  - `app_check` because `check` is a SQL reserved word.
  - remaining_cents is a computed value (charge.amount_cents - SUM allocations),
    never persisted — avoids double source of truth.
  - FIFO allocation: payment covers charges ordered by created_at ASC.
  - SELECT FOR UPDATE on charges during _allocate() to prevent race conditions.
  - Outbox events (CHECK_REQUESTED, CHECK_PAID, PAYMENT_APPROVED, PAYMENT_REJECTED)
    written atomically within the same transaction — at-least-once via Outbox.

Rules (NON-NEGOTIABLE):
  - NEVER query is_active == True — use is_active.is_(True)
  - NEVER call db.commit() directly — use safe_commit(db)
  - ALWAYS filter by tenant_id
  - Prices in INTEGER cents only — never float
  - app_check has a unique constraint on session_id (one check per session)
  - external_id on payment has a partial unique index (WHERE external_id IS NOT NULL)
    for idempotency of MP webhooks
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.infrastructure.db import Base
from rest_api.models.mixins import AuditMixin


class Check(Base, AuditMixin):
    """
    A billing check for a table session.

    One check per session (UniqueConstraint on session_id).
    Total is computed from round items at creation time and stored as a
    snapshot — subsequent menu price changes don't affect the bill.

    Status machine: REQUESTED → PAID

    branch_id and tenant_id are denormalized for fast access and WS routing
    without joins.
    """

    __tablename__ = "app_check"
    __table_args__ = (
        UniqueConstraint("session_id", name="uq_app_check_session_id"),
        Index("ix_app_check_session_id", "session_id"),
        Index("ix_app_check_tenant_id", "tenant_id"),
        CheckConstraint(
            "status IN ('REQUESTED', 'PAID')",
            name="ck_app_check_status_valid",
        ),
        CheckConstraint(
            "total_cents >= 0",
            name="ck_app_check_total_nonnegative",
        ),
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
    tenant_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("app_tenant.id", ondelete="RESTRICT"),
        nullable=False,
    )
    total_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="REQUESTED",
        server_default=text("'REQUESTED'"),
    )

    # Relationships
    session: Mapped["TableSession"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "TableSession",
        lazy="select",
    )
    charges: Mapped[list["Charge"]] = relationship(
        "Charge",
        back_populates="check",
        lazy="select",
    )
    payments: Mapped[list["Payment"]] = relationship(
        "Payment",
        back_populates="check",
        lazy="select",
    )

    def __repr__(self) -> str:
        return (
            f"<Check id={self.id} session_id={self.session_id} "
            f"total_cents={self.total_cents} status={self.status!r}>"
        )


class Charge(Base):
    """
    A line item on a billing check.

    Charges are created when a check is requested. Each charge corresponds to
    a diner (split by equal/consumption/custom). Shared items have diner_id=None.

    remaining_cents is a computed value — NOT stored — equals:
      charge.amount_cents - SUM(allocation.amount_cents WHERE charge_id = self.id)

    All charges must have amount_cents > 0 (CHECK constraint).
    """

    __tablename__ = "charge"
    __table_args__ = (
        CheckConstraint("amount_cents > 0", name="ck_charge_amount_positive"),
        Index("ix_charge_check_id", "check_id"),
        Index("ix_charge_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    check_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("app_check.id", ondelete="RESTRICT"),
        nullable=False,
    )
    diner_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("diner.id", ondelete="RESTRICT"),
        nullable=True,
        default=None,
    )
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True, default=None)
    is_active: Mapped[bool] = mapped_column(
        "is_active",
        nullable=False,
        default=True,
        server_default=text("true"),
    )
    created_at: Mapped[datetime] = mapped_column(
        "created_at",
        nullable=False,
        server_default=func.now(),
    )

    # Relationships
    check: Mapped["Check"] = relationship(
        "Check",
        back_populates="charges",
        lazy="select",
    )
    allocations: Mapped[list["Allocation"]] = relationship(
        "Allocation",
        back_populates="charge",
        lazy="select",
    )

    def __repr__(self) -> str:
        return (
            f"<Charge id={self.id} check_id={self.check_id} "
            f"diner_id={self.diner_id} amount_cents={self.amount_cents}>"
        )


class Payment(Base):
    """
    A payment attempt against a billing check.

    Status machine: PENDING → APPROVED | REJECTED
      - PENDING: MP preference created, awaiting IPN confirmation.
      - APPROVED: payment verified and allocated to charges via FIFO.
      - REJECTED: MP rejected or HMAC verification failed.

    external_id is the payment ID returned by MercadoPago — used as an
    idempotency key. Partial unique index enforces uniqueness only when set.

    All payments must have amount_cents > 0 (CHECK constraint).
    """

    __tablename__ = "payment"
    __table_args__ = (
        CheckConstraint("amount_cents > 0", name="ck_payment_amount_positive"),
        CheckConstraint(
            "status IN ('PENDING', 'APPROVED', 'REJECTED')",
            name="ck_payment_status_valid",
        ),
        CheckConstraint(
            "method IN ('cash', 'card', 'transfer', 'mercadopago')",
            name="ck_payment_method_valid",
        ),
        Index("ix_payment_check_id", "check_id"),
        # Partial unique index — enforces idempotency for MP webhook external_id
        Index(
            "uq_payment_external_id",
            "external_id",
            unique=True,
            postgresql_where=text("external_id IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    check_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("app_check.id", ondelete="RESTRICT"),
        nullable=False,
    )
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    method: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="PENDING",
        server_default=text("'PENDING'"),
    )
    external_id: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    is_active: Mapped[bool] = mapped_column(
        "is_active",
        nullable=False,
        default=True,
        server_default=text("true"),
    )
    created_at: Mapped[datetime] = mapped_column(
        "created_at",
        nullable=False,
        server_default=func.now(),
    )

    # Relationships
    check: Mapped["Check"] = relationship(
        "Check",
        back_populates="payments",
        lazy="select",
    )
    allocations: Mapped[list["Allocation"]] = relationship(
        "Allocation",
        back_populates="payment",
        lazy="select",
    )

    def __repr__(self) -> str:
        return (
            f"<Payment id={self.id} check_id={self.check_id} "
            f"amount_cents={self.amount_cents} method={self.method!r} "
            f"status={self.status!r}>"
        )


class Allocation(Base):
    """
    FIFO allocation: links a payment to a charge for a specific amount.

    This is the core of the billing ledger. When a payment arrives:
      1. Fetch charges with remaining_cents > 0 ordered by created_at ASC.
      2. Create Allocation rows until the payment amount is exhausted.
      3. remaining_cents per charge = charge.amount_cents - SUM(allocations).

    amount_cents must be > 0 (CHECK constraint).
    """

    __tablename__ = "allocation"
    __table_args__ = (
        CheckConstraint("amount_cents > 0", name="ck_allocation_amount_positive"),
        Index("ix_allocation_charge_id_payment_id", "charge_id", "payment_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    charge_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("charge.id", ondelete="RESTRICT"),
        nullable=False,
    )
    payment_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("payment.id", ondelete="RESTRICT"),
        nullable=False,
    )
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)

    # Relationships
    charge: Mapped["Charge"] = relationship(
        "Charge",
        back_populates="allocations",
        lazy="select",
    )
    payment: Mapped["Payment"] = relationship(
        "Payment",
        back_populates="allocations",
        lazy="select",
    )

    def __repr__(self) -> str:
        return (
            f"<Allocation id={self.id} charge_id={self.charge_id} "
            f"payment_id={self.payment_id} amount_cents={self.amount_cents}>"
        )
