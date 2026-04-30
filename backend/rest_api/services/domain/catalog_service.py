"""
CatalogService — generic domain service for tenant-scoped catalog lookup tables.

Architecture: Router (thin) → CatalogService → Repository → Model

Handles all four catalog models with identical CRUD behavior:
  - CookingMethod
  - FlavorProfile
  - TextureProfile
  - CuisineType

Design: CatalogService takes the model class as a constructor parameter to avoid
code duplication (D3 from design.md). One service instance per catalog type.

Rules (NON-NEGOTIABLE):
  - NEVER db.commit() directly → safe_commit(db)
  - NEVER is_active == True → is_active.is_(True)
  - ALWAYS filter by tenant_id — no exceptions
"""
from datetime import UTC, datetime
from typing import Any, Generic, TypeVar

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config.logging import get_logger
from shared.infrastructure.db import safe_commit
from shared.utils.exceptions import NotFoundError, ValidationError
from rest_api.schemas.catalog import CatalogItemCreate, CatalogItemOut, CatalogItemUpdate

logger = get_logger(__name__)

# Type variable for catalog models (CookingMethod, FlavorProfile, etc.)
CatalogModelT = TypeVar("CatalogModelT")


class CatalogService:
    """
    Generic domain service for tenant-scoped catalog lookup tables.

    Usage:
        from rest_api.models.catalog import CookingMethod
        service = CatalogService(db=db, model=CookingMethod)

    All methods are tenant-scoped and enforce soft-delete conventions.
    """

    def __init__(self, db: AsyncSession, model: type) -> None:
        self.db = db
        self.model = model
        self._resource_name = model.__name__

    async def list_items(
        self,
        tenant_id: int,
        limit: int = 50,
        offset: int = 0,
    ) -> list[CatalogItemOut]:
        """Return all active catalog items for the tenant."""
        stmt = (
            select(self.model)
            .where(
                self.model.tenant_id == tenant_id,
                self.model.is_active.is_(True),
            )
            .limit(limit)
            .offset(offset)
        )
        result = await self.db.execute(stmt)
        items = list(result.scalars().all())
        return [CatalogItemOut.model_validate(item) for item in items]

    async def get_item(self, item_id: int, tenant_id: int) -> CatalogItemOut:
        """
        Return a single catalog item by ID, scoped to tenant.
        Raises NotFoundError if not found or belongs to a different tenant.
        """
        item = await self._get_or_404(item_id, tenant_id)
        return CatalogItemOut.model_validate(item)

    async def create_item(
        self, data: CatalogItemCreate, tenant_id: int
    ) -> CatalogItemOut:
        """
        Create a new catalog item.
        Raises ValidationError (409) if name already exists for this tenant.
        """
        await self._check_name_unique(data.name, tenant_id)

        item = self.model(tenant_id=tenant_id, name=data.name)
        self.db.add(item)
        await self.db.flush()
        await self.db.refresh(item)
        await safe_commit(self.db)

        logger.info(
            "Created %s id=%s name=%r tenant_id=%s",
            self._resource_name,
            item.id,
            item.name,
            tenant_id,
        )
        return CatalogItemOut.model_validate(item)

    async def update_item(
        self, item_id: int, data: CatalogItemUpdate, tenant_id: int
    ) -> CatalogItemOut:
        """
        Update a catalog item's name.
        Raises NotFoundError if not found. Raises ValidationError (409) on duplicate name.
        """
        item = await self._get_or_404(item_id, tenant_id)

        if data.name is not None and data.name != item.name:
            await self._check_name_unique(data.name, tenant_id, exclude_id=item_id)
            item.name = data.name

        await self.db.flush()
        await self.db.refresh(item)
        await safe_commit(self.db)
        return CatalogItemOut.model_validate(item)

    async def delete_item(
        self, item_id: int, tenant_id: int, user_id: int
    ) -> None:
        """
        Soft-delete a catalog item.
        Raises NotFoundError if not found.
        """
        item = await self._get_or_404(item_id, tenant_id)
        item.is_active = False
        item.deleted_at = datetime.now(UTC)
        item.deleted_by_id = user_id
        await safe_commit(self.db)
        logger.info(
            "Soft-deleted %s id=%s tenant_id=%s", self._resource_name, item_id, tenant_id
        )

    # ── Private helpers ────────────────────────────────────────────────────────

    async def _get_or_404(self, item_id: int, tenant_id: int) -> Any:
        stmt = select(self.model).where(
            self.model.id == item_id,
            self.model.tenant_id == tenant_id,
            self.model.is_active.is_(True),
        )
        result = await self.db.execute(stmt)
        item = result.scalar_one_or_none()
        if item is None:
            raise NotFoundError(self._resource_name, item_id)
        return item

    async def _check_name_unique(
        self, name: str, tenant_id: int, exclude_id: int | None = None
    ) -> None:
        stmt = select(self.model).where(
            self.model.tenant_id == tenant_id,
            self.model.name == name,
            self.model.is_active.is_(True),
        )
        if exclude_id is not None:
            stmt = stmt.where(self.model.id != exclude_id)
        result = await self.db.execute(stmt)
        if result.scalar_one_or_none() is not None:
            raise ValidationError(
                f"{self._resource_name} with name={name!r} already exists for this tenant",
                field="name",
            )
