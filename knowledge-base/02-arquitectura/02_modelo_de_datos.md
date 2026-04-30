# Modelo de Datos

Este documento describe el modelo de datos completo del sistema Integrador / Buen Sabor, incluyendo todas las entidades, sus relaciones, convenciones de nombrado y decisiones de diseño.

---

## 1. Diagrama de Entidades y Relaciones

```
Tenant (Restaurant)
  |
  |-- CookingMethod          (catálogo tenant-scoped)
  |-- FlavorProfile           (catálogo tenant-scoped)
  |-- TextureProfile          (catálogo tenant-scoped)
  |-- CuisineType             (catálogo tenant-scoped)
  |
  |-- IngredientGroup (N)
  |     +-- Ingredient (N)
  |           +-- SubIngredient (N)
  |
  |-- Allergen (N)
  |     +-- AllergenCrossReaction (self-referential)
  |
  |-- Recipe (N)
  |
  +-- Branch (N)
        |
        |-- Category (N)
        |     +-- Subcategory (N)
        |           +-- Product (N)
        |                 +-- ProductAllergen (M:N con presence_type + risk_level)
        |                 +-- BranchProduct (precio por sucursal, is_active)
        |                 +-- PromotionItem (M:N con Promotion)
        |
        |-- BranchSector (N)
        |     +-- Table (N)
        |     |     +-- TableSession
        |     |           +-- Diner (N)
        |     |           +-- Round (N)
        |     |           |     +-- RoundItem (N)
        |     |           |     +-- KitchenTicket
        |     |           |           +-- KitchenTicketItem (N)
        |     |           +-- CartItem (N, efímero)
        |     |           +-- ServiceCall (N)
        |     |           +-- Check (app_check)
        |     |                 +-- Charge (N)
        |     |                 |     +-- Allocation (N, FIFO)
        |     |                 +-- Payment (N)
        |     |
        |     +-- WaiterSectorAssignment (diaria)
        |
        +-- Promotion (N, via PromotionBranch)
              +-- PromotionItem (N)

User
  +-- UserBranchRole (M:N con Branch, roles: WAITER/KITCHEN/MANAGER/ADMIN)

Customer
  +-- Diner (1:N via customer_id, tracking por dispositivo)
```

---

## 2. Detalle de Tablas

### 2.1 Entidades de Tenant

#### `app_tenant`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| name | String | Nombre del restaurante |
| is_active | Boolean | Soft delete flag |
| created_at | DateTime | Timestamp de creación |
| updated_at | DateTime | Timestamp de última modificación |

**Relaciones**: 1:N con `branch`, 1:N con entidades tenant-scoped (allergen, recipe, ingredient_group, etc.)

> **Nota**: Se usa `app_tenant` como nombre de tabla para evitar conflictos con palabras reservadas de SQL.

---

#### `branch`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| tenant_id | BigInt (FK) | Referencia al tenant |
| name | String | Nombre de la sucursal |
| address | String | Dirección física |
| slug | String (unique per tenant) | Identificador URL-friendly |
| is_active | Boolean | Soft delete flag |

**Relaciones**: N:1 con `app_tenant`, 1:N con `category`, `branch_sector`, `app_table`, `promotion_branch`

---

### 2.2 Catálogos Tenant-Scoped

Estas entidades son compartidas entre todas las sucursales de un tenant:

| Tabla | Campos clave | Uso |
|-------|-------------|-----|
| `cooking_method` | tenant_id, name | Métodos de cocción (grill, horno, etc.) |
| `flavor_profile` | tenant_id, name | Perfiles de sabor (dulce, salado, etc.) |
| `texture_profile` | tenant_id, name | Perfiles de textura (crocante, cremoso, etc.) |
| `cuisine_type` | tenant_id, name | Tipos de cocina (italiana, japonesa, etc.) |

Todos heredan de `AuditMixin` e incluyen `is_active` para soft delete.

---

### 2.3 Menú y Productos

#### `category`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| branch_id | BigInt (FK) | Sucursal a la que pertenece |
| name | String | Nombre (ej: "Entradas", "Platos principales") |
| icon | String (nullable) | Icono representativo |
| image | String (nullable) | URL de imagen |
| order | Integer | Orden de visualización |
| is_active | Boolean | Soft delete flag |

