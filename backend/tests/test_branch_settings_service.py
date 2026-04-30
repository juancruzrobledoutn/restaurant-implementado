"""
Tests for BranchSettingsService (C-28).

TDD — tests written BEFORE the service.

Covers:
  - get_settings: correct tenant returns data / cross-tenant returns None
  - update_settings: happy path all fields, update only name, slug duplicate raises 409
  - cache invalidation called with old and new slug
  - Redis down does not fail the operation
"""
import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from sqlalchemy.ext.asyncio import AsyncSession


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def tenant_and_branch(db: AsyncSession):
    """Create two tenants and two branches for isolation tests."""
    from rest_api.models.tenant import Tenant
    from rest_api.models.branch import Branch

    tenant1 = Tenant(name="Tenant 1")
    tenant2 = Tenant(name="Tenant 2")
    db.add_all([tenant1, tenant2])
    await db.flush()

    branch1 = Branch(
        tenant_id=tenant1.id,
        name="Branch 1",
        address="Addr 1",
        slug="branch-one",
        timezone="America/Argentina/Buenos_Aires",
    )
    branch2 = Branch(
        tenant_id=tenant2.id,
        name="Branch 2",
        address="Addr 2",
        slug="branch-two",
        timezone="America/Argentina/Buenos_Aires",
    )
    db.add_all([branch1, branch2])
    await db.flush()
    return {"tenant1": tenant1, "tenant2": tenant2, "branch1": branch1, "branch2": branch2}


# ---------------------------------------------------------------------------
# get_settings tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_settings_returns_branch_for_correct_tenant(db: AsyncSession, tenant_and_branch):
    """get_settings returns a BranchSettingsResponse for the correct tenant."""
    from rest_api.services.domain.branch_settings_service import BranchSettingsService

    branch1 = tenant_and_branch["branch1"]
    tenant1 = tenant_and_branch["tenant1"]

    service = BranchSettingsService(db)
    result = await service.get_settings(branch_id=branch1.id, tenant_id=tenant1.id)

    assert result is not None
    assert result.id == branch1.id
    assert result.tenant_id == tenant1.id
    assert result.slug == "branch-one"


@pytest.mark.asyncio
async def test_get_settings_returns_none_for_cross_tenant(db: AsyncSession, tenant_and_branch):
    """get_settings returns None when branch doesn't belong to the tenant (cross-tenant isolation)."""
    from rest_api.services.domain.branch_settings_service import BranchSettingsService

    branch1 = tenant_and_branch["branch1"]
    tenant2 = tenant_and_branch["tenant2"]

    service = BranchSettingsService(db)
    # branch1 belongs to tenant1, not tenant2
    result = await service.get_settings(branch_id=branch1.id, tenant_id=tenant2.id)

    assert result is None


# ---------------------------------------------------------------------------
# update_settings tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_update_settings_happy_path_all_fields(db: AsyncSession, tenant_and_branch):
    """update_settings updates all provided fields and returns the updated schema."""
    from rest_api.services.domain.branch_settings_service import BranchSettingsService
    from rest_api.schemas.branch_settings import BranchSettingsUpdate

    branch1 = tenant_and_branch["branch1"]
    tenant1 = tenant_and_branch["tenant1"]

    patch_data = BranchSettingsUpdate(
        name="Updated Branch",
        phone="+54 11 9999-0000",
        timezone="Europe/Madrid",
        opening_hours={
            "mon": [{"open": "09:00", "close": "23:00"}],
            "tue": [], "wed": [], "thu": [], "fri": [], "sat": [], "sun": [],
        },
    )

    service = BranchSettingsService(db)
    with patch.object(service, "_invalidate_menu_cache", new_callable=AsyncMock):
        result = await service.update_settings(
            branch_id=branch1.id,
            tenant_id=tenant1.id,
            patch=patch_data,
        )

    assert result.name == "Updated Branch"
    assert result.phone == "+54 11 9999-0000"
    assert result.timezone == "Europe/Madrid"
    assert result.opening_hours is not None


@pytest.mark.asyncio
async def test_update_settings_only_name(db: AsyncSession, tenant_and_branch):
    """update_settings with only name — other fields remain unchanged."""
    from rest_api.services.domain.branch_settings_service import BranchSettingsService
    from rest_api.schemas.branch_settings import BranchSettingsUpdate

    branch1 = tenant_and_branch["branch1"]
    tenant1 = tenant_and_branch["tenant1"]

    patch_data = BranchSettingsUpdate(name="Renamed Branch")

    service = BranchSettingsService(db)
    with patch.object(service, "_invalidate_menu_cache", new_callable=AsyncMock):
        result = await service.update_settings(
            branch_id=branch1.id,
            tenant_id=tenant1.id,
            patch=patch_data,
        )

    assert result.name == "Renamed Branch"
    assert result.slug == "branch-one"  # unchanged


