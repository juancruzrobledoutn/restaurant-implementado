"""
Base repository classes for multi-tenant data access.

Rules (NON-NEGOTIABLE):
  - NEVER use Model.is_active == True  →  always is_active.is_(True)
  - NEVER call db.commit() directly    →  use safe_commit(db)
  - ALWAYS filter by tenant_id         →  no exceptions

TenantRepository: generic CRUD scoped to tenant + is_active
BranchRepository: extends TenantRepository with branch_id filtering
"""
from datetime import UTC, datetime
from typing import Generic, TypeVar

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

ModelT = TypeVar("ModelT")


class TenantRepository(Generic[ModelT]):
    """
    Generic repository that scopes all queries to a tenant and active records.

    Usage:
        class CategoryRepository(TenantRepository[Category]):
            model = Category

    All public methods automatically filter by:
      - tenant_id (passed per call)
      - is_active.is_(True)
    """

    model: type[ModelT]

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_id(self, id: int, tenant_id: int) -> ModelT | None:
        """Return the entity by PK, scoped to tenant and active only."""
        stmt = (
            select(self.model)
            .where(
                self.model.id == id,  # type: ignore[attr-defined]
                self.model.tenant_id == tenant_id,  # type: ignore[attr-defined]
                self.model.is_active.is_(True),  # type: ignore[attr-defined]
            )
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def list_all(
        self,
        tenant_id: int,
        limit: int = 50,
        offset: int = 0,
    ) -> list[ModelT]:
        """Return all active entities for the given tenant."""
        stmt = (
            select(self.model)
            .where(
                self.model.tenant_id == tenant_id,  # type: ignore[attr-defined]
                self.model.is_active.is_(True),  # type: ignore[attr-defined]
            )
            .limit(limit)
            .offset(offset)
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def create(self, instance: ModelT) -> ModelT:
        """Add and flush a new entity. Caller (service) owns the commit."""
        self.db.add(instance)
        await self.db.flush()
        await self.db.refresh(instance)  # type: ignore[arg-type]
        return instance

    async def update(self, instance: ModelT) -> ModelT:
        """Merge changes and flush. Caller (service) owns the commit."""
        self.db.add(instance)
        await self.db.flush()
        await self.db.refresh(instance)  # type: ignore[arg-type]
        return instance

    async def soft_delete(self, entity: ModelT, user_id: int) -> None:
        """
        Soft-delete: set is_active=False, deleted_at, deleted_by_id.
        Does NOT cascade — use cascade_soft_delete() for recursive deletes.
        Caller (service) owns the commit.
        """
        entity.is_active = False  # type: ignore[attr-defined]
        entity.deleted_at = datetime.now(UTC)  # type: ignore[attr-defined]
        entity.deleted_by_id = user_id  # type: ignore[attr-defined]
        await self.db.flush()


class BranchRepository(TenantRepository[ModelT]):
    """
    Extends TenantRepository with branch-scoped queries.

    The model MUST have a `branch_id` column for these methods to work.
    """

    async def list_by_branch(
        self,
        tenant_id: int,
        branch_id: int,
        limit: int = 50,
        offset: int = 0,
    ) -> list[ModelT]:
        """Return all active entities scoped to tenant + branch."""
        stmt = (
            select(self.model)
            .where(
                self.model.tenant_id == tenant_id,  # type: ignore[attr-defined]
                self.model.branch_id == branch_id,  # type: ignore[attr-defined]
                self.model.is_active.is_(True),  # type: ignore[attr-defined]
            )
            .limit(limit)
            .offset(offset)
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def get_by_branch(
        self,
        id: int,
        tenant_id: int,
        branch_id: int,
    ) -> ModelT | None:
        """Return a single active entity scoped to tenant + branch."""
        stmt = (
            select(self.model)
            .where(
                self.model.id == id,  # type: ignore[attr-defined]
                self.model.tenant_id == tenant_id,  # type: ignore[attr-defined]
                self.model.branch_id == branch_id,  # type: ignore[attr-defined]
                self.model.is_active.is_(True),  # type: ignore[attr-defined]
            )
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()
