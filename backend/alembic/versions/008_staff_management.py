"""008_staff_management

Revision ID: 008_staff_management
Revises: 007_table_sessions
Create Date: 2026-04-17

Creates staff-management tables (C-13):
  - outbox_event: transactional outbox for reliable event publishing
  - promotion: tenant-scoped promotional offer with time bounds
  - promotion_branch: M:N junction — promotion ↔ branch
  - promotion_item: M:N junction — promotion ↔ product
  - push_subscription: WebPush VAPID subscription records per user/device

Key design decisions (from design.md):
  - D-01: OutboxEvent lives in C-13 — decouples infra from business changes
  - D-02: outbox worker deferred to C-10 — partial index supports future polling
  - D-04: push_subscription.endpoint UNIQUE global (VAPID endpoints are globally unique)
  - D-08: single migration for all 5 tables (all independent, no cross-FKs)
  - Partial index ix_outbox_pending WHERE processed_at IS NULL for worker queries
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic
revision: str = "008_staff_management"
down_revision: Union[str, None] = "007_table_sessions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── outbox_event ──────────────────────────────────────────────────────────
    op.create_table(
        "outbox_event",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("event_type", sa.String(100), nullable=False),
        sa.Column("payload", JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    # Partial index — fast polling for background worker (events WHERE processed_at IS NULL)
    op.create_index(
        "ix_outbox_pending",
        "outbox_event",
        ["processed_at"],
        postgresql_where=sa.text("processed_at IS NULL"),
    )
    op.create_index(
        "ix_outbox_event_type_created",
        "outbox_event",
        ["event_type", "created_at"],
    )

    # ── promotion ─────────────────────────────────────────────────────────────
    op.create_table(
        "promotion",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.String(1000), nullable=True),
        sa.Column("price", sa.Integer(), nullable=False),  # cents
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.Column("promotion_type_id", sa.BigInteger(), nullable=True),
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
        sa.ForeignKeyConstraint(["tenant_id"], ["app_tenant.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_promotion_tenant_id", "promotion", ["tenant_id"])
    op.create_index(
        "ix_promotion_tenant_dates",
        "promotion",
        ["tenant_id", "start_date", "end_date"],
    )

    # ── promotion_branch ──────────────────────────────────────────────────────
    op.create_table(
        "promotion_branch",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("promotion_id", sa.BigInteger(), nullable=False),
        sa.Column("branch_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["promotion_id"], ["promotion.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["branch_id"], ["branch.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("promotion_id", "branch_id", name="uq_promotion_branch"),
    )
    op.create_index(
        "ix_promotion_branch_branch_id", "promotion_branch", ["branch_id"]
    )

    # ── promotion_item ────────────────────────────────────────────────────────
    op.create_table(
        "promotion_item",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("promotion_id", sa.BigInteger(), nullable=False),
        sa.Column("product_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["promotion_id"], ["promotion.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["product_id"], ["product.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("promotion_id", "product_id", name="uq_promotion_item"),
    )
    op.create_index(
        "ix_promotion_item_product_id", "promotion_item", ["product_id"]
    )

    # ── push_subscription ─────────────────────────────────────────────────────
    op.create_table(
        "push_subscription",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("endpoint", sa.String(2048), nullable=False),
        sa.Column("p256dh_key", sa.String(255), nullable=False),
        sa.Column("auth_key", sa.String(255), nullable=False),
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
        sa.ForeignKeyConstraint(["user_id"], ["app_user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("endpoint", name="uq_push_subscription_endpoint"),
    )
    op.create_index("ix_push_subscription_user_id", "push_subscription", ["user_id"])


def downgrade() -> None:
    # Drop in reverse dependency order (no cross-FKs — order is arbitrary but consistent)
    op.drop_index("ix_push_subscription_user_id", table_name="push_subscription")
    op.drop_table("push_subscription")

    op.drop_index("ix_promotion_item_product_id", table_name="promotion_item")
    op.drop_table("promotion_item")

    op.drop_index("ix_promotion_branch_branch_id", table_name="promotion_branch")
    op.drop_table("promotion_branch")

    op.drop_index("ix_promotion_tenant_dates", table_name="promotion")
    op.drop_index("ix_promotion_tenant_id", table_name="promotion")
    op.drop_table("promotion")

    op.drop_index("ix_outbox_event_type_created", table_name="outbox_event")
    op.drop_index("ix_outbox_pending", table_name="outbox_event")
    op.drop_table("outbox_event")
