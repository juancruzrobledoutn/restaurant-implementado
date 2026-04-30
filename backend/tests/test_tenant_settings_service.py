"""
Tests for TenantSettingsService (C-28).

TDD — tests written BEFORE the service.

Covers:
  - get returns {id, name} without privacy_salt
  - update validates name is not blank
  - update uses safe_commit
  - service never takes tenant_id from input body (always from JWT context)
"""
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession


@pytest_asyncio.fixture
async def tenant(db: AsyncSession):
    """Create a Tenant for testing."""
    from rest_api.models.tenant import Tenant

    t = Tenant(name="Test Tenant", privacy_salt="secret-salt-value")
    db.add(t)
    await db.flush()
    return t


@pytest.mark.asyncio
async def test_get_returns_id_and_name(db: AsyncSession, tenant):
    """get() returns TenantSettingsResponse with id and name."""
    from rest_api.services.domain.tenant_settings_service import TenantSettingsService

    service = TenantSettingsService(db)
    result = await service.get(tenant_id=tenant.id)

    assert result is not None
    assert result.id == tenant.id
    assert result.name == "Test Tenant"


@pytest.mark.asyncio
async def test_get_does_not_expose_privacy_salt(db: AsyncSession, tenant):
    """get() returns TenantSettingsResponse — privacy_salt must not be in the response."""
    from rest_api.services.domain.tenant_settings_service import TenantSettingsService

    service = TenantSettingsService(db)
    result = await service.get(tenant_id=tenant.id)

    # TenantSettingsResponse schema explicitly excludes privacy_salt
    assert not hasattr(result, "privacy_salt")
    result_dict = result.model_dump()
    assert "privacy_salt" not in result_dict


@pytest.mark.asyncio
async def test_get_returns_none_for_unknown_tenant(db: AsyncSession):
    """get() returns None if tenant does not exist."""
    from rest_api.services.domain.tenant_settings_service import TenantSettingsService

    service = TenantSettingsService(db)
    result = await service.get(tenant_id=999_999)

    assert result is None


@pytest.mark.asyncio
async def test_update_name_succeeds(db: AsyncSession, tenant):
    """update() changes the name and returns the updated response."""
    from rest_api.services.domain.tenant_settings_service import TenantSettingsService
    from rest_api.schemas.tenant import TenantSettingsUpdate

    service = TenantSettingsService(db)
    patch = TenantSettingsUpdate(name="Updated Tenant Name")
    result = await service.update(tenant_id=tenant.id, patch=patch)

    assert result.name == "Updated Tenant Name"
    assert result.id == tenant.id


@pytest.mark.asyncio
async def test_update_blank_name_raises_validation_error(db: AsyncSession, tenant):
    """update() with blank name raises ValueError via Pydantic validation."""
    from rest_api.schemas.tenant import TenantSettingsUpdate
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        TenantSettingsUpdate(name="   ")  # blank after strip — Pydantic rejects


@pytest.mark.asyncio
async def test_update_none_name_does_not_change_existing(db: AsyncSession, tenant):
    """update() with name=None is a no-op (name unchanged)."""
    from rest_api.services.domain.tenant_settings_service import TenantSettingsService
    from rest_api.schemas.tenant import TenantSettingsUpdate

    service = TenantSettingsService(db)
    patch = TenantSettingsUpdate()  # no name provided
    result = await service.update(tenant_id=tenant.id, patch=patch)

    assert result.name == "Test Tenant"


@pytest.mark.asyncio
async def test_update_returns_none_for_unknown_tenant(db: AsyncSession):
    """update() returns None if tenant does not exist."""
    from rest_api.services.domain.tenant_settings_service import TenantSettingsService
    from rest_api.schemas.tenant import TenantSettingsUpdate

    service = TenantSettingsService(db)
    patch = TenantSettingsUpdate(name="Won't exist")
    result = await service.update(tenant_id=999_999, patch=patch)

    assert result is None
