# Eventos y WebSocket

Documentación completa de los flujos de eventos, patrones de entrega, routing de eventos WebSocket, flujos de datos y conversiones de tipos del sistema.

---

## Tipos de Eventos y Garantías de Entrega

El sistema utiliza dos patrones de publicación de eventos según la criticidad:

| Patrón | Garantía | Uso | Latencia |
|--------|----------|-----|----------|
| **Outbox transaccional** | At-least-once (atómico con datos de negocio) | Eventos financieros y críticos | Mayor (~100-500ms adicionales) |
| **Direct Redis** | Best-effort (publicación asíncrona) | Eventos informativos, CRUD | Menor (~50-100ms) |

### Outbox Transaccional

1. Evento se escribe en tabla `outbox_events` en la misma transacción que los datos de negocio
2. Background processor lee eventos no procesados periódicamente
3. Publica en Redis Stream
4. Marca evento como procesado
5. Si Redis falla, el evento permanece en DB y se reintenta
6. **Garantía:** At-least-once delivery (puede duplicar, nunca pierde)

### Direct Redis (Background task / Async)

1. Evento se publica directamente en Redis Stream después del commit
2. Si Redis falla en ese momento, el evento se pierde
3. **Garantía:** Best-effort (puede perder en fallas de Redis)

### Redis Streams (ws_gateway)

1. Consumer group lee eventos del stream
2. Si el procesamiento falla, el evento va a DLQ (Dead Letter Queue)
3. Reintentos configurables antes de descarte
4. **Garantía:** At-least-once dentro del gateway (puede duplicar al reconectar)

### Clasificación de Eventos por Patrón

| Patrón | Eventos |
|--------|---------|
| **Outbox** (no debe perderse) | CHECK_REQUESTED, CHECK_PAID, PAYMENT_APPROVED, PAYMENT_REJECTED, ROUND_SUBMITTED, ROUND_READY, SERVICE_CALL_CREATED |
| **Direct Redis** (baja latencia) | ROUND_CONFIRMED, ROUND_IN_KITCHEN, ROUND_SERVED, CART_*, TABLE_*, ENTITY_* |

**Criterio para clasificar eventos nuevos:** Preguntarse "Si este evento se pierde, hay consecuencia financiera o legal?" Si la respuesta es sí, va por outbox. Si no, Redis directo.

---

## WebSocket Endpoints y Autenticación

### Conexiones

| Endpoint | Auth | Rol | Descripción |
|----------|------|-----|-------------|
| `/ws/waiter?token=JWT` | JWT | WAITER | Notificaciones del mozo |
| `/ws/kitchen?token=JWT` | JWT | KITCHEN | Notificaciones de cocina |
| `/ws/admin?token=JWT` | JWT | ADMIN/MANAGER | Notificaciones admin |
| `/ws/diner?table_token=TOKEN` | Table Token | Comensal | Actualizaciones en tiempo real |

### Protocolo de Heartbeat

```
Cliente: {"type": "ping"}     → cada 30 segundos
Servidor: {"type": "pong"}    → respuesta inmediata
Timeout: 60 segundos sin actividad → desconexión
```

### Códigos de Cierre WebSocket

| Código | Significado | Reconexión |
|--------|-------------|------------|
| 1000 | Cierre normal | No |
| 4001 | Autenticación fallida | No |
| 4003 | Prohibido (sin permisos) | No |
| 4029 | Rate limit excedido | No |
| Otros | Error transitorio | Sí (con backoff) |

---

## Matriz Completa de Routing de Eventos

Tabla completa de qué roles reciben cada tipo de evento:

