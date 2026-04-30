# CHANGES — Secuencia de Implementación

> Índice canónico de todos los changes del proyecto Integrador / Buen Sabor.
> Cada change es atómico: un agente puede implementarlo en una sesión (~4-6 horas).
> **Leer este archivo antes de ejecutar cualquier `/opsx:propose`.**

---

## Cómo usar este documento

1. Identificar el change a implementar (verificar que sus dependencias están en `openspec/changes/archive/`)
2. Leer los docs de la knowledge-base indicados en "Leer antes"
3. Ejecutar `/opsx:propose <nombre-del-change>`
4. Al terminar el change, archivarlo con `/opsx:archive <nombre-del-change>`
5. Marcar el checkbox `[x]` en este archivo

---

## Árbol de dependencias

```
C-01 foundation-setup
  └── C-02 core-models
        └── C-03 auth                          ← desbloquea TODO lo demás
              │
              ├── C-04 menu-catalog
              │     ├── C-05 allergens
              │     └── C-07 sectors-tables
              │           └── C-08 table-sessions
              │                 ├── C-09 ws-gateway-base
              │                 │     └── C-10 rounds
              │                 │           ├── C-11 kitchen
              │                 │           │     └── C-12 billing
              │                 │           │
              │                 │           │  ┌── (necesita C-10+C-11+C-12)
              │                 │           │  │
              │                 ├── C-13 staff-management  ← solo necesita C-08
              │                 │
              │                 └── C-17 pwaMenu-shell     ← necesita C-08 + C-04
              │                       └── C-18 pwaMenu-ordering  ← + C-10
              │                             └── C-19 pwaMenu-billing  ← + C-12
              │
              ├── C-06 ingredients             ← paralelo con C-04
              │
              ├── C-14 dashboard-shell         ← solo necesita C-03
              │     └── C-15 dashboard-menu    ← + C-04 + C-05 + C-06
              │           └── C-16 dashboard-ops ← + C-10 + C-11 + C-12 + C-13
              │                 └── C-29 dashboard-branch-selector
              │                       ├── C-30 dashboard-home
              │                       ├── C-25 dashboard-orders      ← + C-10 + C-11
              │                       ├── C-26 dashboard-billing     ← + C-12
              │                       ├── C-27 dashboard-promotions  ← + C-13
              │                       └── C-28 dashboard-settings

C-31 demo-seed-rich                           ← necesita C-16 (seed de toda la operación)
              │
              └── C-20 pwaWaiter-shell         ← necesita C-13 + C-07
                    └── C-21 pwaWaiter-ops     ← + C-10 + C-11 + C-12

C-24 code-review-fixes-pwa-apps               ← necesita C-18 + C-21
C-22 e2e-critical-flow                        ← necesita C-16 + C-19 + C-21 + C-24
  └── C-23 monitoring-production
```

### Paralelismo por fase

> Cada "gate" es un punto de sincronización. Los changes dentro de un grupo pueden ejecutarse en paralelo.

```
GATE 0: ninguna
  → C-01 (solo)

GATE 1: C-01 ✓
  → C-02 (solo)

GATE 2: C-02 ✓
  → C-03 (solo)

GATE 3: C-03 ✓                     ← PRIMER FORK (3 paralelos)
  → C-04 menu-catalog              [Agente A]
  → C-06 ingredients               [Agente B]
  → C-14 dashboard-shell           [Agente C]

GATE 4: C-04 ✓
  → C-05 allergens                 [Agente B — si terminó C-06]
  → C-07 sectors-tables            [Agente A]

GATE 5: C-07 ✓
  → C-08 table-sessions            [Agente A]

GATE 6: C-08 ✓                     ← SEGUNDO FORK (3 paralelos)
  → C-09 ws-gateway-base           [Agente A]
  → C-13 staff-management          [Agente B]
  → C-17 pwaMenu-shell             [Agente C — si C-04 ✓]

GATE 7: C-09 ✓
  → C-10 rounds                    [Agente A]

GATE 8: C-13 + C-07 ✓
  → C-20 pwaWaiter-shell           [Agente B]

GATE 9: C-10 ✓
  → C-11 kitchen                   [Agente A]
  → C-18 pwaMenu-ordering          [Agente C — si C-17 ✓]

GATE 10: C-11 ✓
  → C-12 billing                   [Agente A]

GATE 11: C-14 + C-04 + C-05 + C-06 ✓
  → C-15 dashboard-menu            [Agente C — cuando quede libre]

GATE 12: C-12 ✓
  → C-19 pwaMenu-billing           [si C-18 ✓]
  → C-21 pwaWaiter-ops             [si C-20 + C-10 + C-11 ✓]
  → C-16 dashboard-ops             [si C-15 + C-13 ✓]

GATE 12.5: C-18 + C-21 ✓            ← fixes descubiertos post-apply/smoke
  → C-24 code-review-fixes-pwa-apps [paralelo con C-16/C-19]

GATE 13: C-16 + C-19 + C-21 + C-24 ✓
  → C-22 e2e-critical-flow

GATE 14: C-22 ✓
  → C-23 monitoring-production

GATE 15: C-16 ✓
  → C-29 dashboard-branch-selector   [prerequisito para todo el FORK siguiente]
  → C-31 demo-seed-rich              [paralelo — tooling, no bloquea nada]

GATE 16: C-29 ✓                     ← TERCER FORK (5 paralelos)
  → C-30 dashboard-home        [Agente A]
  → C-25 dashboard-orders      [Agente B]
  → C-26 dashboard-billing     [Agente C — si C-12 ✓]
  → C-27 dashboard-promotions  [Agente D — si C-13 ✓]
  → C-28 dashboard-settings    [Agente E — si C-03 ✓]
```

### Camino crítico (13 changes — mínimo irreducible)

```
C-01 → C-02 → C-03 → C-04 → C-07 → C-08 → C-09 → C-10 → C-11 → C-12 → C-19* → C-22 → C-23
                                                                              │
                                                               * o C-16 o C-21 (depende de
                                                                 cuál termina último)
```

### Plan óptimo con 3 agentes

```
Paso │ Agente A (Backend Core)  │ Agente B (Backend Aux)  │ Agente C (Frontend)
─────┼──────────────────────────┼─────────────────────────┼─────────────────────────
  1  │ C-01 foundation-setup    │         —               │         —
  2  │ C-02 core-models         │         —               │         —
  3  │ C-03 auth                │         —               │         —
  4  │ C-04 menu-catalog        │ C-06 ingredients        │ C-14 dashboard-shell
  5  │ C-07 sectors-tables      │ C-05 allergens          │         —
  6  │ C-08 table-sessions      │         —               │         —
  7  │ C-09 ws-gateway-base     │ C-13 staff-management   │ C-17 pwaMenu-shell
  8  │ C-10 rounds              │ C-20 pwaWaiter-shell    │         —
  9  │ C-11 kitchen             │         —               │ C-15 dashboard-menu
 10  │ C-12 billing             │         —               │ C-18 pwaMenu-ordering
 11  │         —                │ C-21 pwaWaiter-ops      │ C-19 pwaMenu-billing
 12  │         —                │ C-24 code-review-fixes  │ C-16 dashboard-ops
 13  │ C-22 e2e-critical-flow   │         —               │         —
 14  │ C-23 monitoring-prod     │         —               │         —
```