**Relaciones**: N:1 con `branch`, 1:N con `subcategory`

---

#### `subcategory`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| category_id | BigInt (FK) | Categoría padre |
| name | String | Nombre (ej: "Ensaladas", "Sopas") |
| image | String (nullable) | URL de imagen |
| order | Integer | Orden de visualización |
| is_active | Boolean | Soft delete flag |

**Relaciones**: N:1 con `category`, 1:N con `product`

---

#### `product`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| subcategory_id | BigInt (FK) | Subcategoría padre |
| name | String | Nombre del producto |
| description | String (nullable) | Descripción |
| price | Integer | Precio base en centavos |
| image | String (nullable) | URL de imagen |
| featured | Boolean | Producto destacado |
| popular | Boolean | Producto popular |
| is_active | Boolean | Soft delete flag |

**Relaciones**: N:1 con `subcategory`, M:N con `allergen` (via `product_allergen`), 1:N con `branch_product`

---

#### `branch_product`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| product_id | BigInt (FK) | Producto |
| branch_id | BigInt (FK) | Sucursal |
| price_cents | Integer | Precio específico para esta sucursal (centavos) |
| is_active | Boolean | Si el producto se vende en esta sucursal |

**Relaciones**: N:1 con `product`, N:1 con `branch`

> Cuando `use_branch_prices` está activo, este registro define el precio y la disponibilidad del producto en cada sucursal.

---

### 2.4 Alérgenos

#### `allergen`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| tenant_id | BigInt (FK) | Tenant propietario |
| name | String | Nombre del alérgeno (ej: "Gluten", "Lactosa") |
| icon | String (nullable) | Icono |
| description | String (nullable) | Descripción detallada |
| is_mandatory | Boolean | Obligatorio según EU 1169/2011 |
| severity | String | Severidad: mild, moderate, severe, life_threatening |
| is_active | Boolean | Soft delete flag |

**Relaciones**: M:N con `product` (via `product_allergen`), self-referential via `allergen_cross_reaction`

---

#### `product_allergen`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| product_id | BigInt (FK) | Producto |
| allergen_id | BigInt (FK) | Alérgeno |
| presence_type | String | `contains`, `may_contain`, `free_from` |
| risk_level | String | `mild`, `moderate`, `severe`, `life_threatening` |

**Tipo**: Tabla junction M:N con atributos adicionales.

---

#### `allergen_cross_reaction`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| allergen_id | BigInt (FK) | Alérgeno origen |
| related_allergen_id | BigInt (FK) | Alérgeno relacionado |

**Tipo**: Relación self-referential para modelar reacciones cruzadas (ej: latex <-> kiwi).

---

### 2.5 Sectores, Mesas y Sesiones

#### `branch_sector`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| branch_id | BigInt (FK) | Sucursal |
| name | String | Nombre del sector (ej: "Salón principal", "Terraza") |
| is_active | Boolean | Soft delete flag |

**Relaciones**: N:1 con `branch`, 1:N con `app_table`, 1:N con `waiter_sector_assignment`

---

#### `app_table`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| branch_id | BigInt (FK) | Sucursal |
| sector_id | BigInt (FK) | Sector dentro de la sucursal |
| number | Integer | Número de mesa |
| code | String | Código alfanumérico (ej: "INT-01") |
| capacity | Integer | Capacidad de comensales |
| status | String | Estado actual de la mesa |
| is_active | Boolean | Soft delete flag |

**Relaciones**: N:1 con `branch_sector`, 1:N con `table_session`

> **Importante**: Se usa `app_table` como nombre de tabla porque `table` es palabra reservada en SQL.

> **Importante**: Los códigos de mesa NO son únicos entre sucursales. Se requiere `branch_slug` para desambiguar.

---

#### `table_session`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| table_id | BigInt (FK) | Mesa asociada |
| branch_id | BigInt (FK) | Sucursal (denormalizado para consultas rápidas) |
| status | String | `OPEN`, `PAYING`, `CLOSED` |
| is_active | Boolean | Soft delete flag |

