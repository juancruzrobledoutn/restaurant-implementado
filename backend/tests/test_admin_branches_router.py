"""
Tests for admin_branches router (C-28).

Covers:
  - GET /api/admin/branches/{id}/settings: 200 MANAGER with access, 403 MANAGER without, 403 WAITER, 404 cross-tenant
  - PATCH /api/admin/branches/{id}: 200 MANAGER, 422 invalid slug, 409 slug duplicate, 422 invalid timezone, 422 invalid opening_hours
"""
import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, patch
from sqlalchemy.ext.asyncio import AsyncSession


@pytest_asyncio.fixture
async def setup_branches(db: AsyncSession):
    """Create tenant, branches, and users for router tests."""
    from rest_api.models.tenant import Tenant
    from rest_api.models.branch import Branch
    from rest_api.models.user import User, UserBranchRole
    from shared.security.password import hash_password

    tenant = Tenant(name="Router Test Tenant")
    db.add(tenant)
    await db.flush()

    branch1 = Branch(
        tenant_id=tenant.id,
        name="Branch A",
        address="Addr A",
        slug="branch-a",
        timezone="America/Argentina/Buenos_Aires",
    )
    branch2 = Branch(
        tenant_id=tenant.id,
        name="Branch B",
        address="Addr B",
        slug="branch-b",
        timezone="America/Argentina/Buenos_Aires",
    )
    db.add_all([branch1, branch2])
    await db.flush()

    # MANAGER assigned to branch1 only
    manager = User(
        tenant_id=tenant.id,
        email="manager@test.com",
        full_name="Manager User",
        hashed_password=hash_password("Test1234!"),
        is_active=True,
        is_2fa_enabled=False,
    )
    db.add(manager)
    await db.flush()

    role = UserBranchRole(user_id=manager.id, branch_id=branch1.id, role="MANAGER")
    db.add(role)

    # ADMIN with access to both branches
    admin = User(
        tenant_id=tenant.id,
        email="admin@test.com",
        full_name="Admin User",
        hashed_password=hash_password("Test1234!"),
        is_active=True,
        is_2fa_enabled=False,
    )
    db.add(admin)
    await db.flush()

    admin_role = UserBranchRole(user_id=admin.id, branch_id=branch1.id, role="ADMIN")
    db.add(admin_role)

    # WAITER assigned to branch1
    waiter = User(
        tenant_id=tenant.id,
        email="waiter@test.com",
        full_name="Waiter User",
        hashed_password=hash_password("Test1234!"),
        is_active=True,
        is_2fa_enabled=False,
    )
    db.add(waiter)
    await db.flush()

    waiter_role = UserBranchRole(user_id=waiter.id, branch_id=branch1.id, role="WAITER")
    db.add(waiter_role)

    await db.flush()

    return {
        "tenant": tenant,
        "branch1": branch1,
        "branch2": branch2,
        "manager": manager,
        "admin": admin,
        "waiter": waiter,
    }


def _make_user_token(user, branch_ids: list[int], roles: list[str]) -> dict:
    """Build a mock JWT payload dict for current_user dependency override."""
    return {
        "user_id": user.id,
        "email": user.email,
        "tenant_id": user.tenant_id,
        "branch_ids": branch_ids,
        "roles": roles,
        "jti": "test-jti",
        "exp": 9_999_999_999,
        "sub": str(user.id),
    }


@pytest.mark.asyncio
async def test_get_branch_settings_200_manager_with_access(db: AsyncSession, db_client, setup_branches):
    """GET /api/admin/branches/{id}/settings returns 200 for MANAGER with access."""
    from rest_api.main import app
    from rest_api.core.dependencies import current_user

    data = setup_branches
    manager = data["manager"]
    branch1 = data["branch1"]

    user_payload = _make_user_token(manager, [branch1.id], ["MANAGER"])

    app.dependency_overrides[current_user] = lambda: user_payload

    try:
        response = db_client.get(f"/api/admin/branches/{branch1.id}/settings")
        assert response.status_code == 200
        body = response.json()
        assert body["id"] == branch1.id
        assert body["slug"] == "branch-a"
    finally:
        app.dependency_overrides.pop(current_user, None)


@pytest.mark.asyncio
async def test_get_branch_settings_403_manager_without_access(db: AsyncSession, db_client, setup_branches):
    """GET /api/admin/branches/{id}/settings returns 403 for MANAGER without branch access."""
    from rest_api.main import app
    from rest_api.core.dependencies import current_user

    data = setup_branches
    manager = data["manager"]
    branch2 = data["branch2"]  # manager not assigned to branch2

    user_payload = _make_user_token(manager, [data["branch1"].id], ["MANAGER"])

    app.dependency_overrides[current_user] = lambda: user_payload

    try:
        response = db_client.get(f"/api/admin/branches/{branch2.id}/settings")
        assert response.status_code == 403
    finally:
        app.dependency_overrides.pop(current_user, None)


@pytest.mark.asyncio
async def test_get_branch_settings_403_waiter(db: AsyncSession, db_client, setup_branches):
    """GET /api/admin/branches/{id}/settings returns 403 for WAITER role."""
    from rest_api.main import app
    from rest_api.core.dependencies import current_user

    data = setup_branches
    waiter = data["waiter"]
    branch1 = data["branch1"]

    user_payload = _make_user_token(waiter, [branch1.id], ["WAITER"])
    app.dependency_overrides[current_user] = lambda: user_payload

    try:
        response = db_client.get(f"/api/admin/branches/{branch1.id}/settings")
        assert response.status_code == 403
    finally:
        app.dependency_overrides.pop(current_user, None)