---

## FASE 0 — Cimientos

### [C-01] `foundation-setup`
- **Estado**: `[x]` completado y archivado
- **Scope**: Scaffolding completo del monorepo + infraestructura base
  - Estructura de directorios: `backend/`, `ws_gateway/`, `Dashboard/`, `pwaMenu/`, `pwaWaiter/`, `devOps/`, `e2e/`, `shared/`
  - `devOps/docker-compose.yml` operativo (PostgreSQL 16, Redis 7, pgAdmin)
  - `backend/`: FastAPI app mínima con health check `/api/health`, Alembic inicializado (sin migraciones aún), `shared/` con settings, logger, db, exceptions
  - Frontends: Vite + React 19 + TypeScript scaffolding en los 3 proyectos, Zustand instalado, Tailwind 4.1
  - `devOps/backup/` operativo, `.env.example` en cada sub-proyecto
  - GitHub Actions CI: 4 jobs paralelos (backend pytest, Dashboard, pwaMenu, pwaWaiter)
  - JWT_SECRET via `${JWT_SECRET}` sin default hardcodeado
- **Dependencias**: ninguna
- **Governance**: BAJO
- **Leer antes**:
  - `knowledge-base/01-negocio/01_vision_y_contexto.md` (qué es el sistema y por qué existe)
  - `knowledge-base/04-infraestructura/01_configuracion_y_entornos.md`
  - `knowledge-base/07-anexos/02_estructura_del_codigo.md`
  - `devOps/docker-compose.yml` (referencia de servicios)

---

### [C-02] `core-models`
- **Estado**: `[x]` completado y archivado
- **Scope**: Modelos SQLAlchemy base + migraciones iniciales + seed mínimo
  - Modelos: `Tenant`, `Branch`, `User`, `UserBranchRole`
  - `AuditMixin` con `is_active`, `created_at`, `updated_at`, `deleted_at`, `deleted_by_id`
  - `shared/config/constants.py`: `Roles`, `RoundStatus`, `MANAGEMENT_ROLES`, `ORDERABLE`
  - `TenantRepository`, `BranchRepository`, `BaseCRUDService`, `BranchScopedService`
  - `cascade_soft_delete()`, `safe_commit()`
  - Migración 001: tablas `app_tenant`, `branch`, `app_user`, `user_branch_role`
  - Seed mínimo: 1 tenant, 1 branch, 1 usuario ADMIN
- **Dependencias**: C-01
- **Governance**: CRITICO
- **Leer antes**:
  - `knowledge-base/02-arquitectura/02_modelo_de_datos.md` §2.1
  - `knowledge-base/02-arquitectura/01_arquitectura_general.md` (Clean Architecture)
  - `knowledge-base/05-dx/04_convenciones_y_estandares.md` §2 (DB conventions)
  - `knowledge-base/07-anexos/08_seed_data_minimo.md` (seed mínimo de referencia)

---

## FASE 1A — Autenticación

### [C-03] `auth`
- **Estado**: `[x]` completado y archivado
- **Scope**: Sistema completo de autenticación JWT
  - `POST /api/auth/login` — JWT access + refresh, rate limiting 5/60s por IP+email (Redis+Lua atómico), fail-closed si Redis falla
  - `POST /api/auth/refresh` — rotación de refresh token, blacklist del anterior en Redis
  - `POST /api/auth/logout` — blacklist del access token
  - `GET /api/auth/me` — info del usuario actual
  - `POST /api/auth/2fa/setup`, `/verify`, `/disable` — TOTP via pyotp
  - `PermissionContext`: `require_management()`, `require_branch_access()`
  - `current_user` dependency, `verify_jwt()`
  - Campos JWT: `sub`, `tenant_id`, `branch_ids`, `roles`, `email`, `jti`, `type`, `iss`, `aud`, `iat`, `exp`
  - Refresh token en cookie HttpOnly (secure, samesite=lax, path=/api/auth)
  - Tests: login correcto, token expirado, rate limit, 2FA, refresh rotation
- **Dependencias**: C-02
- **Governance**: CRITICO
- **Leer antes**:
  - `knowledge-base/03-seguridad/01_modelo_de_seguridad.md`
  - `knowledge-base/01-negocio/04_reglas_de_negocio.md` §1 (Autenticación)
  - `knowledge-base/02-arquitectura/03_api_y_endpoints.md` §Auth

---

## FASE 1B — Catálogo

> Los changes C-04, C-05 y C-06 pueden proponerse en paralelo. C-04 debe archivarse antes de C-07.

### [C-04] `menu-catalog`
- **Estado**: `[x]` completado y archivado
- **Scope**: Catálogo de menú completo con endpoints admin
  - Modelos: `Category`, `Subcategory`, `Product`, `BranchProduct`
  - `CategoryService`, `SubcategoryService`, `ProductService`
  - Endpoints admin CRUD para los 4 modelos (`/api/admin/categories`, `/subcategories`, `/products`, `/branch-products`)
  - Endpoint público: `GET /api/public/menu/{slug}` — menú completo cacheado en Redis (TTL 5 min, invalidación en CRUD)
  - Paginación `?limit=50&offset=0` en todos los listados
  - Precios en centavos (int), validación de imagen URL anti-SSRF
  - Migración 002: tablas `category`, `subcategory`, `product`, `branch_product`
  - Tests: CRUD, aislamiento multi-tenant, cache invalidation
- **Dependencias**: C-03
- **Governance**: BAJO
- **Leer antes**:
  - `knowledge-base/02-arquitectura/02_modelo_de_datos.md` §2.3
  - `knowledge-base/02-arquitectura/03_api_y_endpoints.md` §Admin + §Público
  - `knowledge-base/05-dx/04_convenciones_y_estandares.md` §2 (precios en centavos)

---

### [C-05] `allergens`
- **Estado**: `[x]` completado y archivado
- **Scope**: Sistema de alérgenos con vinculación a productos
  - Modelos: `Allergen`, `ProductAllergen` (M:N con `presence_type` + `risk_level`), `AllergenCrossReaction`
  - `AllergenService`
  - Endpoints: CRUD `/api/admin/allergens`, vinculación `POST /api/admin/products/{id}/allergens`
  - El endpoint público de menú debe incluir alérgenos por producto
  - Migración 003: tablas `allergen`, `product_allergen`, `allergen_cross_reaction`
  - Tests: CRUD alérgenos, vinculación con productos, cross-reactions
