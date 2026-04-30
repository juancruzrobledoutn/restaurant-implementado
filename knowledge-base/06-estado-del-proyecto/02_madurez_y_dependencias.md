> Creado: 2026-04-04 | Actualizado: 2026-04-05 | Estado: vigente

# Madurez, Features Parciales y Dependencias

Analisis integral del estado de madurez de cada feature, detalle de las que aun no estan completas y mapa de dependencias entre componentes.

---

## Niveles de madurez

| Nivel | Significado |
|-------|-------------|
| **COMPLETA** | Modelo + API + Frontend + Tests + Docs. Feature lista para produccion. |
| **FUNCIONAL** | Feature operativa pero le faltan capas (tests, docs, i18n, o integracion parcial). |
| **PARCIAL** | Algunas capas implementadas, pero la feature no es utilizable end-to-end. |
| **SCAFFOLD** | Estructura basica creada (archivos, config, modelos), pero sin logica funcional. |
| **PLANIFICADA** | Solo documentacion o README. Sin codigo funcional. |

---

## Matriz de Madurez

### Core CRUD

| Feature | Modelo | API | Frontend | Tests | Docs | i18n | Madurez |
|---------|:------:|:---:|:--------:|:-----:|:----:|:----:|---------|
| Login / JWT Auth | SI | SI | SI | SI | SI | - | **COMPLETA** |
| Table Token Auth | SI | SI | SI | SI | SI | - | **COMPLETA** |
| Branch (Sucursal) | SI | SI | SI | SI | SI | - | **COMPLETA** |
| Category (Categoria) | SI | SI | SI | SI | SI | - | **COMPLETA** |
| Subcategory (Subcategoria) | SI | SI | SI | SI | SI | - | **COMPLETA** |
| Product (Producto) | SI | SI | SI | SI | SI | - | **COMPLETA** |
| Allergen (Alergeno) | SI | SI | SI | SI | SI | - | **COMPLETA** |
| Promotion (Promocion) | SI | SI | SI | SI | SI | - | **COMPLETA** |
| Table (Mesa) | SI | SI | SI | SI | SI | - | **COMPLETA** |
| Sector | SI | SI | SI | SI | SI | - | **COMPLETA** |
| Staff (Personal) | SI | SI | SI | SI | SI | - | **COMPLETA** |
| Role (Rol) | SI | SI | SI | SI | SI | - | **COMPLETA** |
| Restaurant Settings | SI | SI | SI | SI | SI | - | **COMPLETA** |

### Flujo de Pedidos

| Feature | Modelo | API | Frontend | Tests | Docs | i18n | Madurez |
|---------|:------:|:---:|:--------:|:-----:|:----:|:----:|---------|
| QR / Unirse a Mesa | SI | SI | SI | SI | SI | SI | **COMPLETA** |
| Carrito Compartido | SI | SI | SI | SI | SI | SI | **COMPLETA** |
| Customer Feedback | SI | SI | SI | NO | NO | PARCIAL | **FUNCIONAL** |
| Re-order from History | SI | SI | SI | NO | NO | PARCIAL | **FUNCIONAL** |
| Call Waiter from Product Detail | - | SI | SI | NO | NO | PARCIAL | **FUNCIONAL** |
| Confirmacion Grupal | SI | SI | SI | SI | SI | SI | **COMPLETA** |
| Round Submission (comensal) | SI | SI | SI | SI | SI | SI | **COMPLETA** |
| Round Confirmation (mozo) | SI | SI | SI | SI | SI | - | **COMPLETA** |
| Round to Kitchen | SI | SI | SI | SI | SI | - | **COMPLETA** |
| Kitchen Tickets | SI | SI | SI | SI | SI | - | **COMPLETA** |
| Service Calls (Llamadas) | SI | SI | SI | SI | SI | SI | **COMPLETA** |
| Comanda Rapida (mozo) | SI | SI | SI | SI | SI | - | **COMPLETA** |

### Facturacion

