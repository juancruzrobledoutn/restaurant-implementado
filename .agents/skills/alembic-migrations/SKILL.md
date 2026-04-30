---
name: alembic-migrations
description: >
  Workflow completo de Alembic para el proyecto Integrador. Cubre env.py dinámico,
  autogenerate, cadena de dependencias, tests de migración y reglas del proyecto.
  Trigger: Cualquier change C-02 a C-13 que incluya nuevos modelos SQLAlchemy.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use
- Cualquier change que crea o modifica modelos SQLAlchemy (C-02 a C-13)
- ANTES de generar una migración: verificar que todos los modelos están importados en `rest_api/models/__init__.py`

## Reglas del Proyecto (No Negociables)

1. **NUNCA modificar una migración ya archivada** (en `openspec/changes/archive/`). Si un change anterior creó la tabla `category` y necesitás agregar una columna, creás una NUEVA migración numerada consecutivamente.

2. **Una migración por change**. Cada change tiene su migración con nombre descriptivo: `001_tenant_branch_user`, `002_menu_catalog`, etc.

3. **Sin URL hardcodeada en alembic.ini**. La URL se lee siempre de `shared.config.settings`.

4. **Revisar el autogenerate antes de aplicar**. Alembic puede detectar falsos positivos (índices, constraints). Revisar el archivo generado antes de `upgrade head`.

## Workflow por Change

### Paso 1 — Verificar que los modelos están importados

```python
# backend/rest_api/models/__init__.py
# CRÍTICO: Alembic solo detecta modelos importados aquí
from rest_api.models.tenant import Tenant, Branch           # C-02
from rest_api.models.user import User, UserBranchRole       # C-02
from rest_api.models.menu import Category, Subcategory, Product  # C-04
# ... agregar los nuevos modelos del change actual
```

### Paso 2 — Generar la migración

```bash
cd backend
alembic revision --autogenerate -m "descripcion_del_change"
# Ejemplo: alembic revision --autogenerate -m "001_tenant_branch_user"
```

### Paso 3 — Revisar el archivo generado

```python
# backend/alembic/versions/XXXX_descripcion.py
# Verificar:
# 1. down_revision apunta a la migración anterior correcta
# 2. Las tablas creadas tienen los tipos correctos
# 3. Los índices son los esperados
# 4. No hay operaciones sobre tablas que no deberían existir

def upgrade() -> None:
    # Revisar que solo crea las tablas del change actual
    op.create_table('app_tenant',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id')
    )

def downgrade() -> None:
    op.drop_table('app_tenant')
```

### Paso 4 — Aplicar

```bash
alembic upgrade head          # aplicar hasta HEAD
alembic current               # verificar versión actual
alembic history               # ver cadena completa
```

### Paso 5 — Rollback si algo falla

```bash
alembic downgrade -1          # revertir la última migración
alembic downgrade base        # revertir TODAS (destructivo — solo en desarrollo)
```

## AuditMixin — Base de todos los modelos

```python
# backend/shared/infrastructure/db.py (o models/base.py)
from sqlalchemy import Boolean, DateTime, BigInteger, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from datetime import datetime
from typing import Optional

class Base(DeclarativeBase):
    pass

class AuditMixin:
    """Mixin con campos comunes a todas las entidades del sistema."""
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    deleted_by_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
```

## Convenciones de nombres de tablas

| Modelo | Tabla | Razón |
|--------|-------|-------|
| `Tenant` | `app_tenant` | "tenant" puede ser palabra reservada |
| `Check` | `app_check` | "check" es palabra reservada SQL |
| `User` | `app_user` | "user" es palabra reservada en PostgreSQL |
| Todo lo demás | snake_case del nombre | `Category` → `category`, `BranchSector` → `branch_sector` |

## Tests de migración

```python
# backend/tests/test_migrations.py
def test_migrations_up_down(db_engine):
    """Verifica que todas las migraciones tienen un downgrade funcional."""
    from alembic.command import upgrade, downgrade
    from alembic.config import Config

    alembic_cfg = Config("alembic.ini")
    upgrade(alembic_cfg, "head")
    downgrade(alembic_cfg, "base")
    upgrade(alembic_cfg, "head")
```

## Errores comunes

| Error | Causa | Solución |
|-------|-------|---------|
| `Can't locate revision` | down_revision incorrecto | Verificar `alembic history` y corregir el down_revision |
| `Target database is not up to date` | Hay migración pendiente | `alembic upgrade head` primero |
| `Table already exists` | Migración se corrió parcialmente | `alembic downgrade -1` y revisar el archivo |
| Alembic detecta cambios fantasma | Índices o constraints no declarados | Revisar el diff cuidadosamente, puede ser un falso positivo |
| `Module not found` en env.py | Modelo no importado en `__init__.py` | Agregar el import en `rest_api/models/__init__.py` |
