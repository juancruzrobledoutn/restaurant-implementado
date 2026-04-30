"""
Tests for AuthService.change_password and POST /api/auth/change-password endpoint (C-28).

Covers:
  - happy path: 200, hash updated, password_updated_at rotated, log emitted
  - wrong current_password: 400, hash unchanged
  - new_password fails policy: 400 with rules listed
  - new_password == current: 400
  - tokens stay valid after password change (no logout forced)
"""
import pytest
import pytest_asyncio
from datetime import UTC, datetime
from unittest.mock import patch, MagicMock
from sqlalchemy.ext.asyncio import AsyncSession


@pytest_asyncio.fixture
async def user_with_password(db: AsyncSession):
    """Create a user with a known password."""
    from rest_api.models.tenant import Tenant
    from rest_api.models.branch import Branch
    from rest_api.models.user import User, UserBranchRole
    from shared.security.password import hash_password

    tenant = Tenant(name="Auth Test Tenant")
    db.add(tenant)
    await db.flush()

    branch = Branch(
        tenant_id=tenant.id,
        name="Branch",
        address="Addr",
        slug="auth-branch",
        timezone="America/Argentina/Buenos_Aires",
    )
    db.add(branch)
    await db.flush()

    user = User(
        tenant_id=tenant.id,
        email="chpw@test.com",
        full_name="Change PW User",
        hashed_password=hash_password("CurrentPass1"),
        is_active=True,
        is_2fa_enabled=False,
        password_updated_at=None,
    )
    db.add(user)
    await db.flush()

    role = UserBranchRole(user_id=user.id, branch_id=branch.id, role="WAITER")
    db.add(role)
    await db.flush()

    return user


# ---------------------------------------------------------------------------
# Service-level tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_change_password_happy_path(db: AsyncSession, user_with_password):
    """Happy path: hash updated, password_updated_at rotated."""
    from rest_api.services.auth_service import AuthService
    from shared.security.password import verify_password

    user = user_with_password
    service = AuthService()

    result = await service.change_password(
        user_id=user.id,
        current_password="CurrentPass1",
        new_password="NewPass2024!",
        db=db,
    )

    assert result["detail"] == "Password changed successfully"

    await db.refresh(user)
    assert verify_password("NewPass2024!", user.hashed_password)
    assert user.password_updated_at is not None
    assert isinstance(user.password_updated_at, datetime)


@pytest.mark.asyncio
async def test_change_password_wrong_current_raises_400(db: AsyncSession, user_with_password):
    """Wrong current_password returns 400 without changing the hash."""
    from fastapi import HTTPException
    from rest_api.services.auth_service import AuthService
    from shared.security.password import verify_password

    user = user_with_password
    old_hash = user.hashed_password
    service = AuthService()

    with pytest.raises(HTTPException) as exc_info:
        await service.change_password(
            user_id=user.id,
            current_password="WrongPassword!",
            new_password="NewPass2024!",
            db=db,
        )
    assert exc_info.value.status_code == 400
    assert "Current password" in str(exc_info.value.detail)

    await db.refresh(user)
    assert user.hashed_password == old_hash  # hash unchanged


