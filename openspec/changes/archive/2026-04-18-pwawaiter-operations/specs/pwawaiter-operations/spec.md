## ADDED Requirements

### Requirement: Compact Menu Retrieval
The pwaWaiter SHALL fetch a compact menu (without images) from `GET /api/waiter/branches/{branchId}/menu` when the waiter enters the quick-order flow, cache it in `compactMenuStore` for the duration of the session, and expose it via selectors with `useShallow`.

#### Scenario: Mozo abre comanda rápida por primera vez
- **WHEN** el mozo navega a `/tables/:tableId/quick-order` con conexión estable
- **THEN** el store llama `GET /api/waiter/branches/{branchId}/menu` una sola vez, almacena categorías y productos compactos (id, name, price_cents, subcategory_id, is_available), y renderiza la grilla con botones "Agregar".

#### Scenario: Mozo reentra a comanda rápida en la misma sesión
- **WHEN** el mozo vuelve a `/tables/:tableId/quick-order` después de haberla cargado
- **THEN** el store sirve el menú cacheado sin volver a pegarle al endpoint.

#### Scenario: Falla de red al cargar el menú compacto
- **WHEN** `GET /api/waiter/branches/{branchId}/menu` responde error de red
- **THEN** la pantalla muestra un estado de error con botón "Reintentar" y NO encola la operación en la retry queue (lecturas no se encolan).

### Requirement: Quick Order (Waiter Round Creation)
The pwaWaiter SHALL allow the waiter to build a local cart of menu items per table session and submit it via `POST /api/waiter/sessions/{sessionId}/rounds`. The cart SHALL live in `waiterCartStore` scoped by `sessionId`, use stable string IDs in the frontend, and the payload SHALL convert IDs to numbers at the `services/api.ts` boundary. Every submission MUST include an `Idempotency-Key` header with a client-generated UUID.

#### Scenario: Agregar item al carrito y enviar
- **WHEN** el mozo agrega 2 unidades de un producto al carrito y toca "Enviar comanda"
- **THEN** el frontend hace `POST /api/waiter/sessions/{sessionId}/rounds` con body `{ items: [{ product_id: number, quantity: 2, notes?: string }], client_op_id: uuid }`, recibe 201 con `round_id`, limpia el carrito de esa sesión e inserta la ronda en `roundsStore` con status `CONFIRMED`.

#### Scenario: Carrito vacío
- **WHEN** el mozo toca "Enviar comanda" con 0 items
- **THEN** el botón está deshabilitado y no se hace request.

#### Scenario: Error 409 por sesión en estado PAYING
- **WHEN** el backend responde 409 porque la sesión ya está en PAYING
- **THEN** la UI muestra toast "La mesa ya solicitó la cuenta. No se pueden agregar pedidos." y NO se encola el reintento.

#### Scenario: Fallo de red durante submit
- **WHEN** el POST falla por red
- **THEN** la operación se encola en `retryQueueStore` con op `createRound`, la UI muestra badge "Enviado — sincronizando" sobre la mesa, y se reintenta al volver online respetando el backoff exponencial.

### Requirement: Confirm Pending Round
The pwaWaiter SHALL allow a WAITER to transition a round from `PENDING` to `CONFIRMED` via `POST /api/waiter/sessions/{sessionId}/rounds/{roundId}/confirm`. The operation MUST be retry-queue-eligible and idempotent via `Idempotency-Key`.

#### Scenario: Mozo confirma ronda pendiente del comensal
- **WHEN** llega un evento `ROUND_PENDING` para una mesa y el mozo toca "Confirmar" en la ronda
- **THEN** el frontend pega al endpoint de confirmación, recibe 200, actualiza `roundsStore` a `CONFIRMED`, y la animación de pulso amarillo desaparece.

#### Scenario: Intento de confirmar ronda ya no-PENDING
- **WHEN** el backend responde 409 porque la ronda ya está en otro estado
- **THEN** la UI muestra toast "Estado actualizado" y refresca `roundsStore` con el estado recibido.

### Requirement: Request Check (Waiter-Initiated)
The pwaWaiter SHALL allow the waiter to request the check for an `OPEN` session via `POST /api/waiter/sessions/{sessionId}/check`, triggering the backend to transition the session to `PAYING` and emit `CHECK_REQUESTED` (outbox).

