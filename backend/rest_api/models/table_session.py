"""
TableSession, Diner, and CartItem models (C-08).

Tables:
  - table_session: runtime session for an active table (OPEN → PAYING → CLOSED)
  - diner: a person seated at a session (may or may not be a registered customer)
  - cart_item: ephemeral item in a diner's cart (hard-deleted on session close)

Rules:
  - TableSession and Diner use AuditMixin (soft-delete with audit trail)
  - CartItem has NO AuditMixin — ephemeral, hard-deleted on session close
  - All FKs ondelete=RESTRICT — no accidental DB-level cascades
  - Single-active-session invariant enforced by partial unique index (D-02)
  - TableSession.branch_id denormalised from Table.branch_id for WS routing (D-06)
  - CartItem.quantity must be > 0 (CHECK constraint)
"""
from datetime import datetime

from sqlalchemy import (
    BigInteger,
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


class TableSession(Base, AuditMixin):
    """
    A runtime session tied to a physical table.

    Status machine: OPEN → PAYING → CLOSED
    Single-active-session invariant enforced at two layers:
      1. Partial unique index (DB-level, race-proof)
      2. Service-level SELECT ... FOR UPDATE check before insert

    branch_id is denormalised (always == table.branch_id) for fast
    WS routing in C-09 without a join.
    """

    __tablename__ = "table_session"
    __table_args__ = (
        Index("ix_table_session_table_id", "table_id"),
        Index("ix_table_session_branch_id", "branch_id"),
        Index("ix_table_session_table_active", "table_id", "is_active"),
        # Partial unique index — single active session per table (D-02)
        Index(
            "uq_table_session_active_per_table",
            "table_id",
            unique=True,
            postgresql_where=text("is_active AND status IN ('OPEN', 'PAYING')"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
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
        default="OPEN",
        server_default="OPEN",
    )

    # Relationships
    table: Mapped["Table"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Table",
        back_populates="sessions",
        lazy="select",
    )
    branch: Mapped["Branch"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Branch",
        lazy="select",
    )
    diners: Mapped[list["Diner"]] = relationship(
        "Diner",
        back_populates="session",
        lazy="select",
    )
    cart_items: Mapped[list["CartItem"]] = relationship(
        "CartItem",
        back_populates="session",
        lazy="select",
    )
    # C-10: rounds belonging to this session. NO cascade — rounds survive the
    # session's soft-delete because they're referenced later by billing (C-12).
    rounds: Mapped[list["Round"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Round",
        back_populates="session",
        lazy="select",
    )
    # C-11: service calls ("llamar al mozo") belonging to this session.
    service_calls: Mapped[list["ServiceCall"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "ServiceCall",
        back_populates="session",
        lazy="select",
    )

    def __repr__(self) -> str:
        return (
            f"<TableSession id={self.id} table_id={self.table_id} "
            f"status={self.status!r} is_active={self.is_active}>"
        )


class Diner(Base, AuditMixin):
    """
    A person seated at a table session.

    customer_id is nullable — populated by C-19 CustomerService.get_or_create_by_device()
    when the join endpoint receives a device_id and ENABLE_CUSTOMER_TRACKING=true.
    Without device_id or with flag off, customer_id remains NULL (anonymous diner).
    """

    __tablename__ = "diner"
    __table_args__ = (
        Index("ix_diner_session_id", "session_id"),
        Index("ix_diner_customer_id", "customer_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("table_session.id", ondelete="RESTRICT"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    device_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # C-19: activated FK to customer (ondelete=SET NULL — diner survives customer deletion)
    customer_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("customer.id", ondelete="SET NULL"),
        nullable=True,
        default=None,
    )

    # Relationships
    session: Mapped["TableSession"] = relationship(
        "TableSession",
        back_populates="diners",
    )
    # C-19: back-reference to the Customer record (nullable — anonymous diners have none)
    customer: Mapped["Customer | None"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Customer",
        back_populates="diners",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<Diner id={self.id} session_id={self.session_id} name={self.name!r}>"


class CartItem(Base):
    """
    An ephemeral item in a diner's cart.

    NO AuditMixin — cart items are hard-deleted when the session is closed.
    This is deliberate: they are staging data, not audit-trail data.
    C-10 (rounds) converts cart items into permanent round items.
    """

    __tablename__ = "cart_item"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_cart_item_quantity_positive"),
        Index("ix_cart_item_session_id", "session_id"),
        Index("ix_cart_item_session_diner", "session_id", "diner_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("table_session.id", ondelete="RESTRICT"),
        nullable=False,
    )
    diner_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("diner.id", ondelete="RESTRICT"),
        nullable=False,
    )
    product_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("product.id", ondelete="RESTRICT"),
        nullable=False,
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    session: Mapped["TableSession"] = relationship(
        "TableSession",
        back_populates="cart_items",
    )

    def __repr__(self) -> str:
        return (
            f"<CartItem id={self.id} session_id={self.session_id} "
            f"diner_id={self.diner_id} product_id={self.product_id} qty={self.quantity}>"
        )
