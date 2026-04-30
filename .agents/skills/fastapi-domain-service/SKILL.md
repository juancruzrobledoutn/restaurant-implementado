---
name: fastapi-domain-service
description: >
  Enforces Clean Architecture for the Integrador backend: thin routers + domain services.
  Trigger: When creating a new domain service, adding a backend endpoint, or extending the Integrador REST API.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use

- Creating a new domain service in `rest_api/services/domain/`
- Adding a new router or endpoint in `rest_api/routers/`
- Migrating a fat router that contains business logic
- Any backend feature that touches the Integrador REST API

---

## Critical Patterns

### The Golden Rule: Routers Must Be THIN

A router does exactly three things and nothing else:

1. Declare FastAPI `Depends` (db, user)
2. Build a `PermissionContext` and call permission guards
3. Delegate to the domain service and return the result

**NO business logic, NO queries, NO if/else on domain data in routers.**

### CRUDFactory is DEPRECATED

Never use `CRUDFactory`. Always use a Domain Service that extends `BaseCRUDService` or `BranchScopedService`.

### Base Class Decision

| Entity type | Extend |
|-------------|--------|
| Tenant-scoped (no branch_id) | `BaseCRUDService[Model, Output]` |
| Branch-scoped (has branch_id) | `BranchScopedService[Model, Output]` |

---

## Service Creation Steps (mandatory order)

1. Create `rest_api/services/domain/my_entity_service.py`
2. Extend `BaseCRUDService` or `BranchScopedService`
3. Override `_validate_create()`, `_validate_delete()`, `_after_delete()` as needed
4. Export in `rest_api/services/domain/__init__.py`
5. Use in router — keep router thin

---

## Code Examples

### Complete Domain Service

```python
"""
MyEntity Service - Clean Architecture Implementation.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select, func
from sqlalchemy.orm import Session, selectinload

from rest_api.models import MyEntity, Branch
from shared.utils.admin_schemas import MyEntityOutput
from rest_api.services.base_service import BranchScopedService
from rest_api.services.events import publish_entity_deleted
from shared.utils.exceptions import ValidationError, NotFoundError


class MyEntityService(BranchScopedService[MyEntity, MyEntityOutput]):
    """
    Service for MyEntity management.

    Business rules:
    - Belongs to a branch (use BaseCRUDService if tenant-scoped only)
    - Soft delete preserves audit trail
    - Deletion publishes domain event
    """

    def __init__(self, db: Session):
        super().__init__(
            db=db,
            model=MyEntity,
            output_schema=MyEntityOutput,
            entity_name="Mi Entidad",
        )

    # =========================================================================
    # Query Methods
    # =========================================================================

    def list_with_relations(
        self,
        tenant_id: int,
        branch_id: int,
    ) -> list[MyEntityOutput]:
        """List entities with eager-loaded relations to avoid N+1."""
        from sqlalchemy import select
        entities = self._db.execute(
            select(MyEntity)
            .where(
                MyEntity.tenant_id == tenant_id,
                MyEntity.branch_id == branch_id,
                MyEntity.is_active.is_(True),   # ALWAYS use .is_(True), never == True
            )
            .options(
                selectinload(MyEntity.items),    # Eager load to avoid N+1
            )
        ).scalars().unique().all()
        return [self.to_output(e) for e in entities]

    # =========================================================================
    # Validation Hooks
    # =========================================================================

    def _validate_create(self, data: dict[str, Any], tenant_id: int) -> None:
        """Validate before creation. Raise ValidationError on failure."""
        branch_id = data.get("branch_id")
        if not branch_id:
            raise ValidationError("branch_id es requerido", field="branch_id")

        # Verify branch belongs to tenant
        branch = self._db.scalar(
            select(Branch).where(
                Branch.id == branch_id,
                Branch.tenant_id == tenant_id,
            )
        )
        if not branch:
            raise ValidationError("branch_id inválido", field="branch_id")

    def _validate_delete(self, entity: MyEntity, tenant_id: int) -> None:
        """Block deletion if dependent active records exist."""
        from rest_api.models import RelatedModel

        count = self._db.scalar(
            select(func.count())
            .select_from(RelatedModel)
            .where(
                RelatedModel.my_entity_id == entity.id,
                RelatedModel.is_active.is_(True),
            )
        )
        if count and count > 0:
            raise ValidationError(
                f"La entidad tiene {count} registros activos. Elimínelos primero.",
                field="id",
            )

    # =========================================================================
    # Lifecycle Hooks
    # =========================================================================

    def _after_delete(
        self,
        entity_info: dict[str, Any],
        user_id: int,
        user_email: str,
    ) -> None:
        """Publish deletion domain event."""
        publish_entity_deleted(
            tenant_id=entity_info["tenant_id"],
            entity_type="my_entity",
            entity_id=entity_info["id"],
            entity_name=entity_info.get("name"),
            branch_id=entity_info.get("branch_id"),
            actor_user_id=user_id,
        )
```

