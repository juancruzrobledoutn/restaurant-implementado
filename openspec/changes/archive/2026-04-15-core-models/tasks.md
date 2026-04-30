## 1. Constants y Mixins

- [x] 1.1 Actualizar `backend/shared/config/constants.py`: agregar alias `Roles = UserRole` y constante `ORDERABLE = frozenset({RoundStatus.DRAFT})`. NO modificar las definiciones existentes de `UserRole`, `RoundStatus`, `MANAGEMENT_ROLES`, `ALL_ROLES`.
- [x] 1.2 Crear `backend/rest_api/models/mixins.py` con `AuditMixin` (campos: `is_active`, `created_at`, `updated_at`, `deleted_at`, `deleted_by_id`). Usar `server_default` para timestamps, `onupdate` para `updated_at`.

## 2. Modelos SQLAlchemy

- [x] 2.1 Crear `backend/rest_api/models/tenant.py` con modelo `Tenant` (tabla `app_tenant`): `id` BigInteger PK, `name` String not null. Incluir `AuditMixin`.
- [x] 2.2 Crear `backend/rest_api/models/branch.py` con modelo `Branch` (tabla `branch`): `id` BigInteger PK, `tenant_id` FK, `name`, `address`, `slug`. UniqueConstraint(`tenant_id`, `slug`). Index en `tenant_id`. Incluir `AuditMixin`.
- [x] 2.3 Crear `backend/rest_api/models/user.py` con modelos `User` (tabla `app_user`) y `UserBranchRole` (tabla `user_branch_role`). User: `id` BigInteger PK, `tenant_id` FK, `email` unique, `full_name`, `hashed_password`. UserBranchRole: composite PK (`user_id`, `branch_id`, `role`), FKs correspondientes.
- [x] 2.4 Crear `backend/rest_api/models/__init__.py` que re-exporte todos los modelos (Tenant, Branch, User, UserBranchRole) para Alembic autodiscovery.

## 3. Repositories

- [x] 3.1 Crear `backend/rest_api/repositories/__init__.py` y `backend/rest_api/repositories/base.py` con `TenantRepository` (métodos: `get_by_id`, `list_all`, `create`, `update`, `soft_delete`) — todos filtran por `tenant_id` + `is_active.is_(True)`.
- [x] 3.2 Agregar `BranchRepository` en `base.py` extendiendo `TenantRepository` con `list_by_branch` y `get_by_branch`.

## 4. Domain Services Base

- [x] 4.1 Crear `backend/rest_api/services/__init__.py` y `backend/rest_api/services/base.py` con `BaseCRUDService[Model, Output]`: métodos `create`, `update`, `delete`, `get_by_id`, `list_all` con hooks `_validate_create`, `_validate_update`, `_after_create`, `_after_update`, `_after_delete`. Usar `safe_commit(db)` para writes.
- [x] 4.2 Agregar `BranchScopedService[Model, Output]` en `base.py` extendiendo `BaseCRUDService` con `list_by_branch` y `get_by_branch`.
- [x] 4.3 Crear `backend/rest_api/services/domain/__init__.py` (vacío, placeholder para C-03+).

## 5. Utilidades Soft Delete

- [x] 5.1 Crear `backend/shared/utils/soft_delete.py` con función `cascade_soft_delete(db, entity, user_id)` que recursivamente desactiva la entidad y sus dependientes via SQLAlchemy relationships. Setear `is_active=False`, `deleted_at=utcnow`, `deleted_by_id=user_id`. Skipear entidades ya borradas.

## 6. Migración Alembic

- [x] 6.1 Verificar que `backend/alembic/env.py` importa `rest_api.models` para autodiscovery de los modelos.
- [x] 6.2 Generar migración 001 con `alembic revision --autogenerate -m "001_core_models"`. Verificar que crea las 4 tablas (`app_tenant`, `branch`, `app_user`, `user_branch_role`) con todos los constraints, índices y FKs. Downgrade debe dropear en orden inverso.

## 7. Seed Data

- [x] 7.1 Crear `backend/rest_api/seeds/__init__.py` y `backend/rest_api/seeds/tenants.py` con `seed_tenants(db)`: crea 1 tenant + 1 branch (idempotente, verifica por slug/nombre antes de insertar).
- [x] 7.2 Crear `backend/rest_api/seeds/users.py` con `seed_users(db)`: crea 4 usuarios con hashed passwords (bcrypt pre-computados) y sus UserBranchRole entries (idempotente, verifica por email).
- [x] 7.3 Crear `backend/rest_api/seeds/runner.py` como entry point (`python -m rest_api.seeds.runner`) que ejecuta `seed_tenants` y luego `seed_users` en una sesión async.

## 8. Verificación

- [ ] 8.1 Verificar que `alembic upgrade head` ejecuta sin errores y crea las 4 tablas. [REQUIRES LIVE DB]
- [ ] 8.2 Verificar que `python -m rest_api.seeds.runner` crea los datos esperados (1 tenant, 1 branch, 4 users, 4 roles) y que una segunda ejecución es idempotente. [REQUIRES LIVE DB]
- [x] 8.3 Verificar que el linter (ruff) no reporta errores en los archivos creados.
