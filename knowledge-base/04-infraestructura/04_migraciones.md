# 04. Cadena de Migraciones Alembic

> Creado: 2026-04-04 | Actualizado: 2026-04-05 | Estado: vigente

Documentacion completa de la cadena de migraciones de base de datos del sistema Integrador.

---

## Estado Actual

```
Migraciones totales: 12
Ultima migracion: 012_customizations
Directorio: backend/alembic/versions/
```

---

## Cadena Completa

```
(sin migracion inicial) ← Schema base creado por SQLAlchemy create_all()
         │
         ▼
001_product_name (down_revision: None)
         │
         ▼
002_is_available (down_revision: 001_product_name)
         │
         ▼
003_reservation (down_revision: 002_is_available)
         │
         ▼
004_delivery (down_revision: 003_reservation)
         │
         ▼
005_inventory (down_revision: 004_delivery)
         │
         ▼
006_cash_register (down_revision: 005_inventory)
         │
         ▼
007_tips (down_revision: 006_cash_register)
         │
         ▼
008_fiscal (down_revision: 007_tips)
         │
         ▼
009_scheduling (down_revision: 008_fiscal)
         │
         ▼
010_crm (down_revision: 009_scheduling)
         │
         ▼
011_floor_plan (down_revision: 010_crm)
         │
         ▼
012_customizations (down_revision: 011_floor_plan)  ← HEAD actual
```

---

## Detalle de Cada Migracion

### 001_product_name

- **Archivo**: `backend/alembic/versions/001_add_product_name_to_round_item.py`
- **Revision ID**: `001_product_name`
- **Down revision**: `None` (primera migracion)
- **Operacion**: `ALTER TABLE round_item ADD COLUMN product_name TEXT NULL`
- **Proposito**: Snapshot del nombre del producto al momento del pedido. Si el producto cambia de nombre despues, los pedidos historicos mantienen el nombre original.
- **Tabla afectada**: `round_item`
- **Columna nueva**: `product_name` (Text, nullable)
- **Riesgo**: Ninguno. Campo nullable, registros existentes quedan con `NULL`.
- **Rollback**: `DROP COLUMN product_name` de `round_item`

### 002_is_available

- **Archivo**: `backend/alembic/versions/002_add_is_available_to_branch_product.py`
- **Revision ID**: `002_is_available`
- **Down revision**: `001_product_name`
- **Operaciones**:
  - `ALTER TABLE branch_product ADD COLUMN is_available BOOLEAN NOT NULL DEFAULT true`
  - `CREATE INDEX ix_branch_product_is_available ON branch_product (is_available)`
- **Proposito**: Permite a la cocina marcar productos como temporalmente no disponibles (ej. "se acabo el salmon"). Es diferente de `is_active` (decision administrativa permanente).
- **Tabla afectada**: `branch_product`
- **Columna nueva**: `is_available` (Boolean, default `true`, NOT NULL, indexada)
- **Riesgo**: Ninguno. Default `true` no cambia el comportamiento existente.
- **Rollback**: `DROP INDEX ix_branch_product_is_available`, `DROP COLUMN is_available`
- **Nota importante**: `is_available = false` → producto temporalmente agotado (cocina). `is_active = false` → producto eliminado del menu (admin, soft delete).

### 003_reservation

- **Archivo**: `backend/alembic/versions/003_create_reservation_table.py`
- **Revision ID**: `003_reservation`
- **Down revision**: `002_is_available`
- **Operacion**: `CREATE TABLE reservation` con 17 columnas + AuditMixin + 5 indices
- **Proposito**: Sistema de reservas de mesas para implementacion futura.
- **Tabla nueva**: `reservation`
- **Columnas**:
  - `id` (BigInteger, PK, autoincrement)
  - `tenant_id` (BigInteger, FK → app_tenant.id, NOT NULL)
  - `branch_id` (BigInteger, FK → branch.id, NOT NULL)
  - `customer_name` (Text, NOT NULL)
  - `customer_phone` (Text, nullable)
  - `customer_email` (Text, nullable)
  - `party_size` (Integer, NOT NULL)
  - `reservation_date` (Date, NOT NULL)
  - `reservation_time` (Time, NOT NULL)
  - `duration_minutes` (Integer, default 90, NOT NULL)
  - `table_id` (BigInteger, FK → app_table.id, nullable)
  - `status` (Text, default 'PENDING', NOT NULL)
  - `notes` (Text, nullable)
  - AuditMixin: `is_active`, `created_at`, `updated_at`, `deleted_at`, `created_by_id`, `created_by_email`, `updated_by_id`, `updated_by_email`, `deleted_by_id`, `deleted_by_email`
