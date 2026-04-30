"""
Branch model — represents a physical location of a tenant.

Table: branch
Constraints:
  - UNIQUE(tenant_id, slug) — slug must be unique within a tenant
  - INDEX(tenant_id) — for multi-tenant queries

C-28: phone, timezone, opening_hours added for branch settings management.
"""
from typing import Optional

from sqlalchemy import BigInteger, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.infrastructure.db import Base
from rest_api.models.mixins import AuditMixin


class Branch(Base, AuditMixin):
    """
    Physical location (sucursal) belonging to a Tenant.
    """

    __tablename__ = "branch"
    __table_args__ = (
        UniqueConstraint("tenant_id", "slug", name="uq_branch_tenant_slug"),
        Index("ix_branch_tenant_id", "tenant_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("app_tenant.id", ondelete="RESTRICT"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    address: Mapped[str] = mapped_column(String(500), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False)

    # C-28: branch settings fields
    phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    timezone: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        default="America/Argentina/Buenos_Aires",
        server_default="America/Argentina/Buenos_Aires",
    )
    opening_hours: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    # Relationships
    tenant: Mapped["Tenant"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Tenant",
        back_populates="branches",
    )
    user_roles: Mapped[list["UserBranchRole"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "UserBranchRole",
        back_populates="branch",
        cascade="all, delete-orphan",
        lazy="select",
    )
    # C-04 menu catalog
    categories: Mapped[list["Category"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Category",
        back_populates="branch",
        cascade="all, delete-orphan",
        lazy="select",
    )
    branch_products: Mapped[list["BranchProduct"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "BranchProduct",
        back_populates="branch",
        cascade="all, delete-orphan",
        lazy="select",
    )
    # C-07: branch sectors and tables
    sectors: Mapped[list["BranchSector"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "BranchSector",
        back_populates="branch",
        cascade="all, delete-orphan",
        lazy="select",
    )
    tables: Mapped[list["Table"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Table",
        back_populates="branch",
        cascade="all, delete-orphan",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<Branch id={self.id} tenant_id={self.tenant_id} slug={self.slug!r}>"