| Evento | Admin | Kitchen | Waiters | Diners | Sector filter |
|--------|-------|---------|---------|--------|---------------|
| `ROUND_PENDING` | Sí | No | Sí (todos) | No | No |
| `ROUND_CONFIRMED` | Sí | No | Sí | No | No |
| `ROUND_SUBMITTED` | Sí | Sí | Sí | No | No |
| `ROUND_IN_KITCHEN` | Sí | Sí | Sí | Sí | No |
| `ROUND_READY` | Sí | Sí | Sí | Sí | No |
| `ROUND_SERVED` | Sí | Sí | Sí | Sí | No |
| `ROUND_CANCELED` | Sí | No | Sí | Sí | No |
| `CART_ITEM_ADDED` | No | No | No | Sí | N/A |
| `CART_ITEM_UPDATED` | No | No | No | Sí | N/A |
| `CART_ITEM_REMOVED` | No | No | No | Sí | N/A |
| `CART_CLEARED` | No | No | No | Sí | N/A |
| `SERVICE_CALL_CREATED` | Sí | No | Sí (sector) | No | SÍ |
| `SERVICE_CALL_ACKED` | Sí | No | Sí (sector) | No | SÍ |
| `SERVICE_CALL_CLOSED` | Sí | No | Sí (sector) | No | SÍ |
| `CHECK_REQUESTED` | Sí | No | Sí | Sí | No |
| `CHECK_PAID` | Sí | No | Sí | Sí | No |
| `PAYMENT_APPROVED` | Sí | No | Sí | Sí | No |
| `PAYMENT_REJECTED` | Sí | No | Sí | Sí | No |
| `TABLE_SESSION_STARTED` | Sí | No | Sí (todos) | No | No |
| `TABLE_CLEARED` | Sí | No | Sí (todos) | No | No |
| `TABLE_STATUS_CHANGED` | Sí | No | Sí (todos) | No | No |
| `ENTITY_CREATED` | Sí | No | No | No | No |
| `ENTITY_UPDATED` | Sí | No | No | No | No |
| `ENTITY_DELETED` | Sí | No | No | No | No |
| `CASCADE_DELETE` | Sí | No | No | No | No |

### Event Catch-up (Recuperación post-reconexión)

Cuando un cliente WebSocket se reconecta tras una desconexión, puede haber perdido eventos. El sistema provee endpoints HTTP de catch-up para recuperarlos:

| Endpoint | Auth | Cliente | Descripción |
|----------|------|---------|-------------|
| `GET /ws/catchup?branch_id=&since=&token=` | JWT | Staff (Dashboard, pwaWaiter, Kitchen) | Recupera eventos de la sucursal desde timestamp `since` |
| `GET /ws/catchup/session?session_id=&since=&table_token=` | Table Token | Comensales (pwaMenu) | Recupera eventos de la sesión, filtrados a: ROUND_*, CART_*, CHECK_*, PAYMENT_*, TABLE_STATUS_CHANGED, PRODUCT_AVAILABILITY_CHANGED |

**Almacenamiento Redis:** Sorted set con key `catchup:branch:{id}`, máximo 100 eventos, TTL de 5 minutos. Los eventos se almacenan con su timestamp como score para consultas por rango temporal.

**Implementación en clientes:** Los 3 frontends implementan catch-up automático al reconectarse:
- Cada cliente WebSocket guarda el `lastEventTimestamp` del último evento recibido
- Al reconectar, llama al endpoint de catch-up con ese timestamp como parámetro `since`
- Los eventos recuperados se procesan en orden cronológico antes de continuar con el flujo normal

### Categorías del EventRouter

| Categoría | Destino | Eventos |
|-----------|---------|---------|
| `KITCHEN_EVENTS` | Solo conexiones `/ws/kitchen` | ROUND_SUBMITTED, ROUND_IN_KITCHEN, ROUND_READY |
| `SESSION_EVENTS` | Comensales de la sesión específica | CART_*, ROUND_IN_KITCHEN+, CHECK_* |
| `ADMIN_ONLY_EVENTS` | Solo conexiones `/ws/admin` | ENTITY_CREATED, ENTITY_UPDATED, ENTITY_DELETED |
| `BRANCH_WIDE_WAITER_EVENTS` | Todos los mozos de la sucursal | ROUND_PENDING, TABLE_SESSION_STARTED |
| `SECTOR_EVENTS` | Mozos del sector específico | SERVICE_CALL_CREATED, TABLE_STATUS_CHANGED |

**Filtrado por sector:** Los eventos con `sector_id` se envían solo a mozos asignados a ese sector. ADMIN y MANAGER siempre reciben todos los eventos de su sucursal, independientemente del sector.

---

## 5 Flujos Críticos de Eventos (End-to-End)

### Flujo 1: ROUND_PENDING — Comensal hace un pedido

**Trigger:** El comensal confirma su carrito en pwaMenu.

**Criticidad:** Alta — representa un pedido real con impacto financiero.