**Relaciones**: N:1 con `app_table`, 1:N con `diner`, 1:N con `round`, 1:N con `service_call`, 1:1 con `app_check`

---

#### `diner`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| session_id | BigInt (FK) | Sesión de mesa |
| name | String | Nombre del comensal |
| device_id | String (nullable) | Identificador del dispositivo |
| customer_id | BigInt (FK, nullable) | Cliente registrado (loyalty) |
| is_active | Boolean | Soft delete flag |

**Relaciones**: N:1 con `table_session`, N:1 con `customer` (opcional)

---

### 2.6 Rondas y Cocina

#### `round`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| session_id | BigInt (FK) | Sesión de mesa |
| round_number | Integer | Número secuencial de ronda en la sesión |
| status | String | Estado: PENDING, CONFIRMED, SUBMITTED, IN_KITCHEN, READY, SERVED, CANCELED |
| submitted_by | BigInt (FK, nullable) | Usuario que envió a cocina |
| is_active | Boolean | Soft delete flag |

**Relaciones**: N:1 con `table_session`, 1:N con `round_item`, 1:1 con `kitchen_ticket`

---

#### `round_item`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| round_id | BigInt (FK) | Ronda |
| product_id | BigInt (FK) | Producto pedido |
| quantity | Integer | Cantidad |
| notes | String (nullable) | Notas especiales (ej: "sin cebolla") |
| diner_id | BigInt (FK, nullable) | Comensal que pidió el item |
| is_active | Boolean | Soft delete flag |

**Relaciones**: N:1 con `round`, N:1 con `product`, N:1 con `diner`

---

#### `kitchen_ticket`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| round_id | BigInt (FK) | Ronda asociada |
| status | String | Estado del ticket en cocina |
| is_active | Boolean | Soft delete flag |

**Relaciones**: N:1 con `round`, 1:N con `kitchen_ticket_item`

---

#### `kitchen_ticket_item`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| ticket_id | BigInt (FK) | Ticket de cocina |
| round_item_id | BigInt (FK) | Item de ronda asociado |

**Relaciones**: N:1 con `kitchen_ticket`, N:1 con `round_item`

---

### 2.7 Facturación y Pagos

#### `app_check`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| session_id | BigInt (FK) | Sesión de mesa |
| total_cents | Integer | Total de la cuenta en centavos |
| status | String | `REQUESTED`, `PAID` |
| is_active | Boolean | Soft delete flag |

**Relaciones**: N:1 con `table_session`, 1:N con `charge`, 1:N con `payment`

> Se usa `app_check` como nombre de tabla porque `check` es palabra reservada en SQL.

---

#### `charge`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| check_id | BigInt (FK) | Cuenta |
| diner_id | BigInt (FK) | Comensal al que corresponde el cargo |
| amount_cents | Integer | Monto del cargo en centavos |

**Relaciones**: N:1 con `app_check`, N:1 con `diner`, 1:N con `allocation`

---

#### `payment`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| check_id | BigInt (FK) | Cuenta |
| amount_cents | Integer | Monto del pago en centavos |
| method | String | Método: efectivo, tarjeta, transferencia |
| status | String | `PENDING`, `APPROVED`, `REJECTED`, `FAILED` |

**Relaciones**: N:1 con `app_check`, 1:N con `allocation`

---

#### `allocation`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| charge_id | BigInt (FK) | Cargo al que se aplica |
| payment_id | BigInt (FK) | Pago que lo cubre |
| amount_cents | Integer | Monto asignado en centavos |

**Tipo**: Tabla junction que implementa el patrón **FIFO** (First In, First Out) para asignar pagos a cargos.

> El patrón FIFO garantiza que los pagos se apliquen a los cargos en orden cronológico. Un pago puede cubrir múltiples cargos parcialmente, y un cargo puede ser cubierto por múltiples pagos.

---

### 2.8 Llamadas de Servicio

#### `service_call`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| session_id | BigInt (FK) | Sesión de mesa |
| table_id | BigInt (FK) | Mesa (denormalizado) |
| branch_id | BigInt (FK) | Sucursal (denormalizado) |
| status | String | `CREATED`, `ACKED`, `CLOSED` |
| is_active | Boolean | Soft delete flag |

