"""
Alembic environment configuration.

CRITICAL:
- Reads DATABASE_URL from shared.config.settings (never from alembic.ini)
- Converts asyncpg URL to synchronous psycopg URL for Alembic (CLI is sync)
- Imports Base from rest_api.models so all models are detected for autogenerate
"""
import os
import sys
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

# Add backend/ to sys.path so imports work when running alembic from backend/
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# CRITICAL: import all models via rest_api.models.__init__ so Alembic detects them
from rest_api.models import Base  # noqa: F401 — required for autogenerate
from shared.config.settings import settings

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def get_sync_url() -> str:
    """
    Convert async DATABASE_URL to synchronous URL for Alembic.

    postgresql+asyncpg://... → postgresql+psycopg://...
    postgresql+asyncpg://... → postgresql://...  (fallback)
    """
    url = settings.DATABASE_URL
    return url.replace("postgresql+asyncpg", "postgresql+psycopg").replace(
        "postgresql+asyncpg", "postgresql"
    )


def run_migrations_offline() -> None:
    """Run migrations without a live database connection (generates SQL)."""
    url = get_sync_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against a live database connection."""
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = get_sync_url()

    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
