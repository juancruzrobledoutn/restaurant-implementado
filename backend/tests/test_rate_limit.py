"""
Tests for rest_api/services/rate_limit_service.py

Tests:
  - check_email_rate_limit passes when under limit
  - check_email_rate_limit raises 429 when limit exceeded
  - check_email_rate_limit raises 503 when Redis is unavailable

All tests mock Redis to avoid requiring a live instance.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import HTTPException


@pytest.fixture
def mock_redis_client():
    """Return a mock Redis client with configurable eval response."""
    client = AsyncMock()
    client.aclose = AsyncMock()
    return client


@pytest.mark.asyncio
async def test_rate_limit_passes_under_limit(mock_redis_client):
    """Under the limit (count <= LOGIN_RATE_LIMIT), no exception is raised."""
    mock_redis_client.eval = AsyncMock(return_value=1)  # First attempt

    with patch(
        "rest_api.services.rate_limit_service._get_redis",
        return_value=mock_redis_client,
    ):
        from rest_api.services.rate_limit_service import check_email_rate_limit
        # Should not raise
        await check_email_rate_limit("test@example.com")


@pytest.mark.asyncio
async def test_rate_limit_passes_at_exact_limit(mock_redis_client):
    """At exactly LOGIN_RATE_LIMIT attempts, no exception (> limit triggers 429)."""
    from shared.config.settings import settings
    mock_redis_client.eval = AsyncMock(return_value=settings.LOGIN_RATE_LIMIT)

    with patch(
        "rest_api.services.rate_limit_service._get_redis",
        return_value=mock_redis_client,
    ):
        from rest_api.services.rate_limit_service import check_email_rate_limit
        await check_email_rate_limit("test@example.com")  # Should not raise


@pytest.mark.asyncio
async def test_rate_limit_raises_429_when_exceeded(mock_redis_client):
    """When count > LOGIN_RATE_LIMIT, raises HTTPException 429."""
    from shared.config.settings import settings
    mock_redis_client.eval = AsyncMock(return_value=settings.LOGIN_RATE_LIMIT + 1)

    with patch(
        "rest_api.services.rate_limit_service._get_redis",
        return_value=mock_redis_client,
    ):
        from rest_api.services.rate_limit_service import check_email_rate_limit
        with pytest.raises(HTTPException) as exc_info:
            await check_email_rate_limit("test@example.com")
        assert exc_info.value.status_code == 429
        assert "Too many login attempts" in exc_info.value.detail


@pytest.mark.asyncio
async def test_rate_limit_raises_503_when_redis_unavailable():
    """When Redis raises an exception, raises HTTPException 503 (fail-closed)."""
    broken_client = AsyncMock()
    broken_client.eval = AsyncMock(side_effect=ConnectionError("Redis unreachable"))
    broken_client.aclose = AsyncMock()

    with patch(
        "rest_api.services.rate_limit_service._get_redis",
        return_value=broken_client,
    ):
        from rest_api.services.rate_limit_service import check_email_rate_limit
        with pytest.raises(HTTPException) as exc_info:
            await check_email_rate_limit("test@example.com")
        assert exc_info.value.status_code == 503


@pytest.mark.asyncio
async def test_rate_limit_uses_lowercased_email(mock_redis_client):
    """Email key is lowercased for consistent rate limiting across case variants."""
    calls = []

    async def capture_eval(script, num_keys, key, window, limit):
        calls.append(key)
        return 1

    mock_redis_client.eval = capture_eval

    with patch(
        "rest_api.services.rate_limit_service._get_redis",
        return_value=mock_redis_client,
    ):
        from rest_api.services.rate_limit_service import check_email_rate_limit
        await check_email_rate_limit("TEST@EXAMPLE.COM")

    assert len(calls) == 1
    assert calls[0] == "rl:email:test@example.com"