@pytest.mark.asyncio
async def test_update_settings_slug_duplicate_raises_conflict(db: AsyncSession, tenant_and_branch):
    """update_settings raises 409 ConflictError when slug is already taken within the same tenant."""
    from fastapi import HTTPException
    from rest_api.services.domain.branch_settings_service import BranchSettingsService
    from rest_api.schemas.branch_settings import BranchSettingsUpdate
    from rest_api.models.branch import Branch

    tenant1 = tenant_and_branch["tenant1"]
    branch1 = tenant_and_branch["branch1"]

    # Create a second branch for tenant1 with slug "branch-alpha"
    branch_alpha = Branch(
        tenant_id=tenant1.id,
        name="Alpha Branch",
        address="Addr Alpha",
        slug="branch-alpha",
        timezone="America/Argentina/Buenos_Aires",
    )
    db.add(branch_alpha)
    await db.flush()

    # Now try to update branch1 to use "branch-alpha" (already taken)
    patch_data = BranchSettingsUpdate(slug="branch-alpha")
    service = BranchSettingsService(db)

    with pytest.raises(HTTPException) as exc_info:
        await service.update_settings(
            branch_id=branch1.id,
            tenant_id=tenant1.id,
            patch=patch_data,
        )
    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_update_settings_same_slug_no_conflict(db: AsyncSession, tenant_and_branch):
    """update_settings with the same slug as the current branch does not raise a conflict."""
    from rest_api.services.domain.branch_settings_service import BranchSettingsService
    from rest_api.schemas.branch_settings import BranchSettingsUpdate

    branch1 = tenant_and_branch["branch1"]
    tenant1 = tenant_and_branch["tenant1"]

    # Same slug — should not raise
    patch_data = BranchSettingsUpdate(slug="branch-one", name="Same Slug Branch")
    service = BranchSettingsService(db)
    with patch.object(service, "_invalidate_menu_cache", new_callable=AsyncMock):
        result = await service.update_settings(
            branch_id=branch1.id,
            tenant_id=tenant1.id,
            patch=patch_data,
        )
    assert result.slug == "branch-one"


# ---------------------------------------------------------------------------
# Cache invalidation tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_update_settings_calls_cache_invalidation(db: AsyncSession, tenant_and_branch):
    """Cache invalidation is called with old slug (and new slug if changed)."""
    from rest_api.services.domain.branch_settings_service import BranchSettingsService
    from rest_api.schemas.branch_settings import BranchSettingsUpdate

    branch1 = tenant_and_branch["branch1"]
    tenant1 = tenant_and_branch["tenant1"]

    patch_data = BranchSettingsUpdate(slug="branch-one-new")
    service = BranchSettingsService(db)

    with patch.object(service, "_invalidate_menu_cache", new_callable=AsyncMock) as mock_invalidate:
        await service.update_settings(
            branch_id=branch1.id,
            tenant_id=tenant1.id,
            patch=patch_data,
        )
        # Should be called at least once (old slug) or twice (old + new)
        assert mock_invalidate.called


@pytest.mark.asyncio
async def test_update_settings_redis_down_does_not_fail(db: AsyncSession):
    """If Redis is down during cache invalidation, the update still succeeds."""
    from rest_api.services.domain.branch_settings_service import BranchSettingsService
    from rest_api.schemas.branch_settings import BranchSettingsUpdate
    from rest_api.models.tenant import Tenant
    from rest_api.models.branch import Branch

    # Set up data inline
    tenant = Tenant(name="Tenant Redis Test")
    db.add(tenant)
    await db.flush()
    branch = Branch(
        tenant_id=tenant.id,
        name="Branch Redis",
        address="Addr",
        slug="redis-test-slug",
        timezone="America/Argentina/Buenos_Aires",
    )
    db.add(branch)
    await db.flush()

    patch_data = BranchSettingsUpdate(name="Redis Down Branch")
    service = BranchSettingsService(db)

    # Make _invalidate_menu_cache raise (simulate Redis down)
    async def _raise(*args, **kwargs):
        raise ConnectionError("Redis is down")

    with patch.object(service, "_invalidate_menu_cache", side_effect=_raise):
        # Should not raise even if invalidation fails
        result = await service.update_settings(
            branch_id=branch.id,
            tenant_id=tenant.id,
            patch=patch_data,
        )
    assert result.name == "Redis Down Branch"