```
pwaMenu (cliente)
  └─ submitOrder()
      └─ dinerAPI.submitRound()
          └─ POST /api/diner/rounds/submit
              Header: X-Table-Token
              Body: { items: [{ product_id, quantity, notes }] }

Backend (rest_api)
  └─ round_router.submit_round()
      └─ round_service.submit_round()
          ├─ SELECT FOR UPDATE session         ← Lock para prevenir race conditions
          ├─ INSERT Round (status = PENDING)
          ├─ INSERT RoundItems                 ← price_cents snapshot del momento
          ├─ DELETE CartItems                  ← Limpia carrito del comensal
          └─ safe_commit()                     ← Atómico: todo o nada
      └─ Background task: publish_round_event()
          └─ Redis Stream: ROUND_PENDING

WebSocket Gateway (ws_gateway)
  └─ redis_subscriber recibe evento
      └─ validate evento
          └─ process_event_batch()
              └─ EventRouter.route_event(ROUND_PENDING)
                  ├─ send_to_admins(branch_id)      → Dashboard WS
                  ├─ send_to_waiters_only(branch_id) → pwaWaiter WS (TODOS los mozos)
                  ├─ NO cocina                       ← Kitchen no ve PENDING
                  └─ NO comensales                   ← Diners ya saben, ellos lo enviaron

Clientes receptores
  ├─ Dashboard: tabla de pedidos actualizada
  └─ pwaWaiter: TableCard muestra pulso amarillo, contador de pendientes +1
```

**Nota:** ROUND_PENDING se envía a TODOS los mozos del branch (no filtrado por sector) porque el sistema necesita que cualquier mozo disponible pueda confirmar.

---

### Flujo 2: SERVICE_CALL_CREATED — Comensal llama al mozo

**Trigger:** El comensal presiona el botón "Llamar mozo" en pwaMenu.

**Criticidad:** Alta — usa Outbox Pattern para garantía de entrega.

```
pwaMenu (cliente)
  └─ CallWaiterModal
      └─ dinerAPI.createServiceCall()
          └─ POST /api/diner/service-call
              Header: X-Table-Token
              Body: { type: "CALL_WAITER" }

Backend (rest_api)
  └─ service_call_router.create()
      └─ service_call_service.create()
          ├─ INSERT ServiceCall (status = OPEN)
          ├─ write_service_call_outbox_event()  ← OUTBOX PATTERN (atómico con INSERT)
          └─ safe_commit()                      ← Evento garantizado en DB
  └─ Outbox Processor (background worker)
      └─ SELECT outbox_events WHERE processed = false
          └─ Publica SERVICE_CALL_CREATED en Redis Stream
              └─ UPDATE outbox_event SET processed = true

WebSocket Gateway (ws_gateway)
  └─ redis_subscriber recibe evento
      └─ EventRouter.route_event(SERVICE_CALL_CREATED)
          ├─ send_to_sector(sector_id)    → Mozos asignados al sector de la mesa
          ├─ send_to_admins(branch_id)    → Dashboard WS
          ├─ NO cocina
          └─ NO comensales

Clientes receptores
  ├─ Dashboard: notificación de llamada de servicio
  └─ pwaWaiter: animación roja parpadeante + sonido de alerta en la mesa correspondiente
```

**Nota:** Este flujo usa filtrado por sector — solo los mozos asignados al sector de la mesa reciben la notificación. ADMIN y MANAGER reciben todas las notificaciones independientemente del sector.

---

### Flujo 3: CHECK_REQUESTED — Comensal pide la cuenta

**Trigger:** El comensal toca "Pedir cuenta" en el BottomNav de pwaMenu.

**Criticidad:** Crítica — involucra datos financieros, usa Outbox Pattern.

