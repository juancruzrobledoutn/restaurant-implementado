"""
IngredientService — domain service for ingredient hierarchy management.

Architecture: Router (thin) → IngredientService → Repository → Model

Handles:
  - IngredientGroup CRUD (tenant-scoped)
  - Ingredient CRUD (auto-sets tenant_id from parent group)
  - SubIngredient CRUD
  - Cascade soft-delete: group → ingredients → sub-ingredients

Rules (NON-NEGOTIABLE):
  - NEVER db.commit() directly → safe_commit(db)
  - NEVER is_active == True → is_active.is_(True)
  - ALWAYS filter by tenant_id — no exceptions
  - Cascade soft-delete is explicit (no DB-level cascade) to preserve audit trail
  - Duplicate name in same scope → 409 Conflict (ValidationError)
  - Cross-tenant access → 404 (tenant isolation, not 403)
"""
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.config.logging import get_logger
from shared.infrastructure.db import safe_commit
from shared.utils.exceptions import NotFoundError, ValidationError
from rest_api.models.ingredient import Ingredient, IngredientGroup, SubIngredient
from rest_api.schemas.ingredient import (
    IngredientGroupCreate,
    IngredientGroupOut,
    IngredientGroupUpdate,
    IngredientCreate,
    IngredientOut,
    IngredientUpdate,
    SubIngredientCreate,
    SubIngredientOut,
    SubIngredientUpdate,
)

logger = get_logger(__name__)


