"""011_billing

Revision ID: 011_billing
Revises: 010_kitchen
Create Date: 2026-04-18

Creates billing tables (C-12):
  - app_check: one check per table session (REQUESTED → PAID)
  - charge: per-diner billing charges (amount_cents > 0)
  - payment: payment attempts (PENDING → APPROVED | REJECTED)
  - allocation: FIFO junction linking payments to charges

Key design decisions (design.md):
  - D-01: `app_check` because `check` is SQL reserved word.
  - D-02: FIFO allocation via junction table — no `paid_cents` denormalization.
  - D-03: PaymentGateway ABC + MercadoPagoGateway — never inline in router.
  - D-04: partial unique index on payment.external_id WHERE NOT NULL (idempotency).
  - D-05: Outbox for all 4 financial events (at-least-once).
  - D-06: `app_check.session_id` unique constraint (one check per session).

Table creation order (respects FK chain):
  app_check → charge → payment → allocation

All FKs use ondelete=RESTRICT — no accidental DB-level cascades.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "011_billing"
down_revision = "010_kitchen"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ─── app_check ────────────────────────────────────────────────────────────
    op.create_table(
        "app_check",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column(
            "session_id",
            sa.BigInteger(),
            sa.ForeignKey("table_session.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "branch_id",
            sa.BigInteger(),
            sa.ForeignKey("branch.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "tenant_id",
            sa.BigInteger(),
            sa.ForeignKey("app_tenant.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("total_cents", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="REQUESTED",
        ),
        # AuditMixin fields
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
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
        # Constraints
        sa.CheckConstraint(
            "status IN ('REQUESTED', 'PAID')",
            name="ck_app_check_status_valid",
        ),
        sa.CheckConstraint(
            "total_cents >= 0",
            name="ck_app_check_total_nonnegative",
        ),
        sa.UniqueConstraint("session_id", name="uq_app_check_session_id"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_app_check_session_id", "app_check", ["session_id"])
    op.create_index("ix_app_check_tenant_id", "app_check", ["tenant_id"])

    # ─── charge ───────────────────────────────────────────────────────────────
    op.create_table(
        "charge",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column(
            "check_id",
            sa.BigInteger(),
            sa.ForeignKey("app_check.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "diner_id",
            sa.BigInteger(),
            sa.ForeignKey("diner.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        # Constraints
        sa.CheckConstraint("amount_cents > 0", name="ck_charge_amount_positive"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_charge_check_id", "charge", ["check_id"])
    op.create_index("ix_charge_created_at", "charge", ["created_at"])

    # ─── payment ──────────────────────────────────────────────────────────────
    op.create_table(
        "payment",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column(
            "check_id",
            sa.BigInteger(),
            sa.ForeignKey("app_check.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.Column("method", sa.String(20), nullable=False),
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="PENDING",
        ),
        sa.Column("external_id", sa.String(255), nullable=True),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        # Constraints
        sa.CheckConstraint("amount_cents > 0", name="ck_payment_amount_positive"),
        sa.CheckConstraint(
            "status IN ('PENDING', 'APPROVED', 'REJECTED')",
            name="ck_payment_status_valid",
        ),
        sa.CheckConstraint(
            "method IN ('cash', 'card', 'transfer', 'mercadopago')",
            name="ck_payment_method_valid",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_payment_check_id", "payment", ["check_id"])
    # Partial unique index — idempotency for MP external_id
    op.create_index(
        "uq_payment_external_id",
        "payment",
        ["external_id"],
        unique=True,
        postgresql_where=sa.text("external_id IS NOT NULL"),
    )

    # ─── allocation ───────────────────────────────────────────────────────────
    op.create_table(
        "allocation",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column(
            "charge_id",
            sa.BigInteger(),
            sa.ForeignKey("charge.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "payment_id",
            sa.BigInteger(),
            sa.ForeignKey("payment.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        # Constraints
        sa.CheckConstraint("amount_cents > 0", name="ck_allocation_amount_positive"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_allocation_charge_id_payment_id",
        "allocation",
        ["charge_id", "payment_id"],
    )


def downgrade() -> None:
    # Drop in reverse FK order: allocation → payment → charge → app_check
    op.drop_index("ix_allocation_charge_id_payment_id", table_name="allocation")
    op.drop_table("allocation")

    op.drop_index("uq_payment_external_id", table_name="payment")
    op.drop_index("ix_payment_check_id", table_name="payment")
    op.drop_table("payment")

    op.drop_index("ix_charge_created_at", table_name="charge")
    op.drop_index("ix_charge_check_id", table_name="charge")
    op.drop_table("charge")

    op.drop_index("ix_app_check_tenant_id", table_name="app_check")
    op.drop_index("ix_app_check_session_id", table_name="app_check")
    op.drop_table("app_check")
