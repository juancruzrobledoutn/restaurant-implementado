"""003_menu_catalog

Revision ID: 003_menu_catalog
Revises: 002_user_2fa_fields
Create Date: 2026-04-15

Creates menu catalog tables (C-04):
  - category: branch-scoped menu categories with ordering
  - subcategory: category children with ordering
  - product: subcategory children with base price in cents
  - branch_product: per-branch pricing (price_cents) and availability (is_available)

All tables include AuditMixin fields: is_active, created_at, updated_at,
deleted_at, deleted_by_id.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "003_menu_catalog"
down_revision: Union[str, None] = "002_user_2fa_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── category ──────────────────────────────────────────────────────────────
    op.create_table(
        "category",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("branch_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("icon", sa.String(255), nullable=True),
        sa.Column("image", sa.String(500), nullable=True),
        sa.Column("order", sa.Integer(), nullable=False, server_default="0"),
        # AuditMixin fields
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by_id", sa.BigInteger(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["branch_id"], ["branch.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_category_branch_id", "category", ["branch_id"])

    # ── subcategory ───────────────────────────────────────────────────────────
    op.create_table(
        "subcategory",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("category_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("image", sa.String(500), nullable=True),
        sa.Column("order", sa.Integer(), nullable=False, server_default="0"),
        # AuditMixin fields
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by_id", sa.BigInteger(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["category_id"], ["category.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_subcategory_category_id", "subcategory", ["category_id"])

    # ── product ───────────────────────────────────────────────────────────────
    op.create_table(
        "product",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("subcategory_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.String(1000), nullable=True),
        sa.Column("price", sa.Integer(), nullable=False),  # base price in cents
        sa.Column("image", sa.String(500), nullable=True),
        sa.Column("featured", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("popular", sa.Boolean(), nullable=False, server_default="false"),
        # AuditMixin fields
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by_id", sa.BigInteger(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["subcategory_id"], ["subcategory.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_product_subcategory_id", "product", ["subcategory_id"])

    # ── branch_product ────────────────────────────────────────────────────────
    op.create_table(
        "branch_product",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("product_id", sa.BigInteger(), nullable=False),
        sa.Column("branch_id", sa.BigInteger(), nullable=False),
        sa.Column("price_cents", sa.Integer(), nullable=False),  # branch-specific price in cents
        sa.Column("is_available", sa.Boolean(), nullable=False, server_default="true"),
        # AuditMixin fields
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by_id", sa.BigInteger(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["product_id"], ["product.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["branch_id"], ["branch.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("product_id", "branch_id", name="uq_branch_product"),
    )
    op.create_index("ix_branch_product_product_id", "branch_product", ["product_id"])
    op.create_index("ix_branch_product_branch_id", "branch_product", ["branch_id"])


def downgrade() -> None:
    # Drop in reverse dependency order
    op.drop_index("ix_branch_product_branch_id", table_name="branch_product")
    op.drop_index("ix_branch_product_product_id", table_name="branch_product")
    op.drop_table("branch_product")

    op.drop_index("ix_product_subcategory_id", table_name="product")
    op.drop_table("product")

    op.drop_index("ix_subcategory_category_id", table_name="subcategory")
    op.drop_table("subcategory")

    op.drop_index("ix_category_branch_id", table_name="category")
    op.drop_table("category")