#### Scenario: Mozo solicita la cuenta
- **WHEN** el mozo toca "Solicitar cuenta" en una mesa con sesión OPEN
- **THEN** el frontend hace POST al endpoint, al recibir 200 el evento WS `CHECK_REQUESTED` (que puede llegar antes o después del response) actualiza `tableStore.status = PAYING` y activa pulso violeta.

#### Scenario: Solicitar cuenta en sesión ya PAYING
- **WHEN** el backend responde 409 porque la sesión ya está PAYING
- **THEN** la UI muestra toast informativo y el botón queda deshabilitado.

### Requirement: Manual Payment Registration
The pwaWaiter SHALL allow the waiter to register a manual payment (cash / card / transfer) via `POST /api/waiter/payments/manual`. The form SHALL use React 19 `useActionState`. Amounts MUST be stored and transmitted as integer cents. The form MUST validate that `amount_cents > 0` and `method ∈ {cash, card, transfer}` before submission.

#### Scenario: Registrar pago en efectivo exitoso
- **WHEN** el mozo ingresa $150.50 método "cash" y envía
- **THEN** el frontend hace `POST /api/waiter/payments/manual` con `{ session_id: number, amount_cents: 15050, method: "cash", reference?: string, client_op_id: uuid }`, recibe 201, muestra toast de éxito y actualiza la vista con el nuevo saldo.

#### Scenario: Pago con monto inválido
- **WHEN** el mozo intenta enviar con monto 0 o negativo
- **THEN** la validación cliente bloquea el submit y muestra error inline.

#### Scenario: Red falla durante pago manual
- **WHEN** el POST falla por red
- **THEN** la operación se encola en `retryQueueStore`, la UI marca el pago como "pendiente de sincronizar" con badge visible y NO permite cerrar la mesa hasta que el pago esté confirmado (`APPROVED`).

### Requirement: Close Table
The pwaWaiter SHALL allow closing a `PAYING` session via `POST /api/waiter/tables/{tableId}/close` only when all manual payments for the session have been confirmed (`APPROVED`) and the backend's check is `PAID`.

#### Scenario: Cerrar mesa con todos los pagos confirmados
- **WHEN** la sesión está PAYING, check está PAID y no hay entries pendientes en retry queue para esa sesión
- **THEN** el botón "Cerrar mesa" está habilitado; al tocarlo el backend transiciona sesión a CLOSED y emite `TABLE_CLEARED`, la mesa vuelve a FREE.

#### Scenario: Cerrar mesa con pago pendiente en retry queue
- **WHEN** hay un entry `submitManualPayment` pendiente en la retry queue para la sesión
- **THEN** el botón "Cerrar mesa" queda deshabilitado con tooltip "Hay pagos sin sincronizar".

### Requirement: Service Call Inbox
The pwaWaiter SHALL maintain a `serviceCallsStore` populated from `GET /api/waiter/service-calls` and updated in real time by `SERVICE_CALL_CREATED` / `ACKED` / `CLOSED` events. The store SHALL be indexed by `id` and expose selectors filtered by `sectorId` and `tableId`.

#### Scenario: Llegada de nueva llamada de servicio
- **WHEN** el mozo recibe evento `SERVICE_CALL_CREATED` con `sector_id` asignado
- **THEN** la llamada se inserta en `serviceCallsStore`, la `TableCard` asociada muestra parpadeo rojo y se dispara un sonido de alerta (opt-in).

#### Scenario: Mozo acusa recibo
- **WHEN** el mozo toca "Acusé recibo" en una llamada activa
- **THEN** el frontend pega `PUT /api/waiter/service-calls/{id}/ack`, actualiza el estado a ACKED, el parpadeo rojo se detiene pero la llamada sigue listada hasta que se cierre.

#### Scenario: Mozo cierra la llamada
- **WHEN** el mozo toca "Cerrar llamada"
- **THEN** el frontend pega `PUT /api/waiter/service-calls/{id}/close`, la llamada se remueve de `serviceCallsStore` al recibir 200 o el evento `SERVICE_CALL_CLOSED`.