| Feature | Modelo | API | Frontend | Tests | Docs | i18n | Madurez |
|---------|:------:|:---:|:--------:|:-----:|:----:|:----:|---------|
| Solicitud de Cuenta (Check) | SI | SI | SI | SI | SI | SI | **COMPLETA** |
| Division de Cuenta (Bill Split) | SI | SI | SI | SI | SI | SI | **COMPLETA** |
| Mercado Pago | SI | SI | SI | SI | SI | - | **COMPLETA** |
| Pago Manual (efectivo/tarjeta) | SI | SI | SI | SI | SI | - | **COMPLETA** |
| Cierre de Mesa | SI | SI | SI | SI | SI | - | **COMPLETA** |

### Cocina y Operaciones

| Feature | Modelo | API | Frontend | Tests | Docs | i18n | Madurez |
|---------|:------:|:---:|:--------:|:-----:|:----:|:----:|---------|
| Kitchen Display | SI | SI | SI | NO | NO | NO | **FUNCIONAL** |
| Advanced KDS (timer per-item + pulse) | SI | SI | SI | SI | SI | - | **COMPLETA** |
| Kitchen Audio Alerts (Web Audio API) | - | - | SI | SI | SI | - | **COMPLETA** |
| Estadisticas / Reportes | SI | SI | SI | NO | NO | NO | **FUNCIONAL** |
| Per-Waiter Analytics | SI | SI | SI | NO | NO | NO | **FUNCIONAL** |
| Wait Time Estimator | SI | SI | SI | NO | NO | NO | **FUNCIONAL** |
| Disponibilidad de Producto | SI | SI | NO | NO | NO | NO | **PARCIAL** |
| Receipt Printing (kitchen + customer + daily) | SI | SI | SI | SI | SI | - | **COMPLETA** |
| Stock Validation on Round Submit | SI | SI | SI | SI | SI | - | **COMPLETA** |
| Item Void (migration 013) | SI | SI | SI | SI | SI | - | **COMPLETA** |
| Manager Overrides (model + service + audit + UI) | SI | SI | SI | SI | SI | - | **COMPLETA** |
| Waiter Shift Handoff | SI | SI | SI | SI | SI | - | **COMPLETA** |
| Table Transfer (move customers) | SI | SI | SI | SI | SI | - | **COMPLETA** |
| Ad-hoc Discounts | SI | SI | SI | SI | SI | - | **COMPLETA** |
| Comprehensive Audit Log (AuditService + page) | SI | SI | SI | SI | SI | - | **COMPLETA** |
| QR Codes per Table | SI | SI | SI | SI | SI | - | **COMPLETA** |

### Infraestructura

| Feature | Modelo | API | Frontend | Tests | Docs | i18n | Madurez |
|---------|:------:|:---:|:--------:|:-----:|:----:|:----:|---------|
| CI/CD (GitHub Actions) | - | - | - | SI | NO | - | **FUNCIONAL** |
| Alembic Migrations (001-014) | SI | - | - | NO | NO | - | **FUNCIONAL** |
| 2FA TOTP for Admin | SI | SI | SI | SI | SI | - | **COMPLETA** |
| Idle Timeout (25/30 min) | - | SI | SI | SI | SI | - | **COMPLETA** |
| GDPR Data Export / Anonymize | SI | SI | SI | SI | SI | - | **COMPLETA** |
| Email Service (SMTP no-op fallback) | - | SI | - | NO | NO | - | **FUNCIONAL** |
| Backup / Restore | - | SI | - | NO | NO | - | **FUNCIONAL** |
| Horizontal Scaling (WS Gateway) | - | SI | - | NO | SI | - | **FUNCIONAL** |
| E2E Tests (Playwright) | - | - | - | PARCIAL | NO | - | **SCAFFOLD** |
| Seed Data Modular | SI | - | - | NO | NO | - | **FUNCIONAL** |
| OpenAPI Codegen | - | SI | NO | NO | NO | - | **SCAFFOLD** |
| Dashboard i18n | - | - | PARCIAL | NO | NO | PARCIAL | **SCAFFOLD** |
| Shared WS Client | - | - | SI | NO | NO | - | **COMPLETA** |
| Shared UI Components | - | - | NO | NO | SI | - | **PLANIFICADA** |

### Features Nuevas

