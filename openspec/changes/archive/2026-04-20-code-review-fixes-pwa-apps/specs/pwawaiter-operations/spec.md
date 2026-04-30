## MODIFIED Requirements

### Requirement: Compact Menu Retrieval

The pwaWaiter SHALL fetch a compact menu (without images) from `GET /api/waiter/branches/{branchId}/menu` when the waiter enters the quick-order flow, cache it in `compactMenuStore` for the duration of the session, and expose it via selectors with `useShallow`. Filtering by subcategory SHALL use `subcategoryId` consistently across selectors and components — a product is considered part of a subcategory only when `product.subcategory_id === subcategoryId`. Selectors SHALL NOT mix `category.id` with `subcategoryId` in equality checks. The store SHALL also expose a selector `selectProductById(productId)` returning the product compact record, so that components (e.g., `RoundCard`) can resolve product names by id instead of displaying placeholder text like `"Producto #1234"`.

#### Scenario: Mozo abre comanda rápida por primera vez
- **WHEN** el mozo navega a `/tables/:tableId/quick-order` con conexión estable
- **THEN** el store llama `GET /api/waiter/branches/{branchId}/menu` una sola vez, almacena categorías y productos compactos (id, name, price_cents, subcategory_id, is_available), y renderiza la grilla con botones "Agregar".

#### Scenario: Mozo reentra a comanda rápida en la misma sesión
- **WHEN** el mozo vuelve a `/tables/:tableId/quick-order` después de haberla cargado
- **THEN** el store sirve el menú cacheado sin volver a pegarle al endpoint.

#### Scenario: Falla de red al cargar el menú compacto
- **WHEN** `GET /api/waiter/branches/{branchId}/menu` responde error de red
- **THEN** la pantalla muestra un estado de error con botón "Reintentar" y NO encola la operación en la retry queue (lecturas no se encolan).

#### Scenario: Filtrado por subcategoría es consistente
- **GIVEN** el store tiene productos con `subcategory_id: 10` y otra categoría con `id: 10`
- **WHEN** un componente solicita productos de `subcategoryId: 10`
- **THEN** el selector SHALL filtrar estrictamente por `product.subcategory_id === 10`
- **AND** NO SHALL incluir productos cuyo `category.id === 10` pero distinto `subcategory_id`

#### Scenario: RoundCard resuelve nombre real del producto
- **GIVEN** una ronda contiene `{ product_id: 1234 }` y el `compactMenuStore` tiene ese producto cacheado con `name: "Milanesa napolitana"`
- **WHEN** el componente `RoundCard` renderiza el item
- **THEN** el texto mostrado SHALL ser `"Milanesa napolitana"` resuelto vía `selectProductById(1234)`
- **AND** NO SHALL ser el placeholder `"Producto #1234"`

### Requirement: WebSocket Subscriptions with Ref Pattern

The pwaWaiter SHALL use the two-effects ref pattern (skill `ws-frontend-subscription`) in `useWaiterSubscriptions`: one effect for store refs (dependency `[]`), another for subscriptions (dependency on navigation scope). Every `wsService.on(...)` SHALL return an unsubscribe function from the effect. The WS service SHALL NOT attempt to reconnect on non-recoverable close codes `4001` (AUTH_FAILED), `4003` (FORBIDDEN), and `4029` (RATE_LIMITED); on any of those codes, the service SHALL invoke the corresponding handler (`onAuthFail`, `onForbidden`, `onRateLimited`) and remain disconnected. On all other close codes, reconnection SHALL follow the existing exponential-backoff policy. The service SHALL additionally accept an `onMaxReconnect` handler invoked exactly once when the reconnection attempt cap is reached, so the UI can display a definitive "offline, please reload" state.

#### Scenario: Re-render no duplica suscripciones
- **WHEN** `TableDetailPage` re-renderiza 5 veces por cambio de state no relacionado
- **THEN** sigue habiendo exactamente una suscripción por evento en `wsService`.

#### Scenario: Cambio de ruta libera suscripciones
- **WHEN** el mozo navega de `TableDetailPage` a `/tables`
- **THEN** las suscripciones específicas de la página (`ROUND_*`, `CHECK_*`) se liberan via unsubscribe.

#### Scenario: No reconnect on 4001 (auth failed)
- **WHEN** the WS closes with code `4001`
- **THEN** `waiterWs` SHALL NOT schedule a reconnect
- **AND** it SHALL invoke `onAuthFail()` exactly once

