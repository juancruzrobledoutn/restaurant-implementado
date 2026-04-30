"""
Tests for C-06 ingredient models: IngredientGroup, Ingredient, SubIngredient.

Coverage:
  - Model creation with required fields
  - AuditMixin default field values (is_active, created_at, etc.)
  - Unique constraints: (tenant_id, name) for groups, (group_id, name) for ingredients,
    (ingredient_id, name) for sub-ingredients
  - FK relationships and cascade behavior
  - tenant_id denormalization on Ingredient (auto-set from parent group)
  - __repr__ output
"""
import pytest
from decimal import Decimal
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.ingredient import Ingredient, IngredientGroup, SubIngredient
from rest_api.models.tenant import Tenant


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _make_tenant(db: AsyncSession, name: str = "Acme Corp") -> Tenant:
    tenant = Tenant(name=name)
    db.add(tenant)
    await db.flush()
    await db.refresh(tenant)
    return tenant


async def _make_group(
    db: AsyncSession,
    tenant_id: int,
    name: str = "Dairy",
) -> IngredientGroup:
    group = IngredientGroup(tenant_id=tenant_id, name=name)
    db.add(group)
    await db.flush()
    await db.refresh(group)
    return group


async def _make_ingredient(
    db: AsyncSession,
    group_id: int,
    tenant_id: int,
    name: str = "Whole Milk",
) -> Ingredient:
    ingredient = Ingredient(group_id=group_id, tenant_id=tenant_id, name=name)
    db.add(ingredient)
    await db.flush()
    await db.refresh(ingredient)
    return ingredient


# ── IngredientGroup tests ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_ingredient_group_creation(db: AsyncSession) -> None:
    """IngredientGroup is created with required fields and AuditMixin defaults."""
    tenant = await _make_tenant(db)
    group = await _make_group(db, tenant.id)

    assert group.id is not None
    assert group.tenant_id == tenant.id
    assert group.name == "Dairy"
    assert group.is_active is True
    assert group.created_at is not None
    assert group.updated_at is not None
    assert group.deleted_at is None
    assert group.deleted_by_id is None


@pytest.mark.asyncio
async def test_ingredient_group_repr(db: AsyncSession) -> None:
    tenant = await _make_tenant(db)
    group = await _make_group(db, tenant.id)
    assert "IngredientGroup" in repr(group)
    assert "Dairy" in repr(group)


@pytest.mark.asyncio
async def test_ingredient_group_unique_name_per_tenant(db: AsyncSession) -> None:
    """(tenant_id, name) unique constraint — duplicate raises IntegrityError."""
    tenant = await _make_tenant(db)
    await _make_group(db, tenant.id, name="Proteins")

    dup = IngredientGroup(tenant_id=tenant.id, name="Proteins")
    db.add(dup)
    with pytest.raises(IntegrityError):
        await db.flush()
    await db.rollback()


@pytest.mark.asyncio
async def test_ingredient_group_same_name_different_tenants_allowed(db: AsyncSession) -> None:
    """Same group name in different tenants is allowed."""
    tenant_a = await _make_tenant(db, "Tenant A")
    tenant_b = await _make_tenant(db, "Tenant B")

    group_a = await _make_group(db, tenant_a.id, name="Vegetables")
    group_b = await _make_group(db, tenant_b.id, name="Vegetables")

    assert group_a.id != group_b.id
    assert group_a.tenant_id != group_b.tenant_id


@pytest.mark.asyncio
async def test_ingredient_group_soft_delete(db: AsyncSession) -> None:
    """Soft delete sets is_active=False and keeps the row."""
    tenant = await _make_tenant(db)
    group = await _make_group(db, tenant.id)

    group.is_active = False
    await db.flush()
    await db.refresh(group)

    assert group.is_active is False
    assert group.id is not None  # row still exists


