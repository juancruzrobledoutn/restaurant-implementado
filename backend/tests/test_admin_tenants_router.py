"""
Tests for admin_tenants router (C-28).

Covers:
  - GET /api/admin/tenants/me: 200 ADMIN, 403 MANAGER
  - PATCH /api/admin/tenants/me: 200 ADMIN, 403 MANAGER, 422 name blank, privacy_salt not in response
"""
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession


@pytest_asyncio.fixture
async def setup_tenants(db: AsyncSession):
    """Create a tenant with ADMIN and MANAGER users."""
    from rest_api.models.tenant import Tenant
    from rest_api.models.branch import Branch
    from rest_api.models.user import User, UserBranchRole
    from shared.security.password import hash_password

    tenant = Tenant(name="Router Tenant", privacy_salt="super-secret-salt")
    db.add(tenant)
    await db.flush()

    branch = Branch(
        tenant_id=tenant.id,
        name="Branch",
        address="Addr",
        slug="router-branch",
        timezone="America/Argentina/Buenos_Aires",
    )
    db.add(branch)
    await db.flush()

    admin = User(
        tenant_id=tenant.id,
        email="admin2@test.com",
        full_name="Admin User",
        hashed_password=hash_password("Test1234!"),
        is_active=True,
        is_2fa_enabled=False,
    )
    manager = User(
        tenant_id=tenant.id,
        email="manager2@test.com",
        full_name="Manager User",
        hashed_password=hash_password("Test1234!"),
        is_active=True,
        is_2fa_enabled=False,
    )
    db.add_all([admin, manager])
    await db.flush()

    admin_role = UserBranchRole(user_id=admin.id, branch_id=branch.id, role="ADMIN")
    manager_role = UserBranchRole(user_id=manager.id, branch_id=branch.id, role="MANAGER")
    db.add_all([admin_role, manager_role])
    await db.flush()

    return {"tenant": tenant, "branch": branch, "admin": admin, "manager": manager}


def _payload(user, roles: list[str], tenant_id: int, branch_ids: list[int]) -> dict:
    return {
        "user_id": user.id,
        "email": user.email,
        "tenant_id": tenant_id,
        "branch_ids": branch_ids,
        "roles": roles,
        "jti": "test-jti",
        "exp": 9_999_999_999,
        "sub": str(user.id),
    }


@pytest.mark.asyncio
async def test_get_tenant_settings_200_admin(db: AsyncSession, db_client, setup_tenants):
    """GET /api/admin/tenants/me returns 200 for ADMIN."""
    from rest_api.main import app
    from rest_api.core.dependencies import current_user

    data = setup_tenants
    payload = _payload(data["admin"], ["ADMIN"], data["tenant"].id, [data["branch"].id])
    app.dependency_overrides[current_user] = lambda: payload

    try:
        response = db_client.get("/api/admin/tenants/me")
        assert response.status_code == 200
        body = response.json()
        assert body["id"] == data["tenant"].id
        assert body["name"] == "Router Tenant"
    finally:
        app.dependency_overrides.pop(current_user, None)


@pytest.mark.asyncio
async def test_get_tenant_settings_does_not_expose_privacy_salt(db: AsyncSession, db_client, setup_tenants):
    """GET /api/admin/tenants/me response must NOT include privacy_salt."""
    from rest_api.main import app
    from rest_api.core.dependencies import current_user

    data = setup_tenants
    payload = _payload(data["admin"], ["ADMIN"], data["tenant"].id, [data["branch"].id])
    app.dependency_overrides[current_user] = lambda: payload

    try:
        response = db_client.get("/api/admin/tenants/me")
        assert response.status_code == 200
        body = response.json()
        assert "privacy_salt" not in body
    finally:
        app.dependency_overrides.pop(current_user, None)


@pytest.mark.asyncio
async def test_get_tenant_settings_403_manager(db: AsyncSession, db_client, setup_tenants):
    """GET /api/admin/tenants/me returns 403 for MANAGER role."""
    from rest_api.main import app
    from rest_api.core.dependencies import current_user

    data = setup_tenants
    payload = _payload(data["manager"], ["MANAGER"], data["tenant"].id, [data["branch"].id])
    app.dependency_overrides[current_user] = lambda: payload

    try:
        response = db_client.get("/api/admin/tenants/me")
        assert response.status_code == 403
    finally:
        app.dependency_overrides.pop(current_user, None)


@pytest.mark.asyncio
async def test_patch_tenant_settings_200_admin(db: AsyncSession, db_client, setup_tenants):
    """PATCH /api/admin/tenants/me returns 200 for ADMIN."""
    from rest_api.main import app
    from rest_api.core.dependencies import current_user

    data = setup_tenants
    payload = _payload(data["admin"], ["ADMIN"], data["tenant"].id, [data["branch"].id])
    app.dependency_overrides[current_user] = lambda: payload

    try:
        response = db_client.patch(
            "/api/admin/tenants/me",
            json={"name": "Updated Tenant"},
        )
        assert response.status_code == 200
        assert response.json()["name"] == "Updated Tenant"
    finally:
        app.dependency_overrides.pop(current_user, None)


@pytest.mark.asyncio
async def test_patch_tenant_settings_403_manager(db: AsyncSession, db_client, setup_tenants):
    """PATCH /api/admin/tenants/me returns 403 for MANAGER role."""
    from rest_api.main import app
    from rest_api.core.dependencies import current_user

    data = setup_tenants
    payload = _payload(data["manager"], ["MANAGER"], data["tenant"].id, [data["branch"].id])
    app.dependency_overrides[current_user] = lambda: payload

    try:
        response = db_client.patch(
            "/api/admin/tenants/me",
            json={"name": "Attempted Update"},
        )
        assert response.status_code == 403
    finally:
        app.dependency_overrides.pop(current_user, None)


@pytest.mark.asyncio
async def test_patch_tenant_settings_422_blank_name(db: AsyncSession, db_client, setup_tenants):
    """PATCH /api/admin/tenants/me returns 422 for blank name."""
    from rest_api.main import app
    from rest_api.core.dependencies import current_user

    data = setup_tenants
    payload = _payload(data["admin"], ["ADMIN"], data["tenant"].id, [data["branch"].id])
    app.dependency_overrides[current_user] = lambda: payload

    try:
        response = db_client.patch(
            "/api/admin/tenants/me",
            json={"name": "   "},
        )
        assert response.status_code == 422
    finally:
        app.dependency_overrides.pop(current_user, None)


@pytest.mark.asyncio
async def test_patch_tenant_settings_response_excludes_privacy_salt(db: AsyncSession, db_client, setup_tenants):
    """PATCH /api/admin/tenants/me response must NOT include privacy_salt."""
    from rest_api.main import app
    from rest_api.core.dependencies import current_user

    data = setup_tenants
    payload = _payload(data["admin"], ["ADMIN"], data["tenant"].id, [data["branch"].id])
    app.dependency_overrides[current_user] = lambda: payload

    try:
        response = db_client.patch(
            "/api/admin/tenants/me",
            json={"name": "No Salt"},
        )
        assert response.status_code == 200
        body = response.json()
        assert "privacy_salt" not in body
    finally:
        app.dependency_overrides.pop(current_user, None)
