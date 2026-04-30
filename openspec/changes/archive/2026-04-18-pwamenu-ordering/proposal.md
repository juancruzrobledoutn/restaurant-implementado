## Why

Con el shell de pwaMenu (C-17) los comensales ya pueden escanear el QR, activar la sesión por Table Token y recorrer el menú público — pero **no pueden pedir**. Falta la pieza central de la experiencia del cliente: un **carrito compartido multi-dispositivo** dentro de la mesa, el flujo de **confirmación grupal** hacia una ronda, los **updates en tiempo real** del estado de esa ronda (CONFIRMED → SUBMITTED → IN_KITCHEN → READY → SERVED) y la **tolerancia a pérdida de conectividad** típica de un restaurante (wifi saturado, 4G en sótano). Sin este change, C-10 (rondas, ya archivado) no tiene consumidor por parte del comensal, la experiencia del cliente queda muerta en la pantalla del menú, y C-19 (billing / check request) no puede encadenar. Este change activa el loop diner → round → kitchen end-to-end desde el lado del comensal.

## What Changes

- **`cartStore` (Zustand)**: estado del carrito compartido de la mesa, replicado por eventos WS. Guarda items propios + items de otros comensales con `diner_id`, `diner_name` y `diner_color`. Selectores con `useShallow`, `EMPTY_ARRAY` estable como fallback, nunca destructuring directo.
- **Optimistic UI con React 19 `useOptimistic`**: hook `useOptimisticCart` para add/update/remove — el item se muestra inmediatamente con flag `pending`, y se confirma o revierte según la respuesta del backend (o el evento WS entrante). Reduce la percepción de lag en conexiones lentas.
- **Shared cart UX**: cada ítem del carrito compartido muestra avatar (inicial + color asignado) del comensal que lo agregó. Items propios son editables (cantidad/notas/eliminar); items de otros son solo-lectura. Badge con contador total de items y subtotal de la mesa.
- **Group confirmation flow**: pantalla `/cart/confirm` muestra el resumen agrupado por comensal, detalle total con subtotales por ítem, input de notas opcionales de ronda, y botón "Enviar ronda" que llama `POST /api/diner/rounds`. Bloqueo si la mesa está en PAYING.
- **`roundsStore` (Zustand)**: rondas enviadas por la sesión, con status reactivo a eventos WS `ROUND_CONFIRMED/SUBMITTED/IN_KITCHEN/READY/SERVED/CANCELED`. Historial visible en pantalla `/rounds` con colores por estado (naranja pulsante para READY).
- **WebSocket diner wiring**: conexión a `/ws/diner?table_token=...` usando ref pattern (dos effects — setup + subscribe, `return unsubscribe` siempre), handlers para `CART_ITEM_ADDED/UPDATED/REMOVED/CLEARED`, `ROUND_*` y `TABLE_STATUS_CHANGED`. Autoreconexión con backoff exponencial (1s → 30s, 50 intentos).
- **Event catch-up al reconectar**: al volver de RECONNECTING → CONNECTED, llamar `GET /ws/catchup/session?session_id=...&since=...&table_token=...`, aplicar eventos en orden e idempotentemente al `cartStore` y `roundsStore`. Deduplicación por `event_id`.
- **`retryQueueStore`**: cola persistida en `localStorage` con operaciones de mutación fallidas (add/update/remove cart, submit round, service call). Cuando el navegador recupera conectividad (`online` event + ping al backend), reprocesa la cola en orden FIFO. Marca visualmente el item como "en reintento" hasta que confirma.
- **Bloqueo en PAYING**: cuando `tableSession.status === 'PAYING'`, deshabilitar el botón "Agregar al carrito" en productos, ocultar el CTA de "Enviar ronda", mostrar banner informativo traducido ("La cuenta ya fue solicitada, no se pueden agregar pedidos"). Rechazo defensivo en el cliente + rechazo autoritativo en backend (409).
- **i18n es/en/pt**: ~80 keys nuevas en `cart`, `rounds`, `connection` y `errors` (cero strings hardcodeadas).
- **Tests**: unit de `cartStore` (optimistic add/remove, reconciliación con WS, idempotencia de CART_ITEM_ADDED duplicado), `retryQueueStore` (encolado, reintento, orden FIFO, persistencia), handler de WS events, bloqueo en PAYING, catch-up tras reconexión.

Governance: **MEDIO** — toca la ruta crítica del pedido del comensal (si se rompe, el cliente no puede ordenar), pero no toca pagos ni staff management. Requiere checkpoints de revisión en: (1) diseño del optimistic UI + reconciliación, (2) contract de eventos WS, (3) estrategia de retry/catch-up.

