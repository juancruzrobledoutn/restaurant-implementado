"""005_sectors_tables

Revision ID: 005_sectors_tables
Revises: 004_ingredients_recipes_catalogs
Create Date: 2026-04-16

Creates branch sector, table, and waiter assignment tables (C-07):
  - branch_sector: physical zones within a branch (AuditMixin)
  - app_table: individual tables inside a sector (AuditMixin, app_ prefix: reserved word)
  - waiter_sector_assignment: ephemeral daily waiter→sector assignments (no AuditMixin)

Constraints:
  - UNIQUE(branch_id, code) on app_table — code must be unique per branch
  - UNIQUE(user_id, sector_id, date) on waiter_sector_assignment — one slot per day
  - INDEX(sector_id, date) on waiter_sector_assignment for fast daily lookups
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "005_sectors_tables"
down_revision: Union[str, None] = "004_ingredients_recipes_catalogs"
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
    # ── branch_sector ──────────────────────────────────────────────────────────
    op.create_table(
        "branch_sector",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("branch_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        *_audit_columns(),
        sa.ForeignKeyConstraint(
            ["branch_id"],
            ["branch.id"],
            name="fk_branch_sector_branch_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_branch_sector"),
    )
    op.create_index(
        "ix_branch_sector_branch_id", "branch_sector", ["branch_id"], unique=False
    )

    # ── app_table ──────────────────────────────────────────────────────────────
    op.create_table(
        "app_table",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("branch_id", sa.BigInteger(), nullable=False),
        sa.Column("sector_id", sa.BigInteger(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(50), nullable=False),
        sa.Column("capacity", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(20), server_default="AVAILABLE", nullable=False),
        *_audit_columns(),
        sa.ForeignKeyConstraint(
            ["branch_id"],
            ["branch.id"],
            name="fk_app_table_branch_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["sector_id"],
            ["branch_sector.id"],
            name="fk_app_table_sector_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_app_table"),
        sa.UniqueConstraint("branch_id", "code", name="uq_table_branch_code"),
    )
    op.create_index("ix_table_branch_id", "app_table", ["branch_id"], unique=False)
    op.create_index("ix_table_sector_id", "app_table", ["sector_id"], unique=False)

    # ── waiter_sector_assignment ────────────────────────────────────────────────
    op.create_table(
        "waiter_sector_assignment",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("sector_id", sa.BigInteger(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["app_user.id"],
            name="fk_waiter_assignment_user_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["sector_id"],
            ["branch_sector.id"],
            name="fk_waiter_assignment_sector_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_waiter_sector_assignment"),
        sa.UniqueConstraint(
            "user_id", "sector_id", "date",
            name="uq_waiter_sector_date",
        ),
    )
    op.create_index(
        "ix_waiter_sector_assignment_sector_date",
        "waiter_sector_assignment",
        ["sector_id", "date"],
        unique=False,
    )


def downgrade() -> None:
    # Drop in reverse dependency order (children before parents)
    op.drop_index(
        "ix_waiter_sector_assignment_sector_date",
        table_name="waiter_sector_assignment",
    )
    op.drop_table("waiter_sector_assignment")

    op.drop_index("ix_table_sector_id", table_name="app_table")
    op.drop_index("ix_table_branch_id", table_name="app_table")
    op.drop_table("app_table")

    op.drop_index("ix_branch_sector_branch_id", table_name="branch_sector")
    op.drop_table("branch_sector")
