"""
Menu catalog models: Category, Subcategory, Product, BranchProduct.

Architecture:
  - Category is branch-scoped (each branch has its own menu)
  - Subcategory belongs to a Category
  - Product belongs to a Subcategory with base price in cents
  - BranchProduct is the per-branch pricing/availability join table
    is_available (runtime toggle) != is_active (soft delete)

Rules:
  - ALL prices in cents (int), never float
  - Soft delete via AuditMixin (is_active=False)
  - NEVER query is_active == True — use is_active.is_(True)
"""
from sqlalchemy import BigInteger, Boolean, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.infrastructure.db import Base
from rest_api.models.mixins import AuditMixin


class Category(Base, AuditMixin):
    """
    Menu category belonging to a branch.

    Categories are branch-scoped: each branch curates its own menu structure.
    Ordered display via `order` field (gap-based: 10, 20, 30...).
    """

    __tablename__ = "category"
    __table_args__ = (
        Index("ix_category_branch_id", "branch_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    branch_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("branch.id", ondelete="RESTRICT"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    icon: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    image: Mapped[str | None] = mapped_column(String(500), nullable=True, default=None)
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Relationships
    branch: Mapped["Branch"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Branch",
        back_populates="categories",
    )
    subcategories: Mapped[list["Subcategory"]] = relationship(
        "Subcategory",
        back_populates="category",
        cascade="all, delete-orphan",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<Category id={self.id} name={self.name!r} branch_id={self.branch_id}>"


class Subcategory(Base, AuditMixin):
    """
    Subcategory belonging to a Category.

    Ordered display via `order` field (gap-based: 10, 20, 30...).
    """

    __tablename__ = "subcategory"
    __table_args__ = (
        Index("ix_subcategory_category_id", "category_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    category_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("category.id", ondelete="RESTRICT"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    image: Mapped[str | None] = mapped_column(String(500), nullable=True, default=None)
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Relationships
    category: Mapped["Category"] = relationship(
        "Category",
        back_populates="subcategories",
    )
    products: Mapped[list["Product"]] = relationship(
        "Product",
        back_populates="subcategory",
        cascade="all, delete-orphan",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<Subcategory id={self.id} name={self.name!r} category_id={self.category_id}>"


class Product(Base, AuditMixin):
    """
    Product belonging to a Subcategory.

    price is the base price in cents (integer). Never use float for money.
    featured/popular are editorial flags for display prominence.
    Products are linked to branches via BranchProduct (per-branch pricing + availability).
    """

    __tablename__ = "product"
    __table_args__ = (
        Index("ix_product_subcategory_id", "subcategory_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    subcategory_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("subcategory.id", ondelete="RESTRICT"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(1000), nullable=True, default=None)
    price: Mapped[int] = mapped_column(Integer, nullable=False)  # base price in cents
    image: Mapped[str | None] = mapped_column(String(500), nullable=True, default=None)
    featured: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    popular: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )

    # Relationships
    subcategory: Mapped["Subcategory"] = relationship(
        "Subcategory",
        back_populates="products",
    )
    branch_products: Mapped[list["BranchProduct"]] = relationship(
        "BranchProduct",
        back_populates="product",
        cascade="all, delete-orphan",
        lazy="select",
    )
    product_allergens: Mapped[list["ProductAllergen"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "ProductAllergen",
        back_populates="product",
        cascade="all, delete-orphan",
        lazy="selectin",  # Eager for public menu queries — avoids N+1
    )
    # C-10: round items referencing this product. ORM-only — no schema change.
    round_items: Mapped[list["RoundItem"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "RoundItem",
        back_populates="product",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<Product id={self.id} name={self.name!r} price={self.price}>"


class BranchProduct(Base, AuditMixin):
    """
    Per-branch product pricing and availability.

    Links a Product to a Branch with:
      - price_cents: branch-specific price override (in cents, always int)
      - is_available: runtime visibility toggle (e.g., "86'd" / out of stock)
        DISTINCT from is_active (soft delete).

    A product appears on the public menu ONLY when:
      - BranchProduct.is_active.is_(True)  (not soft-deleted)
      - BranchProduct.is_available.is_(True)  (currently in stock / visible)

    UniqueConstraint on (product_id, branch_id): a product can only have
    one BranchProduct per branch.
    """

    __tablename__ = "branch_product"
    __table_args__ = (
        UniqueConstraint("product_id", "branch_id", name="uq_branch_product"),
        Index("ix_branch_product_product_id", "product_id"),
        Index("ix_branch_product_branch_id", "branch_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("product.id", ondelete="RESTRICT"),
        nullable=False,
    )
    branch_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("branch.id", ondelete="RESTRICT"),
        nullable=False,
    )
    price_cents: Mapped[int] = mapped_column(Integer, nullable=False)  # branch-specific price
    is_available: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )

    # Relationships
    product: Mapped["Product"] = relationship(
        "Product",
        back_populates="branch_products",
    )
    branch: Mapped["Branch"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Branch",
        back_populates="branch_products",
    )

    def __repr__(self) -> str:
        return (
            f"<BranchProduct id={self.id} product_id={self.product_id} "
            f"branch_id={self.branch_id} price_cents={self.price_cents}>"
        )
