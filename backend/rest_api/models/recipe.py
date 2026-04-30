"""
Recipe models: Recipe and RecipeIngredient junction table.

Tables:
  - recipe: a named recipe belonging to a tenant
  - recipe_ingredient: M:N junction between recipes and ingredients with quantity/unit

Design decisions:
  - Quantities use Numeric(10,3) — NOT float — to avoid precision issues
  - Units are stored as plain strings (e.g. "g", "kg", "ml", "unit", "tbsp")
  - Soft-deleting an ingredient does NOT cascade to recipe_ingredient (recipe history preserved)
  - Recipe is tenant-scoped (unique name per tenant)
"""
from decimal import Decimal

from sqlalchemy import BigInteger, ForeignKey, Index, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.infrastructure.db import Base
from rest_api.models.mixins import AuditMixin


class Recipe(Base, AuditMixin):
    """
    A named recipe belonging to a tenant.
    Links to ingredients via RecipeIngredient junction table.

    Uniqueness: (tenant_id, name) — no duplicate recipe names per tenant.
    """

    __tablename__ = "recipe"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_recipe_tenant_name"),
        Index("ix_recipe_tenant_id", "tenant_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("app_tenant.id", ondelete="RESTRICT"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(1000), nullable=True, default=None)

    # Relationships
    tenant: Mapped["Tenant"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Tenant",
        lazy="select",
    )
    recipe_ingredients: Mapped[list["RecipeIngredient"]] = relationship(
        "RecipeIngredient",
        back_populates="recipe",
        cascade="all, delete-orphan",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<Recipe id={self.id} name={self.name!r} tenant_id={self.tenant_id}>"


class RecipeIngredient(Base):
    """
    Junction table: which ingredients a recipe uses and in what quantities.

    AuditMixin NOT applied — this is a junction/association table.
    Uniqueness: (recipe_id, ingredient_id) — each ingredient appears once per recipe.

    quantity: Numeric(10,3) — never float — for precise recipe measurements.
    unit: plain string (e.g. "g", "kg", "ml", "l", "unit", "tbsp", "tsp")
    """

    __tablename__ = "recipe_ingredient"
    __table_args__ = (
        UniqueConstraint(
            "recipe_id", "ingredient_id", name="uq_recipe_ingredient_recipe_ingredient"
        ),
        # FK indexes — PostgreSQL does NOT auto-create indexes on FK columns
        Index("ix_recipe_ingredient_recipe_id", "recipe_id"),
        Index("ix_recipe_ingredient_ingredient_id", "ingredient_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    recipe_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("recipe.id", ondelete="CASCADE"),
        nullable=False,
    )
    ingredient_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("ingredient.id", ondelete="RESTRICT"),
        nullable=False,
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(10, 3), nullable=False)
    unit: Mapped[str] = mapped_column(String(50), nullable=False)

    # Relationships
    recipe: Mapped["Recipe"] = relationship(
        "Recipe",
        back_populates="recipe_ingredients",
        lazy="select",
    )
    ingredient: Mapped["Ingredient"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Ingredient",
        lazy="select",
    )

    def __repr__(self) -> str:
        return (
            f"<RecipeIngredient recipe_id={self.recipe_id} "
            f"ingredient_id={self.ingredient_id} quantity={self.quantity}{self.unit}>"
        )