```
pwaMenu (cliente)
  └─ BottomNav → botón "Cuenta"
      └─ closeTable()
          └─ billingAPI.requestCheck()
              └─ POST /api/billing/check/request
                  Header: X-Table-Token

Backend (rest_api)
  └─ billing_router.request_check()
      └─ billing_service.request_check()
          ├─ Verificar session.status == OPEN
          ├─ Calcular total de todas las rondas (SUBMITTED+)
          ├─ INSERT Check (status = REQUESTED)  ← tabla: app_check
          ├─ INSERT Charges por cada item
          ├─ UPDATE Table.status = PAYING
          ├─ UPDATE Session.status = PAYING
          ├─ write_billing_outbox_event(CHECK_REQUESTED)  ← OUTBOX
          └─ safe_commit()                                ← Todo atómico
  └─ Outbox Processor
      └─ Publica CHECK_REQUESTED en Redis Stream

WebSocket Gateway (ws_gateway)
  └─ EventRouter.route_event(CHECK_REQUESTED)
      ├─ send_to_admins(branch_id)         → Dashboard WS
      ├─ send_to_waiters_only(branch_id)   → pwaWaiter WS
      └─ send_to_session(session_id)       → pwaMenu (todos los comensales de la mesa)

Clientes receptores
  ├─ Dashboard: mesa cambia a estado "Pagando"
  ├─ pwaWaiter: TableCard muestra pulso púrpura, indica cuenta solicitada
  └─ pwaMenu: comensales ven el total, métodos de pago disponibles
```

**Nota:** Los comensales pueden seguir ordenando durante el estado PAYING. La cuenta se recalcula si hay nuevas rondas.

---

### Flujo 4: TABLE_SESSION_STARTED — Escaneo de QR

**Trigger:** Un cliente escanea el código QR de la mesa con su celular.

**Criticidad:** Media — usa Direct Redis (no Outbox) por ser informativo.

```
pwaMenu (cliente)
  └─ QR scan → URL con código de mesa
      └─ JoinTable page
          └─ joinTable()
              └─ sessionAPI.createOrGetSession()
                  └─ POST /api/tables/code/{code}/session
                      Sin auth (endpoint público con branch_slug)
                      Body: { branch_slug: "sucursal-centro" }

Backend (rest_api)
  └─ table_router.create_or_get_session()
      └─ table_service.get_or_create_session()
          ├─ SELECT FOR UPDATE table            ← Lock para evitar sesiones duplicadas
          ├─ IF no session activa:
          │   ├─ INSERT TableSession (status = OPEN)
          │   └─ UPDATE Table.status = ACTIVE
          ├─ Generar table_token (JWT con table_id, session_id, branch_id)
          └─ safe_commit()
      └─ publish_table_event(TABLE_SESSION_STARTED)  ← DIRECT REDIS
          └─ Redis Stream inmediato (sin outbox)

WebSocket Gateway (ws_gateway)
  └─ EventRouter.route_event(TABLE_SESSION_STARTED)
      ├─ send_to_waiters_only(branch_id)   → TODOS los mozos del branch
      ├─ send_to_admins(branch_id)         → Dashboard WS
      ├─ NO cocina
      └─ NO comensales (el que escaneó recibe respuesta HTTP directa)

Clientes receptores
  ├─ Dashboard: mesa cambia a estado "Activa"
  └─ pwaWaiter: animación azul parpadeante, mesa aparece como ocupada
```

**Nota:** El código de mesa NO es único entre sucursales — el `branch_slug` es obligatorio para identificar la mesa correcta.

---

### Flujo 5: ENTITY_UPDATED — Admin actualiza un producto

**Trigger:** Un administrador modifica un producto desde el Dashboard.

**Criticidad:** Baja — evento informativo, usa Direct Async.

```
Dashboard (cliente)
  └─ ProductEditor form (React 19 useActionState)
      └─ productStore.update()
          └─ productAPI.update(productId, formData)
              └─ PATCH /api/admin/products/{id}
                  Header: Authorization: Bearer {JWT}
                  Body: { name, description, price_cents, allergen_ids, branch_prices }

Backend (rest_api)
  └─ admin_router.update_product()
      └─ ProductService.update_full()
          ├─ PermissionContext(user).require_management()
          ├─ UPDATE Product (campos básicos)
          ├─ UPSERT BranchProduct (precios por sucursal)
          ├─ SYNC ProductAllergen (agregar/quitar)
          └─ safe_commit()
      └─ publish_entity_updated()  ← DIRECT ASYNC (sin outbox, sin background task)
          └─ Redis Stream inmediato

WebSocket Gateway (ws_gateway)
  └─ EventRouter.route_event(ENTITY_UPDATED)
      ├─ send_to_admins(branch_id)   → Dashboard WS ÚNICAMENTE
      ├─ NO mozos                    ← ADMIN_ONLY_EVENTS
      ├─ NO cocina
      └─ NO comensales

Clientes receptores
  └─ Dashboard: invalidar cache local, refetch del producto actualizado
      └─ Otros tabs/admins ven el cambio en tiempo real
```

