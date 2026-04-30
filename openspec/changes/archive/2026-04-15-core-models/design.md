## Context

C-01 dejó el monorepo scaffolded con:
- `backend/shared/infrastructure/db.py`: `Base`, `get_db()`, `safe_commit()`, `SessionLocal`, engine async
- `backend/shared/config/constants.py`: `UserRole` (StrEnum), `RoundStatus` (StrEnum), `MANAGEMENT_ROLES`, `ALL_ROLES`
- `backend/shared/utils/exceptions.py`: `NotFoundError`, `ForbiddenError`, `ValidationError`
- `backend/alembic/`: inicializado con `env.py` configurado, carpeta `versions/` vacía

No existen modelos SQLAlchemy, repositorios, ni servicios de dominio. Este change los crea.

## Goals / Non-Goals

**Goals:**
- Definir `AuditMixin` reutilizable para todas las entidades del sistema
- Crear los 4 modelos fundacionales: `Tenant`, `Branch`, `User`, `UserBranchRole`
- Implementar `TenantRepository` y `BranchRepository` con filtrado automático multi-tenant
- Implementar `BaseCRUDService` y `BranchScopedService` como clases base para domain services
- Crear `cascade_soft_delete()` para desactivación recursiva
- Generar la primera migración Alembic con las 4 tablas
- Crear seed modular con datos mínimos para desarrollo

**Non-Goals:**
- NO crear endpoints REST (eso es responsabilidad de C-03 auth y changes posteriores)
- NO implementar `PermissionContext` ni autenticación JWT (C-03)
- NO crear schemas Pydantic de request/response (cada change crea los suyos)
- NO crear modelos de catálogo (Category, Product, etc. — C-04)
- NO implementar el campo `hashed_password` con bcrypt real (C-03 trae passlib/bcrypt)
- NO crear tests E2E ni de integración con DB real (el seed se valida manualmente)

## Decisions

### D1: AuditMixin como mixin declarativo (no clase base abstracta)

**Decisión**: Usar un mixin SQLAlchemy (`declared_attr` donde sea necesario) en vez de una clase base abstracta.

**Alternativa considerada**: Herencia de `AuditBase(Base)` que incluya los campos audit. Descartada porque fuerza herencia simple y complicaría modelos con relaciones M:N como `UserBranchRole`.

**Campos del mixin**:
- `is_active: bool = True` — soft delete flag
- `created_at: datetime` — timestamp UTC, server_default
- `updated_at: datetime` — timestamp UTC, onupdate
- `deleted_at: datetime | None` — timestamp de soft delete
- `deleted_by_id: int | None` — FK opcional al usuario que borró

### D2: Repositorios como clases (no funciones sueltas)

**Decisión**: `TenantRepository` y `BranchRepository` como clases que reciben `AsyncSession` en el constructor y aplican filtros `tenant_id` + `is_active.is_(True)` automáticamente en todos los métodos.

**Alternativa considerada**: Funciones stateless que reciben `db` como parámetro. Descartada porque los repositorios necesitan estado (la sesión) y composición en los services.

**Ubicación**: `backend/rest_api/repositories/base.py` para las clases base, archivos específicos para repositorios concretos si se necesitan.

### D3: BaseCRUDService con patrón Template Method

**Decisión**: `BaseCRUDService[Model, Output]` como clase genérica con hooks (`_validate_create`, `_validate_update`, `_after_create`, `_after_update`, `_after_delete`) que las subclases overridean.

**Alternativa considerada**: Services sin clase base, cada uno implementa CRUD desde cero. Descartada por duplicación masiva — el 80% del CRUD es idéntico entre entidades.

`BranchScopedService` extiende `BaseCRUDService` agregando filtrado por `branch_id` en lecturas.

**Ubicación**: `backend/rest_api/services/base.py`

### D4: User.hashed_password como campo String nullable

**Decisión**: El modelo `User` declara `hashed_password: str` como columna String. En el seed de C-02, se almacena un placeholder (hash pre-computado con bcrypt). El import real de `passlib` y la lógica de hashing se implementan en C-03 (auth).

**Razón**: No agregar dependencia de passlib/bcrypt en C-02 — mantiene el scope acotado.

### D5: Constants.py — actualizar, NO recrear

