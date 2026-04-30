"""
Tenant-scoped catalog lookup tables.

All four catalog models share an identical structure:
  - id (BigInteger PK autoincrement)
  - tenant_id (BigInteger FK to app_tenant, NOT NULL)
  - name (String 255, NOT NULL)
  - AuditMixin fields (is_active, created_at, updated_at, deleted_at, deleted_by_id)
  - Unique constraint on (tenant_id, name)
  - B-tree index on tenant_id

Tables:
  - cooking_method: e.g. "Grilled", "Fried", "Steamed"
  - flavor_profile: e.g. "Umami", "Sweet", "Spicy"
  - texture_profile: e.g. "Crispy", "Creamy", "Chewy"
  - cuisine_type: e.g. "Italian", "Japanese", "Argentine"

Used by CatalogService (generic/parameterized — avoids code duplication).
"""
from sqlalchemy import BigInteger, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.infrastructure.db import Base
from rest_api.models.mixins import AuditMixin


class CookingMethod(Base, AuditMixin):
    """Catalog of cooking methods, tenant-scoped. Example: Grilled, Fried, Steamed."""

    __tablename__ = "cooking_method"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_cooking_method_tenant_name"),
        Index("ix_cooking_method_tenant_id", "tenant_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("app_tenant.id", ondelete="RESTRICT"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    tenant: Mapped["Tenant"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Tenant",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<CookingMethod id={self.id} name={self.name!r}>"


class FlavorProfile(Base, AuditMixin):
    """Catalog of flavor profiles, tenant-scoped. Example: Umami, Sweet, Spicy."""

    __tablename__ = "flavor_profile"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_flavor_profile_tenant_name"),
        Index("ix_flavor_profile_tenant_id", "tenant_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("app_tenant.id", ondelete="RESTRICT"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    tenant: Mapped["Tenant"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Tenant",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<FlavorProfile id={self.id} name={self.name!r}>"


class TextureProfile(Base, AuditMixin):
    """Catalog of texture profiles, tenant-scoped. Example: Crispy, Creamy, Chewy."""

    __tablename__ = "texture_profile"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_texture_profile_tenant_name"),
        Index("ix_texture_profile_tenant_id", "tenant_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("app_tenant.id", ondelete="RESTRICT"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    tenant: Mapped["Tenant"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Tenant",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<TextureProfile id={self.id} name={self.name!r}>"


class CuisineType(Base, AuditMixin):
    """Catalog of cuisine types, tenant-scoped. Example: Italian, Japanese, Argentine."""

    __tablename__ = "cuisine_type"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_cuisine_type_tenant_name"),
        Index("ix_cuisine_type_tenant_id", "tenant_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("app_tenant.id", ondelete="RESTRICT"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    tenant: Mapped["Tenant"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Tenant",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<CuisineType id={self.id} name={self.name!r}>"