- **Indices**: `ix_reservation_branch_date`, `ix_reservation_tenant`, `ix_reservation_date`, `ix_reservation_status`, `ix_reservation_is_active`
- **Estados posibles**: PENDING, CONFIRMED, SEATED, COMPLETED, CANCELED, NO_SHOW
- **Riesgo**: Ninguno. Tabla nueva sin FK obligatorias activas.
- **Estado de implementacion**: Modelo existe (`backend/rest_api/models/reservation.py`), API y frontend pendientes.
- **Rollback**: `DROP TABLE reservation` (con indices)

### 004_delivery

- **Archivo**: `backend/alembic/versions/004_create_delivery_tables.py`
- **Revision ID**: `004_delivery`
- **Down revision**: `003_reservation`
- **Operacion**: `CREATE TABLE delivery_order` + `CREATE TABLE delivery_order_item`
- **Proposito**: Soporte para pedidos takeout (para llevar) y delivery (a domicilio), sin mesa fisica.
- **Tablas nuevas**:

**delivery_order** (20 columnas + AuditMixin):
  - `id` (BigInteger, PK, autoincrement)
  - `tenant_id` (BigInteger, FK → app_tenant.id, NOT NULL)
  - `branch_id` (BigInteger, FK → branch.id, NOT NULL)
  - `order_type` (Text, NOT NULL — valores: TAKEOUT, DELIVERY)
  - `customer_name` (Text, NOT NULL)
  - `customer_phone` (Text, NOT NULL)
  - `customer_email` (Text, nullable)
  - `delivery_address` (Text, nullable — solo para DELIVERY)
  - `delivery_instructions` (Text, nullable)
  - `delivery_lat` (Float, nullable)
  - `delivery_lng` (Float, nullable)
  - `estimated_ready_at` (DateTime TZ, nullable)
  - `estimated_delivery_at` (DateTime TZ, nullable)
  - `status` (Text, default 'RECEIVED', NOT NULL)
  - `total_cents` (Integer, default 0, NOT NULL)
  - `payment_method` (Text, nullable)
  - `is_paid` (Boolean, default false, NOT NULL)
  - `notes` (Text, nullable)
  - AuditMixin (10 columnas)

**delivery_order_item** (10 columnas + AuditMixin):
  - `id` (BigInteger, PK, autoincrement)
  - `tenant_id` (BigInteger, FK → app_tenant.id, NOT NULL)
  - `order_id` (BigInteger, FK → delivery_order.id, NOT NULL)
  - `product_id` (BigInteger, FK → product.id, NOT NULL)
  - `qty` (Integer, NOT NULL)
  - `unit_price_cents` (Integer, NOT NULL)
  - `product_name` (Text, nullable — snapshot)
  - `notes` (Text, nullable)
  - AuditMixin (10 columnas)

- **Indices**: `ix_delivery_order_tenant`, `ix_delivery_order_branch`, `ix_delivery_order_status`, `ix_delivery_order_branch_status`, `ix_delivery_order_is_active`, `ix_delivery_order_item_order`, `ix_delivery_order_item_is_active`
- **Estados posibles**: RECEIVED → PREPARING → READY → OUT_FOR_DELIVERY → DELIVERED | PICKED_UP | CANCELED
- **Riesgo**: Ninguno. Tablas nuevas.
- **Estado de implementacion**: Modelos existen (`backend/rest_api/models/delivery.py`), API y frontend pendientes.
- **Rollback**: `DROP TABLE delivery_order_item`, `DROP TABLE delivery_order` (en ese orden por FK)