- **Dependencias**: C-04
- **Governance**: CRITICO (alérgenos son dato de seguridad alimentaria)
- **Leer antes**:
  - `knowledge-base/02-arquitectura/02_modelo_de_datos.md` §2.3 (ProductAllergen)
  - `knowledge-base/01-negocio/04_reglas_de_negocio.md` §Alérgenos
  - `knowledge-base/03-seguridad/02_superficie_de_ataque.md`

---

### [C-06] `ingredients`
- **Estado**: `[x]` completado y archivado
- **Scope**: Jerarquía de ingredientes y recetas
  - Modelos: `IngredientGroup`, `Ingredient`, `SubIngredient`, `Recipe`, catálogos tenant-scoped (`CookingMethod`, `FlavorProfile`, `TextureProfile`, `CuisineType`)
  - Endpoints: CRUD `/api/admin/ingredients`, `/api/recipes`
  - Migración 004: tablas de ingredientes, recetas y catálogos
  - Tests: CRUD, aislamiento por tenant
- **Dependencias**: C-03
- **Governance**: BAJO
- **Leer antes**:
  - `knowledge-base/02-arquitectura/02_modelo_de_datos.md` §IngredientGroup
  - `knowledge-base/02-arquitectura/03_api_y_endpoints.md` §Recipes

---

## FASE 1C — Operación de mesa

### [C-07] `sectors-tables`
- **Estado**: `[x]` completado y archivado
- **Scope**: Sectores del salón y mesas
  - Modelos: `BranchSector`, `Table`, `WaiterSectorAssignment`
  - `SectorService`, `TableService`
  - Endpoints: CRUD `/api/admin/sectors`, `/api/admin/tables`
  - Códigos de mesa alfanuméricos (ej: "INT-01"), NO únicos entre branches (siempre filtrar por `branch_slug`)
  - `WaiterSectorAssignment`: asignación diaria, verificada por fecha de HOY
  - `GET /api/public/branches` — listado público de branches (sin auth, para pwaWaiter pre-login)
  - Migración 005: tablas `branch_sector`, `app_table`, `waiter_sector_assignment`
  - Tests: CRUD, asignación diaria de mozos, acceso por sector
- **Dependencias**: C-04
- **Governance**: BAJO
- **Leer antes**:
  - `knowledge-base/02-arquitectura/02_modelo_de_datos.md` §BranchSector
  - `knowledge-base/01-negocio/04_reglas_de_negocio.md` §Mesas y Sectores
  - `knowledge-base/01-negocio/02_actores_y_roles.md` §WAITER

---

### [C-08] `table-sessions`
- **Estado**: `[x]` completado
- **Scope**: Sesiones de mesa, comensales y autenticación por token de mesa
  - Modelos: `TableSession` (estados: OPEN → PAYING → CLOSED), `Diner`, `CartItem` (efímero)
  - `DinerService`
  - Table Token HMAC (3 horas), header `X-Table-Token`
  - `GET /api/tables/{id}/session` — por ID numérico
  - `GET /api/tables/code/{code}/session` — por código de mesa (requiere `branch_slug`)
  - `POST /api/waiter/tables/{id}/activate` — mozo activa la mesa (crea sesión)
  - `POST /api/waiter/tables/{id}/close` — mozo cierra la mesa tras el pago
  - `GET /api/diner/session` — info de la sesión activa del comensal
  - Regla crítica: solo OPEN puede recibir nuevos pedidos
  - Migración 006: tablas `table_session`, `diner`, `cart_item`
  - Tests: activar mesa, token de mesa, sesión OPEN→PAYING→CLOSED, hard delete de cart_items
- **Dependencias**: C-07
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/01-negocio/04_reglas_de_negocio.md` §Sesiones de Mesa
  - `knowledge-base/02-arquitectura/02_modelo_de_datos.md` §TableSession
  - `knowledge-base/03-seguridad/01_modelo_de_seguridad.md` §Table Token

---

### [C-09] `ws-gateway-base`
- **Estado**: `[x]` completado
- **Scope**: WebSocket Gateway operativo con los 4 endpoints
  - Estructura `ws_gateway/`: `components/auth/`, `components/connection/`, `components/broadcast/`, `components/resilience/`, `core/`
  - Patrones: Strategy Auth (JWTAuthStrategy + TableTokenAuthStrategy), Sharded Locks, Worker Pool (10 workers), Circuit Breaker, Heartbeat (30s ping/pong, 60s timeout)
  - 4 endpoints: `/ws/waiter`, `/ws/kitchen`, `/ws/admin`, `/ws/diner`
  - Close codes: 4001 (auth failed), 4003 (forbidden), 4029 (rate limited)
  - Redis Streams consumer group para eventos críticos, DLQ para fallidos
  - Event catch-up: `GET /ws/catchup?branch_id=&since=&token=` (staff) y `GET /ws/catchup/session?session_id=&since=&table_token=` (diner)
  - Rate limiting WS: 30 mensajes/ventana/conexión
  - Origin validation, WS-specific CORS
  - Tests: conexión, auth fallida, heartbeat, disconnect graceful
- **Dependencias**: C-08
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/02-arquitectura/04_eventos_y_websocket.md`
  - `knowledge-base/02-arquitectura/01_arquitectura_general.md` §WS Gateway
  - `knowledge-base/03-seguridad/01_modelo_de_seguridad.md` §WebSocket
  - `knowledge-base/07-anexos/07_estandar_calidad_gateway.md` (estándar de calidad gateway)

---

### [C-10] `rounds`
- **Estado**: `[x]` completado y archivado
- **Scope**: Rondas de pedidos — el flujo central del sistema
  - Modelos: `Round`, `RoundItem` (con `is_voided` + `void_reason`)
  - `RoundService`
  - Máquina de estados: PENDING → CONFIRMED → SUBMITTED → IN_KITCHEN → READY → SERVED (→ CANCELED desde cualquier estado)
  - Roles por transición: PENDING (Diner), CONFIRMED (Waiter), SUBMITTED (Admin/Manager), IN_KITCHEN/READY (Kitchen), SERVED (Staff)
  - Cocina SOLO ve SUBMITTED+, nunca PENDING ni CONFIRMED
  - `POST /api/diner/rounds` — comensal crea ronda
  - `POST /api/waiter/sessions/{id}/rounds` — mozo crea ronda para clientes sin teléfono (comanda rápida)
  - `PATCH /api/waiter/rounds/{id}` — mozo confirma (PENDING → CONFIRMED)
  - `PATCH /api/admin/rounds/{id}` — manager envía a cocina (CONFIRMED → SUBMITTED)
  - `PATCH /api/kitchen/rounds/{id}` — cocina actualiza estado (SUBMITTED → IN_KITCHEN → READY)
  - `POST /api/waiter/rounds/{id}/void-item` — anular ítem (SUBMITTED/IN_KITCHEN/READY)
  - Eventos WS: ROUND_PENDING (Direct), ROUND_CONFIRMED (Direct), ROUND_SUBMITTED (Outbox), ROUND_IN_KITCHEN (Direct), ROUND_READY (Outbox), ROUND_SERVED (Direct), ROUND_CANCELED (Direct)
  - Validación de stock antes de submit (409 si insuficiente)
  - Migración 007: tablas `round`, `round_item`
  - Tests: cada transición de estado, roles no autorizados, void de items, cancelación
