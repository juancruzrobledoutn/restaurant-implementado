"""
Tests for authentication strategies
(ws_gateway/components/auth/strategies.py).

Covered scenarios:
  - JWT valid → accepted
  - JWT expired → AuthError(4001)
  - JWT blacklisted → AuthError(4001)
  - Redis down during blacklist → fail-closed (4001)
  - Role mismatch → AuthError(4003)
  - Table Token valid → accepted
  - Table Token tampered (HMAC invalid) → AuthError(4001)
  - Table Token expired → AuthError(4001)
  - NullAuthStrategy returns synthetic result
  - NullAuthStrategy is usable (no production check in strategy itself)
  - CompositeAuthStrategy: first success wins
  - CompositeAuthStrategy: all fail → last AuthError raised
"""
from __future__ import annotations

import time
from datetime import datetime, UTC, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import jwt as pyjwt
import pytest
import pytest_asyncio

from ws_gateway.components.auth.strategies import (
    AuthError,
    AuthResult,
    CompositeAuthStrategy,
    JWTAuthStrategy,
    NullAuthStrategy,
    TableTokenAuthStrategy,
)


# ── Fixtures ──────────────────────────────────────────────────────────────────

JWT_SECRET = "test-secret-at-least-32-chars-long!!"
JWT_ALGORITHM = "HS256"


