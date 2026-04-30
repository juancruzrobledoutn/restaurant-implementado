"""
Base service classes — generic CRUD with Template Method hooks.

Architecture: Router (thin) → Domain Service → Repository → Model
Rules (NON-NEGOTIABLE):
  - NEVER call db.commit() directly  →  safe_commit(db)
  - NEVER business logic in routers  →  only Domain Services
  - ALWAYS filter by tenant_id       →  no exceptions

BaseCRUDService[Model, Output]:
  - Generic CRUD: create, update, delete, get_by_id, list_all
  - Template Method hooks for subclass customization
  - Soft delete via is_active + deleted_at + deleted_by_id

BranchScopedService[Model, Output]:
  - Extends BaseCRUDService with branch_id-scoped queries
"""
from datetime import UTC, datetime
from typing import Any, Generic, TypeVar

from sqlalchemy.ext.asyncio import AsyncSession

from shared.infrastructure.db import safe_commit
from shared.utils.exceptions import NotFoundError

ModelT = TypeVar("ModelT")
OutputT = TypeVar("OutputT")


class BaseCRUDService(Generic[ModelT, OutputT]):
    """
    Generic CRUD service with Template Method hooks.

    Subclasses can override any hook without touching CRUD logic:
      - _validate_create(data, tenant_id)  → raise ValidationError on bad input
      - _validate_update(entity, data, tenant_id)  → same for updates
      - _after_create(entity, db)   → post-create side effects
      - _after_update(entity, db)   → post-update side effects
      - _after_delete(entity, db)   → post-delete side effects

    Subclasses MUST set:
      - repository_class: a TenantRepository subclass
      - (optionally) _to_output(entity) → OutputT to convert the model to a DTO
    """

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ── Template Method Hooks ─────────────────────────────────────────────────

    async def _validate_create(self, data: dict[str, Any], tenant_id: int) -> None:
        """Override in subclass to validate before create. Raise ValidationError."""

    async def _validate_update(
        self,
        entity: ModelT,
        data: dict[str, Any],
        tenant_id: int,
    ) -> None:
        """Override in subclass to validate before update. Raise ValidationError."""

    async def _after_create(self, entity: ModelT) -> None:
        """Override in subclass for post-create side effects (e.g., events)."""

    async def _after_update(self, entity: ModelT) -> None:
        """Override in subclass for post-update side effects."""

    async def _after_delete(self, entity: ModelT) -> None:
        """Override in subclass for post-delete side effects."""

    def _to_output(self, entity: ModelT) -> OutputT:
        """Override in subclass to convert a model instance to an output DTO."""
        return entity  # type: ignore[return-value]

    # ── Repository accessor ────────────────────────────────────────────────────

    def _get_repository(self) -> Any:
        """
        Return an initialized repository for this service.
        Subclasses MUST override this and return their concrete repository.
        """
        raise NotImplementedError(
            f"{self.__class__.__name__} must implement _get_repository()"
        )

    # ── CRUD operations ────────────────────────────────────────────────────────

    async def get_by_id(self, entity_id: int, tenant_id: int) -> OutputT:
        """
        Return entity by ID scoped to tenant.
        Raises NotFoundError if not found or inactive.
        """
        repo = self._get_repository()
        entity = await repo.get_by_id(entity_id, tenant_id)
        if entity is None:
            resource = self.__class__.__name__.replace("Service", "")
            raise NotFoundError(resource, entity_id)
        return self._to_output(entity)

    async def list_all(
        self,
        tenant_id: int,
        limit: int = 50,
        offset: int = 0,
    ) -> list[OutputT]:
        """Return all active entities for the tenant."""
        repo = self._get_repository()
        entities = await repo.list_all(tenant_id, limit=limit, offset=offset)
        return [self._to_output(e) for e in entities]

    async def create(self, data: dict[str, Any], tenant_id: int) -> OutputT:
        """
        Create a new entity.
        Runs _validate_create → persist → safe_commit → _after_create.
        """
        await self._validate_create(data, tenant_id)
        repo = self._get_repository()
        entity = await repo.create(data)  # type: ignore[arg-type]
        await self._after_create(entity)
        await safe_commit(self.db)
        return self._to_output(entity)

    async def update(
        self,
        entity_id: int,
        data: dict[str, Any],
        tenant_id: int,
    ) -> OutputT:
        """
        Update an existing entity.
        Raises NotFoundError if not found. Runs _validate_update → persist → _after_update.
        """
        repo = self._get_repository()
        entity = await repo.get_by_id(entity_id, tenant_id)
        if entity is None:
            resource = self.__class__.__name__.replace("Service", "")
            raise NotFoundError(resource, entity_id)

        await self._validate_update(entity, data, tenant_id)

        for key, value in data.items():
            setattr(entity, key, value)

        await self.db.flush()
        await self.db.refresh(entity)
        await self._after_update(entity)
        await safe_commit(self.db)
        return self._to_output(entity)

    async def delete(
        self,
        entity_id: int,
        tenant_id: int,
        user_id: int,
        user_email: str,
    ) -> None:
        """
        Soft-delete an entity: set is_active=False, deleted_at, deleted_by_id.
        Raises NotFoundError if not found.
        Physical deletion is NEVER performed.
        """
        repo = self._get_repository()
        entity = await repo.get_by_id(entity_id, tenant_id)
        if entity is None:
            resource = self.__class__.__name__.replace("Service", "")
            raise NotFoundError(resource, entity_id)

        entity.is_active = False  # type: ignore[attr-defined]
        entity.deleted_at = datetime.now(UTC)  # type: ignore[attr-defined]
        entity.deleted_by_id = user_id  # type: ignore[attr-defined]

        await self._after_delete(entity)
        await safe_commit(self.db)


class BranchScopedService(BaseCRUDService[ModelT, OutputT]):
    """
    Extends BaseCRUDService with branch-scoped read queries.

    The underlying model MUST have a `branch_id` column.
    Uses a BranchRepository (or subclass) as its repository.
    """

    async def list_by_branch(
        self,
        tenant_id: int,
        branch_id: int,
        limit: int = 50,
        offset: int = 0,
    ) -> list[OutputT]:
        """Return all active entities scoped to a specific branch."""
        repo = self._get_repository()
        entities = await repo.list_by_branch(
            tenant_id, branch_id, limit=limit, offset=offset
        )
        return [self._to_output(e) for e in entities]

    async def get_by_branch(
        self,
        entity_id: int,
        tenant_id: int,
        branch_id: int,
    ) -> OutputT:
        """
        Return a single entity scoped to tenant + branch.
        Raises NotFoundError if not found.
        """
        repo = self._get_repository()
        entity = await repo.get_by_branch(entity_id, tenant_id, branch_id)
        if entity is None:
            resource = self.__class__.__name__.replace("Service", "")
            raise NotFoundError(resource, entity_id)
        return self._to_output(entity)
