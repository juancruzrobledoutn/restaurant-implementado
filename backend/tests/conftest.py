"""
Pytest fixtures for the Integrador backend test suite.

Fixtures:
  - client: synchronous TestClient for HTTP-level tests (health, routes)
  - db_engine: in-memory async SQLite engine, schema created per session
  - db: transactional async session that rolls back after each test
"""
import os

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy import BigInteger, Integer, JSON, event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# Force test environment before importing app modules
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://postgres:postgres@localhost:5432/menu_ops_test",
)
os.environ.setdefault("REDIS_URL", "redis://localhost:6380")
os.environ.setdefault("JWT_SECRET", "test-secret-at-least-32-characters-long")
os.environ.setdefault("TABLE_TOKEN_SECRET", "test-table-secret-at-least-32-chars")

# C-12: MercadoPago dummy credentials for test environment (no real MP calls in tests)
os.environ.setdefault("MERCADOPAGO_ACCESS_TOKEN", "TEST-dummy-access-token-for-tests")
os.environ.setdefault("MERCADOPAGO_PUBLIC_KEY", "TEST-dummy-public-key-for-tests")
os.environ.setdefault("MERCADOPAGO_WEBHOOK_SECRET", "test-mp-webhook-secret-32-chars!")

# Import all models so Base.metadata is fully populated before create_all
from rest_api.models import Base  # noqa: E402, F401
from rest_api.models.branch import Branch  # noqa: E402, F401
from rest_api.models.tenant import Tenant  # noqa: E402, F401
from rest_api.models.user import User, UserBranchRole  # noqa: E402, F401
# C-04 menu catalog models
from rest_api.models.menu import (  # noqa: E402, F401
    Category,
    Subcategory,
    Product,
    BranchProduct,
)
# C-05 allergen models — must be imported so SQLite schema includes these tables
from rest_api.models.allergen import Allergen, ProductAllergen, AllergenCrossReaction  # noqa: E402, F401
# C-06 models — must be imported so SQLite schema includes these tables
from rest_api.models.ingredient import IngredientGroup, Ingredient, SubIngredient  # noqa: E402, F401
from rest_api.models.recipe import Recipe, RecipeIngredient  # noqa: E402, F401
from rest_api.models.catalog import (  # noqa: E402, F401
    CookingMethod,
    FlavorProfile,
    TextureProfile,
    CuisineType,
)
# C-07 models — must be imported so SQLite schema includes these tables
from rest_api.models.sector import BranchSector, Table, WaiterSectorAssignment  # noqa: E402, F401
# C-08 models — must be imported so SQLite schema includes these tables
from rest_api.models.table_session import TableSession, Diner, CartItem  # noqa: E402, F401
# C-13 models — must be imported so SQLite schema includes these tables
from rest_api.models.outbox import OutboxEvent  # noqa: E402, F401
from rest_api.models.promotion import Promotion, PromotionBranch, PromotionItem  # noqa: E402, F401
from rest_api.models.push_subscription import PushSubscription  # noqa: E402, F401
# C-10 models — rounds and round items
from rest_api.models.round import Round, RoundItem  # noqa: E402, F401
# C-11 models — kitchen tickets and service calls
from rest_api.models.kitchen_ticket import KitchenTicket, KitchenTicketItem  # noqa: E402, F401
from rest_api.models.service_call import ServiceCall  # noqa: E402, F401
# C-12 models — billing: Check (app_check), Charge, Payment, Allocation
from rest_api.models.billing import Check, Charge, Payment, Allocation  # noqa: E402, F401
# C-19 models — customer loyalty
from rest_api.models.customer import Customer  # noqa: E402, F401

_SQLITE_URL = "sqlite+aiosqlite://"


def _patch_bigint_for_sqlite():
    """
    SQLite only autoincrements INTEGER PRIMARY KEY.
    Rewrite BigInteger columns to Integer in Base.metadata before CREATE TABLE.
    Must be called once before create_all on an SQLite engine.
    """
    for table in Base.metadata.tables.values():
        for column in table.columns:
            if isinstance(column.type, BigInteger):
                column.type = Integer()


def _patch_jsonb_for_sqlite():
    """
    SQLite does not support PostgreSQL's JSONB type.
    Rewrite JSONB columns to plain JSON in Base.metadata before CREATE TABLE.
    Must be called once before create_all on an SQLite engine.
    """
    for table in Base.metadata.tables.values():
        for column in table.columns:
            if isinstance(column.type, JSONB):
                column.type = JSON()


def _patch_partial_indices_for_sqlite():
    """
    Remove PostgreSQL-specific partial unique indexes from Base.metadata.

    SQLite does not support conditional indexes (WHERE clause), so it creates
    a plain UNIQUE index that breaks tests creating multiple rows for the same key
    (e.g., multiple closed TableSessions for the same table_id).
    """
    for table in Base.metadata.tables.values():
        to_remove = [
            idx for idx in list(table.indexes)
            if idx.kwargs.get("postgresql_where") is not None and idx.unique
        ]
        for idx in to_remove:
            table.indexes.discard(idx)


@pytest.fixture(autouse=True, scope="session")
def disable_slowapi_for_tests():
    """
    Disable slowapi IP-based rate limiting during tests.

    The limiter tries to connect to Redis to increment counters. In the test
    environment Redis may not be available, and we test rate limiting logic
    separately (test_rate_limit.py uses mocks).

    Setting limiter.enabled = False bypasses all slowapi middleware logic.
    """
    from rest_api.core.limiter import limiter
    original = limiter.enabled
    limiter.enabled = False
    yield
    limiter.enabled = original


@pytest.fixture(scope="session")
def client() -> TestClient:
    """Synchronous TestClient for the FastAPI app — suitable for unit/integration tests."""
    from rest_api.main import app

    with TestClient(app) as c:
        yield c


@pytest_asyncio.fixture
async def db_client(db: AsyncSession):
    """
    TestClient with get_db overridden to share the test's SQLite db session.
    Use this when a test hits a router endpoint that needs DB access — without
    the override, the endpoint tries to connect to the real Postgres.
    """
    from rest_api.main import app
    from shared.infrastructure.db import get_db

    async def _override_get_db():
        yield db

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def db_engine():
    """
    Create an in-memory async SQLite engine with the full schema.

    Scope: per-test (default). Each test gets a fresh empty database.
    This avoids inter-test contamination without needing transactions.
    """
    _patch_bigint_for_sqlite()
    _patch_jsonb_for_sqlite()
    _patch_partial_indices_for_sqlite()

    def _set_sqlite_pragma(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    engine = create_async_engine(_SQLITE_URL, echo=False)
    event.listen(engine.sync_engine, "connect", _set_sqlite_pragma)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def db(db_engine):
    """
    Provide a transactional async session that rolls back after each test.

    Usage:
        async def test_something(db: AsyncSession) -> None:
            ...
    """
    session_factory = async_sessionmaker(
        db_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    async with session_factory() as session:
        yield session
        await session.rollback()
