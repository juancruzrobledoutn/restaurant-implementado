# Patrones de Diseño

> Resumen de los **57 patrones de diseño** del sistema Integrador / Buen Sabor, incluyendo análisis de brecha entre lo planificado y lo implementado.
>
> Este documento es la referencia canónica de patrones para BaseJR. Al implementar código nuevo, aplicar los mismos patrones documentados aquí.

---

## Patrones Implementados por Capa

### Backend (12 patrones)

| # | Patrón | Tipo GoF/Moderno | Componente | Archivo(s) Clave |
|---|--------|------------------|------------|-------------------|
| 1 | Template Method | Comportamiento (GoF) | REST API | `rest_api/services/base_service.py` |
| 2 | Repository | Datos (DDD) | REST API | `rest_api/services/crud/repository.py` |
| 3 | Specification | Datos (DDD) | REST API | `rest_api/services/crud/repository.py` (líneas 434-620) |
| 4 | Strategy (Permisos) | Comportamiento (GoF) | REST API | `rest_api/services/permissions/strategies.py` |
| 5 | Mixin (AuditMixin) | Estructural (Python) | REST API | `rest_api/services/permissions/strategies.py` (líneas 117-157) |
| 6 | Soft Delete | Datos (Dominio) | REST API | `rest_api/models/base.py`, `rest_api/services/crud/soft_delete.py` |
| 7 | Transactional Outbox | Datos/Mensajería | REST API | `rest_api/services/events/outbox_service.py` |
| 8 | Dependency Injection | Arquitectónico | REST API | `shared/infrastructure/db.py` |
| 9 | Middleware Chain | Comportamiento (GoF) | REST API | `rest_api/main.py`, `rest_api/core/middlewares.py` |
| 10 | Exception Hierarchy | Comportamiento | Shared | `shared/utils/exceptions.py` |
| 11 | Singleton (Settings) | Creacional (GoF) | Shared | `shared/config/settings.py` |
| 12 | Connection Pool | Recursos | Shared | `shared/infrastructure/db.py` |

### WebSocket Gateway (11 patrones)

| # | Patrón | Tipo GoF/Moderno | Componente | Archivo(s) Clave |
|---|--------|------------------|------------|-------------------|
| 13 | Strategy (Auth) | Comportamiento (GoF) | ws_gateway | `ws_gateway/components/auth/strategies.py` |
| 14 | Circuit Breaker | Resiliencia | ws_gateway | `ws_gateway/components/resilience/circuit_breaker.py` |
| 15 | Sliding Window Rate Limiter | Concurrencia | ws_gateway | `ws_gateway/components/connection/rate_limiter.py` |
| 16 | Multi-Dimensional Index | Estructura de Datos | ws_gateway | `ws_gateway/components/connection/index.py` |
| 17 | Sharded Locks | Concurrencia | ws_gateway | `ws_gateway/components/connection/locks.py` |
| 18 | Heartbeat Tracker | Monitoreo | ws_gateway | `ws_gateway/components/connection/heartbeat.py` |
| 19 | Template Method (Endpoints) | Comportamiento (GoF) | ws_gateway | `ws_gateway/components/endpoints/base.py` |
| 20 | Event Router | Comunicación | ws_gateway | `ws_gateway/components/events/router.py` |
| 21 | Worker Pool | Concurrencia | ws_gateway | `ws_gateway/core/connection/broadcaster.py` |
| 22 | Drop Rate Tracker | Monitoreo | ws_gateway | `ws_gateway/core/subscriber/drop_tracker.py` |
| 23 | Retry with Exponential Backoff | Resiliencia | ws_gateway | `ws_gateway/components/resilience/retry.py` |

### Frontend — Dashboard + pwaMenu + pwaWaiter (34 patrones)

#### Estado (5)