#### Scenario: ACK o Close fallan por red
- **WHEN** la request falla por red
- **THEN** la operación se encola en `retryQueueStore` con idempotencia; el botón vuelve a habilitarse pero la UI muestra estado "pendiente".

### Requirement: Real-Time Table Status (Derived Visual State)
The pwaWaiter SHALL derive the visual state of each table (`FREE | ACTIVE | PAYING | OUT_OF_SERVICE`) and its active animation (red blink / yellow pulse / orange blink / violet pulse / blue blink) from `tableStore`, `roundsStore`, and `serviceCallsStore` via a pure function, never storing the derived value. Animation priority: service call > pending round > ready round > check requested > recent status change.

#### Scenario: Mesa con service call y ronda pendiente simultáneas
- **WHEN** una mesa tiene un `SERVICE_CALL` abierto y una ronda `PENDING`
- **THEN** la `TableCard` muestra parpadeo rojo (prioridad más alta), no amarillo.

#### Scenario: Todas las rondas pasan a SERVED
- **WHEN** la última ronda de la mesa transiciona a SERVED y no hay animaciones activas
- **THEN** la `TableCard` queda en color sólido según su estado (ACTIVE en rojo sólido, etc.), sin animación.

### Requirement: WebSocket Subscriptions with Ref Pattern
The pwaWaiter SHALL use the two-effects ref pattern (skill `ws-frontend-subscription`) in `useWaiterSubscriptions`: one effect for store refs (dependency `[]`), another for subscriptions (dependency on navigation scope). Every `wsService.on(...)` SHALL return an unsubscribe function from the effect.

#### Scenario: Re-render no duplica suscripciones
- **WHEN** `TableDetailPage` re-renderiza 5 veces por cambio de state no relacionado
- **THEN** sigue habiendo exactamente una suscripción por evento en `wsService`.

#### Scenario: Cambio de ruta libera suscripciones
- **WHEN** el mozo navega de `TableDetailPage` a `/tables`
- **THEN** las suscripciones específicas de la página (`ROUND_*`, `CHECK_*`) se liberan via unsubscribe.

### Requirement: Retry Queue with IndexedDB Persistence
The pwaWaiter SHALL persist a retry queue in IndexedDB (library `idb` ^8) for the operations: `createRound`, `confirmRound`, `ackServiceCall`, `closeServiceCall`, `requestCheck`, `submitManualPayment`, `closeTable`. Each entry SHALL carry a client-generated UUID sent as `Idempotency-Key`. Backoff: `min(1000 * 2^attempts, 30000) + jitter(0..500)`. Max 10 attempts, cap 500 entries, scoped by `userId`.

#### Scenario: Operación encolada drena al volver online
- **WHEN** un `createRound` se encola offline y luego el device recupera conexión
- **THEN** `retryQueueStore` detecta el `online` event y el WS `open`, reintenta el POST con el mismo `client_op_id` (idempotencia), y al recibir 201 elimina el entry.

#### Scenario: Backoff entre intentos fallidos
- **WHEN** un reintento falla por 5xx
- **THEN** el entry incrementa `attempts`, calcula `nextAttemptAt = now + backoff(attempts)`, y NO se reintenta antes de ese timestamp.

#### Scenario: Falla definitiva tras 10 intentos
- **WHEN** una operación acumula 10 intentos fallidos
- **THEN** se marca `failed: true`, se muestra toast persistente con opciones "Reintentar manualmente" o "Descartar", y NO se reintenta automáticamente más.

#### Scenario: Cola scoped por usuario
- **WHEN** el mozo A cierra sesión y el mozo B se loguea en el mismo device
- **THEN** el mozo B NO ve las entries del mozo A; cada key es `{userId}:{entryId}`.

#### Scenario: Cap de 500 entries
- **WHEN** la cola alcanza 500 entries
- **THEN** nuevas operaciones son rechazadas con toast "Demasiadas operaciones offline — sincronice primero" y el botón correspondiente queda deshabilitado.

### Requirement: Event Catch-Up on Reconnect
The pwaWaiter SHALL invoke `GET /ws/catchup?branch_id=&since=&token=` after a successful WS reconnection following a disconnect. The `since` parameter SHALL be the timestamp of the last received event, persisted in `localStorage` as `waiter:lastEventTimestamp`. Recovered events SHALL be replayed through the same event handlers as live events.

