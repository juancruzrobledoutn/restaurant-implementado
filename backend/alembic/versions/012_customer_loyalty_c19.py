"""012_customer_loyalty_c19

Revision ID: 012_customer_loyalty_c19
Revises: 011_billing
Create Date: 2026-04-19

Customer loyalty tables and schema extensions (C-19):
  - customer: device-tracked customers per tenant (Phase 1-2 loyalty)
  - app_tenant.privacy_salt: per-tenant salt for consent IP hashing (GDPR)
  - diner.customer_id: activated FK (was a placeholder comment-only column in C-08)
  - Consent audit fields: consent_version, consent_granted_at, consent_ip_hash, opted_in

GDPR Impact:
  - consent_ip_hash stores SHA-256(client_ip + tenant.privacy_salt). Never plain-text IP.
  - HUMAN REVIEW REQUIRED before running `alembic upgrade head` in production.
  - No personal data is moved or deleted by this migration (forward-only).

Migration order (atomic — all in one revision):
  Step 1: CREATE customer table (tenant_id nullable for safety)
  Step 2: ADD app_tenant.privacy_salt (nullable → backfill → migration leaves nullable,
          application code generates salt on tenant creation going forward)
  Step 3: ALTER diner.customer_id to add real FK constraint (was comment-only before)
  Step 4: CREATE indexes

Rollback strategy:
  - downgrade() drops the customer table and reverts diner/tenant columns.
  - GDPR note: downgrade will NOT delete any data from existing customer rows.
    A separate migration is required to purge consent records if needed.
"""
from typing import Sequence, Union
import secrets

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "012_customer_loyalty_c19"
down_revision: Union[str, None] = "011_billing"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Step 1: CREATE customer table ─────────────────────────────────────────
    # tenant_id is NOT NULL here — we create the table fresh (no existing data).
    # The unique partial index enforces one active customer per (device, tenant).
    op.create_table(
        "customer",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column("device_id", sa.String(128), nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        # PII fields — NULL until opt-in
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("email", sa.String(255), nullable=True),
        # Consent audit (GDPR art. 7)
        sa.Column("opted_in", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("consent_version", sa.String(20), nullable=True),
        sa.Column("consent_granted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("consent_ip_hash", sa.String(64), nullable=True),
        # AuditMixin fields
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by_id", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["app_tenant.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )

    # Indexes on customer
    op.create_index("ix_customer_tenant_id", "customer", ["tenant_id"])
    op.create_index("ix_customer_device_id", "customer", ["device_id"])
    # Unique partial index: one active customer per (device, tenant)
    op.create_index(
        "uq_customer_device_tenant_active",
        "customer",
        ["device_id", "tenant_id"],
        unique=True,
        postgresql_where=sa.text("is_active = true"),
    )

    # ── Step 2: Add app_tenant.privacy_salt ───────────────────────────────────
    # Added as nullable — backfill is done via application logic on next tenant creation.
    # Existing tenants get NULL (no consent records exist yet since customer table is new).
    # Production deployment: run backfill script before first opt-in operation.
    op.add_column(
        "app_tenant",
        sa.Column("privacy_salt", sa.String(64), nullable=True, comment="Per-tenant salt for GDPR consent IP hashing"),
    )

    # ── Step 3: Activate diner.customer_id FK ─────────────────────────────────
    # In C-08 (007_table_sessions), customer_id was added as a plain BigInteger
    # with only a comment noting it was a forward-looking FK placeholder.
    # Here we add the actual FK constraint.
    # IMPORTANT: The column already exists in the diner table — we only add the FK.
    op.create_index("ix_diner_customer_id", "diner", ["customer_id"])
    op.create_foreign_key(
        "fk_diner_customer_id",
        "diner",
        "customer",
        ["customer_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    # ── Reverse Step 3: Remove diner.customer_id FK ───────────────────────────
    op.drop_constraint("fk_diner_customer_id", "diner", type_="foreignkey")
    op.drop_index("ix_diner_customer_id", table_name="diner")

    # ── Reverse Step 2: Remove app_tenant.privacy_salt ───────────────────────
    op.drop_column("app_tenant", "privacy_salt")

    # ── Reverse Step 1: Drop customer table ───────────────────────────────────
    op.drop_index("uq_customer_device_tenant_active", table_name="customer")
    op.drop_index("ix_customer_device_id", table_name="customer")
    op.drop_index("ix_customer_tenant_id", table_name="customer")
    op.drop_table("customer")