#### Scenario: No reconnect on 4003 (forbidden)
- **WHEN** the WS closes with code `4003`
- **THEN** `waiterWs` SHALL NOT schedule a reconnect
- **AND** it SHALL invoke `onForbidden()` exactly once

#### Scenario: No reconnect on 4029 (rate limited)
- **WHEN** the WS closes with code `4029`
- **THEN** `waiterWs` SHALL NOT schedule a reconnect
- **AND** it SHALL invoke `onRateLimited()` exactly once

#### Scenario: onMaxReconnect fires after attempts exhausted
- **GIVEN** the WS has failed `MAX_RECONNECT_ATTEMPTS` times consecutively
- **WHEN** the final attempt fails
- **THEN** `waiterWs` SHALL invoke `onMaxReconnect()` exactly once
- **AND** SHALL NOT schedule further reconnects

### Requirement: Retry Queue with IndexedDB Persistence

The pwaWaiter SHALL persist a retry queue in IndexedDB (library `idb` ^8) for the operations: `createRound`, `confirmRound`, `ackServiceCall`, `closeServiceCall`, `requestCheck`, `submitManualPayment`, `closeTable`. Each entry SHALL carry a client-generated UUID sent as `Idempotency-Key`. Backoff: `min(1000 * 2^attempts, 30000) + jitter(0..500)`. Max 10 attempts, cap 500 entries, scoped by `userId`. The `drain()` function SHALL process entries in parallel using `Promise.allSettled` with a concurrency cap of 10 concurrent replays at any time, to improve throughput without saturating the backend. Enqueuing SHALL use `useEnqueuedAction` as the standard client API; callers MUST NOT detect "network error" by string-matching `error.message.includes('network')`, and SHALL pass the real `userId` from `authStore` (never the empty string `''`).

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

#### Scenario: drain() processes in parallel with concurrency cap
- **GIVEN** the queue has 30 pending entries
- **WHEN** `drain()` is invoked
- **THEN** at most 10 replays SHALL be in flight concurrently
- **AND** all 30 entries SHALL be attempted via `Promise.allSettled` batches
- **AND** no single failure SHALL abort the remaining batch

#### Scenario: useEnqueuedAction is the canonical enqueuer
- **GIVEN** a submit handler needs to optimistically call an API and fall back to enqueue on network failure
- **WHEN** the handler is implemented
- **THEN** it SHALL use `useEnqueuedAction({ fn, op, userId, buildPayload })`
- **AND** SHALL NOT detect network errors via `error.message.includes('network')`
- **AND** SHALL pass the real authenticated `userId` (never the empty string `''`)

### Requirement: Zustand Store Conventions (Selectors and Stable References)

Every store created in this change (`compactMenuStore`, `waiterCartStore`, `roundsStore`, `serviceCallsStore`, `retryQueueStore`) and the extensions of `tableStore` / `waiterWsStore` SHALL be consumed via named selectors with `useShallow` for objects and arrays. Components MUST NOT destructure stores. Empty-array fallbacks MUST use a stable `EMPTY_ARRAY` constant (typed as `readonly never[]`), not inline `?? []`, and NOT cast the constant via `as unknown as T[]`. Callback handlers used as props or WS subscriptions MUST be wrapped in `useCallback` with an explicit dependency list; in particular, `StaleDataBanner.handleRefresh` SHALL be memoized via `useCallback`. Selector reuse is mandatory: components such as `OfflineBanner` SHALL reuse existing selectors like `selectFailedEntries` rather than define equivalent logic inline. Hooks that expose stable callbacks (e.g., `useEnqueuedAction`) SHALL list concrete property dependencies (`[options.fn, options.op, options.userId, options.buildPayload, enqueue]`), NOT the entire `options` object, to avoid identity churn when callers pass object literals.

#### Scenario: Consumer uses selector + useShallow
- **WHEN** un componente lee un array de rondas del store
- **THEN** lo hace con `const rounds = useRoundsStore(useShallow(selectRoundsBySession(sessionId)))` y NUNCA con `const { rounds } = useRoundsStore()`.

#### Scenario: Fallback estable para arrays vacíos
- **WHEN** el selector no encuentra rondas para una sesión
- **THEN** retorna la misma referencia `EMPTY_ARRAY` exportada desde `lib/constants.ts` y NUNCA `?? []` inline.

#### Scenario: EMPTY_ARRAY typing eliminates casts
- **WHEN** a selector returns `EMPTY_ARRAY` as fallback for a `readonly Round[]` result
- **THEN** the assignment SHALL compile without `as unknown as Round[]` or any equivalent cast