### 005_inventory

- **Archivo**: `backend/alembic/versions/005_create_inventory_tables.py`
- **Revision ID**: `005_inventory`
- **Down revision**: `004_delivery`
- **Operacion**: Crea 8 tablas para el modulo de inventario y costos
- **Proposito**: Gestion de stock, proveedores, ordenes de compra, registro de desperdicios y costos de recetas.
- **Tablas nuevas** (8):
  - `stock_item` — Items de stock con cantidad actual, minima, unidad de medida
  - `stock_movement` — Movimientos de stock (entrada, salida, ajuste, desperdicio)
  - `stock_alert` — Alertas de stock bajo o agotado
  - `supplier` — Proveedores con datos de contacto
  - `purchase_order` — Ordenes de compra a proveedores
  - `purchase_order_item` — Items individuales de cada orden de compra
  - `waste_log` — Registro de desperdicios con motivo y costo
  - `recipe_cost` — Costos calculados de recetas basados en ingredientes
- **Modelo**: `backend/rest_api/models/inventory.py`
- **Servicio**: `inventory_service.py` con `deduct_for_round()` (auto-deduccion al confirmar pedido), `calculate_recipe_cost()`, `get_food_cost_report()`
- **Dashboard**: `Inventory.tsx` + `Suppliers.tsx`
- **Riesgo**: Ninguno. Tablas nuevas.
- **Rollback**: Drop de las 8 tablas en orden inverso de dependencias

### 006_cash_register

- **Archivo**: `backend/alembic/versions/006_create_cash_register_tables.py`
- **Revision ID**: `006_cash_register`
- **Down revision**: `005_inventory`
- **Operacion**: Crea 3 tablas para el modulo de cierre de caja
- **Proposito**: Apertura/cierre de caja con conteo de efectivo, registro de movimientos y calculo de diferencias.
- **Tablas nuevas** (3):
  - `cash_register` — Cajas registradoras por sucursal
  - `cash_session` — Sesiones de caja (apertura → cierre con monto esperado vs real)
  - `cash_movement` — Movimientos individuales (ingresos, egresos, retiros)
- **Modelo**: `backend/rest_api/models/cash_register.py`
- **Dashboard**: `CashRegister.tsx`
- **Riesgo**: Ninguno. Tablas nuevas.
- **Rollback**: Drop de las 3 tablas en orden inverso de dependencias

### 007_tips

- **Archivo**: `backend/alembic/versions/007_create_tip_tables.py`
- **Revision ID**: `007_tips`
- **Down revision**: `006_cash_register`
- **Operacion**: Crea 3 tablas para el modulo de propinas
- **Proposito**: Registro de propinas, distribucion entre staff y configuracion de pools de distribucion.
- **Tablas nuevas** (3):
  - `tip` — Propinas individuales asociadas a pagos
  - `tip_distribution` — Distribucion de cada propina entre empleados
  - `tip_pool` — Pools configurables de distribucion (% mozo, % cocina, % otros)
- **Modelo**: `backend/rest_api/models/tip.py`
- **Dashboard**: `Tips.tsx` con 4 tabs (propinas, distribucion, pools, reportes)
- **Riesgo**: Ninguno. Tablas nuevas.
- **Rollback**: Drop de las 3 tablas en orden inverso de dependencias

### 008_fiscal

- **Archivo**: `backend/alembic/versions/008_create_fiscal_tables.py`
- **Revision ID**: `008_fiscal`
- **Down revision**: `007_tips`
- **Operacion**: Crea 3 tablas para el modulo de facturacion electronica AFIP
- **Proposito**: Puntos de venta fiscal, facturas electronicas (tipos A/B/C) con CAE, notas de credito y calculo de IVA.
- **Tablas nuevas** (3):
  - `fiscal_point` — Puntos de venta fiscal por sucursal
  - `fiscal_invoice` — Facturas electronicas con tipo, CAE, montos e IVA
  - `credit_note` — Notas de credito asociadas a facturas