| # | Patrón | Tipo | Componente | Archivo(s) Clave |
|---|--------|------|------------|-------------------|
| F1 | Zustand Selectors + EMPTY_ARRAY | Estado / Rendimiento | Todos | `Dashboard/src/stores/authStore.ts`, `pwaMenu/src/stores/tableStore/selectors.ts` |
| F2 | Zustand Persist + Migration | Estado / Persistencia | pwaMenu, pwaWaiter | `pwaMenu/src/stores/tableStore/persist.ts` |
| F3 | useShallow | Estado / Rendimiento | Todos | Selectores con arrays filtrados |
| F4 | useMemo Derived State | Estado / Rendimiento | Todos | Componentes con estado derivado |
| F5 | BroadcastChannel | Estado / Sincronización | Dashboard | `Dashboard/src/stores/authStore.ts` |

#### Hooks Personalizados (8)

| # | Patrón | Tipo | Componente | Archivo(s) Clave |
|---|--------|------|------------|-------------------|
| F6 | useFormModal | Hooks / UI | Dashboard | `Dashboard/src/hooks/useFormModal.ts` |
| F7 | useConfirmDialog | Hooks / UI | Dashboard | `Dashboard/src/hooks/useConfirmDialog.ts` |
| F8 | usePagination | Hooks / Datos | Dashboard | `Dashboard/src/hooks/usePagination.ts` |
| F9 | useOptimisticMutation | Hooks / Datos | Dashboard | `Dashboard/src/hooks/useOptimisticMutation.ts` |
| F10 | useFocusTrap | Hooks / Accesibilidad | Dashboard | `Dashboard/src/hooks/useFocusTrap.ts` |
| F11 | useKeyboardShortcuts | Hooks / Accesibilidad | Dashboard | `Dashboard/src/hooks/useKeyboardShortcuts.ts` |
| F12 | useOptimisticCart (React 19) | Hooks / React 19 | pwaMenu | `pwaMenu/src/hooks/useOptimisticCart.ts` |
| F13 | useSystemTheme | Hooks / UI | pwaMenu | `pwaMenu/src/hooks/useSystemTheme.ts` |

#### Comunicación (8)

| # | Patrón | Tipo | Componente | Archivo(s) Clave |
|---|--------|------|------------|-------------------|
| F14 | Token Refresh Mutex | Seguridad / Comunicación | Dashboard, pwaWaiter | `Dashboard/src/services/api.ts` |
| F15 | 401 Retry | Comunicación / Resiliencia | Dashboard, pwaWaiter | `Dashboard/src/services/api.ts` |
| F16 | AbortController Timeout | Comunicación | Todos | `*/src/services/api.ts` |
| F17 | Request Deduplication | Comunicación / Rendimiento | Dashboard | `Dashboard/src/services/api.ts` |
| F18 | SSRF Prevention | Seguridad | Backend + Frontend | `shared/utils/validators.py` |
| F19 | WebSocket Singleton + Reconnect | Comunicación | pwaMenu, pwaWaiter | `pwaMenu/src/services/websocket.ts`, `pwaWaiter/src/services/websocket.ts` |
| F20 | Observer (Event Subscription) | Comunicación | pwaMenu, pwaWaiter | `*/src/services/websocket.ts` |
| F21 | Proactive Token Refresh | Seguridad | Dashboard, pwaWaiter | `Dashboard/src/services/api.ts` |

#### Seguridad (2)

| # | Patrón | Tipo | Componente | Archivo(s) Clave |
|---|--------|------|------------|-------------------|
| F22 | HttpOnly Cookie | Seguridad | Dashboard, pwaWaiter | `Dashboard/src/services/api.ts` (credentials: 'include') |
| F23 | Throttle | Rendimiento / Seguridad | pwaMenu, pwaWaiter | `*/src/services/websocket.ts` |

#### Offline / PWA (2)

| # | Patrón | Tipo | Componente | Archivo(s) Clave |
|---|--------|------|------------|-------------------|
| F24 | Retry Queue (pwaWaiter) | Offline / Resiliencia | pwaWaiter | `pwaWaiter/src/services/retryQueue.ts` |
| F25 | IndexedDB Queue (pwaMenu) | Offline / Persistencia | pwaMenu | `pwaMenu/src/services/offlineQueue.ts` |

#### Componentes y Formularios (5)

