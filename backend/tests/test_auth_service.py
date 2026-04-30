"""
Tests for rest_api/services/auth_service.py — AuthService domain service.

Tests:
  - Successful login flow
  - Invalid credentials returns 401
  - Inactive user returns 401
  - 2FA required response when 2FA enabled without code
  - 2FA login with valid code succeeds
  - get_me returns user info
  - 2FA setup/verify/disable flow

Uses SQLite in-memory database (via conftest.py fixtures).
Redis calls are mocked to avoid requiring a live Redis instance.
"""
import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.security.password import hash_password
from rest_api.models.tenant import Tenant
from rest_api.models.branch import Branch
from rest_api.models.user import User, UserBranchRole
from rest_api.schemas.auth import LoginResponse, TwoFactorRequiredResponse
from rest_api.services.auth_service import AuthService

auth_service = AuthService()

# ── Fixtures ───────────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def tenant_and_branch(db: AsyncSession):
    """Create tenant and branch needed for FK constraints."""
    tenant = Tenant(name="Test Tenant")
    db.add(tenant)
    await db.flush()

    branch = Branch(
        tenant_id=tenant.id,
        name="Main Branch",
        slug="main",
        address="123 Main St",
    )
    db.add(branch)
    await db.flush()
    return tenant, branch


@pytest_asyncio.fixture
async def user_with_password(db: AsyncSession, tenant_and_branch):
    """Create an active user with a hashed password in the test DB."""
    tenant, branch = tenant_and_branch
    user = User(
        tenant_id=tenant.id,
        email="testuser@example.com",
        full_name="Test User",
        hashed_password=hash_password("correctpassword"),
        is_active=True,
    )
    db.add(user)
    await db.flush()

    role = UserBranchRole(user_id=user.id, branch_id=branch.id, role="ADMIN")
    db.add(role)
    await db.flush()

    return user


@pytest_asyncio.fixture
async def inactive_user(db: AsyncSession, tenant_and_branch):
    """Create an inactive user."""
    tenant, branch = tenant_and_branch
    user = User(
        tenant_id=tenant.id,
        email="inactive@example.com",
        full_name="Inactive User",
        hashed_password=hash_password("somepassword"),
        is_active=False,
    )
    db.add(user)
    await db.flush()
    return user


# Patch Redis calls for all tests in this module
@pytest.fixture(autouse=True)
def mock_redis(monkeypatch):
    """Mock all Redis-dependent functions to avoid needing a live Redis."""
    monkeypatch.setattr(
        "rest_api.services.rate_limit_service.check_email_rate_limit",
        AsyncMock(return_value=None),  # No-op: always under limit
    )
    monkeypatch.setattr(
        "rest_api.services.auth_service.check_email_rate_limit",
        AsyncMock(return_value=None),
    )


# ── Login tests ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_login_success(user_with_password, db: AsyncSession):
    """Successful login returns a tuple of (LoginResponse, refresh_token_str)."""
    result = await auth_service.authenticate(
        email="testuser@example.com",
        password="correctpassword",
        totp_code=None,
        db=db,
    )
    # authenticate returns (LoginResponse, refresh_token_str) on success
    assert isinstance(result, tuple), "Expected tuple on success"
    login_response, refresh_token = result
    assert isinstance(login_response, LoginResponse)
    assert login_response.access_token
    assert login_response.token_type == "bearer"
    assert login_response.user.email == "testuser@example.com"
    assert isinstance(refresh_token, str)


@pytest.mark.asyncio
async def test_login_invalid_password(user_with_password, db: AsyncSession):
    """Wrong password returns HTTP 401."""
    with pytest.raises(HTTPException) as exc_info:
        await auth_service.authenticate(
            email="testuser@example.com",
            password="wrongpassword",
            totp_code=None,
            db=db,
        )
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Invalid credentials"


