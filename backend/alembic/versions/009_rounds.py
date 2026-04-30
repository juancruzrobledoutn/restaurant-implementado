"""009_rounds

Revision ID: 009_rounds
Revises: 008_staff_management
Create Date: 2026-04-17

Creates the round tables (C-10):
  - round: a round of orders for a table session, 7-state machine
  - round_item: line items within a round with void support

Key design decisions:
  - Round uses AuditMixin (soft-delete + audit trail). CANCELED is a STATE,
    not a soft-delete — a canceled round keeps is_active=True.
  - RoundItem uses AuditMixin for the same reasons.
  - All FKs ondelete=RESTRICT — no accidental DB-level cascades.
  - Unique (session_id, round_number) enforces sequential numbering per session.
  - CHECK constraints keep DB-level status and role values aligned with enums.
  - branch_id denormalized on round (= session.table.branch_id) for fast scoping.
  - Index (branch_id, status, submitted_at) supports the kitchen listing.
  - price_cents_snapshot on round_item captures the price at round creation —
    billing (C-12) reads it verbatim regardless of later menu changes.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic
revision: str = "009_rounds"
down_revision: Union[str, None] = "008_staff_management"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── round ─────────────────────────────────────────────────────────────────
    op.create_table(
        "round",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("session_id", sa.BigInteger(), nullable=False),
        sa.Column("branch_id", sa.BigInteger(), nullable=False),
        sa.Column("round_number", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="PENDING"),
        sa.Column("created_by_role", sa.String(20), nullable=False),
        sa.Column("created_by_diner_id", sa.BigInteger(), nullable=True),
        sa.Column("created_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("confirmed_by_id", sa.BigInteger(), nullable=True),
        sa.Column("submitted_by_id", sa.BigInteger(), nullable=True),
        sa.Column("canceled_by_id", sa.BigInteger(), nullable=True),
        sa.Column("cancel_reason", sa.String(500), nullable=True),
        # Transition timestamps
        sa.Column(
            "pending_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("in_kitchen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ready_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("served_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("canceled_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["session_id"], ["table_session.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(["branch_id"], ["branch.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["created_by_diner_id"], ["diner.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"], ["app_user.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["confirmed_by_id"], ["app_user.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["submitted_by_id"], ["app_user.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["canceled_by_id"], ["app_user.id"], ondelete="RESTRICT"
        ),
        sa.CheckConstraint(
            "status IN ('PENDING','CONFIRMED','SUBMITTED','IN_KITCHEN','READY','SERVED','CANCELED')",
            name="ck_round_status_valid",
        ),
        sa.CheckConstraint(
            "created_by_role IN ('DINER','WAITER','MANAGER','ADMIN')",
            name="ck_round_created_by_role_valid",
        ),
        sa.CheckConstraint("round_number > 0", name="ck_round_number_positive"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_round_session_active", "round", ["session_id", "is_active"])
    op.create_index(
        "ix_round_branch_status_submitted_at",
        "round",
        ["branch_id", "status", "submitted_at"],
    )
    op.create_index(
        "uq_round_session_number",
        "round",
        ["session_id", "round_number"],
        unique=True,
    )

    # ── round_item ────────────────────────────────────────────────────────────
    op.create_table(
        "round_item",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("round_id", sa.BigInteger(), nullable=False),
        sa.Column("product_id", sa.BigInteger(), nullable=False),
        sa.Column("diner_id", sa.BigInteger(), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("notes", sa.String(500), nullable=True),
        sa.Column("price_cents_snapshot", sa.Integer(), nullable=False),
        sa.Column(
            "is_voided",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
        sa.Column("void_reason", sa.String(500), nullable=True),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("voided_by_id", sa.BigInteger(), nullable=True),
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
        sa.ForeignKeyConstraint(["round_id"], ["round.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["product_id"], ["product.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["diner_id"], ["diner.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["voided_by_id"], ["app_user.id"], ondelete="RESTRICT"
        ),
        sa.CheckConstraint("quantity > 0", name="ck_round_item_quantity_positive"),
        sa.CheckConstraint(
            "price_cents_snapshot >= 0",
            name="ck_round_item_price_nonnegative",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_round_item_round", "round_item", ["round_id"])
    op.create_index(
        "ix_round_item_round_voided", "round_item", ["round_id", "is_voided"]
    )
    op.create_index("ix_round_item_product", "round_item", ["product_id"])


def downgrade() -> None:
    op.drop_index("ix_round_item_product", table_name="round_item")
    op.drop_index("ix_round_item_round_voided", table_name="round_item")
    op.drop_index("ix_round_item_round", table_name="round_item")
    op.drop_table("round_item")

    op.drop_index("uq_round_session_number", table_name="round")
    op.drop_index("ix_round_branch_status_submitted_at", table_name="round")
    op.drop_index("ix_round_session_active", table_name="round")
    op.drop_table("round")
