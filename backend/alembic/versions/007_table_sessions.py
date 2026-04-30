"""007_table_sessions

Revision ID: 007_table_sessions
Revises: 006_allergens
Create Date: 2026-04-17

Creates table session runtime tables (C-08):
  - table_session: runtime session record for an active table (OPEN/PAYING/CLOSED)
  - diner: a person seated at a table session
  - cart_item: ephemeral item in a diner's cart (hard-deleted on session close)

Key design decisions:
  - TableSession has AuditMixin (soft delete + audit trail)
  - Diner has AuditMixin (soft delete + audit trail)
  - CartItem has NO AuditMixin — ephemeral, hard-deleted when session closes
  - Partial unique index enforces single-active-session per table (D-02)
  - All FKs ondelete=RESTRICT to prevent accidental DB-level cascades
  - branch_id denormalized on table_session for fast WS routing (D-06)
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic
revision: str = "007_table_sessions"
down_revision: Union[str, None] = "006_allergens"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── table_session ─────────────────────────────────────────────────────────
    op.create_table(
        "table_session",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("table_id", sa.BigInteger(), nullable=False),
        sa.Column("branch_id", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="OPEN"),
        # AuditMixin fields
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by_id", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["table_id"], ["app_table.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["branch_id"], ["branch.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_table_session_table_id", "table_session", ["table_id"])
    op.create_index("ix_table_session_branch_id", "table_session", ["branch_id"])
    op.create_index("ix_table_session_table_active", "table_session", ["table_id", "is_active"])
    # Partial unique index — single active session per table (D-02)
    op.create_index(
        "uq_table_session_active_per_table",
        "table_session",
        ["table_id"],
        unique=True,
        postgresql_where=sa.text("is_active AND status IN ('OPEN', 'PAYING')"),
    )

    # ── diner ─────────────────────────────────────────────────────────────────
    op.create_table(
        "diner",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("session_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("device_id", sa.String(128), nullable=True),
        sa.Column("customer_id", sa.BigInteger(), nullable=True),
        # AuditMixin fields
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by_id", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["session_id"], ["table_session.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_diner_session_id", "diner", ["session_id"])

    # ── cart_item ─────────────────────────────────────────────────────────────
    op.create_table(
        "cart_item",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("session_id", sa.BigInteger(), nullable=False),
        sa.Column("diner_id", sa.BigInteger(), nullable=False),
        sa.Column("product_id", sa.BigInteger(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("notes", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("quantity > 0", name="ck_cart_item_quantity_positive"),
        sa.ForeignKeyConstraint(["session_id"], ["table_session.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["diner_id"], ["diner.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["product_id"], ["product.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cart_item_session_id", "cart_item", ["session_id"])
    op.create_index("ix_cart_item_session_diner", "cart_item", ["session_id", "diner_id"])


def downgrade() -> None:
    # Drop in reverse FK order
    op.drop_index("ix_cart_item_session_diner", table_name="cart_item")
    op.drop_index("ix_cart_item_session_id", table_name="cart_item")
    op.drop_table("cart_item")

    op.drop_index("ix_diner_session_id", table_name="diner")
    op.drop_table("diner")

    # Drop partial unique index before dropping table_session
    op.drop_index("uq_table_session_active_per_table", table_name="table_session")
    op.drop_index("ix_table_session_table_active", table_name="table_session")
    op.drop_index("ix_table_session_branch_id", table_name="table_session")
    op.drop_index("ix_table_session_table_id", table_name="table_session")
    op.drop_table("table_session")
