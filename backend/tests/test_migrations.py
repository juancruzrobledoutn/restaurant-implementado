"""
Migration smoke test: upgrade to head → downgrade to base.

Validates that the downgrade path in 001_core_models does not crash.

This test requires a live PostgreSQL database. If none is available (e.g., in
CI without the services sidecar, or on a developer machine without Docker), the
test is automatically skipped via a graceful try/except on the connection step.

How it works:
  1. Builds an Alembic Config pointed at the project's alembic.ini
  2. Overrides sqlalchemy.url with the sync psycopg URL derived from settings
  3. Runs upgrade("head") — applies all migrations
  4. Runs downgrade("base") — rolls them all back
  5. Any error from either step causes the test to fail (not skip)

Skip condition: psycopg cannot connect (OperationalError / connection refused).
"""
import os

import pytest

# Resolve the absolute path to backend/ regardless of cwd
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_ALEMBIC_INI = os.path.join(_BACKEND_DIR, "alembic.ini")


def _get_sync_db_url() -> str:
    """Convert the asyncpg DATABASE_URL to a synchronous psycopg URL for Alembic."""
    from shared.config.settings import settings

    url = settings.DATABASE_URL
    return url.replace("postgresql+asyncpg", "postgresql+psycopg")


def test_migration_upgrade_and_downgrade() -> None:
    """
    Apply all migrations then roll them all back.

    Skipped when no PostgreSQL connection is available.
    Fails when upgrade or downgrade raises any error.
    """
    try:
        from alembic import command
        from alembic.config import Config
        from sqlalchemy import create_engine, text

        sync_url = _get_sync_db_url()

        # Verify connectivity before attempting migrations
        try:
            engine = create_engine(sync_url, pool_pre_ping=True)
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        except Exception as conn_err:
            pytest.skip(f"PostgreSQL not available, skipping migration test: {conn_err}")
            return

        alembic_cfg = Config(_ALEMBIC_INI)
        alembic_cfg.set_main_option("sqlalchemy.url", sync_url)

        # Upgrade: apply all migrations
        command.upgrade(alembic_cfg, "head")

        # Downgrade: roll them all back — must not crash
        command.downgrade(alembic_cfg, "base")

    except ImportError as exc:
        pytest.skip(f"Alembic or psycopg not installed: {exc}")


def test_migration_007_creates_and_drops_table_session_tables() -> None:
    """
    Verify migration 007 creates table_session, diner, cart_item with the
    partial unique index, and that downgrade to 006 removes them cleanly.

    Skipped when PostgreSQL is not available.
    """
    try:
        from alembic import command
        from alembic.config import Config
        from sqlalchemy import create_engine, inspect, text

        sync_url = _get_sync_db_url()

        try:
            engine = create_engine(sync_url, pool_pre_ping=True)
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        except Exception as conn_err:
            pytest.skip(f"PostgreSQL not available: {conn_err}")
            return

        alembic_cfg = Config(_ALEMBIC_INI)
        alembic_cfg.set_main_option("sqlalchemy.url", sync_url)

        # Upgrade to head (includes 007)
        command.upgrade(alembic_cfg, "head")

        # Assert the three C-08 tables exist
        inspector = inspect(engine)
        table_names = inspector.get_table_names()
        assert "table_session" in table_names, "table_session table not created"
        assert "diner" in table_names, "diner table not created"
        assert "cart_item" in table_names, "cart_item table not created"

        # Assert the partial unique index exists
        ts_indexes = {idx["name"] for idx in inspector.get_indexes("table_session")}
        assert "uq_table_session_active_per_table" in ts_indexes, (
            "Partial unique index uq_table_session_active_per_table not found"
        )

        # Downgrade to 006_allergens — C-08 tables should be gone
        command.downgrade(alembic_cfg, "006_allergens")

        inspector2 = inspect(engine)
        table_names2 = inspector2.get_table_names()
        assert "table_session" not in table_names2, "table_session not dropped on downgrade"
        assert "diner" not in table_names2, "diner not dropped on downgrade"
        assert "cart_item" not in table_names2, "cart_item not dropped on downgrade"

        # Re-upgrade to leave DB at head
        command.upgrade(alembic_cfg, "head")

    except ImportError as exc:
        pytest.skip(f"Alembic or psycopg not installed: {exc}")


def test_migration_009_creates_and_drops_round_tables() -> None:
    """
    Verify migration 009 creates `round` and `round_item` with indexes,
    and that downgrade to 008 removes them cleanly.

    Skipped when PostgreSQL is not available.
    """
    try:
        from alembic import command
        from alembic.config import Config
        from sqlalchemy import create_engine, inspect, text

        sync_url = _get_sync_db_url()

        try:
            engine = create_engine(sync_url, pool_pre_ping=True)
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        except Exception as conn_err:
            pytest.skip(f"PostgreSQL not available: {conn_err}")
            return

        alembic_cfg = Config(_ALEMBIC_INI)
        alembic_cfg.set_main_option("sqlalchemy.url", sync_url)

        command.upgrade(alembic_cfg, "head")

        inspector = inspect(engine)
        table_names = inspector.get_table_names()
        assert "round" in table_names, "round table not created by migration 009"
        assert "round_item" in table_names, "round_item table not created by migration 009"

        round_indexes = {idx["name"] for idx in inspector.get_indexes("round")}
        assert "ix_round_session_active" in round_indexes, (
            "ix_round_session_active index missing on round"
        )
        assert "uq_round_session_number" in round_indexes, (
            "uq_round_session_number unique index missing on round"
        )

        round_item_indexes = {idx["name"] for idx in inspector.get_indexes("round_item")}
        assert "ix_round_item_round" in round_item_indexes, (
            "ix_round_item_round index missing on round_item"
        )

        command.downgrade(alembic_cfg, "008_staff_management")

        inspector2 = inspect(engine)
        table_names2 = inspector2.get_table_names()
        assert "round" not in table_names2, "round not dropped on downgrade from 009"
        assert "round_item" not in table_names2, "round_item not dropped on downgrade from 009"

        command.upgrade(alembic_cfg, "head")

    except ImportError as exc:
        pytest.skip(f"Alembic or psycopg not installed: {exc}")
