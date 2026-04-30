"""
Ingredient hierarchy models: IngredientGroup → Ingredient → SubIngredient.

Tables:
  - ingredient_group: top-level tenant-scoped category (e.g. "Dairy")
  - ingredient: a specific ingredient within a group (e.g. "Whole Milk")
  - sub_ingredient: a component of an ingredient (e.g. "Lactose")

Hierarchy rules:
  - IngredientGroup has tenant_id directly (FK to app_tenant)
  - Ingredient has both group_id (FK) and tenant_id (denormalized for query efficiency)
  - SubIngredient is accessed only through its parent ingredient (no direct tenant_id needed)
  - Soft delete cascades: group → ingredients → sub-ingredients (enforced in IngredientService)

Uniqueness:
  - (tenant_id, name) unique on ingredient_group
  - (group_id, name) unique on ingredient
  - (ingredient_id, name) unique on sub_ingredient
"""
from sqlalchemy import BigInteger, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.infrastructure.db import Base
from rest_api.models.mixins import AuditMixin


class IngredientGroup(Base, AuditMixin):
    """
    Top-level ingredient category, scoped to a tenant.
    Example: "Dairy", "Vegetables", "Proteins"
    """

    __tablename__ = "ingredient_group"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_ingredient_group_tenant_name"),
        Index("ix_ingredient_group_tenant_id", "tenant_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("app_tenant.id", ondelete="RESTRICT"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Relationships
    tenant: Mapped["Tenant"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Tenant",
        lazy="select",
    )
    ingredients: Mapped[list["Ingredient"]] = relationship(
        "Ingredient",
        back_populates="group",
        cascade="all, delete-orphan",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<IngredientGroup id={self.id} name={self.name!r} tenant_id={self.tenant_id}>"


class Ingredient(Base, AuditMixin):
    """
    A specific ingredient within a group.
    Example: "Whole Milk" within "Dairy".

    tenant_id is denormalized here (copied from parent group) for efficient filtering.
    This follows the project convention of ALWAYS filtering directly by tenant_id.
    """

    __tablename__ = "ingredient"
    __table_args__ = (
        UniqueConstraint("group_id", "name", name="uq_ingredient_group_name"),
        Index("ix_ingredient_tenant_id", "tenant_id"),
        Index("ix_ingredient_group_id", "group_id"),  # FK index — PG does NOT auto-create
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    group_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("ingredient_group.id", ondelete="RESTRICT"),
        nullable=False,
    )
    tenant_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("app_tenant.id", ondelete="RESTRICT"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Relationships
    group: Mapped["IngredientGroup"] = relationship(
        "IngredientGroup",
        back_populates="ingredients",
        lazy="select",
    )
    sub_ingredients: Mapped[list["SubIngredient"]] = relationship(
        "SubIngredient",
        back_populates="ingredient",
        cascade="all, delete-orphan",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<Ingredient id={self.id} name={self.name!r} group_id={self.group_id}>"


class SubIngredient(Base, AuditMixin):
    """
    A component/sub-item of an ingredient.
    Example: "Lactose" within "Whole Milk".

    No direct tenant_id — always accessed through parent ingredient.
    """

    __tablename__ = "sub_ingredient"
    __table_args__ = (
        UniqueConstraint("ingredient_id", "name", name="uq_sub_ingredient_ingredient_name"),
        Index("ix_sub_ingredient_ingredient_id", "ingredient_id"),  # FK index — PG does NOT auto-create
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    ingredient_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("ingredient.id", ondelete="RESTRICT"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Relationships
    ingredient: Mapped["Ingredient"] = relationship(
        "Ingredient",
        back_populates="sub_ingredients",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<SubIngredient id={self.id} name={self.name!r} ingredient_id={self.ingredient_id}>"
