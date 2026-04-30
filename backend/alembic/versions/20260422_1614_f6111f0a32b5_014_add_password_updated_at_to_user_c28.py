"""014_add_password_updated_at_to_user_c28

Revision ID: f6111f0a32b5
Revises: 013_branch_settings_fields_c28
Create Date: 2026-04-22 16:14:24.179867

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'f6111f0a32b5'
down_revision: Union[str, None] = '013_branch_settings_fields_c28'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # C-28: password change audit field — missing from migration 013
    op.add_column('app_user', sa.Column('password_updated_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('app_user', 'password_updated_at')