#### Scenario: StaleDataBanner.handleRefresh is memoized
- **WHEN** `StaleDataBanner` renders
- **THEN** its `handleRefresh` SHALL be created via `useCallback` with a concrete dependency list
- **AND** SHALL NOT be a fresh function identity on every render

#### Scenario: OfflineBanner reuses selectFailedEntries
- **WHEN** `OfflineBanner` reads the failed entries from the retry queue store
- **THEN** it SHALL call the existing `selectFailedEntries` selector
- **AND** SHALL NOT define an equivalent selector inline

#### Scenario: useEnqueuedAction deps list is property-scoped
- **WHEN** inspecting the `useCallback` in `useEnqueuedAction`
- **THEN** its dependency array SHALL be exactly `[options.fn, options.op, options.userId, options.buildPayload, enqueue]`
- **AND** SHALL NOT be `[options, enqueue]`

### Requirement: Service Call Inbox

The pwaWaiter SHALL maintain a `serviceCallsStore` populated from `GET /api/waiter/service-calls` and updated in real time by `SERVICE_CALL_CREATED` / `ACKED` / `CLOSED` events. The store SHALL be indexed by `id` and expose selectors filtered by `sectorId` and `tableId`. The `ServiceCallsPage` SHALL honor its `filterSector` UI control: the list displayed (`displayCalls`) SHALL be filtered by the selected `filterSector` value; when `filterSector` is `'all'` (or its equivalent sentinel), all calls SHALL be displayed.

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

#### Scenario: filterSector filters displayCalls
- **GIVEN** `serviceCallsStore` contains calls in sectors `A`, `B`, and `C`
- **WHEN** the user sets `filterSector` to `B`
- **THEN** `displayCalls` SHALL contain only the calls whose `sector_id === B`
- **AND** changing `filterSector` back to `all` SHALL restore all calls in the display

## ADDED Requirements

### Requirement: Catchup endpoint uses JWT Authorization header (never query)

The pwaWaiter SHALL invoke the WS catchup endpoint with the JWT placed in the `Authorization: Bearer <token>` HTTP header, NEVER as a URL query parameter. The previous pattern `fetch(.../ws/catchup?token=${jwt}&...)` is prohibited because JWTs in query strings are exposed in proxy/access logs, browser history, Referer headers, and third-party observability tools. Any callsite in `services/waiter.ts` that builds a catchup URL with a `token` query param SHALL be refactored to pass `Authorization: Bearer <token>` via `fetch(..., { headers })`.

#### Scenario: Catchup request uses Authorization header

- **WHEN** `services/waiter.ts` invokes the catchup endpoint on reconnect
- **THEN** the fetch call SHALL include `Authorization: Bearer <jwt>` in the `headers` option
- **AND** the URL SHALL NOT contain a `token` query parameter

#### Scenario: Old query-param pattern fails typecheck or test

- **WHEN** the codebase is scanned for `?token=`
- **THEN** there SHALL be zero matches in any catchup-related callsite in `pwaWaiter/src/services/`

### Requirement: Payment submission uses useEnqueuedAction with real userId

The `TableDetailPage` `handlePaymentSubmit` handler SHALL delegate enqueue decisions to `useEnqueuedAction`, NOT to ad-hoc `try/catch` blocks that classify errors via `error.message.includes('network')`. The handler SHALL supply the authenticated `userId` from `authStore` (NEVER the empty string `''`) as the retry queue entry scope.

#### Scenario: Handler uses useEnqueuedAction

- **WHEN** `handlePaymentSubmit` is implemented
- **THEN** it SHALL construct the action via `useEnqueuedAction({ fn, op: 'submitManualPayment', userId, buildPayload })`
- **AND** it SHALL NOT contain `error.message.includes('network')` logic
- **AND** the `userId` argument SHALL be the current authenticated user id from `authStore`, never `''`

### Requirement: Parallel retry-queue drain with concurrency cap

The pwaWaiter `retryQueueStore.drain()` SHALL replay entries in parallel using `Promise.allSettled` with a maximum of 10 concurrent in-flight replays. Settled results SHALL be processed in the order of settlement, and any `rejected` result SHALL cause the entry's `attempts` to be incremented without aborting siblings.

#### Scenario: 30 entries drain with up to 10 in flight

- **GIVEN** the queue has 30 entries and all replays simulate a 2s latency
- **WHEN** `drain()` runs
- **THEN** at any instant there SHALL be at most 10 replays in flight
- **AND** the wall-clock drain time SHALL be approximately `ceil(30/10) * 2s = 6s` (plus overhead), significantly less than the sequential baseline of `30 * 2s = 60s`