- **Dependencias**: C-09
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/01-negocio/04_reglas_de_negocio.md` §Rondas
  - `knowledge-base/02-arquitectura/04_eventos_y_websocket.md` §Round lifecycle
  - `knowledge-base/02-arquitectura/03_api_y_endpoints.md` §Waiter + §Diner + §Kitchen

---

### [C-11] `kitchen`
- **Estado**: `[x]` completado
- **Scope**: Display de cocina y tickets
  - Modelos: `KitchenTicket`, `KitchenTicketItem`
  - `TicketService`
  - `GET /api/kitchen/tickets` — tickets activos (solo SUBMITTED+)
  - `PATCH /api/kitchen/tickets/{id}` — actualizar estado del ticket
  - `GET /api/waiter/branches/{id}/menu` — menú compacto sin imágenes (comanda rápida)
  - Alertas de cocina: Web Audio API beep + visual flash en ROUND_SUBMITTED (toggle en localStorage)
  - `ServiceCall`: `POST /api/diner/service-call`, `PATCH /api/waiter/service-calls/{id}` (ACK/CLOSE)
  - Evento SERVICE_CALL_CREATED por Outbox
  - Migración 008: tablas `kitchen_ticket`, `kitchen_ticket_item`, `service_call`
  - Tests: tickets por estado, service calls, alertas
- **Dependencias**: C-10
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/02-arquitectura/03_api_y_endpoints.md` §Kitchen
  - `knowledge-base/01-negocio/04_reglas_de_negocio.md` §Cocina

---

### [C-12] `billing`
- **Estado**: `[x]` completado y archivado
- **Scope**: Facturación y pagos completos
  - Modelos: `Check` (tabla `app_check`), `Charge`, `Allocation` (FIFO), `Payment`
  - `BillingService`, `PaymentGateway` ABC, `MercadoPagoGateway`
  - `POST /api/waiter/sessions/{id}/check` — mozo solicita cuenta (OPEN → PAYING)
  - `GET /api/billing/check/{id}` — detalle de la cuenta
  - `POST /api/waiter/payments/manual` — efectivo/tarjeta/transferencia
  - `POST /api/billing/mercadopago/preference` — crear preferencia MP
  - `POST /api/billing/mercadopago/webhook` — IPN de MP
  - Algoritmo FIFO: cada payment se asigna a charges en orden cronológico via Allocation
  - Algoritmo de distribución: cobro parcial permite propinas (Tip model)
  - Rate limiting billing: 5-20/min según endpoint
  - Eventos por Outbox: CHECK_REQUESTED, CHECK_PAID, PAYMENT_APPROVED, PAYMENT_REJECTED
  - Migración 009: tablas `app_check`, `charge`, `allocation`, `payment`, `tip`
  - Tests: solicitud de cuenta, pago manual, algoritmo FIFO, rate limiting
- **Dependencias**: C-11
- **Governance**: CRITICO
- **Leer antes**:
  - `knowledge-base/01-negocio/04_reglas_de_negocio.md` §Facturación y Pagos
  - `knowledge-base/02-arquitectura/04_eventos_y_websocket.md` §Outbox
  - `knowledge-base/02-arquitectura/06_capas_de_abstraccion.md` §PaymentGateway

---

### [C-13] `staff-management`
- **Estado**: `[x]` completado
- **Scope**: Gestión de personal y promotions
  - `StaffService`: CRUD usuarios, asignación de roles y branches
  - `PromotionService`: CRUD promotions, vinculación a branches y productos
  - Modelos: `Promotion`, `PromotionBranch`, `PromotionItem`
  - `GET /api/waiter/verify-branch-assignment` — verificar asignación del mozo HOY
  - Endpoints admin: `/api/admin/staff`, `/api/admin/promotions`
  - Push notifications: suscripción VAPID, `POST /api/waiter/notifications/subscribe`
  - `Outbox` model + `outbox_service.py` si no se creó antes
  - Migración 010: tablas `promotion`, `promotion_branch`, `promotion_item`
  - Tests: CRUD staff, asignación diaria de mozos, promotions
- **Dependencias**: C-08
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/01-negocio/02_actores_y_roles.md`
  - `knowledge-base/02-arquitectura/03_api_y_endpoints.md` §Waiter pre-login

---

## FASE 1D — Frontends

> Los 3 frontends pueden implementarse en paralelo entre sí. Cada uno requiere que los changes de backend (C-03 a C-13) estén archivados.

### [C-14] `dashboard-shell`
- **Estado**: `[x]` completado y archivado
- **Scope**: Scaffold del Dashboard con auth, layout, routing y stores base
  - Vite config, Tailwind 4.1, React Router v7, i18next (es/en con 700+ keys base)
  - `authStore`: login, refresh proactivo cada 14 min, logout con prevención de loop infinito
  - Layout principal: sidebar colapsable, navbar, breadcrumbs
  - Páginas: Login, Home (dashboard vacío), 404
  - `api.ts`: fetchAPI con retry en 401, interceptor de refresh silencioso
  - `useIdleTimeout`: warning 25min, logout 30min
  - Convenciones Zustand: selectores, EMPTY_ARRAY, useShallow
  - `babel-plugin-react-compiler`, `eslint-plugin-react-hooks` 7.x
  - Tests: authStore (login, refresh, logout), layout rendering
- **Dependencias**: C-03
- **Governance**: BAJO
- **Leer antes**:
  - `knowledge-base/05-dx/04_convenciones_y_estandares.md` §3 (Frontend)
  - `knowledge-base/05-dx/05_workflow_implementacion.md` §6-7
  - `CLAUDE.md` §React 19 Patterns

---

### [C-15] `dashboard-menu`
- **Estado**: `[x]` completado y archivado
- **Scope**: Páginas de gestión de menú y alérgenos en Dashboard
  - Pages: Categories, Subcategories, Products, Allergens, Ingredients, Recipes
  - Patrón `useFormModal` + `useConfirmDialog` para CRUD sin boilerplate
  - `useActionState` (React 19) para forms
  - WebSocket store: listener con `useRef`, suscripción única
  - Eventos WS recibidos: ENTITY_CREATED, ENTITY_UPDATED, ENTITY_DELETED, CASCADE_DELETE
  - Optimistic updates con rollback automático
  - Store migrations con type guards, `STORE_VERSIONS`
  - Tests: stores con migraciones, CRUD pages, WS events
- **Dependencias**: C-14, C-04, C-05, C-06
- **Governance**: BAJO
- **Leer antes**:
  - `knowledge-base/05-dx/05_workflow_implementacion.md` §6-9
  - `CLAUDE.md` §React 19 Patterns + §Store migrations

---

### [C-16] `dashboard-operations`
- **Estado**: `[x]` completado y listo para archivar
- **Scope**: Páginas operativas del Dashboard
  - Pages: Tables (gestión de mesas), Staff (personal y roles), Sectors, Kitchen Display
  - Kitchen Display: 3 columnas (SUBMITTED/IN_KITCHEN/READY), colores de urgencia, timers, audio alerts toggle
  - Sales page: revenue diario, órdenes, ticket promedio, top productos
  - Waiter assignments: asignación diaria por sector
  - WebSocket: ROUND_SUBMITTED, ROUND_IN_KITCHEN, ROUND_READY, TABLE_STATUS_CHANGED
  - Receipt printing: `ReceiptService` HTML para impresora térmica
  - Tests: Kitchen Display WS, Sales queries, assignment flow
- **Dependencias**: C-15, C-10, C-11, C-12, C-13
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/01-negocio/04_reglas_de_negocio.md` §Kitchen + §Billing
  - `knowledge-base/02-arquitectura/04_eventos_y_websocket.md` §Round routing