| Feature | Modelo | API | Frontend | Tests | Docs | i18n | Madurez |
|---------|:------:|:---:|:--------:|:-----:|:----:|:----:|---------|
| Push Notifications | PARCIAL | SI | PARCIAL | NO | NO | NO | **PARCIAL** |
| Light / Dark Mode | - | - | SI (3 frontends) | NO | NO | - | **COMPLETA** |
| Reservations | SI | NO | NO | NO | NO | NO | **SCAFFOLD** |
| Takeout / Delivery | SI | NO | NO | NO | SI | NO | **SCAFFOLD** |
| Payment Gateway Abstraction | SI | PARCIAL | - | NO | NO | - | **FUNCIONAL** |

### Real-time

| Feature | Modelo | API | Frontend | Tests | Docs | i18n | Madurez |
|---------|:------:|:---:|:--------:|:-----:|:----:|:----:|---------|
| Event Catch-up (reconexion) | SI | SI | PARCIAL | NO | NO | - | **FUNCIONAL** |
| WebSocket Gateway | SI | SI | SI | SI | SI | - | **COMPLETA** |

### Modulos de Negocio Nuevos

| Feature | Modelo | API | Frontend | Tests | Docs | i18n | Madurez |
|---------|:------:|:---:|:--------:|:-----:|:----:|:----:|---------|
| Inventory & Costs | SI | SI | SI | NO | NO | NO | **FUNCIONAL** |
| Cash Register (Cierre de Caja) | SI | SI | SI | NO | NO | NO | **FUNCIONAL** |
| Tips (Propinas) | SI | SI | SI | NO | NO | NO | **FUNCIONAL** |
| AFIP Fiscal (Facturacion) | SI | SI (STUB) | SI | NO | NO | NO | **PARCIAL** |
| Scheduling (Turnos) | SI | SI | SI | NO | NO | NO | **FUNCIONAL** |
| Customer CRM | SI | SI | SI | NO | NO | NO | **FUNCIONAL** |
| Floor Plan (Plan de Piso) | SI | SI | SI | NO | NO | NO | **FUNCIONAL** |
| Product Customizations | SI | SI | SI | NO | NO | NO | **FUNCIONAL** |
| Redis Menu Cache | - | SI | - | NO | NO | - | **FUNCIONAL** |

### Resumen

| Madurez | Cantidad | Porcentaje |
|---------|:--------:|:----------:|
| **COMPLETA** | 44 | 59% |
| **FUNCIONAL** | 21 | 28% |
| **PARCIAL** | 3 | 4% |
| **SCAFFOLD** | 5 | 7% |
| **PLANIFICADA** | 1 | 1% |
| **Total** | **75** | **100%** |

### Newly Completed (recent additions)

- Manager Overrides (model + service + endpoints + audit + UI)
- Item Void (migration 013 + service + Kitchen UI)
- Receipt Printing (kitchen ticket + customer receipt + daily report)
- GDPR Data Export (export + anonymize)
- Kitchen Audio Alerts (Web Audio API beep + visual flash)
- Comprehensive Audit Log (AuditService + Dashboard page)
- Waiter Shift Handoff
- Table Transfer (move customers between tables)
- Ad-hoc Discounts
- 2FA TOTP for Admin
- Idle Timeout (25 min warning / 30 min logout)
- Advanced KDS (per-item timer + pulse animation)
- Stock Validation on Round Submit
- QR Codes per Table

### Newly Functional

- Email Service (SMTP with no-op fallback)
- Per-Waiter Analytics
- Wait Time Estimator
- Customer Feedback
- Re-order from History
- Call Waiter from Product Detail

---

## Features Incompletas — Detalle

### FUNCIONAL (operativas pero incompletas)

#### 1. Kitchen Display

- **Que existe**: Modelo `KitchenTicket`, endpoints en kitchen router, `Dashboard/src/pages/Kitchen.tsx` con 3 columnas (En Espera / En Preparacion / Listos), colores de urgencia, botones de accion, timers auto-actualizados. Eventos WS completos.
- **Que falta**: Tests dedicados, i18n (texto hardcodeado en espanol), documentacion en knowledge-base.
- **Esfuerzo estimado**: 2-3 dias
- **Bloqueado por**: Nada

#### 2. Estadisticas / Reportes

