"""
Tests for token blacklist and nuclear revocation.

Tests:
  - blacklisted token rejected by current_user dependency
  - nuclear revocation invalidates all user tokens
  - fail-closed when Redis unavailable (mock Redis connection failure)
"""
import pytest
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import jwt
from fastapi import HTTPException

from shared.config.settings import settings
from shared.security.auth import (
    create_access_token,
    verify_jwt,
)
from rest_api.core.dependencies import current_user as current_user_dep

_SAMPLE_USER = {
    "id": 10,
    "email": "blacklist_test@example.com",
    "tenant_id": 1,
    "branch_ids": [1],
    "roles": ["MANAGER"],
}


async def _call_current_user(token: str) -> dict:
    """Helper: simulate calling the current_user dependency with a Bearer token."""
    from fastapi.security import HTTPAuthorizationCredentials
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    return await current_user_dep(credentials=creds)


# ── is_blacklisted tests ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_blacklisted_token_raises_401():
    """A token whose jti is in the blacklist must be rejected with 401."""
    token = create_access_token(_SAMPLE_USER)

    with (
        patch("rest_api.core.dependencies.is_blacklisted", new_callable=AsyncMock, return_value=True),
        patch("rest_api.core.dependencies.get_nuclear_revocation_time", new_callable=AsyncMock, return_value=None),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await _call_current_user(token)
        assert exc_info.value.status_code == 401
        assert exc_info.value.detail == "Token revoked"


@pytest.mark.asyncio
async def test_valid_non_blacklisted_token_passes():
    """A valid, non-blacklisted token should pass the dependency check."""
    token = create_access_token(_SAMPLE_USER)

    with (
        patch("rest_api.core.dependencies.is_blacklisted", new_callable=AsyncMock, return_value=False),
        patch("rest_api.core.dependencies.get_nuclear_revocation_time", new_callable=AsyncMock, return_value=None),
    ):
        user = await _call_current_user(token)
        assert user["email"] == _SAMPLE_USER["email"]
        assert user["tenant_id"] == _SAMPLE_USER["tenant_id"]


# ── Nuclear revocation tests ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_nuclear_revocation_rejects_old_tokens():
    """
    Token issued before the nuclear revocation timestamp should be rejected.
    """
    token = create_access_token(_SAMPLE_USER)
    payload = verify_jwt(token, expected_type="access")

    # Nuclear revocation timestamp is set to AFTER the token was issued
    revocation_time = datetime.now(UTC) + timedelta(seconds=1)

    with (
        patch("rest_api.core.dependencies.is_blacklisted", new_callable=AsyncMock, return_value=False),
        patch("rest_api.core.dependencies.get_nuclear_revocation_time", new_callable=AsyncMock, return_value=revocation_time),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await _call_current_user(token)
        assert exc_info.value.status_code == 401
        assert exc_info.value.detail == "Token revoked"


@pytest.mark.asyncio
async def test_nuclear_revocation_passes_newer_tokens():
    """
    Token issued AFTER the nuclear revocation timestamp should pass.
    """
    # Revocation time is in the past
    revocation_time = datetime.now(UTC) - timedelta(hours=1)
    token = create_access_token(_SAMPLE_USER)  # issued now (after revocation)

    with (
        patch("rest_api.core.dependencies.is_blacklisted", new_callable=AsyncMock, return_value=False),
        patch("rest_api.core.dependencies.get_nuclear_revocation_time", new_callable=AsyncMock, return_value=revocation_time),
    ):
        user = await _call_current_user(token)
        assert user["user_id"] == _SAMPLE_USER["id"]


# ── Fail-closed tests ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_is_blacklisted_fails_closed_on_redis_error():
    """When Redis is unavailable, is_blacklisted() must return True (fail-closed)."""
    from shared.security.auth import is_blacklisted

    broken_client = AsyncMock()
    broken_client.exists = AsyncMock(side_effect=ConnectionError("Redis down"))
    broken_client.aclose = AsyncMock()

    with patch("shared.security.auth._get_redis", return_value=broken_client):
        result = await is_blacklisted("any-jti")
    assert result is True, "is_blacklisted must return True (fail-closed) when Redis is down"


@pytest.mark.asyncio
async def test_get_nuclear_revocation_time_fails_closed():
    """When Redis is unavailable, get_nuclear_revocation_time returns datetime.now() (fail-closed)."""
    from shared.security.auth import get_nuclear_revocation_time

    broken_client = AsyncMock()
    broken_client.get = AsyncMock(side_effect=ConnectionError("Redis down"))
    broken_client.aclose = AsyncMock()

    with patch("shared.security.auth._get_redis", return_value=broken_client):
        result = await get_nuclear_revocation_time(user_id=1)

    assert result is not None, "Should return a datetime (not None) when Redis is down"
    # The returned time should be close to now (within 5 seconds)
    diff = abs((result - datetime.now(UTC)).total_seconds())
    assert diff < 5, f"Returned time should be close to now, got diff={diff}s"


@pytest.mark.asyncio
async def test_current_user_dependency_fails_closed_on_redis_error():
    """
    current_user dependency rejects tokens when Redis is unavailable
    (is_blacklisted returns True → fail-closed → 401).
    """
    token = create_access_token(_SAMPLE_USER)

    # is_blacklisted is called inside current_user; it returns True on Redis error
    with (
        patch("rest_api.core.dependencies.is_blacklisted", new_callable=AsyncMock, return_value=True),
        patch("rest_api.core.dependencies.get_nuclear_revocation_time", new_callable=AsyncMock, return_value=None),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await _call_current_user(token)
        assert exc_info.value.status_code == 401


# ── Missing / invalid tokens ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_current_user_no_credentials():
    """No Authorization header → 401."""
    with pytest.raises(HTTPException) as exc_info:
        await current_user_dep(credentials=None)
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Not authenticated"


@pytest.mark.asyncio
async def test_current_user_invalid_token():
    """Garbage token → 401 Invalid token."""
    from fastapi.security import HTTPAuthorizationCredentials
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="this.is.garbage")

    with pytest.raises(HTTPException) as exc_info:
        await current_user_dep(credentials=creds)
    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_current_user_expired_token():
    """Expired JWT → 401 Token expired."""
    expired_token = jwt.encode(
        {
            "sub": "1",
            "tenant_id": 1,
            "branch_ids": [],
            "roles": [],
            "email": "x@x.com",
            "jti": "test-jti",
            "type": "access",
            "iss": "integrador",
            "aud": "integrador-api",
            "iat": datetime.now(UTC) - timedelta(hours=2),
            "exp": datetime.now(UTC) - timedelta(hours=1),
        },
        settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM,
    )
    from fastapi.security import HTTPAuthorizationCredentials
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=expired_token)

    with pytest.raises(HTTPException) as exc_info:
        await current_user_dep(credentials=creds)
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Token expired"