---

### [C-17] `pwaMenu-shell`
- **Estado**: `[x]` completado
- **Scope**: Scaffold de pwaMenu con menú público y autenticación por token
  - Vite PWA config (Workbox), service worker: CacheFirst assets, NetworkFirst API
  - Fallback offline: `fallback-product.svg`, `default-avatar.svg`
  - i18n: `react-i18next` con es/en/pt, cero strings hardcodeadas, lazy load por idioma
  - `sessionStore`: token de mesa, diner info, 8h TTL localStorage, check de expiración al cargar
  - Menú público: `GET /api/public/menu/{VITE_BRANCH_SLUG}`, categorías, productos, filtros
  - Scanner QR → activación de sesión → token de mesa
  - `babel-plugin-react-compiler`, overflow-x-hidden en containers
  - Tests: sessionStore (expiración TTL), menú loading, i18n keys
- **Dependencias**: C-08, C-04
- **Governance**: BAJO
- **Leer antes**:
  - `knowledge-base/05-dx/04_convenciones_y_estandares.md` §PWA + §i18n
  - `knowledge-base/05-dx/07_internacionalizacion.md` (guía i18n es/en/pt)
  - `CLAUDE.md` §PWA & Service Workers + §localStorage expiry

---

### [C-18] `pwaMenu-ordering`
- **Estado**: `[x]` completado y archivado (smoke manual 15.4 parcial — revalidar en C-22)
- **Scope**: Carrito compartido y flujo de pedidos en pwaMenu
  - `cartStore`: carrito por dispositivo, `useOptimisticCart` (React 19 `useOptimistic`)
  - Shared cart UX: cada diner ve sus items + items de otros con nombre/color
  - Group confirmation antes de enviar la ronda
  - WebSocket diner: CART_ITEM_ADDED/UPDATED/REMOVED, ROUND_* status updates
  - Event catch-up al reconectar: `GET /ws/catchup/session`
  - `RetryQueueStore`: encolar operaciones fallidas, reintentar al volver la conectividad
  - Bloqueo de nuevos pedidos cuando sesión está en PAYING
  - Tests: cartStore optimistic, WS eventos, retry queue, bloqueo en PAYING
- **Dependencias**: C-17, C-10
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/01-negocio/04_reglas_de_negocio.md` §Carrito + §Rondas
  - `CLAUDE.md` §Shared Cart + §React 19 Patterns (useOptimistic)

---

### [C-19] `pwaMenu-billing`
- **Estado**: `[x]` completado y archivado (task 2.4 migration test completado → `tests/migrations/test_customer_c19.py`)
- **Scope**: Solicitud de cuenta y pago en pwaMenu
  - Solicitar cuenta: `POST /api/waiter/sessions/{id}/check` desde el comensal
  - Mercado Pago SDK frontend: `VITE_MP_PUBLIC_KEY`, botón de pago
  - Eventos WS: CHECK_REQUESTED, CHECK_PAID, PAYMENT_APPROVED, PAYMENT_REJECTED
  - Customer loyalty Fase 1-2: tracking por dispositivo, historial de visitas
  - `GET /api/customer/profile`, `POST /api/customer/opt-in` (GDPR consent)
  - Tests: solicitud de cuenta, flujo MP, loyalty tracking
- **Dependencias**: C-18, C-12
- **Governance**: CRITICO
- **Leer antes**:
  - `knowledge-base/01-negocio/04_reglas_de_negocio.md` §Pagos
  - `knowledge-base/03-seguridad/01_modelo_de_seguridad.md` §MercadoPago

---

### [C-20] `pwaWaiter-shell`
- **Estado**: `[x]` completado
- **Scope**: Scaffold de pwaWaiter con auth y vista de mesas
  - Pre-login flow: selección de branch → `GET /api/public/branches` (sin auth) → login → verificar asignación HOY
  - `authStore`: JWT con refresh proactivo 14min, `useIdleTimeout`
  - `tableStore`: mesas del sector asignado, estados visuales
  - Push notifications: `sw-push.js`, VAPID, suscripción
  - Sector grouping en la vista de mesas
  - WebSocket waiter: TABLE_SESSION_STARTED, TABLE_CLEARED, TABLE_STATUS_CHANGED
  - Tests: pre-login flow, tableStore, sector filtering, push subscription
- **Dependencias**: C-13, C-07
- **Governance**: BAJO
- **Leer antes**:
  - `knowledge-base/01-negocio/02_actores_y_roles.md` §Waiter
  - `CLAUDE.md` §pwaWaiter Pre-Login Flow

---

### [C-21] `pwaWaiter-operations`
- **Estado**: `[x]` completado y archivado (smoke manual 17.4 parcial — revalidar en C-22)
- **Scope**: Operaciones del mozo: pedidos, cuenta, pagos manuales
  - Comanda rápida: `GET /api/waiter/branches/{id}/menu` (sin imágenes) → crear ronda por mozo
  - Gestión de rondas: confirmar (CONFIRMED), ver estado en tiempo real
  - Solicitar cuenta, registrar pago manual (efectivo/tarjeta/transferencia)
  - ServiceCall: crear, ACK, cerrar
  - WebSocket: ROUND_PENDING, ROUND_READY, SERVICE_CALL_CREATED, CHECK_REQUESTED
  - `RetryQueueStore` para operaciones offline
  - Tests: comanda rápida, estados de ronda, service calls, retry queue
- **Dependencias**: C-20, C-10, C-11, C-12
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/01-negocio/04_reglas_de_negocio.md` §Mozo
  - `knowledge-base/02-arquitectura/03_api_y_endpoints.md` §Waiter

---