### Export in `__init__.py`

```python
# rest_api/services/domain/__init__.py
from .my_entity_service import MyEntityService

__all__ = [
    # ... existing exports ...
    "MyEntityService",
]
```

### Thin Router

```python
"""
MyEntity endpoints.

CLEAN-ARCH: Thin router — delegates all business logic to MyEntityService.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from shared.infrastructure.db import get_db
from shared.security.auth import current_user_context as current_user
from shared.utils.admin_schemas import MyEntityOutput, MyEntityCreate, MyEntityUpdate
from rest_api.routers._common.pagination import Pagination, get_pagination
from rest_api.services.permissions import PermissionContext
from rest_api.services.domain import MyEntityService

router = APIRouter(tags=["admin-my-entity"])


@router.get("/my-entities", response_model=list[MyEntityOutput])
def list_my_entities(
    branch_id: int,
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    user: dict = Depends(current_user),
) -> list[MyEntityOutput]:
    ctx = PermissionContext(user)
    ctx.require_branch_access(branch_id)
    service = MyEntityService(db)
    return service.list_by_branch(
        tenant_id=ctx.tenant_id,
        branch_id=branch_id,
        limit=pagination.limit,
        offset=pagination.offset,
    )


@router.get("/my-entities/{entity_id}", response_model=MyEntityOutput)
def get_my_entity(
    entity_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(current_user),
) -> MyEntityOutput:
    ctx = PermissionContext(user)
    service = MyEntityService(db)
    output = service.get_by_id(entity_id, ctx.tenant_id)
    entity = service.get_entity(entity_id, ctx.tenant_id)
    if entity:
        ctx.require_branch_access(entity.branch_id)
    return output


@router.post("/my-entities", response_model=MyEntityOutput, status_code=201)
def create_my_entity(
    body: MyEntityCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(current_user),
) -> MyEntityOutput:
    ctx = PermissionContext(user)
    ctx.require_management()
    ctx.require_branch_access(body.branch_id)
    service = MyEntityService(db)
    return service.create(
        data=body.model_dump(),
        tenant_id=ctx.tenant_id,
        user_id=ctx.user_id,
        user_email=ctx.user_email,
    )


@router.patch("/my-entities/{entity_id}", response_model=MyEntityOutput)
def update_my_entity(
    entity_id: int,
    body: MyEntityUpdate,
    db: Session = Depends(get_db),
    user: dict = Depends(current_user),
) -> MyEntityOutput:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = MyEntityService(db)
    entity = service.get_entity(entity_id, ctx.tenant_id)
    if entity:
        service.validate_branch_access(entity, ctx.branch_ids if not ctx.is_admin else None)
    return service.update(
        entity_id=entity_id,
        data=body.model_dump(exclude_unset=True),
        tenant_id=ctx.tenant_id,
        user_id=ctx.user_id,
        user_email=ctx.user_email,
    )


@router.delete("/my-entities/{entity_id}", status_code=204)
def delete_my_entity(
    entity_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(current_user),
) -> None:
    ctx = PermissionContext(user)
    ctx.require_management()
    service = MyEntityService(db)
    entity = service.get_entity(entity_id, ctx.tenant_id)
    if entity:
        service.validate_branch_access(entity, ctx.branch_ids if not ctx.is_admin else None)
    service.delete(
        entity_id=entity_id,
        tenant_id=ctx.tenant_id,
        user_id=ctx.user_id,
        user_email=ctx.user_email,
    )
```

