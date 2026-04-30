"""
RecipeService — domain service for recipe management.

Architecture: Router (thin) → RecipeService → Repository → Model

Handles:
  - Recipe CRUD with tenant isolation
  - Atomic ingredient list replacement on update (delete old, insert new)
  - Eagerly loads ingredient details (name and group name) on get

Rules (NON-NEGOTIABLE):
  - NEVER db.commit() directly → safe_commit(db)
  - NEVER is_active == True → is_active.is_(True)
  - ALWAYS filter by tenant_id — no exceptions
  - Ingredient list replacement is atomic — partial failures are rolled back
  - References to inactive ingredients are kept in recipes (history preservation)
"""
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.config.logging import get_logger
from shared.infrastructure.db import safe_commit
from shared.utils.exceptions import NotFoundError, ValidationError
from rest_api.models.ingredient import Ingredient
from rest_api.models.recipe import Recipe, RecipeIngredient
from rest_api.schemas.recipe import (
    RecipeCreate,
    RecipeIngredientOut,
    RecipeOut,
    RecipeUpdate,
)

logger = get_logger(__name__)


class RecipeService:
    """
    Domain service for Recipe management.

    All methods require tenant_id derived from the authenticated user's JWT claims.
    Ingredient list replacement on update is atomic — either all new ingredients
    replace the old ones, or the entire update rolls back.
    """

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ── Recipe CRUD ────────────────────────────────────────────────────────────

    async def list_recipes(
        self,
        tenant_id: int,
        limit: int = 50,
        offset: int = 0,
    ) -> list[RecipeOut]:
        """Return all active recipes for the tenant with ingredient details."""
        stmt = (
            select(Recipe)
            .where(
                Recipe.tenant_id == tenant_id,
                Recipe.is_active.is_(True),
            )
            .options(
                selectinload(Recipe.recipe_ingredients)
                .selectinload(RecipeIngredient.ingredient)
                .selectinload(Ingredient.group)  # needed for ingredient_group_name in _to_out
            )
            .limit(limit)
            .offset(offset)
        )
        result = await self.db.execute(stmt)
        recipes = list(result.scalars().all())
        return [self._to_out(r) for r in recipes]

    async def get_recipe(self, recipe_id: int, tenant_id: int) -> RecipeOut:
        """
        Return a single recipe with eagerly loaded ingredient details.
        Raises NotFoundError if not found or belongs to a different tenant.
        """
        recipe = await self._get_recipe_or_404(recipe_id, tenant_id, load_ingredients=True)
        return self._to_out(recipe)

    async def create_recipe(self, data: RecipeCreate, tenant_id: int) -> RecipeOut:
        """
        Create a recipe with its ingredient list.
        Raises ValidationError (409) if name already exists for this tenant.
        Validates that all referenced ingredient IDs exist and are active.
        """
        await self._check_recipe_name_unique(data.name, tenant_id)
        await self._validate_ingredient_ids(
            [i.ingredient_id for i in data.ingredients], tenant_id
        )

        recipe = Recipe(
            tenant_id=tenant_id,
            name=data.name,
            description=data.description,
        )
        self.db.add(recipe)
        await self.db.flush()

        for item in data.ingredients:
            ri = RecipeIngredient(
                recipe_id=recipe.id,
                ingredient_id=item.ingredient_id,
                quantity=item.quantity,
                unit=item.unit,
            )
            self.db.add(ri)

        await self.db.flush()
        await safe_commit(self.db)

        # Reload with ingredients
        recipe = await self._get_recipe_or_404(recipe.id, tenant_id, load_ingredients=True)
        logger.info("Created Recipe id=%s name=%r tenant_id=%s", recipe.id, recipe.name, tenant_id)
        return self._to_out(recipe)

    async def update_recipe(
        self, recipe_id: int, data: RecipeUpdate, tenant_id: int
    ) -> RecipeOut:
        """
        Update a recipe. If `ingredients` is provided, atomically replaces the full list.
        If `ingredients` is None, the existing ingredient list is unchanged.
        """
        recipe = await self._get_recipe_or_404(recipe_id, tenant_id)

        if data.name is not None and data.name != recipe.name:
            await self._check_recipe_name_unique(data.name, tenant_id, exclude_id=recipe_id)
            recipe.name = data.name

        if data.description is not None:
            recipe.description = data.description

        if data.ingredients is not None:
            # Atomic replacement: delete all existing, insert new ones
            await self._validate_ingredient_ids(
                [i.ingredient_id for i in data.ingredients], tenant_id
            )
            await self.db.execute(
                delete(RecipeIngredient).where(RecipeIngredient.recipe_id == recipe_id)
            )
            for item in data.ingredients:
                ri = RecipeIngredient(
                    recipe_id=recipe_id,
                    ingredient_id=item.ingredient_id,
                    quantity=item.quantity,
                    unit=item.unit,
                )
                self.db.add(ri)

        await self.db.flush()
        await safe_commit(self.db)

        recipe = await self._get_recipe_or_404(recipe_id, tenant_id, load_ingredients=True)
        return self._to_out(recipe)

    async def delete_recipe(
        self, recipe_id: int, tenant_id: int, user_id: int
    ) -> None:
        """
        Soft-delete a recipe. RecipeIngredient rows are kept for history.
        Raises NotFoundError if not found.
        """
        recipe = await self._get_recipe_or_404(recipe_id, tenant_id)
        recipe.is_active = False
        recipe.deleted_at = datetime.now(UTC)
        recipe.deleted_by_id = user_id
        await safe_commit(self.db)
        logger.info("Soft-deleted Recipe id=%s tenant_id=%s", recipe_id, tenant_id)

    # ── Private helpers ────────────────────────────────────────────────────────

    async def _get_recipe_or_404(
        self, recipe_id: int, tenant_id: int, load_ingredients: bool = False
    ) -> Recipe:
        stmt = select(Recipe).where(
            Recipe.id == recipe_id,
            Recipe.tenant_id == tenant_id,
            Recipe.is_active.is_(True),
        )
        if load_ingredients:
            stmt = stmt.options(
                selectinload(Recipe.recipe_ingredients)
                .selectinload(RecipeIngredient.ingredient)
                .selectinload(Ingredient.group)  # needed for ingredient_group_name in _to_out
            )
        result = await self.db.execute(stmt)
        recipe = result.scalar_one_or_none()
        if recipe is None:
            raise NotFoundError("Recipe", recipe_id)
        return recipe

    async def _check_recipe_name_unique(
        self, name: str, tenant_id: int, exclude_id: int | None = None
    ) -> None:
        stmt = select(Recipe).where(
            Recipe.tenant_id == tenant_id,
            Recipe.name == name,
            Recipe.is_active.is_(True),
        )
        if exclude_id is not None:
            stmt = stmt.where(Recipe.id != exclude_id)
        result = await self.db.execute(stmt)
        if result.scalar_one_or_none() is not None:
            raise ValidationError(
                f"Recipe with name={name!r} already exists for this tenant",
                field="name",
            )

    async def _validate_ingredient_ids(
        self, ingredient_ids: list[int], tenant_id: int
    ) -> None:
        """
        Verify all ingredient IDs exist, are active, and belong to the tenant.
        Raises ValidationError if any ID is invalid.
        """
        if not ingredient_ids:
            return
        stmt = select(Ingredient.id).where(
            Ingredient.id.in_(ingredient_ids),
            Ingredient.tenant_id == tenant_id,
            Ingredient.is_active.is_(True),
        )
        result = await self.db.execute(stmt)
        found_ids = {row[0] for row in result.all()}
        missing = set(ingredient_ids) - found_ids
        if missing:
            raise ValidationError(
                f"Ingredient IDs not found or inactive: {sorted(missing)}",
                field="ingredients",
            )

    def _to_out(self, recipe: Recipe) -> RecipeOut:
        """Convert a Recipe ORM instance (with loaded recipe_ingredients) to RecipeOut."""
        ingredient_outs = []
        for ri in recipe.recipe_ingredients:
            ingredient_name = ""
            ingredient_group_name = ""
            ingredient_active = True

            if ri.ingredient is not None:
                ingredient_name = ri.ingredient.name
                ingredient_active = ri.ingredient.is_active
                # Group name: only if the ingredient's group is loaded
                if ri.ingredient.group is not None:
                    ingredient_group_name = ri.ingredient.group.name

            ingredient_outs.append(
                RecipeIngredientOut(
                    id=ri.id,
                    ingredient_id=ri.ingredient_id,
                    ingredient_name=ingredient_name,
                    ingredient_group_name=ingredient_group_name,
                    quantity=ri.quantity,
                    unit=ri.unit,
                    is_active=ingredient_active,
                )
            )

        return RecipeOut(
            id=recipe.id,
            tenant_id=recipe.tenant_id,
            name=recipe.name,
            description=recipe.description,
            is_active=recipe.is_active,
            created_at=recipe.created_at,
            updated_at=recipe.updated_at,
            ingredients=ingredient_outs,
        )
