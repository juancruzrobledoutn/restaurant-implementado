## Why

C-01 (foundation-setup) creó el scaffold del monorepo con FastAPI, Alembic vacío y el módulo `shared/`. Pero no existe ningún modelo de datos ni capa de persistencia real. Sin modelos base (`Tenant`, `Branch`, `User`, `UserBranchRole`), no se puede implementar autenticación (C-03), catálogo (C-04), ni nada que requiera acceso a base de datos. Este change establece los cimientos del modelo relacional multi-tenant que todo el sistema necesita.

## What Changes

- **AuditMixin**: mixin SQLAlchemy con `is_active`, `created_at`, `updated_at`, `deleted_at`, `deleted_by_id` — aplicado a todos los modelos
- **Modelos SQLAlchemy**: `Tenant` (`app_tenant`), `Branch` (`branch`), `User` (`app_user`), `UserBranchRole` (`user_branch_role`)
- **Repositories**: `TenantRepository` y `BranchRepository` con filtrado automático por `tenant_id` e `is_active`
- **Domain Services base**: `BaseCRUDService[Model, Output]` y `BranchScopedService[Model, Output]` con hooks de validación
- **Utilidades**: `cascade_soft_delete()` para desactivación recursiva de entidades dependientes
- **Actualización de constants.py**: agregar alias `Roles = UserRole`, constante `ORDERABLE` para estados de round que permiten nuevos pedidos
- **Migración Alembic 001**: tablas `app_tenant`, `branch`, `app_user`, `user_branch_role` con índices y constraints
- **Seed mínimo**: 1 tenant ("Demo Restaurant"), 1 branch ("Sucursal Central", slug="demo"), 4 usuarios (ADMIN, MANAGER, WAITER, KITCHEN) con roles asignados

## Capabilities

### New Capabilities

- `core-models`: Modelos SQLAlchemy base del sistema multi-tenant (Tenant, Branch, User, UserBranchRole), AuditMixin, repositories, y servicios CRUD genéricos
- `seed-data`: Script de seed modular para datos iniciales de desarrollo y testing

### Modified Capabilities

_(ninguna — no existen specs previas)_

## Impact

- **Backend**: nuevos archivos en `backend/rest_api/models/`, `backend/rest_api/repositories/`, `backend/rest_api/services/`, `backend/rest_api/seeds/`
- **Shared**: actualización de `backend/shared/config/constants.py` (NO recrear), nueva utilidad `cascade_soft_delete` en shared
- **Alembic**: primera migración real en `backend/alembic/versions/`
- **DB**: 4 tablas nuevas en PostgreSQL con foreign keys, índices sobre `tenant_id`, `branch_id`, `email`
- **Dependencias Python**: ninguna nueva (SQLAlchemy y Alembic ya están desde C-01)
- **Governance**: CRITICO — estos modelos son la base de todo el sistema; errores aquí propagan a los 23 changes restantes
