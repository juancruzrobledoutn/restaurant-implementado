"""
Migration test for 012_customer_loyalty_c19.

Verifies that the C-19 customer loyalty migration:
  - upgrade(): creates customer table with correct columns/constraints/indexes,
               adds privacy_salt to app_tenant, activates diner.customer_id FK
  - downgrade(): reverts all of the above cleanly without data errors

Requires a running PostgreSQL instance (partial indexes are PostgreSQL-only).
Run with: pytest backend/tests/migrations/ -v
"""
import os
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

BACKEND_DIR = Path(__file__).parent.parent.parent
ALEMBIC_INI = str(BACKEND_DIR / "alembic.ini")

REV_BEFORE = "011_billing"
REV_TARGET = "012_customer_loyalty_c19"


def _sync_url() -> str:
    raw = os.environ.get(
        "DATABASE_URL",
        "postgresql+asyncpg://postgres:postgres@localhost:5432/menu_ops_test",
    )
    return raw.replace("postgresql+asyncpg", "postgresql+psycopg")


@pytest.fixture(scope="module")
def alembic_cfg() -> Config:
    cfg = Config(ALEMBIC_INI)
    return cfg


@pytest.fixture(scope="module")
def engine():
    eng = create_engine(_sync_url(), echo=False)
    yield eng
    eng.dispose()


@pytest.fixture(scope="module")
def upgraded_db(alembic_cfg: Config, engine):
    """Bring DB to 011_billing, apply 012, yield for upgrade tests, then restore."""
    command.upgrade(alembic_cfg, REV_BEFORE)
    command.upgrade(alembic_cfg, REV_TARGET)
    yield engine
    command.downgrade(alembic_cfg, REV_BEFORE)
    command.upgrade(alembic_cfg, "head")


class TestUpgrade:
    def test_customer_table_exists(self, upgraded_db):
        assert "customer" in inspect(upgraded_db).get_table_names()

    def test_customer_required_columns_not_null(self, upgraded_db):
        cols = {c["name"]: c for c in inspect(upgraded_db).get_columns("customer")}
        assert cols["device_id"]["nullable"] is False
        assert cols["tenant_id"]["nullable"] is False
        assert cols["opted_in"]["nullable"] is False
        assert cols["is_active"]["nullable"] is False
        assert cols["created_at"]["nullable"] is False

    def test_customer_pii_columns_nullable(self, upgraded_db):
        cols = {c["name"]: c for c in inspect(upgraded_db).get_columns("customer")}
        assert cols["name"]["nullable"] is True
        assert cols["email"]["nullable"] is True
        assert cols["consent_version"]["nullable"] is True
        assert cols["consent_ip_hash"]["nullable"] is True
        assert cols["consent_granted_at"]["nullable"] is True

    def test_customer_audit_columns_present(self, upgraded_db):
        col_names = {c["name"] for c in inspect(upgraded_db).get_columns("customer")}
        assert {"deleted_at", "deleted_by_id"}.issubset(col_names)

    def test_customer_regular_indexes(self, upgraded_db):
        idx_names = {i["name"] for i in inspect(upgraded_db).get_indexes("customer")}
        assert "ix_customer_tenant_id" in idx_names
        assert "ix_customer_device_id" in idx_names

    def test_unique_partial_index_exists(self, upgraded_db):
        with upgraded_db.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT indexname FROM pg_indexes "
                    "WHERE tablename = 'customer' "
                    "AND indexname = 'uq_customer_device_tenant_active'"
                )
            ).fetchone()
        assert row is not None, "Partial unique index uq_customer_device_tenant_active missing"

    def test_unique_partial_index_is_unique(self, upgraded_db):
        with upgraded_db.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT pg_index.indisunique "
                    "FROM pg_index "
                    "JOIN pg_class ON pg_class.oid = pg_index.indexrelid "
                    "WHERE pg_class.relname = 'uq_customer_device_tenant_active'"
                )
            ).fetchone()
        assert row is not None and row[0] is True, "Index must be UNIQUE"

    def test_unique_partial_index_has_where_predicate(self, upgraded_db):
        with upgraded_db.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT pg_get_expr(pg_index.indpred, pg_index.indrelid) "
                    "FROM pg_index "
                    "JOIN pg_class ON pg_class.oid = pg_index.indexrelid "
                    "WHERE pg_class.relname = 'uq_customer_device_tenant_active'"
                )
            ).fetchone()
        assert row is not None and row[0] is not None, "Partial index must have a WHERE predicate"

    def test_privacy_salt_added_to_tenant(self, upgraded_db):
        cols = {c["name"]: c for c in inspect(upgraded_db).get_columns("app_tenant")}
        assert "privacy_salt" in cols, "app_tenant.privacy_salt column missing"
        assert cols["privacy_salt"]["nullable"] is True

    def test_diner_fk_constraint_activated(self, upgraded_db):
        fks = {fk["name"]: fk for fk in inspect(upgraded_db).get_foreign_keys("diner")}
        assert "fk_diner_customer_id" in fks, "diner.customer_id FK not created"
        assert fks["fk_diner_customer_id"]["referred_table"] == "customer"

    def test_diner_customer_id_index(self, upgraded_db):
        idx_names = {i["name"] for i in inspect(upgraded_db).get_indexes("diner")}
        assert "ix_diner_customer_id" in idx_names


class TestDowngrade:
    @pytest.fixture(scope="class")
    def downgraded_db(self, alembic_cfg: Config, engine):
        """Ensure at REV_TARGET, downgrade to REV_BEFORE, yield, then restore."""
        command.upgrade(alembic_cfg, REV_TARGET)
        command.downgrade(alembic_cfg, REV_BEFORE)
        yield engine
        command.upgrade(alembic_cfg, "head")

    def test_customer_table_dropped(self, downgraded_db):
        assert "customer" not in inspect(downgraded_db).get_table_names()

    def test_privacy_salt_removed_from_tenant(self, downgraded_db):
        cols = {c["name"]: c for c in inspect(downgraded_db).get_columns("app_tenant")}
        assert "privacy_salt" not in cols

    def test_diner_fk_constraint_dropped(self, downgraded_db):
        fk_names = {fk["name"] for fk in inspect(downgraded_db).get_foreign_keys("diner")}
        assert "fk_diner_customer_id" not in fk_names

    def test_diner_customer_id_index_dropped(self, downgraded_db):
        idx_names = {i["name"] for i in inspect(downgraded_db).get_indexes("diner")}
        assert "ix_diner_customer_id" not in idx_names

    def test_no_residual_customer_indexes(self, downgraded_db):
        with downgraded_db.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT indexname FROM pg_indexes "
                    "WHERE tablename = 'customer' "
                    "AND indexname = 'uq_customer_device_tenant_active'"
                )
            ).fetchone()
        assert row is None, "Partial index should not exist after downgrade"
