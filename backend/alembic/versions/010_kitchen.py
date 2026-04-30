"""010_kitchen

Revision ID: 010_kitchen
Revises: 009_rounds
Create Date: 2026-04-17

Creates the kitchen-facing tables (C-11):
  - kitchen_ticket: per-round work unit, IN_PROGRESS → READY → DELIVERED
  - kitchen_ticket_item: 1:1 with non-voided round_items at ticket creation
  - service_call: diner's "llamar al mozo" — CREATED → ACKED → CLOSED

Key design decisions (design.md):
  - D-01: One ticket per round — unique constraint on kitchen_ticket.round_id.
  - D-03: Cancellation of a round from SUBMITTED+ soft-deletes its ticket
    (is_active=False). No CANCELED status in the ticket FSM.
  - D-04: SERVICE_CALL_CREATED goes via outbox (reliability). ACK/CLOSE
    events are best-effort direct Redis.
  - D-05: Duplicate-guard for service_call enforced at the service layer,
    not via a partial unique index (portability with SQLite tests).

  All FKs ondelete=RESTRICT — no accidental DB-level cascades.
  AuditMixin fields included verbatim (is_active, created_at, updated_at,
  deleted_at, deleted_by_id).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic
revision: str = "010_kitchen"
down_revision: Union[str, None] = "009_rounds"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── kitchen_ticket ────────────────────────────────────────────────────────
    op.create_table(
        "kitchen_ticket",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("round_id", sa.BigInteger(), nullable=False),
        sa.Column("branch_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="IN_PROGRESS",
        ),
        sa.Column(
            "priority",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ready_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.ForeignKeyConstraint(["branch_id"], ["branch.id"], ondelete="RESTRICT"),
        sa.CheckConstraint(
            "status IN ('IN_PROGRESS','READY','DELIVERED')",
            name="ck_kitchen_ticket_status_valid",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_kitchen_ticket_round",
        "kitchen_ticket",
        ["round_id"],
        unique=True,
    )
    op.create_index(
        "ix_kitchen_ticket_branch_status",
        "kitchen_ticket",
        ["branch_id", "status"],
    )

    # ── kitchen_ticket_item ───────────────────────────────────────────────────
    op.create_table(
        "kitchen_ticket_item",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("ticket_id", sa.BigInteger(), nullable=False),
        sa.Column("round_item_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "is_prepared",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
        sa.Column("prepared_at", sa.DateTime(timezone=True), nullable=True),
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
            ["ticket_id"], ["kitchen_ticket.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["round_item_id"], ["round_item.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_kitchen_ticket_item_ticket",
        "kitchen_ticket_item",
        ["ticket_id"],
    )
    op.create_index(
        "uq_kitchen_ticket_item_round_item",
        "kitchen_ticket_item",
        ["ticket_id", "round_item_id"],
        unique=True,
    )

    # ── service_call ──────────────────────────────────────────────────────────
    op.create_table(
        "service_call",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("session_id", sa.BigInteger(), nullable=False),
        sa.Column("table_id", sa.BigInteger(), nullable=False),
        sa.Column("branch_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="CREATED",
        ),
        sa.Column("acked_by_id", sa.BigInteger(), nullable=True),
        sa.Column("closed_by_id", sa.BigInteger(), nullable=True),
        sa.Column("acked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["table_id"], ["app_table.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(["branch_id"], ["branch.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["acked_by_id"], ["app_user.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["closed_by_id"], ["app_user.id"], ondelete="RESTRICT"
        ),
        sa.CheckConstraint(
            "status IN ('CREATED','ACKED','CLOSED')",
            name="ck_service_call_status_valid",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_service_call_session_status",
        "service_call",
        ["session_id", "status"],
    )
    op.create_index(
        "ix_service_call_branch_status",
        "service_call",
        ["branch_id", "status"],
    )


def downgrade() -> None:
    op.drop_index("ix_service_call_branch_status", table_name="service_call")
    op.drop_index("ix_service_call_session_status", table_name="service_call")
    op.drop_table("service_call")

    op.drop_index(
        "uq_kitchen_ticket_item_round_item", table_name="kitchen_ticket_item"
    )
    op.drop_index("ix_kitchen_ticket_item_ticket", table_name="kitchen_ticket_item")
    op.drop_table("kitchen_ticket_item")

    op.drop_index("ix_kitchen_ticket_branch_status", table_name="kitchen_ticket")
    op.drop_index("uq_kitchen_ticket_round", table_name="kitchen_ticket")
    op.drop_table("kitchen_ticket")