| # | Patrón | Tipo | Componente | Archivo(s) Clave |
|---|--------|------|------------|-------------------|
| F26 | useActionState (React 19) | Formularios / React 19 | pwaMenu | `pwaMenu/src/hooks/useActionState.ts` |
| F27 | Centralized Validation | Validación | Todos | `*/src/utils/validation.ts` |
| F28 | i18n Validation Keys | i18n / Validación | pwaMenu | `pwaMenu/src/utils/validation.ts` |
| F29 | i18n Fallback Chain | i18n | pwaMenu | `pwaMenu/src/i18n/` |
| F30 | Type Conversion Layer | Datos | Todos | `*/src/utils/typeConversion.ts` o inline en stores |

#### Error Handling (2)

| # | Patrón | Tipo | Componente | Archivo(s) Clave |
|---|--------|------|------------|-------------------|
| F31 | Structured Logger | Logging | Todos | `*/src/utils/logger.ts` |
| F32 | Unified Error Classes | Errores / i18n | pwaMenu | `pwaMenu/src/utils/errors.ts` |

#### Rendimiento (2)

| # | Patrón | Tipo | Componente | Archivo(s) Clave |
|---|--------|------|------------|-------------------|
| F33 | Bounded Maps Cleanup | Rendimiento / Memoria | pwaWaiter | `pwaWaiter/src/services/websocket.ts` |
| F34 | Empty Set Cleanup | Rendimiento / Memoria | ws_gateway + Frontend | `ws_gateway/components/connection/index.py`, WebSocket observers |

### Resumen Estadístico

| Capa | Cantidad | Categorías Principales |
|------|----------|------------------------|
| Backend (REST API + Shared) | 12 | Datos, Comportamiento, Arquitectónico |
| WebSocket Gateway | 11 | Resiliencia, Concurrencia, Comunicación |
| Frontend (3 apps) | 34 | Estado, Hooks, Comunicación, Seguridad, Offline |
| **Total** | **57** | |

---

## Estado de Documentación (Planificado vs Implementado)

### Tabla de Estado General

| Patrón | Planificado | Implementado | Estado |
|--------|:-----------:|:------------:|--------|
| Repository Pattern | SÍ | SÍ | Completo |
| Unit of Work | SÍ | PARCIAL | Gap en documentación |
| Service Layer | SÍ | SÍ | Gap en documentación |
| Snapshot Pattern | SÍ | SÍ | Gap en documentación |
| Soft Delete | SÍ | SÍ | Completo |
| Audit Trail Append-Only | SÍ | SÍ | Gap en documentación |
| State Machine (FSM) | SÍ | SÍ | Gap en documentación |
| Idempotent Payments | SÍ | SÍ | Gap en documentación |
| Feature-Sliced Design | SÍ | NO | No implementado |
| Custom Hooks | SÍ | SÍ | Completo |
| Optimistic Updates | SÍ | SÍ | Completo |
| Webhook / IPN | SÍ | SÍ | Gap en documentación |

**Resumen:** 12 patrones planificados, 11 implementados, 4 completamente documentados, 7 con gap en documentación, 1 no implementado.

### Patrones Completos (Planificado + Implementado + Documentado)

**Repository Pattern:**
- **Ubicación:** `backend/rest_api/services/crud/repository.py`
- Jerarquía `BaseRepository` → `TenantRepository` → `BranchRepository` con aislamiento multi-tenant automático. Incluye `SpecificationRepository` para queries componibles.

**Soft Delete:**
- **Ubicación:** `backend/rest_api/models/base.py` (AuditMixin), `backend/rest_api/services/crud/soft_delete.py` (cascade)
- `AuditMixin` con `is_active`, `deleted_at`, `deleted_by_id`, `deleted_by_email`. Cascade soft delete con emisión de evento `CASCADE_DELETE`.

**Custom Hooks:**
- **Ubicación:** 45+ hooks distribuidos en Dashboard, pwaMenu y pwaWaiter
- Documentados como patrones F6-F13. Incluyen hooks de UI, datos, accesibilidad y React 19.