- **Que existe**: `backend/rest_api/routers/admin/reports.py` (4 endpoints: pedidos por hora, revenue diario, ordenes, top productos, ticket promedio), `Dashboard/src/pages/Sales.tsx` con graficos funcionando.
- **Que falta**: Queries mas completos (por categoria, por mozo, por dia de semana), mas tipos de graficos, tests, documentacion.
- **Esfuerzo estimado**: 1-2 semanas (depende del alcance)
- **Bloqueado por**: Nada

#### 3. Disponibilidad de Producto

- **Que existe**: Campo `is_available` en `BranchProduct`, endpoint toggle en kitchen router, evento WS de cambio.
- **Que falta**: UI en Dashboard admin, pwaMenu no muestra badge "Agotado", tests, documentacion.
- **Esfuerzo estimado**: 3-4 dias
- **Bloqueado por**: Nada

#### 4. Light / Dark Mode — RESUELTO

- **Estado anterior**: Faltaban toggles en pwaMenu y pwaWaiter.
- **Resolucion**: Los 3 frontends ahora tienen toggle funcional (Dashboard en Sidebar, pwaMenu en menu hamburguesa, pwaWaiter en header bar). Todos persisten en localStorage. Promovido a COMPLETA.

#### 5. Payment Gateway Abstraction

- **Que existe**: ABC `PaymentGateway`, implementacion `MercadoPagoGateway`.
- **Que falta**: Billing router usa codigo inline de MP en vez de la abstraccion, segunda implementacion para validar, tests.
- **Esfuerzo estimado**: 3-5 dias
- **Bloqueado por**: Nada (refactor interno)

#### 6. Event Catch-up (reconexion)

- **Que existe**: Backend `catchup.py` (Redis sorted set), endpoint `/ws/catchup`, pwaWaiter auto-replay on reconnect.
- **Que falta**: Dashboard y pwaMenu no implementan catch-up, tests, documentacion.
- **Esfuerzo estimado**: 3-4 dias
- **Bloqueado por**: Nada

#### 7. CI/CD (GitHub Actions)

- **Que existe**: `ci.yml` (4 jobs paralelos: backend, Dashboard, pwaMenu, pwaWaiter), `docker-build.yml`.
- **Que falta**: Workflow de deployment (staging/produccion), coverage reports en PR, E2E tests en pipeline.
- **Esfuerzo estimado**: 3-5 dias
- **Bloqueado por**: Definicion de infraestructura de deploy

#### 8. Alembic Migrations

- **Que existe**: 14 migraciones encadenadas (001 → 014), configuracion funcional.
- **Que falta**: Migracion "initial schema" (schema base creado por `create_all()` antes de Alembic), tests de migracion (upgrade + downgrade).
- **Esfuerzo estimado**: 1-2 dias
- **Bloqueado por**: Nada (generar initial migration retroactivamente es delicado)

#### 9-14. Modulos de Negocio (Inventory, Cash Register, Tips, Scheduling, CRM, Floor Plan)

- **Que existe**: Modelos + APIs + paginas en Dashboard.
- **Que falta en todos**: Documentacion, i18n. (Tests: RESUELTO — cobertura basica agregada.)
- **Esfuerzo estimado**: 1-2 dias por modulo para docs + i18n.
- **Bloqueado por**: Nada

### PARCIAL (no end-to-end)

#### 15. Push Notifications

- **Que existe**: Backend endpoints subscribe/unsubscribe, `sw-push.js` en pwaWaiter, `pushNotifications.ts`, `VITE_VAPID_PUBLIC_KEY`.
- **Que falta**: Persistencia de subscripciones (actualmente in-memory dict), triggers WS no disparan push como fallback, integracion completa frontend-backend.
- **Esfuerzo estimado**: 1 semana
- **Bloqueado por**: Nada

#### 16. AFIP Fiscal (Facturacion Electronica)

- **Que existe**: Modelos FiscalPoint/FiscalInvoice/CreditNote, endpoints, Dashboard `Fiscal.tsx`, migracion 008.
- **Que falta**: Implementacion real de `_call_afip_wsfe()` (actualmente devuelve CAE simulado), certificados AFIP, libreria `pyafipws`.
- **Esfuerzo estimado**: 2-3 semanas (incluye certificacion AFIP)
- **Bloqueado por**: Certificados AFIP de produccion

