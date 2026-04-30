"""
Shared test fixtures for ws_gateway tests.

Fixtures:
  redis_client     — fakeredis async client (for unit tests)
  real_redis       — real Redis at localhost:6380 (for stream tests, skipped if unavailable)
  test_jwt_token   — factory for creating JWT tokens
  test_table_token — factory for creating Table Tokens
  gateway_app      — minimal FastAPI app for integration tests
  ws_client        — TestClient wrapping gateway_app
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, UTC, timedelta
from typing import Callable

import pytest
import pytest_asyncio

# Ensure backend/shared is importable
_repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_backend_path = os.path.join(_repo_root, "backend")
if _backend_path not in sys.path:
    sys.path.insert(0, _backend_path)


# ── Redis fixtures ────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def redis_client():
    """Async fakeredis client for unit tests."""
    import fakeredis.aioredis
    client = fakeredis.aioredis.FakeRedis(decode_responses=True)
    yield client
    await client.aclose()


@pytest_asyncio.fixture
async def real_redis():
    """
    Real Redis connection at localhost:6380.
    Tests using this fixture are automatically skipped if Redis is unavailable.
    """
    try:
        import redis.asyncio as aioredis
        client = aioredis.from_url("redis://localhost:6380", decode_responses=True)
        await client.ping()
        yield client
        await client.aclose()
    except Exception:
        pytest.skip("Real Redis not available at localhost:6380")


# ── Token factories ───────────────────────────────────────────────────────────

JWT_TEST_SECRET = "test-secret-at-least-32-chars-long!!"
JWT_TEST_ALGORITHM = "HS256"
TABLE_TOKEN_TEST_SECRET = "test-table-secret-at-least-32-chars"


@pytest.fixture
def test_jwt_token() -> Callable:
    """
    Factory fixture for creating test JWT tokens.

    Usage:
        def test_something(test_jwt_token):
            token = test_jwt_token(role="ADMIN", tenant=1, branches=[1, 2])
    """
    import jwt as pyjwt

    def _make_token(
        role: str = "ADMIN",
        tenant: int = 1,
        branches: list[int] | None = None,
        user_id: int = 42,
        exp_delta: int = 900,
        jti: str = "test-jti",
    ) -> str:
        now = datetime.now(UTC)
        payload = {
            "sub": str(user_id),
            "tenant_id": tenant,
            "branch_ids": branches or [1],
            "roles": [role],
            "email": f"test_{role.lower()}@example.com",
            "jti": jti,
            "type": "access",
            "iss": "integrador",
            "aud": "integrador-api",
            "iat": now,
            "exp": now + timedelta(seconds=exp_delta),
        }
        return pyjwt.encode(payload, JWT_TEST_SECRET, algorithm=JWT_TEST_ALGORITHM)

    return _make_token


@pytest.fixture
def test_table_token() -> Callable:
    """
    Factory fixture for creating test Table Tokens.

    Usage:
        def test_something(test_table_token):
            token = test_table_token(session_id=10, tenant=1)
    """
    from unittest.mock import patch

    def _make_token(
        session_id: int = 10,
        tenant: int = 1,
        branch_id: int = 1,
        table_id: int = 5,
        diner_id: int = 99,
        exp_delta: int = 3600,
    ) -> str:
        with patch("shared.security.table_token.settings") as ms:
            ms.TABLE_TOKEN_SECRET = TABLE_TOKEN_TEST_SECRET
            ms.TABLE_TOKEN_TTL_SECONDS = exp_delta
            from shared.security.table_token import issue_table_token
            return issue_table_token(
                session_id=session_id,
                table_id=table_id,
                diner_id=diner_id,
                branch_id=branch_id,
                tenant_id=tenant,
            )

    return _make_token


# ── pytest configuration ──────────────────────────────────────────────────────

def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "real_redis: mark test as requiring a real Redis instance at localhost:6380",
    )
    config.addinivalue_line(
        "markers",
        "integration: mark test as integration test (slower, requires services)",
    )
