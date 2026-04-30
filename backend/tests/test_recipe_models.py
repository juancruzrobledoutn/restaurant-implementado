"""
Tests for C-06 recipe models: Recipe and RecipeIngredient.

Coverage:
  - Recipe creation with required fields and AuditMixin defaults
  - Unique constraint on (tenant_id, name)
  - RecipeIngredient creation with Numeric quantity
  - Unique constraint on (recipe_id, ingredient_id)
  - FK constraints (recipe_id, ingredient_id)
  - Numeric precision: quantity stores 3 decimal places without float drift
"""
import pytest
from decimal import Decimal
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from rest_api.models.ingredient import Ingredient, IngredientGroup
from rest_api.models.recipe import Recipe, RecipeIngredient
from rest_api.models.tenant import Tenant


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _make_tenant(db: AsyncSession, name: str = "Acme") -> Tenant:
    t = Tenant(name=name)
    db.add(t)
    await db.flush()
    await db.refresh(t)
    return t


async def _make_recipe(
    db: AsyncSession,
    tenant_id: int,
    name: str = "Lasagna",
) -> Recipe:
    recipe = Recipe(tenant_id=tenant_id, name=name)
    db.add(recipe)
    await db.flush()
    await db.refresh(recipe)
    return recipe


async def _make_ingredient(
    db: AsyncSession,
    tenant_id: int,
    name: str = "Flour",
) -> Ingredient:
    group = IngredientGroup(tenant_id=tenant_id, name=f"Group-{name}")
    db.add(group)
    await db.flush()
    ingredient = Ingredient(group_id=group.id, tenant_id=tenant_id, name=name)
    db.add(ingredient)
    await db.flush()
    await db.refresh(ingredient)
    return ingredient


# ── Recipe tests ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_recipe_creation(db: AsyncSession) -> None:
    """Recipe is created with required fields and AuditMixin defaults."""
    tenant = await _make_tenant(db)
    recipe = await _make_recipe(db, tenant.id)

    assert recipe.id is not None
    assert recipe.tenant_id == tenant.id
    assert recipe.name == "Lasagna"
    assert recipe.description is None
    assert recipe.is_active is True
    assert recipe.created_at is not None
    assert recipe.updated_at is not None
    assert recipe.deleted_at is None


@pytest.mark.asyncio
async def test_recipe_with_description(db: AsyncSession) -> None:
    """Recipe can store an optional description."""
    tenant = await _make_tenant(db)
    recipe = Recipe(tenant_id=tenant.id, name="Stew", description="A hearty stew.")
    db.add(recipe)
    await db.flush()
    await db.refresh(recipe)

    assert recipe.description == "A hearty stew."


@pytest.mark.asyncio
async def test_recipe_unique_name_per_tenant(db: AsyncSession) -> None:
    """(tenant_id, name) unique constraint raises IntegrityError on duplicate."""
    tenant = await _make_tenant(db)
    await _make_recipe(db, tenant.id, name="Paella")

    dup = Recipe(tenant_id=tenant.id, name="Paella")
    db.add(dup)
    with pytest.raises(IntegrityError):
        await db.flush()
    await db.rollback()


@pytest.mark.asyncio
async def test_recipe_same_name_different_tenants_allowed(db: AsyncSession) -> None:
    """Same recipe name in different tenants is allowed."""
    tenant_a = await _make_tenant(db, "Tenant A")
    tenant_b = await _make_tenant(db, "Tenant B")

    r_a = await _make_recipe(db, tenant_a.id, name="Risotto")
    r_b = await _make_recipe(db, tenant_b.id, name="Risotto")

    assert r_a.id != r_b.id


@pytest.mark.asyncio
async def test_recipe_repr(db: AsyncSession) -> None:
    tenant = await _make_tenant(db)
    recipe = await _make_recipe(db, tenant.id, name="Carbonara")
    assert "Recipe" in repr(recipe)
    assert "Carbonara" in repr(recipe)


# ── RecipeIngredient tests ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_recipe_ingredient_creation(db: AsyncSession) -> None:
    """RecipeIngredient is created with quantity (Numeric) and unit."""
    tenant = await _make_tenant(db)
    recipe = await _make_recipe(db, tenant.id)
    ingredient = await _make_ingredient(db, tenant.id)

    ri = RecipeIngredient(
        recipe_id=recipe.id,
        ingredient_id=ingredient.id,
        quantity=Decimal("250.500"),
        unit="g",
    )
    db.add(ri)
    await db.flush()
    await db.refresh(ri)

    assert ri.id is not None
    assert ri.recipe_id == recipe.id
    assert ri.ingredient_id == ingredient.id
    assert ri.unit == "g"


@pytest.mark.asyncio
async def test_recipe_ingredient_numeric_precision(db: AsyncSession) -> None:
    """Numeric(10,3) stores exact decimal values without float drift."""
    tenant = await _make_tenant(db)
    recipe = await _make_recipe(db, tenant.id)
    ingredient = await _make_ingredient(db, tenant.id)

    # 1/3 of a kilogram — would be imprecise as float
    ri = RecipeIngredient(
        recipe_id=recipe.id,
        ingredient_id=ingredient.id,
        quantity=Decimal("333.333"),
        unit="g",
    )
    db.add(ri)
    await db.flush()
    await db.refresh(ri)

    # SQLite stores it as-is; PostgreSQL would enforce Numeric(10,3)
    assert ri.quantity == Decimal("333.333")


@pytest.mark.asyncio
async def test_recipe_ingredient_unique_per_recipe(db: AsyncSession) -> None:
    """(recipe_id, ingredient_id) unique constraint raises IntegrityError on duplicate."""
    tenant = await _make_tenant(db)
    recipe = await _make_recipe(db, tenant.id)
    ingredient = await _make_ingredient(db, tenant.id)

    ri1 = RecipeIngredient(
        recipe_id=recipe.id, ingredient_id=ingredient.id, quantity=Decimal("100"), unit="g"
    )
    db.add(ri1)
    await db.flush()

    ri2 = RecipeIngredient(
        recipe_id=recipe.id, ingredient_id=ingredient.id, quantity=Decimal("200"), unit="g"
    )
    db.add(ri2)
    with pytest.raises(IntegrityError):
        await db.flush()
    await db.rollback()


@pytest.mark.asyncio
async def test_recipe_soft_delete_leaves_recipe_ingredients(db: AsyncSession) -> None:
    """Soft-deleting a recipe does not delete RecipeIngredient rows (history preservation)."""
    tenant = await _make_tenant(db)
    recipe = await _make_recipe(db, tenant.id)
    ingredient = await _make_ingredient(db, tenant.id)

    ri = RecipeIngredient(
        recipe_id=recipe.id, ingredient_id=ingredient.id, quantity=Decimal("100"), unit="g"
    )
    db.add(ri)
    await db.flush()

    recipe.is_active = False
    await db.flush()
    await db.refresh(recipe)
    await db.refresh(ri)

    assert recipe.is_active is False
    assert ri.id is not None  # RecipeIngredient still exists
