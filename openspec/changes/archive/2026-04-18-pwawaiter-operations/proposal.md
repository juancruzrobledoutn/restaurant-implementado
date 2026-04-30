## Why

C-20 (pwaWaiter-shell) dejó el scaffold del mozo listo: pre-login flow, authStore JWT in-memory, tableStore shell-only, push notifications y WebSocket reconnect. Pero sin este change el mozo no puede hacer su trabajo real: no puede tomar pedidos por comanda rápida, confirmar pedidos que llegan desde pwaMenu, atender llamados de servicio, solicitar la cuenta ni registrar pagos manuales. Con C-10/C-11/C-12 ya implementados (rounds, kitchen y billing), el backend waiter expone todos los endpoints necesarios y el WS gateway emite los eventos; solo falta cablear el frontend de operaciones y cerrar el GATE 12 del roadmap.

## What Changes

- Vista de **comanda rápida**: catálogo compacto (sin imágenes) desde `GET /api/waiter/branches/{id}/menu`, carrito local por mesa, envío via `POST /api/waiter/sessions/{id}/rounds` (ronda creada por mozo en estado CONFIRMED).
- **Detalle de mesa**: historial de rondas y estados en tiempo real (PENDING → CONFIRMED → SUBMITTED → IN_KITCHEN → READY → SERVED), botón para confirmar rondas PENDING del comensal (transición WAITER-permitida PENDING→CONFIRMED).
- **Solicitud de cuenta** desde el mozo via `POST /api/waiter/sessions/{id}/check` y **registro de pago manual** (efectivo/tarjeta/transferencia) via `POST /api/waiter/payments/manual` con cierre de mesa `POST /api/waiter/tables/{id}/close`.
- **ServiceCall Inbox**: listado de llamados activos (`GET /api/waiter/service-calls`), ACK (`PUT /ack`), cierre (`PUT /close`), con indicación visual (parpadeo rojo) en TableCard mientras haya llamadas abiertas.
- **Suscripciones WebSocket** en `waiterWsStore`: `ROUND_PENDING`, `ROUND_CONFIRMED`, `ROUND_SUBMITTED`, `ROUND_IN_KITCHEN`, `ROUND_READY`, `ROUND_SERVED`, `ROUND_CANCELED`, `SERVICE_CALL_CREATED`, `SERVICE_CALL_ACKED`, `SERVICE_CALL_CLOSED`, `CHECK_REQUESTED`, `TABLE_SESSION_STARTED`, `TABLE_STATUS_CHANGED`, `TABLE_CLEARED` — actualizan stores y disparan animaciones.
- **RetryQueueStore**: cola persistente (IndexedDB) para operaciones POST/PUT cuando el mozo está offline. Reintenta con backoff al reconectar. Scope acotado: rondas, service-call ack/close, pagos manuales.
- **Extensión de `tableStore`** (shell-only en C-20): ahora hace fetch real a `GET /api/waiter/tables`, deriva estado visual (FREE/ACTIVE/PAYING/OUT_OF_SERVICE) y se actualiza por eventos WS.
- **Catch-up post-reconexión**: al reconectar WS, consumir `GET /ws/catchup?branch_id=&since=&token=` para recuperar eventos perdidos (outbox + last 5 min Redis sorted set).
- **Tests**: comanda rápida (render + submit), máquina de estados de rondas, service-call inbox, pago manual happy path, retry queue (offline→online drain), suscripciones WS (eventos entrantes mutan stores correctamente).

## Capabilities

### New Capabilities
- `pwawaiter-operations`: operación diaria del mozo en pwaWaiter — comanda rápida, gestión de rondas en tiempo real, inbox de service-calls, solicitud de cuenta, pagos manuales y cola offline de reintentos.

### Modified Capabilities
_(ninguna — todos los specs backend afectados (`table-sessions`, el futuro `rounds`, `kitchen`, `billing`) ya definieron sus requirements en changes previos; este change consume contratos sin modificarlos)._

## Impact

- **Código frontend nuevo** (`pwaWaiter/src/`):
  - `services/api.ts` (extensión): `getCompactMenu`, `createWaiterRound`, `confirmRound`, `requestCheck`, `submitManualPayment`, `closeTable`, `listServiceCalls`, `ackServiceCall`, `closeServiceCall`, `catchupEvents`.
  - `stores/compactMenuStore.ts`, `stores/waiterCartStore.ts` (carrito local por sesión), `stores/roundsStore.ts` (rondas por sesión), `stores/serviceCallsStore.ts`, `stores/retryQueueStore.ts`.
  - `stores/tableStore.ts` (extensión de C-20 shell): fetch real + reacción a eventos WS.
  - `stores/waiterWsStore.ts` (extensión): handlers para los 14 eventos listados.
  - `pages/TableDetailPage.tsx` (rondas, service-calls, check, pago), `pages/QuickOrderPage.tsx` (comanda rápida), `pages/ServiceCallsPage.tsx`.
  - `components/RoundCard`, `ServiceCallItem`, `ManualPaymentForm` (React 19 `useActionState`), `CompactMenuGrid`, `OfflineBanner`.
  - `hooks/useRetryQueue.ts`, `hooks/useWaiterSubscriptions.ts` (ref pattern).
  - `lib/idb.ts` (wrapper sobre `idb` lib para retry queue persistence).
- **Sin cambios backend**: todos los endpoints y eventos ya existen (C-10/C-11/C-12/C-13). Este change es 100% frontend integration.
- **Sin cambios DB/migraciones**.
- **Dependencias npm**: agregar `idb` (^8) para IndexedDB promisificado; el resto ya está instalado en C-20.
- **Governance**: MEDIO — implementar con checkpoints; tests obligatorios antes de archivar.
- **Desbloquea**: C-22 (`e2e-critical-flow`) — el flujo end-to-end completo (comensal pide → mozo confirma → cocina prepara → pago) requiere este change operativo.
