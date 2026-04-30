"""
Promotion, PromotionBranch, and PromotionItem models.

Tables:
  - promotion: tenant-scoped promotional offer with time bounds and pricing
  - promotion_branch: M:N junction linking promotions to branches
  - promotion_item: M:N junction linking promotions to products

Rules:
  - Prices in cents (int), NEVER float
  - Promotion is tenant-scoped — ALWAYS filter by tenant_id
  - promotion_branch and promotion_item are junction tables — no AuditMixin
  - AuditMixin on Promotion (soft delete + audit trail)
  - All FK ondelete=CASCADE on junctions, RESTRICT on Promotion
"""
from datetime import date, time

from sqlalchemy import (
    BigInteger,
    Date,
    ForeignKey,
    Index,
    Integer,
    String,
    Time,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.infrastructure.db import Base
from rest_api.models.mixins import AuditMixin


class Promotion(Base, AuditMixin):
    """
    Tenant-scoped promotional offer with time bounds.

    price is in cents (int). start_date+start_time and end_date+end_time
    define the validity window. promotion_type_id is optional (FK to a
    future catalog table — nullable BigInteger for now).

    Multi-tenant isolation: direct tenant_id FK, ALWAYS filter by tenant_id.
    """

    __tablename__ = "promotion"
    __table_args__ = (
        Index("ix_promotion_tenant_id", "tenant_id"),
        Index("ix_promotion_tenant_dates", "tenant_id", "start_date", "end_date"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("app_tenant.id", ondelete="RESTRICT"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(1000), nullable=True, default=None)
    price: Mapped[int] = mapped_column(Integer, nullable=False)  # cents
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    promotion_type_id: Mapped[int | None] = mapped_column(
        BigInteger, nullable=True, default=None
    )

    # Relationships
    tenant: Mapped["Tenant"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Tenant",
        lazy="select",
    )
    branches: Mapped[list["PromotionBranch"]] = relationship(
        "PromotionBranch",
        back_populates="promotion",
        cascade="all, delete-orphan",
        lazy="select",
    )
    items: Mapped[list["PromotionItem"]] = relationship(
        "PromotionItem",
        back_populates="promotion",
        cascade="all, delete-orphan",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<Promotion id={self.id} name={self.name!r} tenant_id={self.tenant_id}>"


class PromotionBranch(Base):
    """
    M:N junction: links a Promotion to a Branch.

    No AuditMixin — this is a join table. Unique on (promotion_id, branch_id).
    ondelete=CASCADE: removing a promotion removes all its branch links.
    """

    __tablename__ = "promotion_branch"
    __table_args__ = (
        UniqueConstraint("promotion_id", "branch_id", name="uq_promotion_branch"),
        Index("ix_promotion_branch_branch_id", "branch_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    promotion_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("promotion.id", ondelete="CASCADE"),
        nullable=False,
    )
    branch_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("branch.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Relationships
    promotion: Mapped["Promotion"] = relationship(
        "Promotion",
        back_populates="branches",
    )
    branch: Mapped["Branch"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Branch",
        lazy="select",
    )

    def __repr__(self) -> str:
        return (
            f"<PromotionBranch promotion_id={self.promotion_id} "
            f"branch_id={self.branch_id}>"
        )


class PromotionItem(Base):
    """
    M:N junction: links a Promotion to a Product.

    No AuditMixin — this is a join table. Unique on (promotion_id, product_id).
    ondelete=CASCADE: removing a promotion removes all its product links.
    """

    __tablename__ = "promotion_item"
    __table_args__ = (
        UniqueConstraint("promotion_id", "product_id", name="uq_promotion_item"),
        Index("ix_promotion_item_product_id", "product_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    promotion_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("promotion.id", ondelete="CASCADE"),
        nullable=False,
    )
    product_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("product.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Relationships
    promotion: Mapped["Promotion"] = relationship(
        "Promotion",
        back_populates="items",
    )
    product: Mapped["Product"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Product",
        lazy="select",
    )

    def __repr__(self) -> str:
        return (
            f"<PromotionItem promotion_id={self.promotion_id} "
            f"product_id={self.product_id}>"
        )
