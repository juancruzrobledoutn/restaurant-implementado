"""004_ingredients_recipes_catalogs

Revision ID: 004_ingredients_recipes_catalogs
Revises: 003_menu_catalog
Create Date: 2026-04-15

Creates ingredient, recipe, and catalog tables (C-06):
  - ingredient_group: top-level tenant-scoped ingredient categories
  - ingredient: specific ingredients within a group (tenant_id denormalized)
  - sub_ingredient: components of an ingredient
  - recipe: named tenant-scoped recipe
  - recipe_ingredient: M:N junction with quantity (Numeric) and unit
  - cooking_method: tenant-scoped lookup catalog
  - flavor_profile: tenant-scoped lookup catalog
  - texture_profile: tenant-scoped lookup catalog
  - cuisine_type: tenant-scoped lookup catalog

All tables include AuditMixin fields except recipe_ingredient (junction table).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "004_ingredients_recipes_catalogs"
down_revision: Union[str, None] = "003_menu_catalog"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _audit_columns() -> list:
    """Return standard AuditMixin columns for CREATE TABLE statements."""
    return [
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by_id", sa.BigInteger(), nullable=True),
    ]


def upgrade() -> None:
    # ── ingredient_group ────────────────────────────────────────────────────────
    op.create_table(
        "ingredient_group",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        *_audit_columns(),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["app_tenant.id"],
            name="fk_ingredient_group_tenant_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_ingredient_group"),
        sa.UniqueConstraint(
            "tenant_id", "name", name="uq_ingredient_group_tenant_name"
        ),
    )
    op.create_index(
        "ix_ingredient_group_tenant_id", "ingredient_group", ["tenant_id"], unique=False
    )

    # ── ingredient ──────────────────────────────────────────────────────────────
    op.create_table(
        "ingredient",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("group_id", sa.BigInteger(), nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        *_audit_columns(),
        sa.ForeignKeyConstraint(
            ["group_id"],
            ["ingredient_group.id"],
            name="fk_ingredient_group_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["app_tenant.id"],
            name="fk_ingredient_tenant_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_ingredient"),
        sa.UniqueConstraint("group_id", "name", name="uq_ingredient_group_name"),
    )
    op.create_index(
        "ix_ingredient_tenant_id", "ingredient", ["tenant_id"], unique=False
    )

    # ── sub_ingredient ──────────────────────────────────────────────────────────
    op.create_table(
        "sub_ingredient",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("ingredient_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        *_audit_columns(),
        sa.ForeignKeyConstraint(
            ["ingredient_id"],
            ["ingredient.id"],
            name="fk_sub_ingredient_ingredient_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_sub_ingredient"),
        sa.UniqueConstraint(
            "ingredient_id", "name", name="uq_sub_ingredient_ingredient_name"
        ),
    )

    # ── recipe ──────────────────────────────────────────────────────────────────
    op.create_table(
        "recipe",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.String(1000), nullable=True),
        *_audit_columns(),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["app_tenant.id"],
            name="fk_recipe_tenant_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_recipe"),
        sa.UniqueConstraint("tenant_id", "name", name="uq_recipe_tenant_name"),
    )
    op.create_index("ix_recipe_tenant_id", "recipe", ["tenant_id"], unique=False)

    # ── recipe_ingredient (junction — no AuditMixin) ────────────────────────────
    op.create_table(
        "recipe_ingredient",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("recipe_id", sa.BigInteger(), nullable=False),
        sa.Column("ingredient_id", sa.BigInteger(), nullable=False),
        sa.Column("quantity", sa.Numeric(10, 3), nullable=False),
        sa.Column("unit", sa.String(50), nullable=False),
        sa.ForeignKeyConstraint(
            ["recipe_id"],
            ["recipe.id"],
            name="fk_recipe_ingredient_recipe_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["ingredient_id"],
            ["ingredient.id"],
            name="fk_recipe_ingredient_ingredient_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_recipe_ingredient"),
        sa.UniqueConstraint(
            "recipe_id",
            "ingredient_id",
            name="uq_recipe_ingredient_recipe_ingredient",
        ),
    )

    # ── cooking_method ──────────────────────────────────────────────────────────
    op.create_table(
        "cooking_method",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        *_audit_columns(),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["app_tenant.id"],
            name="fk_cooking_method_tenant_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_cooking_method"),
        sa.UniqueConstraint("tenant_id", "name", name="uq_cooking_method_tenant_name"),
    )
    op.create_index(
        "ix_cooking_method_tenant_id", "cooking_method", ["tenant_id"], unique=False
    )

    # ── flavor_profile ──────────────────────────────────────────────────────────
    op.create_table(
        "flavor_profile",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        *_audit_columns(),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["app_tenant.id"],
            name="fk_flavor_profile_tenant_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_flavor_profile"),
        sa.UniqueConstraint("tenant_id", "name", name="uq_flavor_profile_tenant_name"),
    )
    op.create_index(
        "ix_flavor_profile_tenant_id", "flavor_profile", ["tenant_id"], unique=False
    )

    # ── texture_profile ─────────────────────────────────────────────────────────
    op.create_table(
        "texture_profile",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        *_audit_columns(),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["app_tenant.id"],
            name="fk_texture_profile_tenant_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_texture_profile"),
        sa.UniqueConstraint("tenant_id", "name", name="uq_texture_profile_tenant_name"),
    )
    op.create_index(
        "ix_texture_profile_tenant_id", "texture_profile", ["tenant_id"], unique=False
    )

    # ── cuisine_type ────────────────────────────────────────────────────────────
    op.create_table(
        "cuisine_type",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        *_audit_columns(),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["app_tenant.id"],
            name="fk_cuisine_type_tenant_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_cuisine_type"),
        sa.UniqueConstraint("tenant_id", "name", name="uq_cuisine_type_tenant_name"),
    )
    op.create_index(
        "ix_cuisine_type_tenant_id", "cuisine_type", ["tenant_id"], unique=False
    )


def downgrade() -> None:
    # Drop in reverse dependency order (children before parents)
    op.drop_index("ix_cuisine_type_tenant_id", table_name="cuisine_type")
    op.drop_table("cuisine_type")

    op.drop_index("ix_texture_profile_tenant_id", table_name="texture_profile")
    op.drop_table("texture_profile")

    op.drop_index("ix_flavor_profile_tenant_id", table_name="flavor_profile")
    op.drop_table("flavor_profile")

    op.drop_index("ix_cooking_method_tenant_id", table_name="cooking_method")
    op.drop_table("cooking_method")

    op.drop_table("recipe_ingredient")

    op.drop_index("ix_recipe_tenant_id", table_name="recipe")
    op.drop_table("recipe")

    op.drop_table("sub_ingredient")

    op.drop_index("ix_ingredient_tenant_id", table_name="ingredient")
    op.drop_table("ingredient")

    op.drop_index("ix_ingredient_group_tenant_id", table_name="ingredient_group")
    op.drop_table("ingredient_group")