## Capabilities

### New Capabilities
- `pwamenu-ordering`: Experiencia de pedido del comensal en pwaMenu. Cubre el carrito compartido multi-dispositivo con optimistic UI, el flujo de confirmación de ronda, el seguimiento en tiempo real del estado de las rondas vía WebSocket, el event catch-up post-reconexión, la cola de reintento de operaciones ante pérdida de conectividad, y el bloqueo defensivo de nuevos pedidos cuando la mesa está en estado PAYING.

### Modified Capabilities

Ninguna. `pwamenu-foundation` (C-17) cubre el shell (auth, sesión, menú público, i18n base, service worker) y permanece intacto — este change consume la `sessionStore` existente y agrega stores/páginas/servicios adicionales. Las capabilities de backend (`rounds`, `table-sessions`) tampoco cambian: este change solo las consume.

## Impact

- **Afectado**: `pwaMenu/` (100% frontend, cero cambios backend)
  - `pwaMenu/src/stores/cartStore.ts` — nuevo
  - `pwaMenu/src/stores/roundsStore.ts` — nuevo
  - `pwaMenu/src/stores/retryQueueStore.ts` — nuevo
  - `pwaMenu/src/services/dinerApi.ts` — extender con cart/rounds endpoints
  - `pwaMenu/src/services/ws/dinerWS.ts` — nuevo (cliente WS con ref pattern + backoff)
  - `pwaMenu/src/services/catchup.ts` — nuevo (cliente de `/ws/catchup/session`)
  - `pwaMenu/src/hooks/useOptimisticCart.ts` — nuevo (wrapper de `useOptimistic` React 19)
  - `pwaMenu/src/hooks/useDinerWS.ts` — nuevo (hook de suscripción + auto-reconexión)
  - `pwaMenu/src/pages/{CartPage,CartConfirmPage,RoundsPage}.tsx` — nuevas
  - `pwaMenu/src/components/cart/{CartItem,CartSharedItem,CartTotals,CartBlockedBanner,DinerAvatar}.tsx` — nuevos
  - `pwaMenu/src/components/rounds/{RoundCard,RoundStatusBadge,RoundItemList}.tsx` — nuevos
  - `pwaMenu/src/types/{cart,round,wsEvents}.ts` — interfaces compartidas
  - `pwaMenu/src/i18n/locales/{es,en,pt}.json` — ~80 keys nuevas en `cart`, `rounds`, `connection`, `errors`
  - `pwaMenu/src/tests/` — tests de cartStore, retryQueueStore, dinerWS, CartConfirmPage
- **Dependencias (ya archivadas, solo consumir)**:
  - C-08 `table-sessions`: Table Token HMAC, `TableSession.status` (OPEN/PAYING/CLOSED)
  - C-09 `ws-gateway-base`: endpoint `/ws/diner`, endpoint `/ws/catchup/session`, routing de eventos por sesión
  - C-10 `rounds`: `POST /api/diner/rounds`, `GET /api/diner/rounds`, eventos `ROUND_*` (outbox + direct Redis)
  - C-17 `pwamenu-foundation`: `sessionStore`, cliente API, i18n base, routing
- **Eventos consumidos desde WS gateway**:
  - `CART_ITEM_ADDED`, `CART_ITEM_UPDATED`, `CART_ITEM_REMOVED`, `CART_CLEARED` (direct Redis)
  - `ROUND_CONFIRMED`, `ROUND_IN_KITCHEN`, `ROUND_SERVED`, `ROUND_CANCELED` (direct Redis)
  - `ROUND_SUBMITTED`, `ROUND_READY` (outbox, at-least-once)
  - `TABLE_STATUS_CHANGED` (para bloqueo en PAYING)
- **Sin migraciones** — pwaMenu no toca la DB. Los endpoints ya existen en C-10/C-09.
- **Riesgos**:
  - Desincronización entre carrito local y carrito compartido si se pierden eventos WS → mitigación: catch-up tras reconexión + endpoint `GET /api/diner/cart` para hidratación idempotente al volver a foreground.
  - Optimistic UI puede mostrar items que luego fallan en backend → mitigación: patrón `pending/confirmed/failed` con rollback automático + retry queue + toast de error.
  - Cola de reintento puede crecer infinitamente con backend caído → mitigación: TTL de 5 min por item en cola, límite de 50 operaciones, descarte con notificación al usuario.
  - Bloqueo en PAYING solo en cliente es bypasseable → mitigación: backend ya rechaza con 409 (C-10), el bloqueo client-side es para UX (no seguridad).
  - `ROUND_READY` llegando dos veces por outbox → mitigación: deduplicación por `(round_id, status)` en `roundsStore`.