**Decisión**: `constants.py` ya existe con `UserRole`, `RoundStatus`, `MANAGEMENT_ROLES`, `ALL_ROLES`. Solo se agregan:
- `Roles = UserRole` (alias para conveniencia — el seed reference doc usa `Roles.ADMIN`)
- `ORDERABLE: frozenset` con los estados de round que permiten nuevos pedidos

NO se modifican ni eliminan las definiciones existentes.

### D6: Tablas SQL — nombres y prefijos

| Modelo | `__tablename__` | Razón |
|--------|-----------------|-------|
| Tenant | `app_tenant` | `tenant` no es reservada pero `app_` es convención del proyecto para entidades core |
| Branch | `branch` | No es palabra reservada |
| User | `app_user` | `user` ES palabra reservada en PostgreSQL |
| UserBranchRole | `user_branch_role` | Tabla de relación M:N, no es reservada |

### D7: Estructura de archivos

```
backend/rest_api/
├── models/
│   ├── __init__.py          ← re-exports para Alembic autodiscovery
│   ├── mixins.py            ← AuditMixin
│   ├── tenant.py            ← Tenant model
│   ├── branch.py            ← Branch model
│   ├── user.py              ← User, UserBranchRole models
├── repositories/
│   ├── __init__.py
│   ├── base.py              ← TenantRepository, BranchRepository
├── services/
│   ├── __init__.py
│   ├── base.py              ← BaseCRUDService, BranchScopedService
│   ├── domain/              ← (vacío por ahora, C-03+ agrega servicios concretos)
│   │   └── __init__.py
├── seeds/
│   ├── __init__.py
│   ├── runner.py            ← entry point: python -m rest_api.seeds.runner
│   ├── tenants.py           ← seed_tenants(db)
│   └── users.py             ← seed_users(db)
backend/shared/
├── config/
│   └── constants.py         ← ACTUALIZAR (agregar Roles alias, ORDERABLE)
├── utils/
│   └── soft_delete.py       ← cascade_soft_delete()
```

### D8: Índices y constraints de la migración 001

| Tabla | Índice / Constraint | Tipo |
|-------|---------------------|------|
| `app_tenant` | PK `id` | BigInteger autoincrement |
| `branch` | PK `id`, FK `tenant_id` → `app_tenant.id` | BigInteger |
| `branch` | UNIQUE(`tenant_id`, `slug`) | Composite unique |
| `branch` | INDEX(`tenant_id`) | B-tree |
| `app_user` | PK `id`, FK `tenant_id` → `app_tenant.id` | BigInteger |
| `app_user` | UNIQUE(`email`) | Global unique (cross-tenant) |
| `app_user` | INDEX(`tenant_id`) | B-tree |
| `user_branch_role` | PK (`user_id`, `branch_id`, `role`) | Composite PK |
| `user_branch_role` | FK `user_id` → `app_user.id` | |
| `user_branch_role` | FK `branch_id` → `branch.id` | |

## Risks / Trade-offs

- **[Risk] Email unique global (cross-tenant)** → Simplifica el sistema pero impide que el mismo email exista en dos tenants distintos. Aceptable para MVP — un usuario con acceso a múltiples tenants se modela con múltiples `UserBranchRole` entries.
  → Mitigation: Si se necesita multi-tenant email en el futuro, migración agrega UNIQUE(`tenant_id`, `email`) y elimina UNIQUE(`email`).

- **[Risk] Seed con IDs hardcoded (1, 2, 3, 4)** → Puede colisionar si se ejecuta sobre una DB con datos.
  → Mitigation: El seed verifica existencia antes de insertar (upsert por email/slug). Solo se ejecuta en dev/test.

- **[Risk] `cascade_soft_delete` sin transacción explícita** → Si falla a mitad de camino, queda en estado inconsistente.
  → Mitigation: Se ejecuta dentro de la sesión del request; el rollback automático de `get_db()` protege ante excepciones.

- **[Trade-off] `hashed_password` placeholder en seed** → Los passwords del seed no son funcionales hasta C-03.
  → Aceptable: el seed existe para que C-03 tenga datos contra los cuales testear login.

## Open Questions

_(ninguna — el scope está acotado y las decisiones alineadas con la knowledge base)_