class IngredientService:
    """
    Domain service for ingredient hierarchy (Group → Ingredient → SubIngredient).

    All methods accept a tenant_id derived from the authenticated user's JWT claims.
    Tenant isolation is enforced on every query — no cross-tenant access is possible.
    """

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ── IngredientGroup ────────────────────────────────────────────────────────

    async def list_groups(
        self,
        tenant_id: int,
        limit: int = 50,
        offset: int = 0,
    ) -> list[IngredientGroupOut]:
        """Return all active ingredient groups for the tenant."""
        stmt = (
            select(IngredientGroup)
            .where(
                IngredientGroup.tenant_id == tenant_id,
                IngredientGroup.is_active.is_(True),
            )
            .options(selectinload(IngredientGroup.ingredients))
            .limit(limit)
            .offset(offset)
        )
        result = await self.db.execute(stmt)
        groups = list(result.scalars().all())
        return [IngredientGroupOut.model_validate(g) for g in groups]

    async def get_group(self, group_id: int, tenant_id: int) -> IngredientGroupOut:
        """
        Return an ingredient group with all its active child ingredients eagerly loaded.
        Raises NotFoundError if not found or belongs to a different tenant.
        """
        stmt = (
            select(IngredientGroup)
            .where(
                IngredientGroup.id == group_id,
                IngredientGroup.tenant_id == tenant_id,
                IngredientGroup.is_active.is_(True),
            )
            .options(
                selectinload(IngredientGroup.ingredients).selectinload(
                    Ingredient.sub_ingredients
                )
            )
        )
        result = await self.db.execute(stmt)
        group = result.scalar_one_or_none()
        if group is None:
            raise NotFoundError("IngredientGroup", group_id)
        return IngredientGroupOut.model_validate(group)

    async def create_group(
        self, data: IngredientGroupCreate, tenant_id: int
    ) -> IngredientGroupOut:
        """
        Create a new ingredient group.
        Raises ValidationError (409) if name already exists for this tenant.
        """
        await self._check_group_name_unique(data.name, tenant_id)

        group = IngredientGroup(tenant_id=tenant_id, name=data.name)
        self.db.add(group)
        await self.db.flush()
        await safe_commit(self.db)

        logger.info(
            "Created IngredientGroup id=%s name=%r tenant_id=%s", group.id, group.name, tenant_id
        )
        # Re-fetch with selectinload to avoid MissingGreenlet on lazy-loaded relationships
        return await self.get_group(group.id, tenant_id=tenant_id)

    async def update_group(
        self, group_id: int, data: IngredientGroupUpdate, tenant_id: int
    ) -> IngredientGroupOut:
        """
        Update an ingredient group name.
        Raises NotFoundError if not found. Raises ValidationError (409) on duplicate name.
        """
        group = await self._get_group_or_404(group_id, tenant_id)

        if data.name is not None and data.name != group.name:
            await self._check_group_name_unique(data.name, tenant_id, exclude_id=group_id)
            group.name = data.name

        await self.db.flush()
        await safe_commit(self.db)
        # Re-fetch with selectinload to avoid MissingGreenlet on lazy-loaded relationships
        return await self.get_group(group_id, tenant_id=tenant_id)

    async def delete_group(
        self, group_id: int, tenant_id: int, user_id: int
    ) -> None:
        """
        Cascade soft-delete: group → all its ingredients → all their sub-ingredients.
        Raises NotFoundError if not found.
        """
        group = await self._get_group_or_404(group_id, tenant_id)

        # Load all active ingredients with their sub-ingredients
        stmt = (
            select(Ingredient)
            .where(
                Ingredient.group_id == group_id,
                Ingredient.is_active.is_(True),
            )
            .options(selectinload(Ingredient.sub_ingredients))
        )
        result = await self.db.execute(stmt)
        ingredients = list(result.scalars().all())

        now = datetime.now(UTC)

        # Cascade soft-delete to sub-ingredients
        for ingredient in ingredients:
            for sub in ingredient.sub_ingredients:
                if sub.is_active:
                    sub.is_active = False
                    sub.deleted_at = now
                    sub.deleted_by_id = user_id
            ingredient.is_active = False
            ingredient.deleted_at = now
            ingredient.deleted_by_id = user_id

        # Soft-delete the group itself
        group.is_active = False
        group.deleted_at = now
        group.deleted_by_id = user_id

        await safe_commit(self.db)
        logger.info(
            "Cascade soft-deleted IngredientGroup id=%s and %s ingredients",
            group_id,
            len(ingredients),
        )

    # ── Ingredient ─────────────────────────────────────────────────────────────

    async def list_ingredients(
        self,
        group_id: int,
        tenant_id: int,
        limit: int = 50,
        offset: int = 0,
    ) -> list[IngredientOut]:
        """Return all active ingredients for a group (verifies group belongs to tenant)."""
        await self._get_group_or_404(group_id, tenant_id)

        stmt = (
            select(Ingredient)
            .where(
                Ingredient.group_id == group_id,
                Ingredient.tenant_id == tenant_id,
                Ingredient.is_active.is_(True),
            )
            .options(selectinload(Ingredient.sub_ingredients))
            .limit(limit)
            .offset(offset)
        )
        result = await self.db.execute(stmt)
        ingredients = list(result.scalars().all())
        return [IngredientOut.model_validate(i) for i in ingredients]

    async def get_ingredient(
        self, group_id: int, ingredient_id: int, tenant_id: int
    ) -> IngredientOut:
        """Return a single ingredient by ID, scoped to group and tenant."""
        stmt = (
            select(Ingredient)
            .where(
                Ingredient.id == ingredient_id,
                Ingredient.group_id == group_id,
                Ingredient.tenant_id == tenant_id,
                Ingredient.is_active.is_(True),
            )
            .options(selectinload(Ingredient.sub_ingredients))
        )
        result = await self.db.execute(stmt)
        ingredient = result.scalar_one_or_none()
        if ingredient is None:
            raise NotFoundError("Ingredient", ingredient_id)
        return IngredientOut.model_validate(ingredient)

    async def create_ingredient(
        self, group_id: int, data: IngredientCreate, tenant_id: int
    ) -> IngredientOut:
        """
        Create an ingredient within a group.
        Auto-sets tenant_id from the parent group.
        Raises ValidationError (409) if name already exists within the group.
        """
        group = await self._get_group_or_404(group_id, tenant_id)
        await self._check_ingredient_name_unique(data.name, group_id)

        ingredient = Ingredient(
            group_id=group_id,
            tenant_id=group.tenant_id,  # denormalized from parent
            name=data.name,
        )
        self.db.add(ingredient)
        await self.db.flush()
        await safe_commit(self.db)

        logger.info(
            "Created Ingredient id=%s name=%r group_id=%s", ingredient.id, ingredient.name, group_id
        )
        # Re-fetch with selectinload to avoid MissingGreenlet on lazy-loaded sub_ingredients
        return await self.get_ingredient(group_id, ingredient.id, tenant_id=tenant_id)

    async def update_ingredient(
        self,
        group_id: int,
        ingredient_id: int,
        data: IngredientUpdate,
        tenant_id: int,
    ) -> IngredientOut:
        """Update an ingredient's name."""
        ingredient = await self._get_ingredient_or_404(ingredient_id, group_id, tenant_id)

        if data.name is not None and data.name != ingredient.name:
            await self._check_ingredient_name_unique(
                data.name, group_id, exclude_id=ingredient_id
            )
            ingredient.name = data.name

        await self.db.flush()
        await safe_commit(self.db)
        # Re-fetch with selectinload to avoid MissingGreenlet on lazy-loaded sub_ingredients
        return await self.get_ingredient(group_id, ingredient_id, tenant_id=tenant_id)

    async def delete_ingredient(
        self, group_id: int, ingredient_id: int, tenant_id: int, user_id: int
    ) -> None:
        """
        Soft-delete an ingredient and cascade to its sub-ingredients.
        Does NOT cascade to the parent group.
        """
        ingredient = await self._get_ingredient_or_404(ingredient_id, group_id, tenant_id)

        # Load active sub-ingredients
        stmt = select(SubIngredient).where(
            SubIngredient.ingredient_id == ingredient_id,
            SubIngredient.is_active.is_(True),
        )
        result = await self.db.execute(stmt)
        subs = list(result.scalars().all())

        now = datetime.now(UTC)
        for sub in subs:
            sub.is_active = False
            sub.deleted_at = now
            sub.deleted_by_id = user_id

        ingredient.is_active = False
        ingredient.deleted_at = now
        ingredient.deleted_by_id = user_id

        await safe_commit(self.db)

    # ── SubIngredient ──────────────────────────────────────────────────────────

    async def list_sub_ingredients(
        self,
        group_id: int,
        ingredient_id: int,
        tenant_id: int,
        limit: int = 50,
        offset: int = 0,
    ) -> list[SubIngredientOut]:
        """Return all active sub-ingredients for an ingredient."""
        await self._get_ingredient_or_404(ingredient_id, group_id, tenant_id)

        stmt = (
            select(SubIngredient)
            .where(
                SubIngredient.ingredient_id == ingredient_id,
                SubIngredient.is_active.is_(True),
            )
            .limit(limit)
            .offset(offset)
        )
        result = await self.db.execute(stmt)
        subs = list(result.scalars().all())
        return [SubIngredientOut.model_validate(s) for s in subs]

    async def create_sub_ingredient(
        self,
        group_id: int,
        ingredient_id: int,
        data: SubIngredientCreate,
        tenant_id: int,
    ) -> SubIngredientOut:
        """
        Create a sub-ingredient within an ingredient.
        Raises ValidationError (409) if name already exists within the ingredient.
        """
        await self._get_ingredient_or_404(ingredient_id, group_id, tenant_id)
        await self._check_sub_ingredient_name_unique(data.name, ingredient_id)

        sub = SubIngredient(ingredient_id=ingredient_id, name=data.name)
        self.db.add(sub)
        await self.db.flush()
        await self.db.refresh(sub)
        await safe_commit(self.db)

        logger.info(
            "Created SubIngredient id=%s name=%r ingredient_id=%s",
            sub.id,
            sub.name,
            ingredient_id,
        )
        return SubIngredientOut.model_validate(sub)

    async def update_sub_ingredient(
        self,
        group_id: int,
        ingredient_id: int,
        sub_id: int,
        data: SubIngredientUpdate,
        tenant_id: int,
    ) -> SubIngredientOut:
        """Update a sub-ingredient's name."""
        sub = await self._get_sub_ingredient_or_404(sub_id, ingredient_id, group_id, tenant_id)

        if data.name is not None and data.name != sub.name:
            await self._check_sub_ingredient_name_unique(
                data.name, ingredient_id, exclude_id=sub_id
            )
            sub.name = data.name

        await self.db.flush()
        await self.db.refresh(sub)
        await safe_commit(self.db)
        return SubIngredientOut.model_validate(sub)

    async def delete_sub_ingredient(
        self, group_id: int, ingredient_id: int, sub_id: int, tenant_id: int, user_id: int
    ) -> None:
        """Soft-delete a sub-ingredient."""
        sub = await self._get_sub_ingredient_or_404(sub_id, ingredient_id, group_id, tenant_id)
        sub.is_active = False
        sub.deleted_at = datetime.now(UTC)
        sub.deleted_by_id = user_id
        await safe_commit(self.db)

    # ── Private helpers ────────────────────────────────────────────────────────

    async def _get_group_or_404(self, group_id: int, tenant_id: int) -> IngredientGroup:
        stmt = select(IngredientGroup).where(
            IngredientGroup.id == group_id,
            IngredientGroup.tenant_id == tenant_id,
            IngredientGroup.is_active.is_(True),
        )
        result = await self.db.execute(stmt)
        group = result.scalar_one_or_none()
        if group is None:
            raise NotFoundError("IngredientGroup", group_id)
        return group

    async def _get_ingredient_or_404(
        self, ingredient_id: int, group_id: int, tenant_id: int
    ) -> Ingredient:
        stmt = select(Ingredient).where(
            Ingredient.id == ingredient_id,
            Ingredient.group_id == group_id,
            Ingredient.tenant_id == tenant_id,
            Ingredient.is_active.is_(True),
        )
        result = await self.db.execute(stmt)
        ingredient = result.scalar_one_or_none()
        if ingredient is None:
            raise NotFoundError("Ingredient", ingredient_id)
        return ingredient

    async def _get_sub_ingredient_or_404(
        self, sub_id: int, ingredient_id: int, group_id: int, tenant_id: int
    ) -> SubIngredient:
        # Verify parent chain is accessible for this tenant
        await self._get_ingredient_or_404(ingredient_id, group_id, tenant_id)
        stmt = select(SubIngredient).where(
            SubIngredient.id == sub_id,
            SubIngredient.ingredient_id == ingredient_id,
            SubIngredient.is_active.is_(True),
        )
        result = await self.db.execute(stmt)
        sub = result.scalar_one_or_none()
        if sub is None:
            raise NotFoundError("SubIngredient", sub_id)
        return sub

    async def _check_group_name_unique(
        self, name: str, tenant_id: int, exclude_id: int | None = None
    ) -> None:
        stmt = select(IngredientGroup).where(
            IngredientGroup.tenant_id == tenant_id,
            IngredientGroup.name == name,
            IngredientGroup.is_active.is_(True),
        )
        if exclude_id is not None:
            stmt = stmt.where(IngredientGroup.id != exclude_id)
        result = await self.db.execute(stmt)
        if result.scalar_one_or_none() is not None:
            raise ValidationError(
                f"IngredientGroup with name={name!r} already exists for this tenant",
                field="name",
            )

    async def _check_ingredient_name_unique(
        self, name: str, group_id: int, exclude_id: int | None = None
    ) -> None:
        stmt = select(Ingredient).where(
            Ingredient.group_id == group_id,
            Ingredient.name == name,
            Ingredient.is_active.is_(True),
        )
        if exclude_id is not None:
            stmt = stmt.where(Ingredient.id != exclude_id)
        result = await self.db.execute(stmt)
        if result.scalar_one_or_none() is not None:
            raise ValidationError(
                f"Ingredient with name={name!r} already exists in this group",
                field="name",
            )

    async def _check_sub_ingredient_name_unique(
        self, name: str, ingredient_id: int, exclude_id: int | None = None
    ) -> None:
        stmt = select(SubIngredient).where(
            SubIngredient.ingredient_id == ingredient_id,
            SubIngredient.name == name,
            SubIngredient.is_active.is_(True),
        )
        if exclude_id is not None:
            stmt = stmt.where(SubIngredient.id != exclude_id)
        result = await self.db.execute(stmt)
        if result.scalar_one_or_none() is not None:
            raise ValidationError(
                f"SubIngredient with name={name!r} already exists for this ingredient",
                field="name",
            )
