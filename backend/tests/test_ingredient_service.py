"""
Tests for IngredientService — service-level CRUD and business rules.

Coverage:
  - IngredientGroup CRUD (create, list, get, update, delete)
  - Ingredient CRUD (tenant_id auto-set from group)
  - SubIngredient CRUD
  - Cascade soft-delete: group → ingredients → sub-ingredients
  - Tenant isolation: cross-tenant access returns NotFoundError (404 semantics)
  - Duplicate name rejection (ValidationError → 409 in router)
"""
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from shared.utils.exceptions import NotFoundError, ValidationError
from rest_api.models.branch import Branch
from rest_api.models.tenant import Tenant
from rest_api.schemas.ingredient import (
    IngredientCreate,
    IngredientGroupCreate,
    IngredientGroupUpdate,
    IngredientUpdate,
    SubIngredientCreate,
    SubIngredientUpdate,
)
from rest_api.services.domain.ingredient_service import IngredientService


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def two_tenants(db: AsyncSession):
    """Create two tenants for cross-tenant isolation tests."""
    tenant_a = Tenant(name="Tenant Alpha")
    tenant_b = Tenant(name="Tenant Beta")
    db.add_all([tenant_a, tenant_b])
    await db.flush()
    return tenant_a, tenant_b


@pytest_asyncio.fixture
async def tenant(db: AsyncSession) -> Tenant:
    t = Tenant(name="Single Tenant")
    db.add(t)
    await db.flush()
    return t


# ── IngredientGroup CRUD ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_ingredient_group(db: AsyncSession, tenant: Tenant) -> None:
    """Service creates IngredientGroup scoped to tenant."""
    svc = IngredientService(db)
    result = await svc.create_group(
        IngredientGroupCreate(name="Dairy"), tenant_id=tenant.id
    )
    assert result.id is not None
    assert result.name == "Dairy"
    assert result.tenant_id == tenant.id
    assert result.is_active is True


@pytest.mark.asyncio
async def test_list_ingredient_groups(db: AsyncSession, tenant: Tenant) -> None:
    """Service lists only active groups for the tenant."""
    svc = IngredientService(db)
    await svc.create_group(IngredientGroupCreate(name="Dairy"), tenant_id=tenant.id)
    await svc.create_group(IngredientGroupCreate(name="Proteins"), tenant_id=tenant.id)

    groups = await svc.list_groups(tenant_id=tenant.id)
    assert len(groups) == 2
    names = {g.name for g in groups}
    assert "Dairy" in names
    assert "Proteins" in names


@pytest.mark.asyncio
async def test_get_ingredient_group(db: AsyncSession, tenant: Tenant) -> None:
    """Service retrieves a group with nested ingredients."""
    svc = IngredientService(db)
    created = await svc.create_group(IngredientGroupCreate(name="Veggies"), tenant_id=tenant.id)
    fetched = await svc.get_group(created.id, tenant_id=tenant.id)
    assert fetched.id == created.id
    assert fetched.name == "Veggies"


@pytest.mark.asyncio
async def test_get_ingredient_group_not_found(db: AsyncSession, tenant: Tenant) -> None:
    """Accessing a non-existent group raises NotFoundError."""
    svc = IngredientService(db)
    with pytest.raises(NotFoundError):
        await svc.get_group(99999, tenant_id=tenant.id)


@pytest.mark.asyncio
async def test_update_ingredient_group(db: AsyncSession, tenant: Tenant) -> None:
    """Service updates group name."""
    svc = IngredientService(db)
    created = await svc.create_group(IngredientGroupCreate(name="Old Name"), tenant_id=tenant.id)
    updated = await svc.update_group(
        created.id, IngredientGroupUpdate(name="New Name"), tenant_id=tenant.id
    )
    assert updated.name == "New Name"


@pytest.mark.asyncio
async def test_create_group_duplicate_name_rejected(db: AsyncSession, tenant: Tenant) -> None:
    """Duplicate group name within same tenant raises ValidationError."""
    svc = IngredientService(db)
    await svc.create_group(IngredientGroupCreate(name="Cereals"), tenant_id=tenant.id)

    with pytest.raises(ValidationError):
        await svc.create_group(IngredientGroupCreate(name="Cereals"), tenant_id=tenant.id)


@pytest.mark.asyncio
async def test_delete_group_cascades_to_children(db: AsyncSession, tenant: Tenant) -> None:
    """Deleting a group soft-deletes all its ingredients and their sub-ingredients."""
    svc = IngredientService(db)
    group = await svc.create_group(IngredientGroupCreate(name="Cascade Test"), tenant_id=tenant.id)
    ingredient = await svc.create_ingredient(
        group.id, IngredientCreate(name="Parent Ingredient"), tenant_id=tenant.id
    )
    await svc.create_sub_ingredient(
        group.id, ingredient.id, SubIngredientCreate(name="Child Sub"), tenant_id=tenant.id
    )

    await svc.delete_group(group.id, tenant_id=tenant.id, user_id=1)

    # Group should not be findable anymore
    with pytest.raises(NotFoundError):
        await svc.get_group(group.id, tenant_id=tenant.id)

    # Ingredient should not be findable either
    with pytest.raises(NotFoundError):
        await svc.get_ingredient(group.id, ingredient.id, tenant_id=tenant.id)