**Optimistic Updates:**
- **Ubicación:** `Dashboard/src/hooks/useOptimisticMutation.ts`, `pwaMenu/src/hooks/useOptimisticCart.ts`
- Dashboard usa hook genérico con rollback. pwaMenu usa `useOptimistic` de React 19 para el carrito.

---

## Gap Analysis: Patrones con Brechas en Documentación

### Unit of Work (Implementación Parcial)

- **Planificación original:** Gestionar transacciones atómicas con UoW explícito.
- **Implementación real:** Implícito via SQLAlchemy Session + `safe_commit()`. No existe una clase `UnitOfWork` explícita; la sesión de SQLAlchemy cumple ese rol.
- **Archivos:** `shared/infrastructure/db.py` (safe_commit, get_db), `rest_api/services/events/outbox_service.py` (escritura atómica)
- **Por qué no se documentó:** Se consideró parte del patrón de Dependency Injection, no como patrón separado.
- **Recomendación:** Documentar como variante implícita. Si el proyecto escala a múltiples fuentes de datos, considerar un UoW explícito.

### Service Layer

- **Planificación original:** Lógica de negocio centralizada, stateless. Independiente del framework.
- **Implementación real:** 14+ servicios de dominio stateless con jerarquía: `BaseService` → `BaseCRUDService` → `BranchScopedService`
- **Archivos:** `rest_api/services/base_service.py`, `rest_api/services/domain/`, `rest_api/services/domain/__init__.py`
- **Por qué no se documentó:** Se documentó parcialmente como parte del patrón Template Method.
- **Recomendación:** Agregar sección dedicada explicando la jerarquía completa.

### Snapshot Pattern

- **Planificación original:** Precios y nombres de producto inmutables al crear el pedido.
- **Implementación real:** `RoundItem` captura `unit_price_cents` y `product_name` al momento de crear el pedido. Estos valores son inmutables incluso si el producto se modifica o elimina después.
- **Archivos:** `rest_api/models/round.py`, `rest_api/services/domain/round_service.py`
- **Recomendación:** Documentar como patrón crítico para integridad de datos históricos.

### Audit Trail Append-Only

- **Planificación original:** Solo INSERT, nunca UPDATE/DELETE en tablas de auditoría.
- **Implementación real:** Dos mecanismos: `AuditLog` (acciones administrativas) y `OutboxEvent` (registro inmutable de eventos de dominio).
- **Archivos:** `rest_api/models/audit.py`, `rest_api/models/outbox.py`, `rest_api/services/events/outbox_service.py`
- **Recomendación:** Agregar sección que explique la política append-only y por qué es crítica para compliance.

### State Machine (FSM)

- **Planificación original:** Transiciones del pedido validadas contra el mapa de transiciones permitidas.
- **Implementación real:** FSM con validación de transiciones Y restricción por rol:
  ```python
  ROUND_TRANSITIONS = {
      RoundStatus.PENDING: [RoundStatus.CONFIRMED, RoundStatus.CANCELED],
      RoundStatus.CONFIRMED: [RoundStatus.SUBMITTED, RoundStatus.CANCELED],
      RoundStatus.SUBMITTED: [RoundStatus.IN_KITCHEN],
      RoundStatus.IN_KITCHEN: [RoundStatus.READY],
      RoundStatus.READY: [RoundStatus.SERVED],
  }
  ROUND_TRANSITION_ROLES = {
      (RoundStatus.PENDING, RoundStatus.CONFIRMED): [Roles.WAITER, Roles.MANAGER, Roles.ADMIN],
      (RoundStatus.CONFIRMED, RoundStatus.SUBMITTED): [Roles.MANAGER, Roles.ADMIN],
      # ...
  }
  ```
- **Archivos:** `shared/config/constants.py`, `rest_api/services/domain/round_service.py`, `rest_api/routers/kitchen/rounds.py`
- **Recomendación:** Patrón crítico para la integridad del flujo de pedidos. Documentar con diagrama de estados.

### Idempotent Payments

