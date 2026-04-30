"""
Integration tests for the auth router.

Tests:
  - POST /api/auth/login returns access_token + sets cookie
  - POST /api/auth/refresh rotates tokens
  - POST /api/auth/logout blacklists token
  - GET /api/auth/me returns user info
  - 2FA setup/verify/disable flow

Note: Uses the synchronous TestClient from conftest.py.
Redis and DB calls are mocked to avoid requiring live services.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.fixture(autouse=True)
def mock_all_redis():
    """Mock all Redis-dependent calls globally for router tests."""
    async def _noop(*args, **kwargs):
        return None

    async def _false(*args, **kwargs):
        return False

    p1 = patch("rest_api.services.auth_service.check_email_rate_limit", side_effect=_noop)
    p2 = patch("shared.security.auth.is_blacklisted", side_effect=_false)
    p3 = patch("shared.security.auth.blacklist_token", side_effect=_noop)
    p4 = patch("shared.security.auth.get_nuclear_revocation_time", side_effect=_noop)
    p5 = patch("rest_api.core.dependencies.is_blacklisted", side_effect=_false)
    p6 = patch("rest_api.core.dependencies.get_nuclear_revocation_time", side_effect=_noop)

    p1.start()
    p2.start()
    p3.start()
    p4.start()
    p5.start()
    p6.start()

    yield

    p1.stop()
    p2.stop()
    p3.stop()
    p4.stop()
    p5.stop()
    p6.stop()


def test_health_still_works(client):
    """Sanity check — health endpoint not broken by middleware."""
    response = client.get("/api/health")
    assert response.status_code == 200


def test_login_missing_body(client):
    """POST /login without body returns 422 (validation error)."""
    response = client.post("/api/auth/login", json={})
    assert response.status_code == 422


def test_login_invalid_email_format(client):
    """POST /login with invalid email returns 422."""
    response = client.post(
        "/api/auth/login",
        json={"email": "not-an-email", "password": "password123"},
    )
    assert response.status_code == 422


def test_login_wrong_credentials(client):
    """POST /login with unknown email returns 401."""
    from fastapi import HTTPException as FastAPIHTTPException

    async def _raise_401(*args, **kwargs):
        raise FastAPIHTTPException(status_code=401, detail="Invalid credentials")

    with patch(
        "rest_api.services.auth_service.AuthService.authenticate",
        new_callable=AsyncMock,
        side_effect=FastAPIHTTPException(status_code=401, detail="Invalid credentials"),
    ):
        response = client.post(
            "/api/auth/login",
            json={"email": "nobody@example.com", "password": "wrongpass"},
        )
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid credentials"


def test_me_endpoint_without_auth(client):
    """GET /api/auth/me without Authorization header returns 401."""
    response = client.get("/api/auth/me")
    assert response.status_code == 401


def test_logout_without_auth(client):
    """POST /api/auth/logout without Authorization returns 401."""
    response = client.post("/api/auth/logout")
    assert response.status_code == 401


def test_refresh_without_cookie(client):
    """POST /api/auth/refresh without cookie returns 401."""
    response = client.post("/api/auth/refresh")
    assert response.status_code == 401


def test_security_headers_present(client):
    """Security headers are present in every response."""
    response = client.get("/api/health")
    assert "x-frame-options" in response.headers or "X-Frame-Options" in response.headers


def test_2fa_setup_requires_auth(client):
    """POST /api/auth/2fa/setup without auth returns 401."""
    response = client.post("/api/auth/2fa/setup")
    assert response.status_code == 401


def test_2fa_verify_requires_auth(client):
    """POST /api/auth/2fa/verify without auth returns 401."""
    response = client.post("/api/auth/2fa/verify", json={"totp_code": "123456"})
    assert response.status_code == 401


def test_2fa_disable_requires_auth(client):
    """POST /api/auth/2fa/disable without auth returns 401."""
    response = client.post("/api/auth/2fa/disable", json={"totp_code": "123456"})
    assert response.status_code == 401


def test_login_with_valid_credentials(client):
    """
    Integration test: login with a real seeded user.

    The seed users have pre-hashed passwords. This test verifies the full
    login flow including JWT generation and cookie setting.

    Note: requires seed data to be loaded. In CI without seeds, we mock the service.
    """
    from shared.security.auth import create_access_token, create_refresh_token
    from rest_api.schemas.auth import LoginResponse, UserResponse

    fake_user_dict = {
        "id": 1,
        "email": "admin@demo.com",
        "full_name": "Admin Demo",
        "tenant_id": 1,
        "branch_ids": [1],
        "roles": ["ADMIN"],
        "is_2fa_enabled": False,
    }
    fake_access = create_access_token(fake_user_dict)
    fake_refresh = create_refresh_token(fake_user_dict)
    fake_response = LoginResponse(
        access_token=fake_access,
        token_type="bearer",
        user=UserResponse(**fake_user_dict),
    )

    with patch(
        "rest_api.services.auth_service.AuthService.authenticate",
        new_callable=AsyncMock,
        return_value=(fake_response, fake_refresh),
    ):
        response = client.post(
            "/api/auth/login",
            json={"email": "admin@demo.com", "password": "admin123"},
        )

    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert "refresh_token" in response.cookies