### SCAFFOLD (estructura basica)

#### 17. E2E Tests (Playwright)

- **Que existe**: Config, 3 specs basicos (login, join-table, branch-select).
- **Que falta**: Flujos completos (pedido, pago, cocina), integracion CI, fixtures.
- **Esfuerzo estimado**: 2-3 semanas

#### 18. Dashboard i18n

- **Que existe**: Setup i18next, locales es/en parciales.
- **Que falta**: Adopcion en 34 paginas (mayoria con texto hardcodeado), portugues.
- **Esfuerzo estimado**: 1-2 semanas

#### 19. Shared WS Client — RESUELTO

- **Estado anterior**: Solo existia scaffold en `shared/websocket-client.ts`.
- **Resolucion**: `BaseWebSocketClient` implementado con 3 subclases especializadas. Los 3 frontends migrados al cliente compartido. Promovido a COMPLETA.

#### 20. Reservations (Reservas)

- **Que existe**: Modelo con 17 columnas + AuditMixin, migracion 003.
- **Que falta**: Router, Domain Service, frontend, tests, i18n.
- **Esfuerzo estimado**: 1-2 semanas

#### 21. Takeout / Delivery

- **Que existe**: Modelos DeliveryOrder + DeliveryOrderItem, migracion 004, documento de arquitectura.
- **Que falta**: Router, Domain Service, frontend, integracion Kitchen Display, tests, i18n.
- **Esfuerzo estimado**: 3-4 semanas

#### 22. OpenAPI Codegen

- **Que existe**: Script `scripts/generate-types.sh`.
- **Que falta**: Integracion CI, archivos generados no commiteados, frontends no importan tipos generados.
- **Esfuerzo estimado**: 2-3 dias

### PLANIFICADA

#### 23. Shared UI Components

- **Que existe**: README `shared/ui/README.md` con propuesta.
- **Que falta**: Todo (componentes, package.json, build config).
- **Esfuerzo estimado**: 2-3 semanas

---

## Mapa de Dependencias entre Features

### Autenticacion (base de todo)

```
JWT Auth
  ├─ depende de: Redis (blacklist de tokens), PostgreSQL (tabla users), bcrypt
  ├─ lo usan: TODOS los endpoints autenticados (Dashboard, pwaWaiter, Kitchen, Admin)
  ├─ refresh: Access token 15min, refresh token 7 dias (HttpOnly cookie)
  └─ si se rompe: TODO el sistema queda inaccesible excepto endpoints publicos

Table Token Auth (HMAC)
  ├─ depende de: Redis, TABLE_TOKEN_SECRET, branch_slug + table_code
  ├─ lo usan: pwaMenu (todas las operaciones de comensal), /ws/diner WebSocket
  ├─ duracion: 3 horas
  └─ si se rompe: Comensales no pueden pedir, ver carrito, ni recibir eventos
```

### Catalogo

```
Restaurant (Tenant)
  ├─ depende de: PostgreSQL (tabla app_tenant)
  ├─ lo usan: TODAS las entidades (todo tiene tenant_id)
  └─ si se borra: Cascada total

Branch (Sucursal)
  ├─ depende de: Tenant
  ├─ lo usan: Category, Table, Sector, BranchProduct, TableSession, Staff assignments
  └─ si se borra: Todo el contenido de la sucursal se desactiva (soft delete cascade)

Category → Subcategory → Product
  ├─ depende de: Branch (Category.branch_id)
  ├─ lo usan: Public Menu, Round Submission (price snapshot), Kitchen Display
  └─ si se borra Category: cascade soft delete desactiva subcategorias y productos

BranchProduct (precios por sucursal)
  ├─ depende de: Product, Branch
  ├─ lo usan: Public Menu (precio visible), Round (snapshot de precio), Billing
  ├─ campos clave: price_cents, is_available, is_active
  └─ si cambio precios: Pedidos historicos NO se afectan (snapshot en round_item)
```

### Flujo de Pedidos