- **Modelo**: `backend/rest_api/models/fiscal.py`
- **Dashboard**: `Fiscal.tsx`
- **Nota**: La funcion `_call_afip_wsfe()` es un **STUB** que retorna CAE simulado. Requiere `pyafipws` + certificados AFIP para produccion.
- **Riesgo**: Ninguno. Tablas nuevas.
- **Rollback**: Drop de las 3 tablas en orden inverso de dependencias

### 009_scheduling

- **Archivo**: `backend/alembic/versions/009_create_scheduling_tables.py`
- **Revision ID**: `009_scheduling`
- **Down revision**: `008_fiscal`
- **Operacion**: Crea 4 tablas para el modulo de turnos y horarios
- **Proposito**: Gestion de turnos del personal, templates de horarios, generacion automatica de turnos y registro de asistencia.
- **Tablas nuevas** (4):
  - `shift` — Turnos individuales asignados a empleados
  - `shift_template` — Templates de turnos (ej: "Turno Manana", "Turno Noche")
  - `shift_template_item` — Items de cada template (dia, hora inicio/fin)
  - `attendance_log` — Registro de clock-in/out con calculo de horas extra (>8h)
- **Modelo**: `backend/rest_api/models/scheduling.py`
- **Dashboard**: `Scheduling.tsx` con grilla semanal
- **Riesgo**: Ninguno. Tablas nuevas.
- **Rollback**: Drop de las 4 tablas en orden inverso de dependencias

### 010_crm

- **Archivo**: `backend/alembic/versions/010_create_crm_tables.py`
- **Revision ID**: `010_crm`
- **Down revision**: `009_scheduling`
- **Operacion**: Crea 4 tablas para el modulo de CRM y fidelizacion
- **Proposito**: Perfiles de clientes, registro de visitas, sistema de puntos de lealtad con tiers y reglas configurables.
- **Tablas nuevas** (4):
  - `customer_profile` — Perfiles de clientes con tier de lealtad y consentimiento GDPR
  - `customer_visit` — Registro de visitas con monto gastado
  - `loyalty_transaction` — Transacciones de puntos (earn/redeem)
  - `loyalty_rule` — Reglas configurables de earning/redemption por tenant
- **Modelo**: `backend/rest_api/models/crm.py`
- **Tiers de lealtad**: BRONZE → SILVER → GOLD → PLATINUM
- **Dashboard**: `CRM.tsx` con busqueda de clientes + badges de tier
- **Riesgo**: Ninguno. Tablas nuevas.
- **Rollback**: Drop de las 4 tablas en orden inverso de dependencias

### 011_floor_plan

- **Archivo**: `backend/alembic/versions/011_create_floor_plan_tables.py`
- **Revision ID**: `011_floor_plan`
- **Down revision**: `010_crm`
- **Operacion**: Crea 2 tablas para el modulo de plan de piso visual
- **Proposito**: Layout visual de mesas con posicionamiento drag-and-drop, colores de estado en tiempo real y generacion automatica de grilla.
- **Tablas nuevas** (2):
  - `floor_plan` — Planes de piso por sucursal (nombre, dimensiones)
  - `floor_plan_table` — Posicion de cada mesa en el plano (x, y, forma, rotacion)
- **Modelo**: `backend/rest_api/models/floor_plan.py`
- **Dashboard**: `FloorPlan.tsx`
- **Riesgo**: Ninguno. Tablas nuevas.
- **Rollback**: Drop de las 2 tablas en orden inverso de dependencias

### 012_customizations

- **Archivo**: `backend/alembic/versions/012_create_customization_tables.py`
- **Revision ID**: `012_customizations`
- **Down revision**: `011_floor_plan`
- **Operacion**: Crea 2 tablas para personalizaciones de producto
- **Proposito**: Opciones de personalizacion (exclusiones de ingredientes) a nivel tenant, con vinculacion M:N a productos.
- **Tablas nuevas** (2):
  - `product_exclusion` — Opciones de personalizacion/exclusion por tenant (ej: "Sin cebolla", "Sin gluten")
  - `product_exclusion_link` — Relacion M:N entre productos y opciones de exclusion
