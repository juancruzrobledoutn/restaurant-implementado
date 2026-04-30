"""013_branch_settings_fields_c28

Revision ID: 013_branch_settings_fields_c28
Revises: 012_customer_loyalty_c19
Create Date: 2026-04-21

Branch settings fields (C-28):
  - branch.phone:         VARCHAR(50) NULL — contact phone
  - branch.timezone:      VARCHAR(64) NOT NULL DEFAULT 'America/Argentina/Buenos_Aires'
  - branch.opening_hours: JSONB NULL — weekly schedule {mon..sun: [{open, close}]}

Migration is fully reversible.
  - phone and opening_hours are nullable (backfill optional).
  - timezone has a DEFAULT so existing rows get 'America/Argentina/Buenos_Aires'.

Deploy sequence:
  1. Run this migration FIRST before deploying backend changes.
  2. Deploy backend (new settings endpoints).
  3. Deploy frontend (new /settings page).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "013_branch_settings_fields_c28"
down_revision: Union[str, None] = "012_customer_loyalty_c19"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # phone — nullable, no default (backfill optional)
    op.add_column(
        "branch",
        sa.Column("phone", sa.String(50), nullable=True),
    )

    # timezone — NOT NULL with DEFAULT so existing rows get a value
    op.add_column(
        "branch",
        sa.Column(
            "timezone",
            sa.String(64),
            nullable=False,
            server_default="America/Argentina/Buenos_Aires",
        ),
    )

    # opening_hours — JSONB, nullable (format: {mon..sun: [{open, close}]})
    op.add_column(
        "branch",
        sa.Column("opening_hours", JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("branch", "opening_hours")
    op.drop_column("branch", "timezone")
    op.drop_column("branch", "phone")