### [C-24] `code-review-fixes-pwa-apps`
- **Estado**: `[x]` completado y archivado
- **Scope**: Resolver issues detectados en code review interno y smoke manual de C-18 y C-21 (2026-04-18). No introduce features — solo fixes de correctitud, seguridad, UX y sync.
  - **Seguridad (C-21)**: mover JWT del query param del catchup (`services/waiter.ts:543-551`) a header `Authorization: Bearer`
  - **Correctitud retry queue (C-21)**: `TableDetailPage.tsx:180-196` — `handlePaymentSubmit` usar `useEnqueuedAction` en vez de string-match `includes('network')`, pasar `userId` real en vez de `''`
  - **React deps (C-21)**: revertir `useEnqueuedAction.ts:86` a `[options.fn, options.op, options.userId, options.buildPayload, enqueue]` (el cambio a `[options, enqueue]` rompió la estabilidad de la ref)
  - **Performance (C-18)**: `cartStore.ts:134` y `roundsStore.ts:67` — dedup con `Set<string>` O(1) en vez de `Array.includes()` O(n); mantener FIFO con array paralelo
  - **UX mobile (C-18)**: `CartItem.tsx` touch targets `w-7 h-7` (28px) → 44px mínimo (WCAG 2.5.5)
  - **UX WS (C-18)**: implementar `OfflineBanner` en pwaMenu (incluido en el scope original del change, nunca se creó)
  - **Código (C-18)**: eliminar double-ref redundante en `useDinerWS.ts:57-95` — el `useCallback([])` ya provee estabilidad, el ref encima es ruido
  - **Types (C-18)**: `CartWsEvent` como discriminated union real → eliminar los `as unknown as` en el switch de `cartStore`
  - **Race condition (C-18)**: retry executor en `App.tsx:81` — chequear si el item ya existe antes de `replaceAll([...existing, item])`
  - **React 19 pattern (C-18)**: `CartConfirmPage` migrar a `useActionState` (consistencia con react19-form-pattern)
  - **WS reconnect (C-21)**: `waiterWs.ts:169-177` — NO reconectar en codes 4001/4003/4029 (auth, forbidden, rate-limited)
  - **Menú (C-21)**: `compactMenuStore.ts:109-127` — normalizar filtrado subcategoryId vs category.id
  - **Labels (C-21)**: `RoundCard.tsx:33` — resolver nombre del producto desde `compactMenuStore` en vez de mostrar `"Producto #1234"`
  - **Performance (C-21)**: `StaleDataBanner.tsx:19` — envolver `handleRefresh` en `useCallback`
  - **Reuso (C-21)**: `OfflineBanner.tsx:15-17` — usar el selector existente `selectFailedEntries` del store
  - **UI sync (C-21, descubrimiento del smoke)**: el UI no refleja el cambio de estado después de una mutation exitosa (ej. confirmar ronda). Diagnosticar store upsert + WS event delivery + render path; probablemente selector inestable o WS event no publicado por backend.
  - **ServiceCalls toggle (C-21)**: `ServiceCallsPage.tsx:34` — `filterSector` debe afectar `displayCalls`
  - **Performance (C-21)**: `retryQueueStore.ts:199` — paralelizar `drain()` bajo carga alta
  - **WS handler (C-21)**: agregar `onMaxReconnect` para UI de fallo definitivo
  - **Types cosmética (C-21)**: `EMPTY_ARRAY` como `readonly never[]` para evitar `as unknown as T[]`
- **Fuera de scope**: nuevas features, refactors no vinculados a issues concretos, cambios de arquitectura
- **Entregables**:
  - Todos los issues marcados 🔴 **crítico** del review cerrados
  - Todos los issues marcados 🟡 **importante** cerrados o justificados como deferred
  - Nits 🟢 a discreción — cerrar los que sean triviales, dejar el resto para deuda técnica
  - Re-correr smoke de C-18 y C-21 una vez implementado C-16 (pre-requisito para flujo multi-rol completo)
  - `pwaMenu` y `pwaWaiter`: tests + lint + build green
- **Dependencias**: C-18, C-21
- **Governance**: ALTO (incluye fix de seguridad JWT en URL)
- **Leer antes**:
  - Engram `opsx/pwamenu-ordering/code-review` (4 críticos + 3 important + 3 nits)
  - Engram `opsx/pwawaiter-operations/code-review` (3 críticos + 5 important + 4 nits)
  - Engram `opsx/pwawaiter-operations/smoke-findings` (contract mismatches + UI sync bug)
  - `.agents/skills/receiving-code-review/SKILL.md`
  - `.agents/skills/zustand-store-pattern/SKILL.md`
  - `.agents/skills/ws-frontend-subscription/SKILL.md`
  - `.agents/skills/react19-form-pattern/SKILL.md`

---

## FASE 1E — Dashboard: Gestión Completa

> C-29 es el prerequisito de toda esta fase — desbloquea el selector de sucursal que todas las páginas necesitan.
> Una vez archivado C-29, los siguientes 5 changes pueden ejecutarse en paralelo.
> C-31 puede ejecutarse en cualquier momento después de C-16 (tooling independiente).

### [C-29] `dashboard-branch-selector`
- **Estado**: `[x]` completado y archivado
- **Scope**: Selector de sucursal en el Navbar del Dashboard (HU-0303)
  - Expandir `branchStore`: agregar `branches: Branch[]`, `selectedBranch: Branch | null`, acción `fetchBranches()`
  - Crear `branchAPI.ts`: `GET /api/public/branches` → filtrar client-side por `user.branch_ids` del JWT
  - Actualizar `Navbar`: dropdown con nombre de sucursal activa + lista desplegable de sucursales disponibles
  - Auto-select si el usuario tiene una sola sucursal (ejecutar en `MainLayout` al montar, post-login)
  - Al cambiar de sucursal: limpiar datos branch-dependientes de otros stores (tables, rounds, sales, kitchen)
  - Persistir `selectedBranchId` en localStorage (ya manejado por `persist` del store)
  - Skeleton/loading state mientras se cargan las sucursales
  - Tests: `branchStore` (fetch, auto-select, cambio de sucursal), Navbar rendering con 1 y N branches
- **Dependencias**: C-16
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/01-negocio/06_backlog_completo.md` §HU-0303
  - `knowledge-base/05-dx/04_convenciones_y_estandares.md` §3 (Zustand patterns)
  - `knowledge-base/03-seguridad/01_modelo_de_seguridad.md` §JWT (branch_ids en el payload)

---

### [C-30] `dashboard-home`
- **Estado**: `[x]` completado y archivado
- **Scope**: Página de inicio funcional del Dashboard (HU-1901)
  - **Sin sucursal seleccionada**: card prominente con instrucción + botón que abre el selector del Navbar
  - **Con sucursal seleccionada**:
    - Header: nombre de la sucursal + fecha actual
    - 4 KPI cards de resumen: mesas activas vs total, pedidos del día, ingresos del día, ticket promedio
    - KPIs se obtienen componiendo datos de stores ya cargados (`tableStore`, `salesStore`) — sin nuevas APIs
    - Quick-links grid: accesos directos a Kitchen Display, Ventas, Mesas, Staff, Asignación de Mozos
    - Actualización en tiempo real: `TABLE_STATUS_CHANGED` y `ROUND_*` events actualizan los KPI cards
  - Sin nuevo store — reutiliza selectores de `tableStore` y `salesStore`
  - Tests: rendering sin sucursal, rendering con sucursal, KPI cards con datos mockeados
- **Dependencias**: C-29, C-16
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/01-negocio/06_backlog_completo.md` §HU-1901
  - `knowledge-base/01-negocio/03_funcionalidades.md` §1.17 (Estadísticas)
  - `knowledge-base/02-arquitectura/04_eventos_y_websocket.md` §TABLE_STATUS_CHANGED