**Relaciones**: N:1 con `table_session`, N:1 con `app_table`

---

### 2.9 Usuarios y Roles

#### `app_user`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| email | String (unique) | Email del usuario |
| hashed_password | String | Contraseña hasheada |
| first_name | String | Nombre |
| last_name | String | Apellido |
| is_active | Boolean | Soft delete flag |

**Relaciones**: M:N con `branch` (via `user_branch_role`)

> Se usa `app_user` como nombre de tabla porque `user` es palabra reservada en PostgreSQL.

---

#### `user_branch_role`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| user_id | BigInt (FK) | Usuario |
| branch_id | BigInt (FK) | Sucursal |
| role | String | `ADMIN`, `MANAGER`, `KITCHEN`, `WAITER` |

**Tipo**: Tabla junction M:N. Un usuario puede tener diferentes roles en diferentes sucursales.

---

#### `waiter_sector_assignment`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| user_id | BigInt (FK) | Mozo asignado |
| sector_id | BigInt (FK) | Sector asignado |
| date | Date | Fecha de la asignación (diaria) |

**Relaciones**: N:1 con `app_user`, N:1 con `branch_sector`

> Las asignaciones son diarias. Un mozo debe estar asignado para la fecha actual para poder operar en pwaWaiter.

---

### 2.10 Clientes y Fidelización

#### `customer`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| device_id | String | Identificador del dispositivo (Phase 1) |
| name | String (nullable) | Nombre (Phase 4: opt-in con GDPR) |
| email | String (nullable) | Email (Phase 4) |
| is_active | Boolean | Soft delete flag |

**Relaciones**: 1:N con `diner` (via `customer_id`)

> El sistema de fidelización tiene fases: Phase 1 (device tracking) → Phase 2 (preferencias implícitas) → Phase 4 (opt-in con consentimiento GDPR).

---

### 2.11 Promociones

#### `promotion`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| name | String | Nombre de la promoción |
| price | Integer | Precio en centavos |
| start_date | Date | Fecha de inicio |
| start_time | Time | Hora de inicio |
| end_date | Date | Fecha de fin |
| end_time | Time | Hora de fin |
| promotion_type_id | BigInt (FK) | Tipo de promoción |
| is_active | Boolean | Soft delete flag |

**Relaciones**: 1:N con `promotion_item`, M:N con `branch` (via `promotion_branch`)

---

#### `promotion_branch`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| promotion_id | BigInt (FK) | Promoción |
| branch_id | BigInt (FK) | Sucursal |

**Tipo**: Tabla junction M:N.

---

#### `promotion_item`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| promotion_id | BigInt (FK) | Promoción |
| product_id | BigInt (FK) | Producto incluido |

**Tipo**: Tabla junction M:N entre promoción y productos.

---

### 2.12 Recetas e Ingredientes

#### `recipe`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| name | String | Nombre de la receta |
| tenant_id | BigInt (FK) | Tenant propietario |
| is_active | Boolean | Soft delete flag |

---

#### `ingredient_group`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| name | String | Nombre del grupo (ej: "Lácteos", "Carnes") |
| tenant_id | BigInt (FK) | Tenant propietario |
| is_active | Boolean | Soft delete flag |

**Relaciones**: 1:N con `ingredient`

---

#### `ingredient`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| group_id | BigInt (FK) | Grupo de ingredientes |
| name | String | Nombre del ingrediente |
| is_active | Boolean | Soft delete flag |

**Relaciones**: N:1 con `ingredient_group`, 1:N con `sub_ingredient`

---

#### `sub_ingredient`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| ingredient_id | BigInt (FK) | Ingrediente padre |
| name | String | Nombre del sub-ingrediente |
| is_active | Boolean | Soft delete flag |

**Relaciones**: N:1 con `ingredient`

---

### 2.13 Infraestructura

#### `outbox_event`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| event_type | String | Tipo de evento (ej: CHECK_REQUESTED) |
| payload | JSON | Datos del evento |
| processed_at | DateTime (nullable) | Timestamp de procesamiento (null = pendiente) |
| created_at | DateTime | Timestamp de creación |