**Nota:** Los eventos ENTITY_* (CREATED, UPDATED, DELETED) son exclusivos del Dashboard. Los mozos, cocina y comensales no reciben estos eventos — consumen datos actualizados via polling o al cargar la página.

---

### Tabla Resumen de Flujos

| Flujo | Evento | Patrón | Canal Redis | Destinatarios | Filtro por sector |
|-------|--------|--------|-------------|---------------|-------------------|
| 1. Pedido | `ROUND_PENDING` | Background task | Stream | Admins + TODOS los Mozos | No (branch-wide) |
| 2. Llamada mozo | `SERVICE_CALL_CREATED` | Outbox | Stream | Admins + Mozos del sector | SÍ |
| 3. Pedir cuenta | `CHECK_REQUESTED` | Outbox | Stream | Admins + Mozos + Comensales | No |
| 4. Escaneo QR | `TABLE_SESSION_STARTED` | Direct Redis | Stream | Admins + TODOS los Mozos | No (branch-wide) |
| 5. CRUD admin | `ENTITY_UPDATED` | Direct Async | Stream | Admins ÚNICAMENTE | No |

---

## Flujos de Datos y Transformaciones

### Diagrama de Capas de Datos

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (React)                      │
│  Estado Zustand ← selectors ← componentes               │
│  Tipos: string IDs, float precios, lowercase status      │
├─────────────────────────────────────────────────────────┤
│                    API LAYER (fetch)                      │
│  fetchAPI() → headers auth → JSON body                   │
│  Conversión: parseInt(id), Math.round(price * 100)       │
├─────────────────────────────────────────────────────────┤
│                    BACKEND (FastAPI)                      │
│  Routers (thin) → Domain Services → Repositories         │
│  Pydantic schemas: validación y serialización             │
│  Tipos: int IDs, int centavos, UPPERCASE enums            │
├─────────────────────────────────────────────────────────┤
│                    DATABASE (PostgreSQL)                  │
│  BigInteger IDs, Integer price_cents                     │
│  Boolean is_active (soft delete)                         │
│  JSONB para metadata flexible                            │
├─────────────────────────────────────────────────────────┤
│                    CACHE (Redis)                          │
│  Token blacklist (TTL = token expiry)                    │
│  Event streams (pub/sub para WebSocket)                  │
│  Session cache (opcional, para performance)               │
└─────────────────────────────────────────────────────────┘
```

### Conversiones de Tipos: Frontend <-> Backend

#### Precios (centavos <-> pesos)

La conversión de precios es una de las transformaciones más críticas del sistema. Un error aquí genera discrepancias financieras.

```
BACKEND (almacenamiento y lógica)
  └─ Tipo: INTEGER (centavos)
  └─ Ejemplo: 12550 (representa $125.50)
  └─ Razón: evitar errores de punto flotante en operaciones financieras

API (transporte JSON)
  └─ Campo: price_cents
  └─ Tipo: number
  └─ Ejemplo: { "price_cents": 12550 }

FRONTEND (presentación)
  └─ Tipo: number (pesos, float)
  └─ Conversión: backendCents / 100
  └─ Ejemplo: 12550 / 100 = 125.50 → formateado como "$125.50"

FRONTEND → BACKEND (envío)
  └─ Conversión: Math.round(inputPesos * 100)
  └─ Ejemplo: Math.round(125.50 * 100) = 12550
  └─ IMPORTANTE: Math.round() previene errores como 125.50 * 100 = 12549.999...
```

#### IDs (BigInteger <-> string)

```
BACKEND (PostgreSQL)
  └─ Tipo: BigInteger (autoincremental)
  └─ Ejemplo: 42

API (transporte JSON)
  └─ Tipo: number
  └─ Ejemplo: { "id": 42 }

FRONTEND (estado y componentes)
  └─ Tipo: string
  └─ Conversión: String(backendId)
  └─ Ejemplo: "42"
  └─ Razón: consistencia con crypto.randomUUID() para IDs locales temporales

