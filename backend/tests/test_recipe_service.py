"""
Tests for RecipeService — service-level CRUD and business rules.

Coverage:
  - Create recipe with ingredients
  - Update replaces ingredients atomically
  - Inactive ingredient reference handling
  - Tenant isolation
  - Duplicate name rejection (ValidationError)
  - Soft delete
"""
import pytest
import pytest_asyncio
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession

from shared.utils.exceptions import NotFoundError, ValidationError
from rest_api.models.ingredient import Ingredient, IngredientGroup
from rest_api.models.tenant import Tenant
from rest_api.schemas.recipe import RecipeCreate, RecipeIngredientIn, RecipeUpdate
from rest_api.services.domain.recipe_service import RecipeService


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def tenant(db: AsyncSession) -> Tenant:
    t = Tenant(name="Recipe Test Tenant")
    db.add(t)
    await db.flush()
    return t


@pytest_asyncio.fixture
async def two_tenants(db: AsyncSession):
    t_a = Tenant(name="Recipe Tenant A")
    t_b = Tenant(name="Recipe Tenant B")
    db.add_all([t_a, t_b])
    await db.flush()
    return t_a, t_b


async def _make_ingredient(
    db: AsyncSession, tenant_id: int, name: str = "Flour"
) -> Ingredient:
    group = IngredientGroup(tenant_id=tenant_id, name=f"Group-{name}")
    db.add(group)
    await db.flush()
    ingredient = Ingredient(group_id=group.id, tenant_id=tenant_id, name=name)
    db.add(ingredient)
    await db.flush()
    await db.refresh(ingredient)
    return ingredient


# ── Create tests ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_recipe_without_ingredients(db: AsyncSession, tenant: Tenant) -> None:
    """Recipe can be created without any ingredients."""
    svc = RecipeService(db)
    result = await svc.create_recipe(
        RecipeCreate(name="Simple Recipe", ingredients=[]), tenant_id=tenant.id
    )
    assert result.id is not None
    assert result.name == "Simple Recipe"
    assert result.tenant_id == tenant.id
    assert result.ingredients == []


@pytest.mark.asyncio
async def test_create_recipe_with_ingredients(db: AsyncSession, tenant: Tenant) -> None:
    """Recipe is created with its full ingredient list."""
    svc = RecipeService(db)
    ingr = await _make_ingredient(db, tenant.id, "Tomato")

    result = await svc.create_recipe(
        RecipeCreate(
            name="Tomato Sauce",
            ingredients=[
                RecipeIngredientIn(ingredient_id=ingr.id, quantity=Decimal("500.000"), unit="g")
            ],
        ),
        tenant_id=tenant.id,
    )
    assert len(result.ingredients) == 1
    assert result.ingredients[0].ingredient_id == ingr.id
    assert result.ingredients[0].unit == "g"


@pytest.mark.asyncio
async def test_create_recipe_duplicate_name_rejected(db: AsyncSession, tenant: Tenant) -> None:
    """Duplicate recipe name within same tenant raises ValidationError."""
    svc = RecipeService(db)
    await svc.create_recipe(
        RecipeCreate(name="Bolognese", ingredients=[]), tenant_id=tenant.id
    )
    with pytest.raises(ValidationError):
        await svc.create_recipe(
            RecipeCreate(name="Bolognese", ingredients=[]), tenant_id=tenant.id
        )


@pytest.mark.asyncio
async def test_create_recipe_invalid_ingredient_id_rejected(
    db: AsyncSession, tenant: Tenant
) -> None:
    """Using a non-existent ingredient_id raises ValidationError."""
    svc = RecipeService(db)
    with pytest.raises(ValidationError):
        await svc.create_recipe(
            RecipeCreate(
                name="Bad Recipe",
                ingredients=[
                    RecipeIngredientIn(ingredient_id=99999, quantity=Decimal("100"), unit="g")
                ],
            ),
            tenant_id=tenant.id,
        )