@pytest.mark.asyncio
async def test_login_nonexistent_user(db: AsyncSession):
    """Login with nonexistent email returns HTTP 401 (not 404 — no user enumeration)."""
    with pytest.raises(HTTPException) as exc_info:
        await auth_service.authenticate(
            email="nobody@example.com",
            password="anypassword",
            totp_code=None,
            db=db,
        )
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Invalid credentials"


@pytest.mark.asyncio
async def test_login_inactive_user(inactive_user, db: AsyncSession):
    """Inactive user returns HTTP 401 (same error as wrong credentials)."""
    with pytest.raises(HTTPException) as exc_info:
        await auth_service.authenticate(
            email="inactive@example.com",
            password="somepassword",
            totp_code=None,
            db=db,
        )
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Invalid credentials"


@pytest.mark.asyncio
async def test_login_2fa_required_when_enabled_no_code(db: AsyncSession, tenant_and_branch):
    """If 2FA is enabled and no totp_code, return TwoFactorRequiredResponse."""
    import pyotp
    tenant, branch = tenant_and_branch
    secret = pyotp.random_base32()

    user = User(
        tenant_id=tenant.id,
        email="2fauser@example.com",
        full_name="2FA User",
        hashed_password=hash_password("password123"),
        is_active=True,
        is_2fa_enabled=True,
        totp_secret=secret,
    )
    db.add(user)
    await db.flush()
    db.add(UserBranchRole(user_id=user.id, branch_id=branch.id, role="MANAGER"))
    await db.flush()

    result = await auth_service.authenticate(
        email="2fauser@example.com",
        password="password123",
        totp_code=None,
        db=db,
    )
    assert isinstance(result, TwoFactorRequiredResponse)
    assert result.requires_2fa is True


@pytest.mark.asyncio
async def test_login_2fa_valid_code_succeeds(db: AsyncSession, tenant_and_branch):
    """Valid 2FA code with correct password → successful login."""
    import pyotp
    tenant, branch = tenant_and_branch
    secret = pyotp.random_base32()
    totp = pyotp.TOTP(secret)
    valid_code = totp.now()

    user = User(
        tenant_id=tenant.id,
        email="2fasuccess@example.com",
        full_name="2FA Success",
        hashed_password=hash_password("password123"),
        is_active=True,
        is_2fa_enabled=True,
        totp_secret=secret,
    )
    db.add(user)
    await db.flush()
    db.add(UserBranchRole(user_id=user.id, branch_id=branch.id, role="WAITER"))
    await db.flush()

    result = await auth_service.authenticate(
        email="2fasuccess@example.com",
        password="password123",
        totp_code=valid_code,
        db=db,
    )
    assert isinstance(result, tuple)
    login_response, _ = result
    assert isinstance(login_response, LoginResponse)


@pytest.mark.asyncio
async def test_login_2fa_invalid_code_rejected(db: AsyncSession, tenant_and_branch):
    """Invalid 2FA code returns HTTP 401."""
    import pyotp
    tenant, branch = tenant_and_branch
    secret = pyotp.random_base32()

    user = User(
        tenant_id=tenant.id,
        email="2fafail@example.com",
        full_name="2FA Fail",
        hashed_password=hash_password("password123"),
        is_active=True,
        is_2fa_enabled=True,
        totp_secret=secret,
    )
    db.add(user)
    await db.flush()
    db.add(UserBranchRole(user_id=user.id, branch_id=branch.id, role="WAITER"))
    await db.flush()

    with pytest.raises(HTTPException) as exc_info:
        await auth_service.authenticate(
            email="2fafail@example.com",
            password="password123",
            totp_code="000000",  # Invalid code
            db=db,
        )
    assert exc_info.value.status_code == 401


# ── get_me tests ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_me_returns_user(user_with_password, db: AsyncSession, tenant_and_branch):
    """get_me returns the user's info from DB."""
    tenant, branch = tenant_and_branch
    user_response = await auth_service.get_me(user_id=user_with_password.id, db=db)
    assert user_response.email == "testuser@example.com"
    assert user_response.tenant_id == tenant.id
    assert "ADMIN" in user_response.roles