---

### [C-25] `dashboard-orders`
- **Estado**: `[x]` completado y archivado
- **Scope**: Página de gestión de rondas/pedidos en el Dashboard
  - Page `/orders`: historial de rondas filtrable por fecha, mesa, sector y estado
  - Vista por columnas de estado: PENDING / CONFIRMED / SUBMITTED → READY (compacto)
  - Detalle de ronda: items, comensal, sector, mesa, timestamps por estado
  - Acción de cancelación (MANAGER/ADMIN): confirmar con dialog, WS event ROUND_CANCELED
  - Filtros: `date` (default hoy), `sector_id`, `status`, `table_code`
  - `roundsAdminStore`: selectores estables, `EMPTY_ARRAY`, `useShallow`; upsert por WS
  - WS en tiempo real: `ROUND_PENDING`, `ROUND_CONFIRMED`, `ROUND_SUBMITTED`, `ROUND_IN_KITCHEN`, `ROUND_READY`, `ROUND_SERVED`, `ROUND_CANCELED`
  - Tests: store (filtros + WS upsert), cancelación con roles, empty state
- **Dependencias**: C-29, C-10, C-11
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/01-negocio/04_reglas_de_negocio.md` §2 (Round Lifecycle) + §11 (RBAC)
  - `knowledge-base/02-arquitectura/03_api_y_endpoints.md` §Operaciones del Mozo + §Administración
  - `knowledge-base/02-arquitectura/04_eventos_y_websocket.md` §Round routing

---

### [C-26] `dashboard-billing`
- **Estado**: `[x]` completado y archivado
- **Scope**: Páginas de Cuentas y Pagos en el Dashboard
  - Page `/checks`: listado de cuentas (`Check`) por sucursal y fecha
    - Estado: REQUESTED (amarillo) / PAID (verde); badge con total y monto cubierto
    - Modal de detalle: charges, allocations, pagos asociados con método y monto
    - KPI rápido en header: cuentas del día / monto total facturado / pendientes
  - Page `/payments`: historial de pagos con filtros
    - Filtros: fecha, método (`cash` / `card` / `transfer` / `mercadopago`), estado (`APPROVED` / `REJECTED` / `PENDING`)
    - Totales agrupados por método (tabla resumen al pie)
  - `billingAdminStore`: `checks` + `payments`, selectores independientes con `useShallow`
  - WS: `CHECK_REQUESTED`, `CHECK_PAID`, `PAYMENT_APPROVED`, `PAYMENT_REJECTED` (upsert en store)
  - Tests: store (upsert WS, filtros), KPI cards, modal de detalle, agrupación por método
- **Dependencias**: C-29, C-12
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/01-negocio/04_reglas_de_negocio.md` §7 (Reglas de Facturación)
  - `knowledge-base/02-arquitectura/03_api_y_endpoints.md` §Facturación
  - `knowledge-base/02-arquitectura/04_eventos_y_websocket.md` §Outbox (CHECK_*, PAYMENT_*)

---

### [C-27] `dashboard-promotions`
- **Estado**: `[x]` completado y archivado
- **Scope**: CRUD de promociones en el Dashboard (backend listo en C-13)
  - Page `/promotions`: listado con nombre, tipo, vigencia `start_date`↔`end_date`, sucursales activas, badge estado
  - Formulario crear/editar (modal):
    - Nombre, precio en centavos (display `$XX.XX`), tipo de promoción (select con catálogo tenant)
    - `DateRangePicker` para `start_date + start_time` / `end_date + end_time`
    - Multi-select de sucursales (`PromotionBranch`)
    - Tabla de items: agregar/quitar productos con cantidad (`PromotionItem`)
  - Toggle `is_active` inline (sin abrir modal)
  - Cascade delete preview antes de eliminar
  - WS: `ENTITY_CREATED`, `ENTITY_UPDATED`, `ENTITY_DELETED` — sync en tiempo real
  - `promotionsStore`: optimistic updates con rollback, `EMPTY_ARRAY`, `useShallow`
  - Tests: CRUD, filtros de vigencia, vinculación a sucursales y productos
- **Dependencias**: C-29, C-13
- **Governance**: BAJO
- **Leer antes**:
  - `knowledge-base/01-negocio/04_reglas_de_negocio.md` §18 (Reglas de Promociones) + §8 (Precios)
  - `knowledge-base/02-arquitectura/02_modelo_de_datos.md` §Promotion + §PromotionItem
  - `knowledge-base/02-arquitectura/03_api_y_endpoints.md` §Administración (Promotions)

---

### [C-28] `dashboard-settings`
- **Estado**: `[x]` completado y archivado
- **Scope**: Página de configuración del Dashboard con tabs por dominio
  - Page `/settings` — layout de tabs:
    - **Tab Sucursal** (MANAGER/ADMIN): nombre, slug (validación regex `[a-z0-9-]+`, preview URL de menú público), dirección, teléfono, timezone, horarios de atención por día
    - **Tab Perfil** (cualquier rol): cambio de contraseña (requiere contraseña actual), configuración de 2FA — QR setup / verificación TOTP / deshabilitar
    - **Tab Tenant** (solo ADMIN): nombre del tenant, configuración global
  - Slug change: mostrar advertencia de que cambia la URL pública del menú; campo de confirmación explícita
  - `useActionState` (React 19) para todos los formularios; feedback inline por campo
  - Tests: form validations, cambio de contraseña (correcto / incorrecto), slug regex, guard de rol por tab