- **Planificación original:** UUID como `idempotency_key` para evitar cobros duplicados.
- **Implementación real:** Múltiples capas de protección (defense-in-depth):
  1. `idempotency_key` con constraint UNIQUE en tabla de pagos
  2. Deduplicación a nivel de servicio (verifica existencia antes de procesar)
  3. `SELECT FOR UPDATE` para prevenir race conditions entre requests concurrentes
- **Archivos:** `rest_api/models/billing.py`, `rest_api/services/domain/billing_service.py`, `rest_api/routers/billing/`
- **Recomendación:** Documentar las tres capas de protección como ejemplo de defense-in-depth.

### Webhook / IPN (MercadoPago)

- **Planificación original:** MercadoPago notifica de forma asíncrona el resultado del pago.
- **Implementación real:** Endpoint webhook con verificación de firma HMAC, retry queue y circuit breaker:
  1. `POST /api/mercadopago/webhook` — recibe notificaciones
  2. Verificación de firma HMAC del header de MercadoPago
  3. Retry queue para reintentos en caso de fallo
  4. Circuit breaker para proteger contra cascadas de fallo
- **Archivos:** `rest_api/routers/billing/mercadopago.py`, `rest_api/services/domain/billing_service.py`
- **Recomendación:** Documentar como patrón compuesto de integración con servicios externos.

---

## Patrón No Implementado

### Feature-Sliced Design

- **Planificación original:** Organización por features con límites de importación claros.
- **Estado actual:** Los tres frontends usan organización por tipo (type-based):
  ```
  src/
    components/    # Todos los componentes
    hooks/         # Todos los hooks
    stores/        # Todos los stores
    services/      # Todos los servicios
    utils/         # Todas las utilidades
    pages/         # Todas las páginas
  ```
- **Cómo se vería implementado:**
  ```
  src/
    features/
      cart/
        components/   CartItem.tsx, CartSummary.tsx
        hooks/        useCart.ts, useOptimisticCart.ts
        stores/       cartStore.ts
        api/          cartApi.ts
        index.ts      # Public API de la feature
      menu/
        components/   ProductCard.tsx, CategoryList.tsx
        hooks/        useMenu.ts
        stores/       menuStore.ts
        api/          menuApi.ts
        index.ts
      session/
        ...
    shared/           # Utilidades compartidas entre features
  ```
- **Por qué no se implementó:**
  1. **Tamaño del proyecto:** Cada frontend tiene 15-30 componentes. La organización por tipo es suficiente a esta escala.
  2. **Costo de migración:** Reorganizar los imports de los 3 frontends sería un esfuerzo considerable sin beneficio inmediato.
  3. **Convención del equipo:** La estructura actual funciona bien con los patrones de Zustand stores centralizados.
- **Recomendación:** Si alguna app crece significativamente (50+ componentes), **pwaMenu es la candidata más natural** por tener los dominios más claros (menú, carrito, sesión, pedidos, cliente).

---

## Patrones Emergentes (No Planificados pero Implementados)

Además de los 12 patrones planificados, el proyecto implementó **45 patrones adicionales** que emergieron durante el desarrollo:

- **Backend:** Template Method, Specification, Mixin, Transactional Outbox, Middleware Chain, Exception Hierarchy, Singleton, Connection Pool (8 adicionales)
- **WebSocket Gateway:** 11 patrones completos (Strategy Auth, Circuit Breaker, Rate Limiter, Sharded Locks, Heartbeat Tracker, Template Method Endpoints, Event Router, Worker Pool, Drop Rate Tracker, Retry with Backoff)
- **Frontend:** 34 patrones de estado, hooks, comunicación, seguridad, offline y rendimiento

Esto demuestra que la planificación inicial cubrió los patrones de dominio críticos, pero la implementación requirió una cantidad significativa de patrones de infraestructura, resiliencia y rendimiento que no fueron anticipados.

> **Nota:** Todos los archivos referenciados usan rutas relativas desde `backend/` o la raíz del proyecto `jr2/`.
> Al implementar un patrón nuevo, verificar en esta tabla que ya existe una referencia de implementación en el proyecto antes de inventar una solución diferente.