# ── Ingredient CRUD ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_ingredient_auto_sets_tenant_id(db: AsyncSession, tenant: Tenant) -> None:
    """Ingredient creation copies tenant_id from parent group."""
    svc = IngredientService(db)
    group = await svc.create_group(IngredientGroupCreate(name="Dairy"), tenant_id=tenant.id)
    ingredient = await svc.create_ingredient(
        group.id, IngredientCreate(name="Whole Milk"), tenant_id=tenant.id
    )
    assert ingredient.tenant_id == tenant.id
    assert ingredient.group_id == group.id


@pytest.mark.asyncio
async def test_create_ingredient_duplicate_name_in_group_rejected(
    db: AsyncSession, tenant: Tenant
) -> None:
    """Duplicate ingredient name within same group raises ValidationError."""
    svc = IngredientService(db)
    group = await svc.create_group(IngredientGroupCreate(name="Dairy"), tenant_id=tenant.id)
    await svc.create_ingredient(
        group.id, IngredientCreate(name="Cream"), tenant_id=tenant.id
    )
    with pytest.raises(ValidationError):
        await svc.create_ingredient(
            group.id, IngredientCreate(name="Cream"), tenant_id=tenant.id
        )


@pytest.mark.asyncio
async def test_update_ingredient(db: AsyncSession, tenant: Tenant) -> None:
    """Service updates ingredient name."""
    svc = IngredientService(db)
    group = await svc.create_group(IngredientGroupCreate(name="Dairy"), tenant_id=tenant.id)
    ingredient = await svc.create_ingredient(
        group.id, IngredientCreate(name="Skimmed Milk"), tenant_id=tenant.id
    )
    updated = await svc.update_ingredient(
        group.id, ingredient.id, IngredientUpdate(name="Full Fat Milk"), tenant_id=tenant.id
    )
    assert updated.name == "Full Fat Milk"


@pytest.mark.asyncio
async def test_delete_ingredient_cascades_to_sub_ingredients(
    db: AsyncSession, tenant: Tenant
) -> None:
    """Deleting an ingredient soft-deletes its sub-ingredients."""
    svc = IngredientService(db)
    group = await svc.create_group(IngredientGroupCreate(name="Dairy"), tenant_id=tenant.id)
    ingredient = await svc.create_ingredient(
        group.id, IngredientCreate(name="Cheese"), tenant_id=tenant.id
    )
    sub = await svc.create_sub_ingredient(
        group.id, ingredient.id, SubIngredientCreate(name="Cheddar Base"), tenant_id=tenant.id
    )

    await svc.delete_ingredient(group.id, ingredient.id, tenant_id=tenant.id, user_id=1)

    # Ingredient not findable
    with pytest.raises(NotFoundError):
        await svc.get_ingredient(group.id, ingredient.id, tenant_id=tenant.id)


# ── Tenant isolation ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_tenant_a_cannot_access_tenant_b_group(db: AsyncSession, two_tenants) -> None:
    """Cross-tenant group access returns NotFoundError (not 403 — avoids leaking existence)."""
    tenant_a, tenant_b = two_tenants
    svc = IngredientService(db)

    group_b = await svc.create_group(
        IngredientGroupCreate(name="Tenant B Group"), tenant_id=tenant_b.id
    )

    with pytest.raises(NotFoundError):
        await svc.get_group(group_b.id, tenant_id=tenant_a.id)


@pytest.mark.asyncio
async def test_list_groups_only_returns_own_tenant(db: AsyncSession, two_tenants) -> None:
    """List only returns groups for the requesting tenant."""
    tenant_a, tenant_b = two_tenants
    svc = IngredientService(db)

    await svc.create_group(IngredientGroupCreate(name="A Group"), tenant_id=tenant_a.id)
    await svc.create_group(IngredientGroupCreate(name="B Group"), tenant_id=tenant_b.id)

    groups_a = await svc.list_groups(tenant_id=tenant_a.id)
    assert len(groups_a) == 1
    assert groups_a[0].name == "A Group"


# ── SubIngredient CRUD ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_sub_ingredient(db: AsyncSession, tenant: Tenant) -> None:
    svc = IngredientService(db)
    group = await svc.create_group(IngredientGroupCreate(name="Dairy"), tenant_id=tenant.id)
    ingredient = await svc.create_ingredient(
        group.id, IngredientCreate(name="Milk"), tenant_id=tenant.id
    )
    sub = await svc.create_sub_ingredient(
        group.id, ingredient.id, SubIngredientCreate(name="Lactose"), tenant_id=tenant.id
    )
    assert sub.id is not None
    assert sub.ingredient_id == ingredient.id
    assert sub.name == "Lactose"


@pytest.mark.asyncio
async def test_create_sub_ingredient_duplicate_name_rejected(
    db: AsyncSession, tenant: Tenant
) -> None:
    svc = IngredientService(db)
    group = await svc.create_group(IngredientGroupCreate(name="Dairy"), tenant_id=tenant.id)
    ingredient = await svc.create_ingredient(
        group.id, IngredientCreate(name="Milk"), tenant_id=tenant.id
    )
    await svc.create_sub_ingredient(
        group.id, ingredient.id, SubIngredientCreate(name="Casein"), tenant_id=tenant.id
    )
    with pytest.raises(ValidationError):
        await svc.create_sub_ingredient(
            group.id, ingredient.id, SubIngredientCreate(name="Casein"), tenant_id=tenant.id
        )