- **Riesgo**: Ninguno. Tablas nuevas.
- **Rollback**: Drop de las 2 tablas en orden inverso de dependencias

---

## Comandos de Operacion

### Aplicar todas las migraciones pendientes

```bash
cd backend && alembic upgrade head
```

### Rollback una migracion

```bash
cd backend && alembic downgrade -1
```

### Rollback a una revision especifica

```bash
cd backend && alembic downgrade 002_is_available
```

### Ver migracion actual

```bash
cd backend && alembic current
```

### Ver historial completo

```bash
cd backend && alembic history --verbose
```

### Generar nueva migracion

```bash
cd backend && alembic revision -m "descripcion_del_cambio"
```

### Generar migracion automatica (a partir de cambios en modelos)

```bash
cd backend && alembic revision --autogenerate -m "descripcion_del_cambio"
```

---

## Nota Critica: Sin Migracion Inicial

**No existe una migracion "initial schema".** El schema base del sistema (todas las tablas core: `app_tenant`, `branch`, `category`, `subcategory`, `product`, `branch_product`, `app_table`, `branch_sector`, `table_session`, `diner`, `round`, `round_item`, `kitchen_ticket`, `app_check`, `charge`, `allocation`, `payment`, `service_call`, `user`, `user_branch_role`, `product_allergen`, `customer`, etc.) fue creado por `SQLAlchemy Base.metadata.create_all()` ANTES de que se configurara Alembic.

### Implicaciones

1. **En un entorno existente** (donde el schema base ya existe): Solo ejecutar `alembic upgrade head` para aplicar las 11 migraciones incrementales.

2. **En un entorno nuevo desde cero**: Se necesita este flujo:
   ```bash
   # 1. Crear schema base con SQLAlchemy
   cd backend && python -c "from shared.infrastructure.db import engine; from rest_api.models import Base; Base.metadata.create_all(engine)"

   # 2. Marcar que el schema ya esta en la revision actual (sin ejecutar migraciones)
   cd backend && alembic stamp head

   # 3. Futuras migraciones funcionan normalmente
   cd backend && alembic upgrade head  # (no-op si ya esta en head)
   ```

3. **Con Docker Compose**: El seed script (`devOps/seed/`) se encarga de crear el schema y datos iniciales. Despues se ejecuta `alembic upgrade head`.

### Riesgo de la Falta de Migracion Inicial

- Si alguien ejecuta `alembic upgrade head` en una base vacia, la migracion 001 fallara con `relation "round_item" does not exist`.
- La solucion correcta es documentar (como se hace aqui) que `create_all()` debe ejecutarse primero.
- Una alternativa futura seria generar una migracion initial con `alembic revision --autogenerate`, pero es complejo retroactivamente con 30+ tablas ya existentes.

---

## Convencion de Naming

| Elemento | Formato | Ejemplo |
|----------|---------|---------|
| Revision ID | `NNN_nombre_corto` | `001_product_name` |
| Archivo | `NNN_descripcion_larga.py` | `001_add_product_name_to_round_item.py` |
| Numeracion | Secuencial, 3 digitos | 001, 002, ..., 011 |
| Siguiente | `013_*` | (la proxima migracion) |

---

## Resumen de Tablas por Migracion

| Migracion | Tablas Afectadas | Tipo de Cambio |
|-----------|-----------------|----------------|
| 001 | `round_item` | ALTER (add column) |
| 002 | `branch_product` | ALTER (add column + index) |
| 003 | `reservation` (1 tabla) | CREATE |
| 004 | `delivery_order`, `delivery_order_item` (2 tablas) | CREATE |
| 005 | 8 tablas de inventario | CREATE |
| 006 | 3 tablas de caja | CREATE |
| 007 | 3 tablas de propinas | CREATE |
| 008 | 3 tablas fiscales | CREATE |
| 009 | 4 tablas de turnos | CREATE |
| 010 | 4 tablas de CRM | CREATE |
| 011 | 2 tablas de floor plan | CREATE |
| 012 | 2 tablas de customizations | CREATE |
| **Total** | **32 tablas nuevas + 2 ALTER** | |