FRONTEND → BACKEND (envío)
  └─ Conversión: parseInt(frontendId, 10)
  └─ Ejemplo: parseInt("42", 10) = 42
```

#### Estado de sesión (UPPERCASE <-> lowercase)

```
BACKEND (enum)
  └─ Valores: "OPEN" | "PAYING" | "CLOSED"

API (transporte)
  └─ { "status": "PAYING" }

FRONTEND (estado local)
  └─ Valores: 'active' | 'paying' | 'closed'
  └─ Conversión:
      switch(response.status) {
        case 'OPEN':   return 'active'
        case 'PAYING': return 'paying'
        case 'CLOSED': return 'closed'
      }
```

#### Roles (backend <-> frontend)

```
BACKEND (constantes)
  └─ Roles.ADMIN = "ADMIN"
  └─ Roles.MANAGER = "MANAGER"
  └─ Roles.WAITER = "WAITER"
  └─ Roles.KITCHEN = "KITCHEN"

JWT payload
  └─ { "roles": ["ADMIN"], "branch_ids": [1, 2] }

FRONTEND (estado)
  └─ Mismos valores uppercase
  └─ Sin conversión necesaria
```

### Resumen de Transformaciones por Capa

| Dato | PostgreSQL | Backend (Python) | API (JSON) | Frontend (TS) | UI (display) |
|------|-----------|------------------|------------|---------------|--------------|
| ID | `BIGINT` | `int` | `number` | `string` | `"42"` |
| Precio | `INTEGER` (cents) | `int` (cents) | `number` (cents) | `number` (pesos) | `"$125.50"` |
| Estado sesión | `VARCHAR` | `str` UPPER | `string` UPPER | `string` lower | `"Pagando"` |
| Booleano | `BOOLEAN` | `bool` | `boolean` | `boolean` | Icono/color |
| Fecha | `TIMESTAMP` | `datetime` | `string` ISO | `Date` | `"hace 5 min"` |
| Email | `VARCHAR(255)` | `str` | `string` | `string` | `"admin@..."` |
| Imagen | `TEXT` (URL) | `str` (validada) | `string` | `string` | `<img src>` |

---

## Ejemplos de Flujos de Datos Completos

### Creación de Producto (UI → API → DB → Notificación)

**UI → API:**
```
Dashboard (React 19)
  └─ ProductEditor (componente de formulario)
      └─ useActionState() maneja submit
          └─ productStore.addProduct(formData)
              ├─ Conversión de precio: inputPesos * 100 → price_cents (int)
              ├─ Conversión de IDs: string → parseInt(id, 10)
              └─ productAPI.create(payload)
                  └─ fetchAPI('POST', '/api/admin/products', {
                        name: "Milanesa napolitana",
                        description: "Con jamón y queso",
                        price_cents: 12550,
                        category_id: 3,
                        subcategory_id: 7,
                        image_url: "https://...",
                        allergen_ids: [1, 4],
                        branch_prices: [
                          { branch_id: 1, price_cents: 12550, is_active: true },
                          { branch_id: 2, price_cents: 13000, is_active: true }
                        ]
                      })
```

**API → Backend:**
```
Backend (FastAPI)
  └─ admin_router.create_product()
      └─ PermissionContext(user).require_management()
      └─ ProductService(db).create(data, tenant_id)
          └─ _validate_create():
              ├─ Verificar nombre único por tenant
              ├─ validate_image_url(url) → bloquear SSRF
              └─ Verificar category_id y subcategory_id existen
          └─ Operaciones DB:
              ├─ INSERT INTO product (name, description, price_cents, ...)
              ├─ INSERT INTO branch_product (product_id, branch_id, price_cents, is_active)
              └─ INSERT INTO product_allergen (product_id, allergen_id, presence_type)
          └─ safe_commit()
          └─ _after_create(): publish_entity_created(entity='product', id=42)
```

**Backend → UI (respuesta):**
```
Dashboard recibe respuesta:
  └─ productStore actualiza estado local
      ├─ id: String(42) = "42"        // Backend number → Frontend string
      └─ displayPrice: 12550 / 100 = "$125.50"
  └─ WebSocket recibe ENTITY_CREATED
      └─ Otros tabs/admins actualizan en tiempo real
