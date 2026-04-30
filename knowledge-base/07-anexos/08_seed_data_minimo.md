> Creado: 2026-04-08 | Estado: vigente

# Seed Data Mínimo — Change C-02 core-models

Este documento define los datos exactos que debe crear el seed del change C-02.
Sin esta especificación, el agente inventaría valores que pueden romper C-03 en adelante.

---

## Por qué este seed es necesario

C-02 crea los modelos base (Tenant, Branch, User, UserBranchRole).
C-03 (auth) necesita al menos 1 usuario para testear login.
C-04 en adelante necesita branch_id para crear categorías, mesas, etc.
Sin seed, los tests de todos los changes siguientes fallan al arrancar.

---

## Datos a crear

### Tenant

```python
tenant = Tenant(
    id=1,
    name="Demo Restaurant",
    is_active=True,
)
```

### Branch

```python
branch = Branch(
    id=1,
    tenant_id=1,
    name="Sucursal Central",
    address="Av. Corrientes 1234, Buenos Aires",
    slug="demo",           # CRÍTICO: branch_slug usado por pwaMenu (VITE_BRANCH_SLUG=demo)
    is_active=True,
)
```

### Users

```python
# ADMIN — acceso total
admin = User(
    id=1,
    tenant_id=1,
    email="admin@demo.com",
    full_name="Admin Demo",
    hashed_password=hash("admin123"),   # bcrypt
    is_active=True,
)
admin_role = UserBranchRole(user_id=1, branch_id=1, role=Roles.ADMIN)

# MANAGER — gestión operativa
manager = User(
    id=2,
    tenant_id=1,
    email="manager@demo.com",
    full_name="Manager Demo",
    hashed_password=hash("manager123"),
    is_active=True,
)
manager_role = UserBranchRole(user_id=2, branch_id=1, role=Roles.MANAGER)

# WAITER — operaciones de sala
waiter = User(
    id=3,
    tenant_id=1,
    email="waiter@demo.com",
    full_name="Waiter Demo",
    hashed_password=hash("waiter123"),
    is_active=True,
)
waiter_role = UserBranchRole(user_id=3, branch_id=1, role=Roles.WAITER)

# KITCHEN — operaciones de cocina
kitchen = User(
    id=4,
    tenant_id=1,
    email="kitchen@demo.com",
    full_name="Kitchen Demo",
    hashed_password=hash("kitchen123"),
    is_active=True,
)
kitchen_role = UserBranchRole(user_id=4, branch_id=1, role=Roles.KITCHEN)
```

---

## Estructura del archivo seed

El seed se implementa como script modular en `backend/rest_api/seeds/`:

```
backend/rest_api/seeds/
├── __init__.py
├── runner.py         ← cli.py llama a este
├── tenants.py        ← crea tenant + branch
└── users.py          ← crea 4 usuarios con roles
```

**Invocación** (desde C-02 en adelante):
```bash
cd backend && python -m rest_api.seeds.runner
# O via CLI una vez que se implemente en C-02:
# cd backend && python cli.py db-seed
```

---

## Verificación post-seed

```bash
# Verificar que los datos existen
cd backend && python -c "
from shared.infrastructure.db import SessionLocal
from rest_api.models import Tenant, Branch, User
db = SessionLocal()
print('Tenants:', db.query(Tenant).count())   # debe ser 1
print('Branches:', db.query(Branch).count())  # debe ser 1
print('Users:', db.query(User).count())        # debe ser 4
db.close()
"
```

---

## Variables de entorno necesarias (derivadas del seed)

```bash
# pwaMenu/.env — el slug debe coincidir con branch.slug del seed
VITE_BRANCH_SLUG=demo

# backend/.env (testing)
SEED_ADMIN_EMAIL=admin@demo.com
SEED_ADMIN_PASSWORD=admin123
```

---

## Seed enriquecido (flag `--full`)

> **DEV ONLY** — nunca correr contra staging ni producción.

```bash
cd backend && python -m rest_api.seeds.runner --full
```

Implementado en `backend/rest_api/seeds/demo_full.py` (C-31). Se ejecuta **después** de `seed_staff_management` dentro de la misma transacción. Idempotente por natural keys (ver §D-02 del design de C-31).

### Entidades creadas

| Entidad | Cantidad | Descripción |
|---------|----------|-------------|
| `Allergen` | 3 | Gluten (moderate), Lácteos (moderate), Mariscos (severe/mandatory) |
| `ProductAllergen` | 6 | Links con `contains` y `may_contain` — ejercita filtro de alérgenos en pwaMenu |
| `Category` | 2 | "Entradas", "Pescados y Mariscos" |
| `Subcategory` | 3 | "Entradas frías", "Mariscos", "Postres" |
| `Product` + `BranchProduct` | 5 | Tostadas bruschetta, Provoleta, Langostinos al ajillo, Empanadas de carne, Flan mixto |
| `TableSession` OPEN (T01) | 1 | 2 Diners (Juan, María) |
| `TableSession` PAYING (T02) | 1 | 1 Diner (Pedro) |
| `TableSession` CLOSED | 3 | Historial relativo: now()-1d, -2d, -3d |
| `Round` SERVED | 5+ | T01-R1, T02-R1, 3 históricas |
| `Round` IN_KITCHEN | 1 | T01-R2 |
| `KitchenTicket` DELIVERED | 5+ | Uno por cada Round SERVED |
| `KitchenTicket` IN_PROGRESS | 1 | T01-R2 — visible en Kitchen Display |
| `ServiceCall` ACKED | 1 | En T01 |
| `ServiceCall` CREATED | 1 | En T01 — muestra badge rojo en pwaWaiter |
| `Check` REQUESTED | 1 | T02 con pago parcial (2000/4500 cents) |
| `Check` PAID | 3 | Uno por sesión histórica |
| `Payment` APPROVED | 4 | 3 full (históricas) + 1 parcial (T02) |
| `Allocation` | 4 | FIFO — una por Payment |

### Estados representados

| Modelo | Estados cubiertos |
|--------|------------------|
| `TableSession` | OPEN · PAYING · CLOSED |
| `Round` | IN_KITCHEN · SERVED |
| `KitchenTicket` | IN_PROGRESS · DELIVERED |
| `ServiceCall` | CREATED · ACKED |
| `Check` | REQUESTED · PAID |
| `Payment` | APPROVED |
| `ProductAllergen.presence_type` | contains · may_contain |

### Natural keys para idempotencia (§D-02)

| Entidad | Natural key |
|---------|-------------|
| `Allergen` | `(tenant_id, name)` |
| `Category` | `(branch_id, name)` |
| `Subcategory` | `(category_id, name)` |
| `Product` | `(subcategory_id, name)` |
| `BranchProduct` | `(product_id, branch_id)` |
| `ProductAllergen` | `(product_id, allergen_id)` |
| `TableSession` activa | `(table_id, status IN ('OPEN','PAYING'), is_active=True)` |
| `ServiceCall` | `(session_id)` — si ya hay calls para la sesión, skip |
| `TableSession` CLOSED (historial) | Bloque entero: si ya hay ≥3 CLOSED en `[now()-4d, now()]` para T01, skip |
| `Check` | `(session_id)` (UniqueConstraint en DB) |
| `Charge`/`Payment`/`Allocation` | Bloque: si el Check ya tiene Charges, skip |
