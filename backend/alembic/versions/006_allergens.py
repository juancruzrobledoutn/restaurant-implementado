"""006_allergens

Revision ID: 006_allergens
Revises: 005_sectors_tables
Create Date: 2026-04-16

Creates allergen-related tables (C-05):
  - allergen: tenant-scoped allergen catalog with severity and mandatory flag
  - product_allergen: M:N junction between product and allergen
    (no AuditMixin — ephemeral junction, hard-delete on unlink)
  - allergen_cross_reaction: bidirectional cross-reactions between allergens
    (no AuditMixin — hard-delete on removal)

All tables include proper FK references, indexes, and uniqueness constraints.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic
revision: str = "006_allergens"
down_revision: Union[str, None] = "005_sectors_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── allergen ──────────────────────────────────────────────────────────────
    op.create_table(
        "allergen",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("icon", sa.String(255), nullable=True),
        sa.Column("description", sa.String(1000), nullable=True),
        sa.Column("is_mandatory", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("severity", sa.String(50), nullable=False),
        # AuditMixin fields
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by_id", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["app_tenant.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_allergen_tenant_id", "allergen", ["tenant_id"])

    # ── product_allergen ──────────────────────────────────────────────────────
    op.create_table(
        "product_allergen",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("product_id", sa.BigInteger(), nullable=False),
        sa.Column("allergen_id", sa.BigInteger(), nullable=False),
        sa.Column("presence_type", sa.String(50), nullable=False),
        sa.Column("risk_level", sa.String(50), nullable=False),
        sa.ForeignKeyConstraint(["product_id"], ["product.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["allergen_id"], ["allergen.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("product_id", "allergen_id", name="uq_product_allergen"),
    )
    op.create_index("ix_product_allergen_product_id", "product_allergen", ["product_id"])
    op.create_index("ix_product_allergen_allergen_id", "product_allergen", ["allergen_id"])

    # ── allergen_cross_reaction ────────────────────────────────────────────────
    op.create_table(
        "allergen_cross_reaction",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("allergen_id", sa.BigInteger(), nullable=False),
        sa.Column("related_allergen_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["allergen_id"], ["allergen.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["related_allergen_id"], ["allergen.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "allergen_id", "related_allergen_id", name="uq_allergen_cross_reaction"
        ),
    )
    op.create_index(
        "ix_allergen_cross_reaction_allergen_id", "allergen_cross_reaction", ["allergen_id"]
    )
    op.create_index(
        "ix_allergen_cross_reaction_related_allergen_id",
        "allergen_cross_reaction",
        ["related_allergen_id"],
    )


def downgrade() -> None:
    # Drop in reverse FK order
    op.drop_index("ix_allergen_cross_reaction_related_allergen_id", table_name="allergen_cross_reaction")
    op.drop_index("ix_allergen_cross_reaction_allergen_id", table_name="allergen_cross_reaction")
    op.drop_table("allergen_cross_reaction")

    op.drop_index("ix_product_allergen_allergen_id", table_name="product_allergen")
    op.drop_index("ix_product_allergen_product_id", table_name="product_allergen")
    op.drop_table("product_allergen")

    op.drop_index("ix_allergen_tenant_id", table_name="allergen")
    op.drop_table("allergen")