# ── Update tests ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_recipe_replaces_ingredients_atomically(
    db: AsyncSession, tenant: Tenant
) -> None:
    """Updating with a new ingredient list fully replaces the old one."""
    svc = RecipeService(db)
    ingr_a = await _make_ingredient(db, tenant.id, "Carrot")
    ingr_b = await _make_ingredient(db, tenant.id, "Potato")

    recipe = await svc.create_recipe(
        RecipeCreate(
            name="Vegetable Stew",
            ingredients=[
                RecipeIngredientIn(
                    ingredient_id=ingr_a.id, quantity=Decimal("200"), unit="g"
                )
            ],
        ),
        tenant_id=tenant.id,
    )
    assert len(recipe.ingredients) == 1

    updated = await svc.update_recipe(
        recipe.id,
        RecipeUpdate(
            ingredients=[
                RecipeIngredientIn(
                    ingredient_id=ingr_b.id, quantity=Decimal("300"), unit="g"
                )
            ]
        ),
        tenant_id=tenant.id,
    )

    # Old ingredient gone, new ingredient present
    assert len(updated.ingredients) == 1
    assert updated.ingredients[0].ingredient_id == ingr_b.id


@pytest.mark.asyncio
async def test_update_recipe_without_ingredients_keeps_existing(
    db: AsyncSession, tenant: Tenant
) -> None:
    """Updating recipe name without providing ingredients keeps existing list."""
    svc = RecipeService(db)
    ingr = await _make_ingredient(db, tenant.id, "Garlic")

    recipe = await svc.create_recipe(
        RecipeCreate(
            name="Garlic Bread",
            ingredients=[
                RecipeIngredientIn(
                    ingredient_id=ingr.id, quantity=Decimal("50"), unit="g"
                )
            ],
        ),
        tenant_id=tenant.id,
    )

    updated = await svc.update_recipe(
        recipe.id,
        RecipeUpdate(name="Garlic Toast"),  # no ingredients key
        tenant_id=tenant.id,
    )

    assert updated.name == "Garlic Toast"
    assert len(updated.ingredients) == 1


# ── Delete tests ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_soft_delete_recipe(db: AsyncSession, tenant: Tenant) -> None:
    """Soft-deleting a recipe makes it unfindable."""
    svc = RecipeService(db)
    recipe = await svc.create_recipe(
        RecipeCreate(name="To Delete", ingredients=[]), tenant_id=tenant.id
    )
    await svc.delete_recipe(recipe.id, tenant_id=tenant.id, user_id=1)

    with pytest.raises(NotFoundError):
        await svc.get_recipe(recipe.id, tenant_id=tenant.id)


# ── Tenant isolation ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_tenant_a_cannot_access_tenant_b_recipe(
    db: AsyncSession, two_tenants
) -> None:
    """Cross-tenant recipe access returns NotFoundError."""
    tenant_a, tenant_b = two_tenants
    svc = RecipeService(db)

    recipe_b = await svc.create_recipe(
        RecipeCreate(name="Tenant B Recipe", ingredients=[]), tenant_id=tenant_b.id
    )

    with pytest.raises(NotFoundError):
        await svc.get_recipe(recipe_b.id, tenant_id=tenant_a.id)


@pytest.mark.asyncio
async def test_list_recipes_only_returns_own_tenant(
    db: AsyncSession, two_tenants
) -> None:
    """List only returns recipes for the requesting tenant."""
    tenant_a, tenant_b = two_tenants
    svc = RecipeService(db)

    await svc.create_recipe(
        RecipeCreate(name="A Recipe", ingredients=[]), tenant_id=tenant_a.id
    )
    await svc.create_recipe(
        RecipeCreate(name="B Recipe", ingredients=[]), tenant_id=tenant_b.id
    )

    recipes_a = await svc.list_recipes(tenant_id=tenant_a.id)
    assert len(recipes_a) == 1
    assert recipes_a[0].name == "A Recipe"


@pytest.mark.asyncio
async def test_cross_tenant_ingredient_id_rejected(
    db: AsyncSession, two_tenants
) -> None:
    """Using an ingredient from another tenant is rejected."""
    tenant_a, tenant_b = two_tenants
    svc = RecipeService(db)

    # Create an ingredient for Tenant B
    ingr_b = await _make_ingredient(db, tenant_b.id, "TenantB-Tomato")

    # Tenant A tries to use it in a recipe — should fail
    with pytest.raises(ValidationError):
        await svc.create_recipe(
            RecipeCreate(
                name="A's Recipe",
                ingredients=[
                    RecipeIngredientIn(
                        ingredient_id=ingr_b.id, quantity=Decimal("100"), unit="g"
                    )
                ],
            ),
            tenant_id=tenant_a.id,
        )
