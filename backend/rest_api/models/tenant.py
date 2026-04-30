"""
Tenant model — represents a restaurant organization.

Table: app_tenant (prefixed to avoid conflicts, project convention for core entities)
"""
from sqlalchemy import BigInteger, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.infrastructure.db import Base
from rest_api.models.mixins import AuditMixin


class Tenant(Base, AuditMixin):
    """
    Top-level tenant entity. Every other entity belongs to a tenant.

    Naming: app_tenant (not 'tenant') to follow project convention for core entities.

    C-19: privacy_salt added for per-tenant IP hashing (GDPR consent audit).
    Generated with secrets.token_hex(32) at tenant creation.
    """

    __tablename__ = "app_tenant"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    # C-19: per-tenant salt for hashing consent IP addresses (GDPR art. 7).
    # Generated with secrets.token_hex(32). Nullable initially for backfill migration.
    # NEVER expose this in API responses.
    privacy_salt: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Relationships — used by cascade_soft_delete
    branches: Mapped[list["Branch"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Branch",
        back_populates="tenant",
        cascade="all, delete-orphan",
        lazy="select",
    )
    users: Mapped[list["User"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "User",
        back_populates="tenant",
        cascade="all, delete-orphan",
        lazy="select",
    )
    # C-19: customers for this tenant
    customers: Mapped[list["Customer"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Customer",
        back_populates="tenant",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<Tenant id={self.id} name={self.name!r}>"
