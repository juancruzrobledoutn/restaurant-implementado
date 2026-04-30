"""
Cascade soft delete utility.

cascade_soft_delete(db, entity, user_id):
  - Sets is_active=False, deleted_at=utcnow, deleted_by_id=user_id on the entity
  - Recursively does the same on all dependent entities reachable via SQLAlchemy
    relationships that support AuditMixin fields
  - Skips entities that are already soft-deleted (is_active=False)
  - Does NOT call safe_commit — caller is responsible for committing the session

Usage:
    from shared.utils.soft_delete import cascade_soft_delete

    async def delete_tenant(db, tenant_id, user_id):
        tenant = await repo.get_by_id(tenant_id, ...)
        await cascade_soft_delete(db, tenant, user_id)
        await safe_commit(db)
"""
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config.logging import get_logger

logger = get_logger(__name__)


async def cascade_soft_delete(
    db: AsyncSession,
    entity: Any,
    user_id: int,
    _visited: set[int] | None = None,
) -> None:
    """
    Recursively soft-delete an entity and all its dependents.

    Algorithm:
    1. Check if entity has AuditMixin fields (is_active). If not, skip.
    2. Skip if already soft-deleted (is_active is False).
    3. Set is_active=False, deleted_at=utcnow, deleted_by_id=user_id.
    4. Inspect SQLAlchemy relationships on the entity.
    5. For each related entity that has AuditMixin fields, recurse.

    Args:
        db: AsyncSession — the current database session
        entity: Any SQLAlchemy model instance
        user_id: int — ID of the user performing the delete (for audit trail)
        _visited: internal set to prevent infinite loops in circular relationships
    """
    if _visited is None:
        _visited = set()

    # Guard against circular relationships
    entity_key = id(entity)
    if entity_key in _visited:
        return
    _visited.add(entity_key)

    # Only operate on entities that have AuditMixin fields
    if not hasattr(entity, "is_active"):
        logger.debug(
            "cascade_soft_delete: skipping %s — no is_active field",
            entity.__class__.__name__,
        )
        return

    # Skip already-deleted entities
    if not entity.is_active:
        logger.debug(
            "cascade_soft_delete: skipping %s id=%s — already deleted",
            entity.__class__.__name__,
            getattr(entity, "id", "?"),
        )
        return

    # Soft-delete this entity
    now = datetime.now(UTC)
    entity.is_active = False
    entity.deleted_at = now
    entity.deleted_by_id = user_id

    logger.debug(
        "cascade_soft_delete: deleted %s id=%s",
        entity.__class__.__name__,
        getattr(entity, "id", "?"),
    )

    # Recurse into all loaded relationships
    mapper = inspect(entity.__class__)
    for relationship in mapper.relationships:
        # Only cascade through relationships with "all" or "delete-orphan" cascade
        if not (
            "all" in relationship.cascade
            or "delete-orphan" in relationship.cascade
        ):
            continue

        # Get the related value — may not be loaded (lazy)
        try:
            related = getattr(entity, relationship.key)
        except Exception:
            # Relationship not loaded — skip silently (we're in async context)
            continue

        if related is None:
            continue

        if isinstance(related, list):
            for child in related:
                await cascade_soft_delete(db, child, user_id, _visited)
        else:
            await cascade_soft_delete(db, related, user_id, _visited)