---

## Required Patterns Reference

### safe_commit — never call db.commit() directly

```python
from shared.infrastructure.db import safe_commit
safe_commit(db)   # Handles rollback and logging automatically
```

### Centralized Exceptions

```python
from shared.utils.exceptions import NotFoundError, ForbiddenError, ValidationError

raise NotFoundError("Producto", product_id, tenant_id=tenant_id)
raise ForbiddenError("acceder a esta sucursal", branch_id=branch_id)
raise ValidationError("nombre es requerido", field="name")
```

### with_for_update() for Race-Condition-Prone Operations

Use this for billing, rounds, and any state machine that must not double-process:

```python
locked = db.scalar(
    select(TableSession)
    .where(TableSession.id == session_id)
    .with_for_update()
)
```

### SQLAlchemy Boolean — .is_(True), never == True

```python
# CORRECT
.where(Model.is_active.is_(True))
.where(Model.is_deleted.is_(False))

# WRONG — do not do this
.where(Model.is_active == True)
```

### Eager Loading to Avoid N+1

```python
from sqlalchemy.orm import selectinload, joinedload

rounds = db.execute(
    select(Round).options(
        selectinload(Round.items).joinedload(RoundItem.product)
    )
).scalars().unique().all()
```

### PermissionContext — User Data from JWT

```python
from rest_api.services.permissions import PermissionContext

ctx = PermissionContext(user)
ctx.tenant_id          # int
ctx.user_id            # int
ctx.user_email         # str
ctx.branch_ids         # list[int] — branches user can access
ctx.is_admin           # bool

ctx.require_management()           # Raises ForbiddenError if not ADMIN/MANAGER
ctx.require_branch_access(bid)     # Raises ForbiddenError if user can't access branch
```

### Canonical Import Paths

```python
from shared.infrastructure.db import get_db, safe_commit
from shared.security.auth import current_user_context as current_user
from shared.utils.exceptions import NotFoundError, ForbiddenError, ValidationError
from shared.utils.admin_schemas import MyEntityOutput
from shared.config.constants import Roles, RoundStatus, MANAGEMENT_ROLES
from rest_api.services.base_service import BaseCRUDService, BranchScopedService
from rest_api.services.domain import MyEntityService
from rest_api.services.permissions import PermissionContext
from rest_api.services.events import publish_entity_deleted
```

---

## Commands

```bash
# Type-check backend
cd backend && python -m mypy rest_api/services/domain/my_entity_service.py

# Run backend tests
cd backend && python -m pytest tests/ -v

# Run single test file
cd backend && python -m pytest tests/test_my_entity.py -v

# Start backend manually (requires DB + Redis running)
cd backend && python -m uvicorn rest_api.main:app --reload --port 8000
```

---

## Resources

> ⚠️ **Nota**: Los archivos de referencia se crean en C-04 (category_service.py) y C-02 (base_service.py).
> Hasta que existan, usar esta skill como template de diseño.

- **Reference service**: `backend/rest_api/services/domain/category_service.py`
- **Reference router**: `backend/rest_api/routers/admin/categories.py`
- **Base classes**: `backend/rest_api/services/base_service.py`
- **Domain exports**: `backend/rest_api/services/domain/__init__.py`
- **Architecture docs**: `CLAUDE.md` — Clean Architecture section