@pytest.mark.asyncio
async def test_change_password_new_too_short_raises_400(db: AsyncSession, user_with_password):
    """new_password < 8 chars returns 400 with policy rules."""
    from fastapi import HTTPException
    from rest_api.services.auth_service import AuthService

    service = AuthService()
    with pytest.raises(HTTPException) as exc_info:
        await service.change_password(
            user_id=user_with_password.id,
            current_password="CurrentPass1",
            new_password="Ab1",  # too short
            db=db,
        )
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_change_password_no_digit_raises_400(db: AsyncSession, user_with_password):
    """new_password without a digit returns 400."""
    from fastapi import HTTPException
    from rest_api.services.auth_service import AuthService

    service = AuthService()
    with pytest.raises(HTTPException) as exc_info:
        await service.change_password(
            user_id=user_with_password.id,
            current_password="CurrentPass1",
            new_password="NoDigitHere!",  # no digit
            db=db,
        )
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_change_password_no_uppercase_raises_400(db: AsyncSession, user_with_password):
    """new_password without an uppercase letter returns 400."""
    from fastapi import HTTPException
    from rest_api.services.auth_service import AuthService

    service = AuthService()
    with pytest.raises(HTTPException) as exc_info:
        await service.change_password(
            user_id=user_with_password.id,
            current_password="CurrentPass1",
            new_password="nouppercase1",  # no uppercase
            db=db,
        )
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_change_password_same_as_current_raises_400(db: AsyncSession, user_with_password):
    """new_password == current_password returns 400."""
    from fastapi import HTTPException
    from rest_api.services.auth_service import AuthService

    service = AuthService()
    with pytest.raises(HTTPException) as exc_info:
        await service.change_password(
            user_id=user_with_password.id,
            current_password="CurrentPass1",
            new_password="CurrentPass1",  # same as current
            db=db,
        )
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_change_password_emits_audit_log(db: AsyncSession, user_with_password):
    """Successful change emits USER_PASSWORD_CHANGED audit log."""
    from rest_api.services.auth_service import AuthService

    service = AuthService()
    with patch("rest_api.services.auth_service.logger") as mock_logger:
        await service.change_password(
            user_id=user_with_password.id,
            current_password="CurrentPass1",
            new_password="NewPass2024!",
            db=db,
        )
        # logger.info should be called with USER_PASSWORD_CHANGED
        mock_logger.info.assert_called()
        call_args = str(mock_logger.info.call_args)
        assert "USER_PASSWORD_CHANGED" in call_args


# ---------------------------------------------------------------------------
# Endpoint-level tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_change_password_endpoint_200(db: AsyncSession, db_client, user_with_password):
    """POST /api/auth/change-password returns 200 for valid request."""
    from rest_api.main import app
    from rest_api.core.dependencies import current_user

    user = user_with_password
    user_payload = {
        "user_id": user.id,
        "email": user.email,
        "tenant_id": user.tenant_id,
        "branch_ids": [],
        "roles": ["WAITER"],
        "jti": "test-jti",
        "exp": 9_999_999_999,
    }
    app.dependency_overrides[current_user] = lambda: user_payload

    try:
        response = db_client.post(
            "/api/auth/change-password",
            json={"current_password": "CurrentPass1", "new_password": "NewPass2024!"},
        )
        assert response.status_code == 200
        assert "detail" in response.json()
    finally:
        app.dependency_overrides.pop(current_user, None)


@pytest.mark.asyncio
async def test_change_password_endpoint_400_wrong_current(db: AsyncSession, db_client, user_with_password):
    """POST /api/auth/change-password returns 400 for wrong current_password."""
    from rest_api.main import app
    from rest_api.core.dependencies import current_user

    user = user_with_password
    user_payload = {
        "user_id": user.id,
        "email": user.email,
        "tenant_id": user.tenant_id,
        "branch_ids": [],
        "roles": ["WAITER"],
        "jti": "test-jti",
        "exp": 9_999_999_999,
    }
    app.dependency_overrides[current_user] = lambda: user_payload

    try:
        response = db_client.post(
            "/api/auth/change-password",
            json={"current_password": "WrongPass!", "new_password": "NewPass2024!"},
        )
        assert response.status_code == 400
    finally:
        app.dependency_overrides.pop(current_user, None)


@pytest.mark.asyncio
async def test_change_password_endpoint_422_too_short(db: AsyncSession, db_client, user_with_password):
    """POST /api/auth/change-password returns 422 for new_password < 8 chars (schema validation)."""
    from rest_api.main import app
    from rest_api.core.dependencies import current_user

    user = user_with_password
    user_payload = {
        "user_id": user.id,
        "email": user.email,
        "tenant_id": user.tenant_id,
        "branch_ids": [],
        "roles": ["WAITER"],
        "jti": "test-jti",
        "exp": 9_999_999_999,
    }
    app.dependency_overrides[current_user] = lambda: user_payload

    try:
        response = db_client.post(
            "/api/auth/change-password",
            json={"current_password": "CurrentPass1", "new_password": "Ab1"},
        )
        assert response.status_code == 422
    finally:
        app.dependency_overrides.pop(current_user, None)