@pytest.mark.asyncio
async def test_get_branch_settings_404_cross_tenant(db: AsyncSession, db_client, setup_branches):
    """GET /api/admin/branches/{id}/settings returns 404 for cross-tenant access."""
    from rest_api.main import app
    from rest_api.core.dependencies import current_user
    from rest_api.models.tenant import Tenant
    from rest_api.models.user import User, UserBranchRole
    from shared.security.password import hash_password

    # Create a second tenant with its own user
    tenant2 = Tenant(name="Another Tenant")
    db.add(tenant2)
    await db.flush()

    other_user = User(
        tenant_id=tenant2.id,
        email="other@tenant2.com",
        full_name="Other Admin",
        hashed_password=hash_password("Test1234!"),
        is_active=True,
        is_2fa_enabled=False,
    )
    db.add(other_user)
    await db.flush()

    branch1 = setup_branches["branch1"]
    # Other user tries to access branch1 (belongs to tenant1)
    user_payload = {
        "user_id": other_user.id,
        "email": other_user.email,
        "tenant_id": tenant2.id,  # different tenant
        "branch_ids": [branch1.id],
        "roles": ["ADMIN"],
        "jti": "test-jti",
        "exp": 9_999_999_999,
        "sub": str(other_user.id),
    }

    app.dependency_overrides[current_user] = lambda: user_payload

    try:
        response = db_client.get(f"/api/admin/branches/{branch1.id}/settings")
        assert response.status_code == 404
    finally:
        app.dependency_overrides.pop(current_user, None)


@pytest.mark.asyncio
async def test_patch_branch_settings_200_manager(db: AsyncSession, db_client, setup_branches):
    """PATCH /api/admin/branches/{id} returns 200 for MANAGER with access."""
    from rest_api.main import app
    from rest_api.core.dependencies import current_user

    data = setup_branches
    manager = data["manager"]
    branch1 = data["branch1"]

    user_payload = _make_user_token(manager, [branch1.id], ["MANAGER"])
    app.dependency_overrides[current_user] = lambda: user_payload

    try:
        with patch("rest_api.services.domain.branch_settings_service.BranchSettingsService._invalidate_menu_cache", new_callable=AsyncMock):
            response = db_client.patch(
                f"/api/admin/branches/{branch1.id}",
                json={"name": "Updated Branch Name"},
            )
        assert response.status_code == 200
        assert response.json()["name"] == "Updated Branch Name"
    finally:
        app.dependency_overrides.pop(current_user, None)


@pytest.mark.asyncio
async def test_patch_branch_settings_422_invalid_slug(db: AsyncSession, db_client, setup_branches):
    """PATCH /api/admin/branches/{id} returns 422 for invalid slug."""
    from rest_api.main import app
    from rest_api.core.dependencies import current_user

    data = setup_branches
    manager = data["manager"]
    branch1 = data["branch1"]

    user_payload = _make_user_token(manager, [branch1.id], ["MANAGER"])
    app.dependency_overrides[current_user] = lambda: user_payload

    try:
        response = db_client.patch(
            f"/api/admin/branches/{branch1.id}",
            json={"slug": "INVALID SLUG!"},
        )
        assert response.status_code == 422
    finally:
        app.dependency_overrides.pop(current_user, None)


@pytest.mark.asyncio
async def test_patch_branch_settings_409_slug_duplicate(db: AsyncSession, db_client, setup_branches):
    """PATCH /api/admin/branches/{id} returns 409 for duplicate slug within tenant."""
    from rest_api.main import app
    from rest_api.core.dependencies import current_user

    data = setup_branches
    admin = data["admin"]
    branch1 = data["branch1"]

    user_payload = _make_user_token(admin, [branch1.id, data["branch2"].id], ["ADMIN"])
    app.dependency_overrides[current_user] = lambda: user_payload

    try:
        # Try to set branch1's slug to branch2's slug
        response = db_client.patch(
            f"/api/admin/branches/{branch1.id}",
            json={"slug": "branch-b"},
        )
        assert response.status_code == 409
    finally:
        app.dependency_overrides.pop(current_user, None)


@pytest.mark.asyncio
async def test_patch_branch_settings_422_invalid_timezone(db: AsyncSession, db_client, setup_branches):
    """PATCH /api/admin/branches/{id} returns 422 for invalid timezone."""
    from rest_api.main import app
    from rest_api.core.dependencies import current_user

    data = setup_branches
    manager = data["manager"]
    branch1 = data["branch1"]

    user_payload = _make_user_token(manager, [branch1.id], ["MANAGER"])
    app.dependency_overrides[current_user] = lambda: user_payload

    try:
        response = db_client.patch(
            f"/api/admin/branches/{branch1.id}",
            json={"timezone": "Not/A/Real/Timezone"},
        )
        assert response.status_code == 422
    finally:
        app.dependency_overrides.pop(current_user, None)


@pytest.mark.asyncio
async def test_patch_branch_settings_422_invalid_opening_hours(db: AsyncSession, db_client, setup_branches):
    """PATCH /api/admin/branches/{id} returns 422 for invalid opening_hours (overlapping intervals)."""
    from rest_api.main import app
    from rest_api.core.dependencies import current_user

    data = setup_branches
    manager = data["manager"]
    branch1 = data["branch1"]

    user_payload = _make_user_token(manager, [branch1.id], ["MANAGER"])
    app.dependency_overrides[current_user] = lambda: user_payload

    try:
        response = db_client.patch(
            f"/api/admin/branches/{branch1.id}",
            json={
                "opening_hours": {
                    "mon": [
                        {"open": "09:00", "close": "15:00"},
                        {"open": "14:00", "close": "23:00"},  # overlaps
                    ]
                }
            },
        )
        assert response.status_code == 422
    finally:
        app.dependency_overrides.pop(current_user, None)