```

### Autenticación (Login)

```
Frontend (cualquier app)
  └─ LoginForm
      └─ POST /api/auth/login
          Body: { email: "admin@demo.com", password: "admin123" }

Backend
  └─ auth_router.login()
      ├─ Buscar usuario por email
      ├─ Verificar bcrypt hash del password
      ├─ Generar access_token (JWT, 15 min)
      │   Payload: { sub: "1", tenant_id: 1, branch_ids: [1,2], roles: ["ADMIN"] }
      ├─ Generar refresh_token (JWT, 7 días)
      └─ Response:
          Body: { access_token: "eyJ...", user: { id: 1, email: "...", roles: [...] } }
          Set-Cookie: refresh_token=eyJ...; HttpOnly; Secure; SameSite=Lax; Path=/api/auth

Frontend recibe
  └─ authStore.setAuth(response)
      ├─ Guardar access_token en memoria (NO localStorage)
      ├─ refresh_token en HttpOnly cookie (automático)
      └─ Iniciar timer de refresh proactivo (cada 14 min)
```

### Sesión de Mesa (QR → Token)

```
pwaMenu
  └─ Usuario escanea QR → URL: https://app.com/mesa/INT-01?branch=sucursal-centro
      └─ JoinTable page extrae parámetros
          └─ POST /api/tables/code/INT-01/session
              Body: { branch_slug: "sucursal-centro", diner_name: "Carlos" }

Backend
  └─ table_service.get_or_create_session()
      ├─ Buscar table por code + branch_slug
      ├─ Crear o recuperar TableSession
      ├─ Crear Diner (nombre, device_id)
      └─ Generar table_token:
          JWT payload: {
            table_id: 5,
            session_id: 12,
            branch_id: 1,
            diner_id: 8,
            tenant_id: 1,
            exp: now + 3h
          }

pwaMenu recibe
  └─ sessionStore.setSession()
      ├─ Guardar table_token en localStorage (TTL 8h check)
      ├─ Guardar datos de sesión en estado Zustand
      └─ Conectar WebSocket: /ws/diner?table_token={token}
```

### Carrito Compartido (Sincronización Multi-dispositivo)

```
Comensal A agrega item
  └─ pwaMenu: cartStore.addItem({ product_id: 42, quantity: 2, notes: "Sin sal" })
      └─ POST /api/diner/cart/items
          Header: X-Table-Token
          Body: { product_id: 42, quantity: 2, notes: "Sin sal" }

Backend
  └─ INSERT CartItem (session_id, diner_id, product_id, quantity, notes)
  └─ Publicar CART_ITEM_ADDED via Redis (direct)
      Payload: {
        session_id: 12,
        diner_id: 8,
        diner_name: "Carlos",
        diner_color: "#3B82F6",
        item: { product_id: 42, name: "Milanesa", quantity: 2, price_cents: 12550 }
      }

WebSocket Gateway
  └─ EventRouter → send_to_session(session_id: 12)
      └─ SOLO comensales de esa mesa (NO mozos, NO cocina, NO admin)

Comensal B (otro dispositivo, misma mesa)
  └─ Recibe CART_ITEM_ADDED via WebSocket
      └─ cartStore actualiza estado local
          └─ UI muestra: "Carlos agregó 2x Milanesa" con color azul del comensal
```

### Consulta de Menú Público (Sin Autenticación)

```
pwaMenu
  └─ MenuPage carga
      ├─ Verificar cache localStorage (TTL 8 horas)
      │   └─ Si cache válido y no expirado → usar datos locales (sin request)
      └─ Si cache inválido o expirado:
          └─ GET /api/public/menu/{slug}
              Sin headers de auth
              Response: {
                branch: { name, slug, address },
                categories: [
                  {
                    id: 3,
                    name: "Platos principales",
                    subcategories: [
                      {
                        id: 7,
                        name: "Carnes",
                        products: [
                          {
                            id: 42,
                            name: "Milanesa napolitana",
                            price_cents: 12550,
                            image_url: "https://...",
                            allergens: [{ id: 1, icon: "gluten", name: "Gluten" }]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }

pwaMenu recibe
  └─ menuStore.setMenu(response)
      ├─ Guardar en estado Zustand (runtime)
      ├─ Guardar en localStorage con timestamp (cache 8h)
      └─ Precios: price_cents / 100 para display
```
