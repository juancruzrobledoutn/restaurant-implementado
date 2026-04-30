"""
Tests for C-06 catalog models: CookingMethod, FlavorProfile, TextureProfile, CuisineType.

Coverage:
  - Creation with required fields and AuditMixin defaults
  - Unique constraint on (tenant_id, name) for all four models
  - Tenant isolation at the DB level: same name allowed in different tenants
  - Soft delete behavior
  - __repr__ output
"""
import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.catalog import CookingMethod, CuisineType, FlavorProfile, TextureProfile
from rest_api.models.tenant import Tenant


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _make_tenant(db: AsyncSession, name: str = "Acme") -> Tenant:
    t = Tenant(name=name)
    db.add(t)
    await db.flush()
    await db.refresh(t)
    return t


async def _make_catalog_item(db: AsyncSession, model: type, tenant_id: int, name: str):
    item = model(tenant_id=tenant_id, name=name)
    db.add(item)
    await db.flush()
    await db.refresh(item)
    return item


# ── Parameterized catalog model tests ─────────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize(
    "model,name",
    [
        (CookingMethod, "Grilled"),
        (FlavorProfile, "Umami"),
        (TextureProfile, "Crispy"),
        (CuisineType, "Italian"),
    ],
)
async def test_catalog_item_creation(db: AsyncSession, model: type, name: str) -> None:
    """Each catalog model creates correctly with required fields and AuditMixin defaults."""
    tenant = await _make_tenant(db)
    item = await _make_catalog_item(db, model, tenant.id, name)

    assert item.id is not None
    assert item.tenant_id == tenant.id
    assert item.name == name
    assert item.is_active is True
    assert item.created_at is not None
    assert item.updated_at is not None
    assert item.deleted_at is None
    assert item.deleted_by_id is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "model,name",
    [
        (CookingMethod, "Steamed"),
        (FlavorProfile, "Sweet"),
        (TextureProfile, "Chewy"),
        (CuisineType, "Japanese"),
    ],
)
async def test_catalog_item_unique_name_per_tenant(
    db: AsyncSession, model: type, name: str
) -> None:
    """(tenant_id, name) unique constraint raises IntegrityError on duplicate."""
    tenant = await _make_tenant(db)
    await _make_catalog_item(db, model, tenant.id, name)

    dup = model(tenant_id=tenant.id, name=name)
    db.add(dup)
    with pytest.raises(IntegrityError):
        await db.flush()
    await db.rollback()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "model,name",
    [
        (CookingMethod, "Fried"),
        (FlavorProfile, "Spicy"),
        (TextureProfile, "Creamy"),
        (CuisineType, "Argentine"),
    ],
)
async def test_catalog_item_same_name_different_tenants_allowed(
    db: AsyncSession, model: type, name: str
) -> None:
    """Same catalog item name is allowed in different tenants."""
    tenant_a = await _make_tenant(db, f"Tenant-A-{name}")
    tenant_b = await _make_tenant(db, f"Tenant-B-{name}")

    item_a = await _make_catalog_item(db, model, tenant_a.id, name)
    item_b = await _make_catalog_item(db, model, tenant_b.id, name)

    assert item_a.id != item_b.id
    assert item_a.tenant_id != item_b.tenant_id


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "model,name",
    [
        (CookingMethod, "Poached"),
        (FlavorProfile, "Bitter"),
        (TextureProfile, "Fluffy"),
        (CuisineType, "French"),
    ],
)
async def test_catalog_item_soft_delete(db: AsyncSession, model: type, name: str) -> None:
    """Soft delete sets is_active=False without removing the row."""
    tenant = await _make_tenant(db, f"Tenant-{name}")
    item = await _make_catalog_item(db, model, tenant.id, name)

    item.is_active = False
    await db.flush()
    await db.refresh(item)

    assert item.is_active is False
    assert item.id is not None


@pytest.mark.asyncio
async def test_cooking_method_repr(db: AsyncSession) -> None:
    tenant = await _make_tenant(db)
    item = await _make_catalog_item(db, CookingMethod, tenant.id, "Baked")
    assert "CookingMethod" in repr(item)
    assert "Baked" in repr(item)


@pytest.mark.asyncio
async def test_flavor_profile_repr(db: AsyncSession) -> None:
    tenant = await _make_tenant(db)
    item = await _make_catalog_item(db, FlavorProfile, tenant.id, "Sour")
    assert "FlavorProfile" in repr(item)


@pytest.mark.asyncio
async def test_texture_profile_repr(db: AsyncSession) -> None:
    tenant = await _make_tenant(db)
    item = await _make_catalog_item(db, TextureProfile, tenant.id, "Tender")
    assert "TextureProfile" in repr(item)


@pytest.mark.asyncio
async def test_cuisine_type_repr(db: AsyncSession) -> None:
    tenant = await _make_tenant(db)
    item = await _make_catalog_item(db, CuisineType, tenant.id, "Mexican")
    assert "CuisineType" in repr(item)