**Uso**: Implementa el patrón Transactional Outbox para entrega garantizada de eventos críticos.

---

#### `audit_log`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| entity_type | String | Tipo de entidad afectada |
| entity_id | BigInt | ID de la entidad |
| action | String | Acción realizada (CREATE, UPDATE, DELETE) |
| user_id | BigInt (FK) | Usuario que realizó la acción |
| created_at | DateTime | Timestamp |

---

#### `cart_item`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| id | BigInt (PK) | Identificador único |
| session_id | BigInt (FK) | Sesión de mesa |
| diner_id | BigInt (FK) | Comensal |
| product_id | BigInt (FK) | Producto |
| quantity | Integer | Cantidad |
| notes | String (nullable) | Notas especiales |

**Tipo**: Registro efímero. Se usa hard delete (no soft delete). Sincronizado via WebSocket entre dispositivos.

---

## 3. Convenciones del Modelo

### 3.1 AuditMixin

Todas las entidades (excepto las efímeras) heredan de `AuditMixin`, que provee:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| created_at | DateTime | Timestamp de creación (automático) |
| updated_at | DateTime | Timestamp de última modificación (automático) |
| is_active | Boolean (default True) | Flag de soft delete |
| deleted_at | DateTime (nullable) | Timestamp de eliminación |
| deleted_by_id | BigInt (nullable) | ID del usuario que eliminó |
| deleted_by_email | String (nullable) | Email del usuario que eliminó |

### 3.2 Nombres de tabla para palabras reservadas SQL

| Entidad lógica | Nombre de tabla | Razón |
|----------------|-----------------|-------|
| Tenant | `app_tenant` | `tenant` puede ser reservada en algunos RDBMS |
| User | `app_user` | `user` es reservada en PostgreSQL |
| Table | `app_table` | `table` es reservada en SQL |
| Check | `app_check` | `check` es reservada en SQL |

### 3.3 Identificadores

| Contexto | Tipo | Ejemplo |
|----------|------|---------|
| Backend (base de datos) | BigInteger autoincremental | `1`, `42`, `1337` |
| Frontend (generación) | UUID v4 | `crypto.randomUUID()` |
| Conversión frontend → backend | `parseInt(frontendId, 10)` | |
| Conversión backend → frontend | `String(backendId)` | |

### 3.4 Precios

Siempre enteros en centavos. Nunca float, nunca string.

```
$125.50 en la UI  <-->  12550 en la base de datos
```

### 3.5 Tipos SQLAlchemy

El proyecto usa **SQLAlchemy 2.0** con `Mapped` types:

```python
from sqlalchemy.orm import Mapped, mapped_column

class Product(Base):
    __tablename__ = "product"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    price: Mapped[int] = mapped_column(Integer)  # centavos
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
```

### 3.6 Comparación de booleanos

```python
# CORRECTO
.where(Model.is_active.is_(True))
.where(Model.featured.is_(False))

# INCORRECTO (genera warnings y comportamiento impredecible)
.where(Model.is_active == True)
```

---

## 4. Patrones de Acceso a Datos

### 4.1 Repositorios

```python
from rest_api.services.crud import TenantRepository, BranchRepository

# Repositorio tenant-scoped (filtra por tenant_id automáticamente)
product_repo = TenantRepository(Product, db)
products = product_repo.find_all(
    tenant_id=1,
    options=[selectinload(Product.allergens)]
)

# Repositorio branch-scoped (filtra por branch_id automáticamente)
table_repo = BranchRepository(Table, db)
tables = table_repo.find_all(branch_id=5)
```

### 4.2 Eager Loading (evitar N+1)

```python
from sqlalchemy.orm import selectinload, joinedload

rounds = db.execute(
    select(Round).options(
        selectinload(Round.items).joinedload(RoundItem.product)
    )
).scalars().unique().all()
```

### 4.3 Prevención de race conditions

```python
# Bloqueo pesimista para operaciones concurrentes
locked = db.scalar(
    select(Entity).where(...).with_for_update()
)
```

### 4.4 Safe commit

```python
from shared.infrastructure.db import safe_commit
safe_commit(db)  # Rollback automático en caso de error
```