#### Scenario: Reconexión con eventos perdidos en los últimos 5 min
- **WHEN** el WS reconecta después de 30 segundos offline y `since` indica un timestamp hace 30 segundos
- **THEN** el frontend pide `/ws/catchup`, recibe los eventos perdidos (ej: un `ROUND_READY`), los replay-ea y los stores se actualizan correctamente.

#### Scenario: Reconexión después de más de 5 minutos
- **WHEN** el WS reconecta después de 7 minutos y `catchup` retorna resultado parcial
- **THEN** la UI muestra banner "Datos pueden estar desactualizados" con botón "Actualizar" que re-fetcha `/api/waiter/tables` y `/api/waiter/service-calls`.

#### Scenario: Primera conexión (sin timestamp previo)
- **WHEN** el mozo se loguea por primera vez y no hay `lastEventTimestamp`
- **THEN** NO se hace catch-up; se hace fetch inicial de mesas y service-calls como baseline.

### Requirement: Zustand Store Conventions (Selectors and Stable References)
Every store created in this change (`compactMenuStore`, `waiterCartStore`, `roundsStore`, `serviceCallsStore`, `retryQueueStore`) and the extensions of `tableStore` / `waiterWsStore` SHALL be consumed via named selectors with `useShallow` for objects and arrays. Components MUST NOT destructure stores. Empty-array fallbacks MUST use a stable `EMPTY_ARRAY` constant, not inline `?? []`.

#### Scenario: Consumer uses selector + useShallow
- **WHEN** un componente lee un array de rondas del store
- **THEN** lo hace con `const rounds = useRoundsStore(useShallow(selectRoundsBySession(sessionId)))` y NUNCA con `const { rounds } = useRoundsStore()`.

#### Scenario: Fallback estable para arrays vacíos
- **WHEN** el selector no encuentra rondas para una sesión
- **THEN** retorna la misma referencia `EMPTY_ARRAY` exportada desde `lib/constants.ts` y NUNCA `?? []` inline.

### Requirement: Routes and Pages
The pwaWaiter SHALL expose the routes `/tables/:tableId` (TableDetailPage), `/tables/:tableId/quick-order` (QuickOrderPage), and `/service-calls` (ServiceCallsPage), all guarded by `authStore` and `branchAssignmentGuard`.

#### Scenario: Acceso a TableDetailPage sin sesión de mesa
- **WHEN** el mozo navega a `/tables/:tableId` donde la mesa no tiene sesión activa
- **THEN** se muestra opción "Activar mesa" que llama `POST /api/waiter/tables/{tableId}/activate`.

#### Scenario: Acceso a TableDetailPage con sesión activa
- **WHEN** el mozo navega a `/tables/:tableId` con sesión OPEN
- **THEN** se renderiza el detalle con lista de rondas, botón "Comanda rápida", inbox de service-calls de la mesa, y acciones de cuenta/pago según estado.

#### Scenario: Acceso sin asignación de branch vigente
- **WHEN** el guard detecta `!isAssignedToday`
- **THEN** redirige a la pantalla "Acceso Denegado" de C-20.

### Requirement: Testing Coverage
The change SHALL ship with Vitest tests covering:
- `compactMenuStore` (fetch + cache hit)
- `waiterCartStore` (add/remove/clear items, sessionId scoping)
- `roundsStore` (state transitions via WS events, upsert-by-id idempotency)
- `serviceCallsStore` (insert/ack/close via events, filter by sector)
- `retryQueueStore` (enqueue, drain on online, backoff, user scoping, cap)
- `lib/tableState.ts` `deriveVisualState` (animation priority matrix)
- `useWaiterSubscriptions` hook (no duplicate subscriptions on re-render, unsubscribe on unmount)
- `ManualPaymentForm` (validation + success + retry enqueue paths)
- `QuickOrderPage` (render menu + submit round happy path)
- Catch-up integration (replay events updates stores)

All tests SHALL pass `npm run test` and `npm run typecheck` with 0 errors before the change can be archived.

#### Scenario: Suite completa en CI
- **WHEN** se ejecuta `npm run test` en `pwaWaiter/`
- **THEN** todos los archivos de test del change pasan y no hay regresiones en los tests heredados de C-20.