def make_jwt(
    sub: str = "42",
    tenant_id: int = 1,
    branch_ids: list[int] | None = None,
    roles: list[str] | None = None,
    jti: str = "test-jti-001",
    exp_delta: int = 900,  # seconds from now
    token_type: str = "access",
) -> str:
    """Build a signed test JWT."""
    now = datetime.now(UTC)
    payload = {
        "sub": sub,
        "tenant_id": tenant_id,
        "branch_ids": branch_ids or [1, 2],
        "roles": roles or ["ADMIN"],
        "email": "test@example.com",
        "jti": jti,
        "type": token_type,
        "iss": "integrador",
        "aud": "integrador-api",
        "iat": now,
        "exp": now + timedelta(seconds=exp_delta),
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def make_table_token(
    session_id: int = 10,
    table_id: int = 5,
    diner_id: int = 99,
    branch_id: int = 1,
    tenant_id: int = 1,
    exp_delta: int = 3600,
) -> str:
    """Build a real HMAC table token using the shared library."""
    from shared.security.table_token import issue_table_token
    with patch("shared.security.table_token.settings") as mock_settings:
        mock_settings.TABLE_TOKEN_SECRET = "test-table-secret-at-least-32-chars"
        mock_settings.TABLE_TOKEN_TTL_SECONDS = exp_delta
        return issue_table_token(
            session_id=session_id,
            table_id=table_id,
            diner_id=diner_id,
            branch_id=branch_id,
            tenant_id=tenant_id,
        )


@pytest.fixture
def mock_redis_clean():
    """Redis mock that says no keys exist (no blacklist)."""
    r = AsyncMock()
    r.exists = AsyncMock(return_value=0)
    return r


@pytest.fixture
def mock_redis_blacklisted():
    """Redis mock that says jti IS blacklisted."""
    r = AsyncMock()
    r.exists = AsyncMock(return_value=1)
    return r


@pytest.fixture
def mock_redis_down():
    """Redis mock that raises on exists."""
    r = AsyncMock()
    r.exists = AsyncMock(side_effect=ConnectionError("Redis is down"))
    return r


# ── JWTAuthStrategy ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_jwt_valid_token_accepted(mock_redis_clean):
    strategy = JWTAuthStrategy(redis=mock_redis_clean)
    token = make_jwt()

    with patch("shared.config.settings.settings") as ms:
        ms.JWT_SECRET = JWT_SECRET
        ms.JWT_ALGORITHM = JWT_ALGORITHM
        result = await strategy.authenticate(token)

    assert isinstance(result, AuthResult)
    assert result.user_id == 42
    assert result.tenant_id == 1
    assert result.token_type == "jwt"


@pytest.mark.asyncio
async def test_jwt_expired_rejected(mock_redis_clean):
    strategy = JWTAuthStrategy(redis=mock_redis_clean)
    token = make_jwt(exp_delta=-1)  # already expired

    with pytest.raises(AuthError) as exc_info:
        with patch("shared.config.settings.settings") as ms:
            ms.JWT_SECRET = JWT_SECRET
            ms.JWT_ALGORITHM = JWT_ALGORITHM
            await strategy.authenticate(token)

    assert exc_info.value.close_code == 4001


@pytest.mark.asyncio
async def test_jwt_blacklisted_rejected(mock_redis_blacklisted):
    strategy = JWTAuthStrategy(redis=mock_redis_blacklisted)
    token = make_jwt()

    with pytest.raises(AuthError) as exc_info:
        with patch("shared.config.settings.settings") as ms:
            ms.JWT_SECRET = JWT_SECRET
            ms.JWT_ALGORITHM = JWT_ALGORITHM
            await strategy.authenticate(token)

    assert exc_info.value.close_code == 4001


@pytest.mark.asyncio
async def test_jwt_redis_down_fails_closed(mock_redis_down):
    """Redis unavailable during blacklist check → fail-closed (4001)."""
    strategy = JWTAuthStrategy(redis=mock_redis_down)
    token = make_jwt()

    with pytest.raises(AuthError) as exc_info:
        with patch("shared.config.settings.settings") as ms:
            ms.JWT_SECRET = JWT_SECRET
            ms.JWT_ALGORITHM = JWT_ALGORITHM
            await strategy.authenticate(token)

    assert exc_info.value.close_code == 4001


@pytest.mark.asyncio
async def test_jwt_role_mismatch_rejected(mock_redis_clean):
    """Token with KITCHEN role rejected at endpoint requiring ADMIN/MANAGER."""
    strategy = JWTAuthStrategy(redis=mock_redis_clean, allowed_roles={"ADMIN", "MANAGER"})
    token = make_jwt(roles=["KITCHEN"])

    with pytest.raises(AuthError) as exc_info:
        with patch("shared.config.settings.settings") as ms:
            ms.JWT_SECRET = JWT_SECRET
            ms.JWT_ALGORITHM = JWT_ALGORITHM
            await strategy.authenticate(token)

    assert exc_info.value.close_code == 4003


@pytest.mark.asyncio
async def test_jwt_role_match_accepted(mock_redis_clean):
    """MANAGER is in allowed_roles for admin endpoint."""
    strategy = JWTAuthStrategy(redis=mock_redis_clean, allowed_roles={"ADMIN", "MANAGER"})
    token = make_jwt(roles=["MANAGER"])

    with patch("shared.config.settings.settings") as ms:
        ms.JWT_SECRET = JWT_SECRET
        ms.JWT_ALGORITHM = JWT_ALGORITHM
        result = await strategy.authenticate(token)

    assert "MANAGER" in result.roles


# ── TableTokenAuthStrategy ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_table_token_valid_accepted():
    strategy = TableTokenAuthStrategy()
    with patch("shared.security.table_token.settings") as ms:
        ms.TABLE_TOKEN_SECRET = "test-table-secret-at-least-32-chars"
        ms.TABLE_TOKEN_TTL_SECONDS = 3600
        token = make_table_token()
        result = await strategy.authenticate(token)

    assert isinstance(result, AuthResult)
    assert result.diner_id == 99
    assert result.session_id == 10
    assert result.tenant_id == 1
    assert result.token_type == "table_token"


@pytest.mark.asyncio
async def test_table_token_tampered_rejected():
    strategy = TableTokenAuthStrategy()
    with patch("shared.config.settings.settings") as ms:
        ms.TABLE_TOKEN_SECRET = "test-table-secret-at-least-32-chars"
        ms.TABLE_TOKEN_TTL_SECONDS = 3600
        good_token = make_table_token()

    # Tamper with the payload part
    parts = good_token.split(".")
    tampered = parts[0] + "XXXXXXX." + parts[1]

    with pytest.raises(AuthError) as exc_info:
        with patch("shared.config.settings.settings") as ms:
            ms.TABLE_TOKEN_SECRET = "test-table-secret-at-least-32-chars"
            await strategy.authenticate(tampered)

    assert exc_info.value.close_code == 4001


@pytest.mark.asyncio
async def test_table_token_expired_rejected():
    strategy = TableTokenAuthStrategy()
    with patch("shared.config.settings.settings") as ms:
        ms.TABLE_TOKEN_SECRET = "test-table-secret-at-least-32-chars"
        ms.TABLE_TOKEN_TTL_SECONDS = -1  # already expired
        token = make_table_token(exp_delta=-1)

    with pytest.raises(AuthError) as exc_info:
        with patch("shared.config.settings.settings") as ms:
            ms.TABLE_TOKEN_SECRET = "test-table-secret-at-least-32-chars"
            await strategy.authenticate(token)

    assert exc_info.value.close_code == 4001


# ── NullAuthStrategy ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_null_strategy_returns_synthetic_result():
    strategy = NullAuthStrategy(tenant_id=2, user_id=99, roles=["WAITER"])
    result = await strategy.authenticate("any-token")
    assert result.tenant_id == 2
    assert result.user_id == 99
    assert result.roles == ["WAITER"]
    assert result.token_type == "null"


@pytest.mark.asyncio
async def test_null_strategy_revalidate_returns_same():
    strategy = NullAuthStrategy()
    result = await strategy.authenticate("x")
    revalidated = await strategy.revalidate(result)
    assert revalidated == result


# ── CompositeAuthStrategy ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_composite_first_success_wins(mock_redis_clean):
    jwt_strategy = JWTAuthStrategy(redis=mock_redis_clean)
    null_strategy = NullAuthStrategy(tenant_id=99)
    composite = CompositeAuthStrategy(jwt_strategy, null_strategy)

    # JWT should succeed first
    token = make_jwt()
    with patch("shared.config.settings.settings") as ms:
        ms.JWT_SECRET = JWT_SECRET
        ms.JWT_ALGORITHM = JWT_ALGORITHM
        result = await composite.authenticate(token)

    assert result.tenant_id == 1  # From JWT, not NullStrategy's tenant_id=99


@pytest.mark.asyncio
async def test_composite_fallback_to_second(mock_redis_down):
    """When JWT strategy fails (redis down), fallback to NullAuthStrategy."""
    jwt_strategy = JWTAuthStrategy(redis=mock_redis_down)
    null_strategy = NullAuthStrategy(tenant_id=42)
    composite = CompositeAuthStrategy(jwt_strategy, null_strategy)

    with patch("shared.config.settings.settings") as ms:
        ms.JWT_SECRET = JWT_SECRET
        ms.JWT_ALGORITHM = JWT_ALGORITHM
        result = await composite.authenticate(make_jwt())

    # null_strategy wins since jwt failed
    assert result.tenant_id == 42


@pytest.mark.asyncio
async def test_composite_all_fail():
    """Both strategies fail → AuthError raised."""
    failing1 = NullAuthStrategy()
    # Monkey-patch to make it fail
    async def fail(token):
        raise AuthError("fail1", 4001)
    failing1.authenticate = fail  # type: ignore

    failing2 = NullAuthStrategy()
    async def fail2(token):
        raise AuthError("fail2", 4001)
    failing2.authenticate = fail2  # type: ignore

    composite = CompositeAuthStrategy(failing1, failing2)
    with pytest.raises(AuthError, match="fail2"):
        await composite.authenticate("token")


@pytest.mark.asyncio
async def test_composite_requires_at_least_one_strategy():
    with pytest.raises(ValueError):
        CompositeAuthStrategy()
