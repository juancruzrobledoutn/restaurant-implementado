"""
Allergen, ProductAllergen, and AllergenCrossReaction models.

Architecture:
  - Allergen is tenant-scoped (each tenant manages their own allergen catalog)
  - ProductAllergen is a junction between Product and Allergen (NO is_active — hard-delete)
  - AllergenCrossReaction tracks bidirectional cross-reactions between allergens

Rules:
  - Allergen uses AuditMixin (soft delete)
  - ProductAllergen has NO is_active field — it's an ephemeral junction (hard-delete on unlink)
  - AllergenCrossReaction has NO is_active field — hard-delete on removal
  - NEVER query is_active == True — use is_active.is_(True)
  - severity: mild / moderate / severe / life_threatening
  - presence_type: contains / may_contain / free_from
  - risk_level: mild / moderate / severe / life_threatening
"""
from sqlalchemy import BigInteger, Boolean, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.infrastructure.db import Base
from rest_api.models.mixins import AuditMixin


class Allergen(Base, AuditMixin):
    """
    Allergen definition scoped to a tenant.

    Tenants can define their own allergen catalog with severity levels,
    icons, and descriptions. is_mandatory flags regulatory allergens
    (e.g., the EU 14 major allergens).
    """

    __tablename__ = "allergen"
    __table_args__ = (
        Index("ix_allergen_tenant_id", "tenant_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("app_tenant.id", ondelete="RESTRICT"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    icon: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    description: Mapped[str | None] = mapped_column(String(1000), nullable=True, default=None)
    is_mandatory: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    # severity: mild / moderate / severe / life_threatening
    severity: Mapped[str] = mapped_column(String(50), nullable=False, default="moderate")

    # Relationships
    product_allergens: Mapped[list["ProductAllergen"]] = relationship(
        "ProductAllergen",
        back_populates="allergen",
        cascade="all, delete-orphan",
        lazy="select",
    )
    cross_reactions: Mapped[list["AllergenCrossReaction"]] = relationship(
        "AllergenCrossReaction",
        foreign_keys="AllergenCrossReaction.allergen_id",
        back_populates="allergen",
        cascade="all, delete-orphan",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<Allergen id={self.id} name={self.name!r} tenant_id={self.tenant_id}>"


class ProductAllergen(Base):
    """
    Junction table linking a Product to an Allergen.

    NO is_active field — this is an ephemeral junction: removing the link
    is a hard-delete. presence_type indicates how the allergen is present
    in the product (contains / may_contain / free_from).

    UniqueConstraint on (product_id, allergen_id) — a product can only be
    linked to the same allergen once.
    """

    __tablename__ = "product_allergen"
    __table_args__ = (
        UniqueConstraint("product_id", "allergen_id", name="uq_product_allergen"),
        Index("ix_product_allergen_product_id", "product_id"),
        Index("ix_product_allergen_allergen_id", "allergen_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("product.id", ondelete="CASCADE"),
        nullable=False,
    )
    allergen_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("allergen.id", ondelete="CASCADE"),
        nullable=False,
    )
    # presence_type: contains / may_contain / free_from
    presence_type: Mapped[str] = mapped_column(String(50), nullable=False)
    # risk_level: mild / moderate / severe / life_threatening
    risk_level: Mapped[str] = mapped_column(String(50), nullable=False)

    # Relationships
    product: Mapped["Product"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Product",
        back_populates="product_allergens",
    )
    allergen: Mapped["Allergen"] = relationship(
        "Allergen",
        back_populates="product_allergens",
    )

    def __repr__(self) -> str:
        return (
            f"<ProductAllergen id={self.id} product_id={self.product_id} "
            f"allergen_id={self.allergen_id} presence_type={self.presence_type!r}>"
        )


class AllergenCrossReaction(Base):
    """
    Records a cross-reaction between two allergens.

    Cross-reactions are stored bidirectionally: if allergen A reacts with B,
    there are two records: (A, B) and (B, A). This allows efficient querying
    in either direction.

    NO is_active field — hard-delete on removal.
    UniqueConstraint on (allergen_id, related_allergen_id).
    """

    __tablename__ = "allergen_cross_reaction"
    __table_args__ = (
        UniqueConstraint(
            "allergen_id", "related_allergen_id", name="uq_allergen_cross_reaction"
        ),
        Index("ix_allergen_cross_reaction_allergen_id", "allergen_id"),
        Index("ix_allergen_cross_reaction_related_allergen_id", "related_allergen_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    allergen_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("allergen.id", ondelete="CASCADE"),
        nullable=False,
    )
    related_allergen_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("allergen.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Relationships
    allergen: Mapped["Allergen"] = relationship(
        "Allergen",
        foreign_keys=[allergen_id],
        back_populates="cross_reactions",
    )
    related_allergen: Mapped["Allergen"] = relationship(
        "Allergen",
        foreign_keys=[related_allergen_id],
    )

    def __repr__(self) -> str:
        return (
            f"<AllergenCrossReaction id={self.id} "
            f"allergen_id={self.allergen_id} related_allergen_id={self.related_allergen_id}>"
        )