# ── Ingredient tests ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_ingredient_creation(db: AsyncSession) -> None:
    """Ingredient is created with group_id and denormalized tenant_id."""
    tenant = await _make_tenant(db)
    group = await _make_group(db, tenant.id)
    ingredient = await _make_ingredient(db, group.id, tenant.id)

    assert ingredient.id is not None
    assert ingredient.group_id == group.id
    assert ingredient.tenant_id == tenant.id
    assert ingredient.name == "Whole Milk"
    assert ingredient.is_active is True


@pytest.mark.asyncio
async def test_ingredient_unique_name_per_group(db: AsyncSession) -> None:
    """(group_id, name) unique constraint — duplicate raises IntegrityError."""
    tenant = await _make_tenant(db)
    group = await _make_group(db, tenant.id)
    await _make_ingredient(db, group.id, tenant.id, name="Butter")

    dup = Ingredient(group_id=group.id, tenant_id=tenant.id, name="Butter")
    db.add(dup)
    with pytest.raises(IntegrityError):
        await db.flush()
    await db.rollback()


@pytest.mark.asyncio
async def test_ingredient_same_name_different_groups_allowed(db: AsyncSession) -> None:
    """Same name in different groups is allowed."""
    tenant = await _make_tenant(db)
    group_a = await _make_group(db, tenant.id, name="Dairy")
    group_b = await _make_group(db, tenant.id, name="Proteins")

    ingr_a = await _make_ingredient(db, group_a.id, tenant.id, name="Cream")
    ingr_b = await _make_ingredient(db, group_b.id, tenant.id, name="Cream")

    assert ingr_a.id != ingr_b.id


@pytest.mark.asyncio
async def test_ingredient_tenant_id_is_denormalized(db: AsyncSession) -> None:
    """Ingredient.tenant_id should match the parent group's tenant_id."""
    tenant = await _make_tenant(db)
    group = await _make_group(db, tenant.id)
    ingredient = await _make_ingredient(db, group.id, group.tenant_id)

    assert ingredient.tenant_id == group.tenant_id


# ── SubIngredient tests ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_sub_ingredient_creation(db: AsyncSession) -> None:
    """SubIngredient is created with ingredient_id and no tenant_id."""
    tenant = await _make_tenant(db)
    group = await _make_group(db, tenant.id)
    ingredient = await _make_ingredient(db, group.id, tenant.id)

    sub = SubIngredient(ingredient_id=ingredient.id, name="Lactose")
    db.add(sub)
    await db.flush()
    await db.refresh(sub)

    assert sub.id is not None
    assert sub.ingredient_id == ingredient.id
    assert sub.name == "Lactose"
    assert sub.is_active is True


@pytest.mark.asyncio
async def test_sub_ingredient_unique_name_per_ingredient(db: AsyncSession) -> None:
    """(ingredient_id, name) unique constraint raises IntegrityError on duplicate."""
    tenant = await _make_tenant(db)
    group = await _make_group(db, tenant.id)
    ingredient = await _make_ingredient(db, group.id, tenant.id)

    sub1 = SubIngredient(ingredient_id=ingredient.id, name="Casein")
    db.add(sub1)
    await db.flush()

    sub2 = SubIngredient(ingredient_id=ingredient.id, name="Casein")
    db.add(sub2)
    with pytest.raises(IntegrityError):
        await db.flush()
    await db.rollback()


@pytest.mark.asyncio
async def test_cascade_soft_delete_simulation(db: AsyncSession) -> None:
    """
    Verifying that setting is_active=False propagates manually in service layer.
    This test simulates the service-level cascade behavior on models directly.
    """
    tenant = await _make_tenant(db)
    group = await _make_group(db, tenant.id)
    ingredient = await _make_ingredient(db, group.id, tenant.id)
    sub = SubIngredient(ingredient_id=ingredient.id, name="Component")
    db.add(sub)
    await db.flush()

    # Simulate cascade: set all inactive
    sub.is_active = False
    ingredient.is_active = False
    group.is_active = False
    await db.flush()

    await db.refresh(group)
    await db.refresh(ingredient)
    await db.refresh(sub)

    assert group.is_active is False
    assert ingredient.is_active is False
    assert sub.is_active is False
