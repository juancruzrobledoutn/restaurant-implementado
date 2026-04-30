"""002_user_2fa_fields

Revision ID: 002_user_2fa_fields
Revises: 001_core_models
Create Date: 2026-04-15

Adds 2FA and last_login_at fields to app_user table (C-03 auth change):
  - totp_secret: nullable string for storing TOTP secret
  - is_2fa_enabled: boolean flag (default False)
  - last_login_at: nullable timestamp for audit
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "002_user_2fa_fields"
down_revision: Union[str, None] = "001_core_models"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "app_user",
        sa.Column("totp_secret", sa.String(64), nullable=True),
    )
    op.add_column(
        "app_user",
        sa.Column(
            "is_2fa_enabled",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )
    op.add_column(
        "app_user",
        sa.Column(
            "last_login_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("app_user", "last_login_at")
    op.drop_column("app_user", "is_2fa_enabled")
    op.drop_column("app_user", "totp_secret")