```
Table Session (Sesion de Mesa)
  ├─ depende de: Table, Branch, Sector
  ├─ lo usan: Round Submission, Billing, Service Calls, Diner Registration
  ├─ estados: OPEN → PAYING → CLOSED
  └─ si se rompe: NADIE puede pedir — es el corazon del flujo

Shared Cart (Carrito Compartido)
  ├─ depende de: TableSession (OPEN), Diner, Product Catalog
  ├─ lo usan: Round Submission (consolida items de todos los comensales)
  └─ si se rompe: Comensales pueden pedir pero no ven items de otros

Round Submission (Envio de Ronda)
  ├─ depende de: TableSession (OPEN, no PAYING), Product Catalog, Diner, Cart
  ├─ lo usan: Kitchen Display, Statistics, Billing
  ├─ snapshot: product_name y unit_price_cents se copian al round_item
  └─ si se rompe: Los pedidos no llegan a cocina

Kitchen Display
  ├─ depende de: Round status flow, KitchenTicket, WebSocket events
  ├─ ve solo: Rounds con status >= SUBMITTED
  └─ si se rompe: Cocina no ve pedidos (fallback: lista manual via API)
```

### Facturacion

```
Check / Billing (Cuenta)
  ├─ depende de: TableSession, Round (para calcular total), Payment model
  ├─ outbox: CHECK_REQUESTED, CHECK_PAID usan outbox pattern
  ├─ FIFO: Charges → Allocations ← Payments
  └─ si se rompe: No se puede cobrar — bloquea cierre de mesas

Mercado Pago
  ├─ depende de: Check model, PaymentGateway ABC, webhook endpoint
  └─ si MP cae: Manual payment como fallback

Table Close (Cierre de Mesa)
  ├─ depende de: Check (debe estar pagado), TableSession, Waiter auth
  └─ si se rompe: Mesas quedan "ocupadas" indefinidamente
```

### Infraestructura

```
WebSocket Gateway
  ├─ depende de: Redis (pub/sub + streams), JWT/TableToken auth
  ├─ lo usan: TODAS las features real-time
  └─ si se rompe: Sistema funciona pero SIN real-time

Redis
  ├─ lo usan: JWT blacklist, WS pub/sub, event catch-up, rate limiting, outbox
  └─ si se rompe: Real-time muere, auth degrada, rate limiting se desactiva

PostgreSQL
  ├─ lo usan: TODAS las features (unica fuente de verdad)
  └─ si se rompe: TODO el sistema cae (sin fallback)

Alembic Migrations
  ├─ cadena: 001 → 002 → 003 → 004 → 005 → 006 → 007 → 008 → 009 → 010 → 011 → 012 → 013 → 014
  └─ si se rompe: Schema desincronizado — requiere intervencion manual
```

### Diagrama de Impacto

```
PostgreSQL ──────────────────────────── CRITICO (todo depende de esto)
    │
Redis ───────────────────────────────── ALTO (real-time + auth + rate limiting)
    │
JWT Auth ────────────────────────────── ALTO (Dashboard + pwaWaiter + Kitchen)
Table Token Auth ────────────────────── ALTO (pwaMenu completo)
    │
WebSocket Gateway ───────────────────── MEDIO (real-time, no afecta CRUD)
    │
TableSession ────────────────────────── ALTO (flujo de pedidos completo)
    │
├── Round Submission ─────────────────── ALTO (pedidos)
│   ├── Kitchen Display ──────────────── MEDIO (visibilidad cocina)
│   └── Billing ──────────────────────── ALTO (cobros)
│       ├── Mercado Pago ─────────────── MEDIO (fallback: pago manual)
│       └── Table Close ──────────────── MEDIO (mesas quedan abiertas)
│
├── Shared Cart ──────────────────────── MEDIO (sync entre comensales)
└── Service Calls ────────────────────── BAJO (conveniencia, no bloquea pedidos)
```

---

## Priorizacion Recomendada

| Prioridad | Features | Esfuerzo |
|-----------|----------|----------|
| Quick wins (< 3 dias) | Tests para modulos nuevos, documentacion de features recientes | ~4 dias |
| Mediano (1-2 semanas) | Kitchen tests, Event catch-up, Reservations, CI deploy, tests modulos nuevos | ~6 semanas |
| Grande (2+ semanas) | E2E Tests, Dashboard i18n, Takeout/Delivery, Shared UI, AFIP produccion | ~12 semanas |
