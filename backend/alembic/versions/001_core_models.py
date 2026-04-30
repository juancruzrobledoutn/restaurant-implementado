"""001_core_models

Revision ID: 001_core_models
Revises:
Create Date: 2026-04-10

Creates the 4 foundational tables:
  - app_tenant: Restaurant organizations
  - branch: Physical locations per tenant
  - app_user: Staff members (app_ prefix: 'user' is PostgreSQL reserved word)
  - user_branch_role: M:N mapping users to branches with roles (composite PK)
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "001_core_models"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── app_tenant ─────────────────────────────────────────────────────────────
    op.create_table(
        "app_tenant",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        # AuditMixin fields
        sa.Column(
            "is_active",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
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
        sa.PrimaryKeyConstraint("id", name="pk_app_tenant"),
    )

    # ── branch ─────────────────────────────────────────────────────────────────
    op.create_table(
        "branch",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("address", sa.String(500), nullable=False),
        sa.Column("slug", sa.String(100), nullable=False),
        # AuditMixin fields
        sa.Column(
            "is_active",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
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
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["app_tenant.id"],
            name="fk_branch_tenant_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_branch"),
        sa.UniqueConstraint("tenant_id", "slug", name="uq_branch_tenant_slug"),
    )
    op.create_index("ix_branch_tenant_id", "branch", ["tenant_id"], unique=False)

    # ── app_user ───────────────────────────────────────────────────────────────
    op.create_table(
        "app_user",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("full_name", sa.String(255), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        # AuditMixin fields
        sa.Column(
            "is_active",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
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
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["app_tenant.id"],
            name="fk_user_tenant_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_app_user"),
        sa.UniqueConstraint("email", name="uq_user_email"),
    )
    op.create_index("ix_user_tenant_id", "app_user", ["tenant_id"], unique=False)

    # ── user_branch_role ───────────────────────────────────────────────────────
    op.create_table(
        "user_branch_role",
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("branch_id", sa.BigInteger(), nullable=False),
        sa.Column("role", sa.String(50), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["app_user.id"],
            name="fk_ubr_user_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["branch_id"],
            ["branch.id"],
            name="fk_ubr_branch_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "branch_id", "role", name="pk_user_branch_role"),
    )


def downgrade() -> None:
    # Drop in reverse dependency order
    op.drop_table("user_branch_role")
    op.drop_index("ix_user_tenant_id", table_name="app_user")
    op.drop_table("app_user")
    op.drop_index("ix_branch_tenant_id", table_name="branch")
    op.drop_table("branch")
    op.drop_table("app_tenant")