@pytest.mark.asyncio
async def test_get_me_not_found_returns_401(db: AsyncSession):
    """get_me with nonexistent user_id returns HTTP 401."""
    with pytest.raises(HTTPException) as exc_info:
        await auth_service.get_me(user_id=99999, db=db)
    assert exc_info.value.status_code == 401


# ── 2FA setup/verify/disable tests ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_setup_2fa_returns_secret_and_uri(user_with_password, db: AsyncSession):
    """setup_2fa generates a secret and provisioning URI."""
    response = await auth_service.setup_2fa(user_id=user_with_password.id, db=db)
    assert response.secret
    assert response.provisioning_uri.startswith("otpauth://totp/")


@pytest.mark.asyncio
async def test_setup_2fa_already_enabled_returns_400(db: AsyncSession, tenant_and_branch):
    """setup_2fa returns HTTP 400 if 2FA is already enabled."""
    import pyotp
    tenant, branch = tenant_and_branch
    user = User(
        tenant_id=tenant.id,
        email="already2fa@example.com",
        full_name="Already 2FA",
        hashed_password=hash_password("pw"),
        is_active=True,
        is_2fa_enabled=True,
        totp_secret=pyotp.random_base32(),
    )
    db.add(user)
    await db.flush()

    with pytest.raises(HTTPException) as exc_info:
        await auth_service.setup_2fa(user_id=user.id, db=db)
    assert exc_info.value.status_code == 400
    assert "already" in exc_info.value.detail.lower()


@pytest.mark.asyncio
async def test_verify_2fa_enables_2fa(user_with_password, db: AsyncSession):
    """verify_2fa with a valid code sets is_2fa_enabled=True."""
    import pyotp

    # First setup
    setup_response = await auth_service.setup_2fa(user_id=user_with_password.id, db=db)
    totp = pyotp.TOTP(setup_response.secret)
    code = totp.now()

    result = await auth_service.verify_2fa(
        user_id=user_with_password.id,
        totp_code=code,
        db=db,
    )
    assert result == {"detail": "2FA enabled"}

    # Confirm in DB
    await db.refresh(user_with_password)
    assert user_with_password.is_2fa_enabled is True


@pytest.mark.asyncio
async def test_verify_2fa_invalid_code_returns_400(user_with_password, db: AsyncSession):
    """verify_2fa with invalid code returns HTTP 400."""
    import pyotp
    await auth_service.setup_2fa(user_id=user_with_password.id, db=db)

    with pytest.raises(HTTPException) as exc_info:
        await auth_service.verify_2fa(
            user_id=user_with_password.id,
            totp_code="000000",
            db=db,
        )
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_disable_2fa_with_valid_code(db: AsyncSession, tenant_and_branch):
    """disable_2fa with valid code clears 2FA."""
    import pyotp
    tenant, branch = tenant_and_branch
    secret = pyotp.random_base32()

    user = User(
        tenant_id=tenant.id,
        email="disable2fa@example.com",
        full_name="Disable 2FA",
        hashed_password=hash_password("pw"),
        is_active=True,
        is_2fa_enabled=True,
        totp_secret=secret,
    )
    db.add(user)
    await db.flush()

    code = pyotp.TOTP(secret).now()
    result = await auth_service.disable_2fa(user_id=user.id, totp_code=code, db=db)
    assert result == {"detail": "2FA disabled"}

    await db.refresh(user)
    assert user.is_2fa_enabled is False
    assert user.totp_secret is None


@pytest.mark.asyncio
async def test_disable_2fa_not_enabled_returns_400(user_with_password, db: AsyncSession):
    """disable_2fa when 2FA is not enabled returns HTTP 400."""
    with pytest.raises(HTTPException) as exc_info:
        await auth_service.disable_2fa(
            user_id=user_with_password.id,
            totp_code="123456",
            db=db,
        )
    assert exc_info.value.status_code == 400