- **Dependencias**: C-29, C-03
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/03-seguridad/01_modelo_de_seguridad.md` §Auth + §2FA
  - `knowledge-base/02-arquitectura/03_api_y_endpoints.md` §Autenticación + §Administración
  - `knowledge-base/01-negocio/02_actores_y_roles.md` (roles y alcance por tab)
  - `knowledge-base/05-dx/04_convenciones_y_estandares.md` §3 (Frontend forms)

---

## FASE 1F — Tooling y DX

### [C-31] `demo-seed-rich`
- **Estado**: `[x]` completado y archivado
- **Scope**: Seed de demostración enriquecido para testing manual completo del flujo operativo
  - **Contexto**: el seed base (`python -m rest_api.seeds.runner`) ya existe y crea: 1 tenant, 1 branch "Sucursal Central" (slug `demo`), 4 usuarios (`admin/manager/waiter/kitchen @demo.com`, password = rol + `123`), 1 sector "Salón principal", 3 mesas (T01-T03), 5 productos y 1 promoción. Este change lo EXTIENDE, no lo reemplaza.
  - **Nuevo módulo** `backend/rest_api/seeds/demo_full.py` — idempotente como el resto:
    - 2 categorías adicionales: "Postres", "Entradas"
    - 5 productos más con alérgenos vinculados (gluten, lácteos, mariscos)
    - 3 table sessions en estados distintos:
      - T01: OPEN con 2 comensales, 1 ronda SERVED + 1 ronda IN_KITCHEN
      - T02: PAYING con cuenta REQUESTED y 1 pago parcial APPROVED
      - T03: libre (sin sesión)
    - 2 service calls: 1 ACKED, 1 CREATED (sin resolver)
    - Historial: 3 sesiones CLOSED de días anteriores con checks PAID (para que la página de Ventas muestre datos reales)
  - Agregar flag `--full` al runner: `python -m rest_api.seeds.runner --full` ejecuta base + demo_full
  - Documentar en `README.md` del backend y en `knowledge-base/07-anexos/08_seed_data_minimo.md`
  - Tests: verificar idempotencia (correr 2 veces no duplica datos), contar entidades post-seed
- **Dependencias**: C-16 (necesita todos los modelos operativos: rounds, checks, payments, service calls)
- **Governance**: BAJO
- **Leer antes**:
  - `knowledge-base/07-anexos/08_seed_data_minimo.md` (seed base — extender sin romper)
  - `knowledge-base/01-negocio/04_reglas_de_negocio.md` §2, §3, §7 (máquinas de estado a respetar en el seed)
  - `backend/rest_api/seeds/runner.py` + `demo_data.py` (código base a extender)

---

## FASE 2 — Producción y Calidad

### [C-22] `e2e-critical-flow`
- **Estado**: `[x]` completado — suite implementada, pendiente smoke local y archive
- **Scope**: Tests E2E del flujo crítico completo
  - Playwright: `e2e/` con tests para el flujo login → activar mesa → escanear QR → agregar items → confirmar ronda → cocina → pago
  - Al menos 5 specs: auth flow, menu ordering, kitchen flow, billing flow, waiter flow
  - CI integration: job E2E en GitHub Actions
  - Revalidación completa de los smokes parciales de C-18 (task 15.4) y C-21 (task 17.4)
- **Dependencias**: C-16, C-19, C-21, C-24
- **Governance**: BAJO
- **Leer antes**:
  - `.agents/skills/playwright-best-practices/SKILL.md`
  - `knowledge-base/05-dx/06_estrategia_testing.md`
  - `knowledge-base/01-negocio/05_flujos_y_casos_de_uso.md` (flujos a validar con E2E)

---

### [C-23] `monitoring-production`
- **Estado**: `[x]` completado
- **Scope**: TLS, logging centralizado y monitoreo
  - TLS: Let's Encrypt + `devOps/nginx/nginx-ssl.conf` + `devOps/ssl/init-letsencrypt.sh`
  - Grafana Loki + Promtail: todos los servicios con `tenant_id`, `request_id`, `user_id`
  - Prometheus + Grafana dashboards: requests/s, latencia p95, conexiones WS, Redis memory, DB connections
  - Alertas: errores críticos, rate limit excedido, Redis/DB down
  - `devOps/RUNBOOK.md` actualizado con checklist de producción
- **Dependencias**: C-22
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/04-infraestructura/` (todos los docs)
  - `devOps/RUNBOOK.md`, `devOps/SCALING.md`

---

## Resumen de estado

| Change | Nombre | Fase | Governance | Depende de | Estado |
|--------|--------|------|-----------|------------|--------|
| C-01 | foundation-setup | 0 | BAJO | — | `[x]` |
| C-02 | core-models | 0 | CRITICO | C-01 | `[x]` |
| C-03 | auth | 1A | CRITICO | C-02 | `[x]` |
| C-04 | menu-catalog | 1B | BAJO | C-03 | `[x]` |
| C-05 | allergens | 1B | CRITICO | C-04 | `[x]` |
| C-06 | ingredients | 1B | BAJO | C-03 | `[x]` |
| C-07 | sectors-tables | 1C | BAJO | C-04 | `[x]` |
| C-08 | table-sessions | 1C | MEDIO | C-07 | `[x]` |
| C-09 | ws-gateway-base | 1C | ALTO | C-08 | `[x]` |
| C-10 | rounds | 1C | MEDIO | C-09 | `[x]` |
| C-11 | kitchen | 1C | MEDIO | C-10 | `[x]` |
| C-12 | billing | 1C | CRITICO | C-11 | `[x]` |
| C-13 | staff-management | 1C | ALTO | C-08 | `[x]` |
| C-14 | dashboard-shell | 1D | BAJO | C-03 | `[x]` |
| C-15 | dashboard-menu | 1D | BAJO | C-14+C-04+C-05+C-06 | `[x]` |
| C-16 | dashboard-operations | 1D | MEDIO | C-15+C-10+C-11+C-12+C-13 | `[x]` |
| C-17 | pwaMenu-shell | 1D | BAJO | C-08+C-04 | `[x]` |
| C-18 | pwaMenu-ordering | 1D | MEDIO | C-17+C-10 | `[x]` |
| C-19 | pwaMenu-billing | 1D | CRITICO | C-18+C-12 | `[x]` |
| C-20 | pwaWaiter-shell | 1D | BAJO | C-13+C-07 | `[x]` |
| C-21 | pwaWaiter-operations | 1D | MEDIO | C-20+C-10+C-11+C-12 | `[x]` |
| C-22 | e2e-critical-flow | 2 | BAJO | C-16+C-19+C-21+C-24 | `[x]` |
| C-23 | monitoring-production | 2 | ALTO | C-22 | `[x]` |
| C-24 | code-review-fixes-pwa-apps | 1D | ALTO | C-18+C-21 | `[x]` |
| C-25 | dashboard-orders | 1E | MEDIO | C-29+C-10+C-11 | `[x]` |
| C-26 | dashboard-billing | 1E | ALTO | C-29+C-12 | `[x]` |
| C-27 | dashboard-promotions | 1E | BAJO | C-29+C-13 | `[x]` |
| C-28 | dashboard-settings | 1E | ALTO | C-29+C-03 | `[x]` |
| C-29 | dashboard-branch-selector | 1E | MEDIO | C-16 | `[x]` |
| C-30 | dashboard-home | 1E | MEDIO | C-29+C-16 | `[x]` |
| C-31 | demo-seed-rich | 1F | BAJO | C-16 | `[x]` |
