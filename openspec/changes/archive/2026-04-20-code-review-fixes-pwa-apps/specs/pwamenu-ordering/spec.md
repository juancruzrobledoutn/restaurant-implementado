## MODIFIED Requirements

### Requirement: Cart WebSocket events update the store idempotently

The pwaMenu WebSocket client SHALL subscribe to `CART_ITEM_ADDED`, `CART_ITEM_UPDATED`, `CART_ITEM_REMOVED`, and `CART_CLEARED` on the `/ws/diner` connection and SHALL update `cartStore` accordingly. Each event SHALL be deduplicated by `event_id` using a capped FIFO set of the last 200 processed event ids, implemented as a `Set<string>` for O(1) membership checks with a parallel `string[]` that preserves FIFO order for eviction. Duplicate events SHALL be silently ignored (no store mutation). The `CartWsEvent` type SHALL be a discriminated union on `type` (literal `'cart.add' | 'cart.update' | 'cart.remove' | 'cart.cleared'`), eliminating any `as unknown as` casts in the event handler switch.

#### Scenario: CART_ITEM_ADDED inserts the item

- **WHEN** `CART_ITEM_ADDED` arrives with `{ event_id: 'e1', item: { item_id: 55, product_id: 42, diner_id: 9, diner_name: 'Ana', quantity: 1, price_cents_snapshot: 8000 } }`
- **THEN** `cartStore.getState().items['55']` SHALL exist with `dinerName === 'Ana'`

#### Scenario: CART_ITEM_UPDATED updates quantity

- **GIVEN** the store holds an item with `id: '55'` and `quantity: 1`
- **WHEN** `CART_ITEM_UPDATED` arrives with `{ event_id: 'e2', item: { item_id: 55, quantity: 3 } }`
- **THEN** `cartStore.getState().items['55'].quantity` SHALL equal `3`

#### Scenario: CART_ITEM_REMOVED deletes the item

- **GIVEN** the store holds items with ids `'55'` and `'56'`
- **WHEN** `CART_ITEM_REMOVED` arrives with `{ event_id: 'e3', item_id: 55 }`
- **THEN** `cartStore.getState().items['55']` SHALL be undefined
- **AND** `cartStore.getState().items['56']` SHALL still exist

#### Scenario: CART_CLEARED empties the entire cart

- **GIVEN** the store holds three items
- **WHEN** `CART_CLEARED` arrives with `{ event_id: 'e4', session_id: 12 }`
- **THEN** `cartStore.getState().items` SHALL equal `{}`

#### Scenario: Duplicate event_id is ignored

- **GIVEN** event with `event_id: 'e1'` has already been processed
- **WHEN** another event with `event_id: 'e1'` arrives
- **THEN** `cartStore` state SHALL be unchanged (no dispatch, no log side effect)

#### Scenario: Dedup membership check is O(1)

- **GIVEN** the FIFO dedup holds 200 event ids
- **WHEN** a new event with a duplicate id arrives
- **THEN** the check SHALL use `Set.has()` and SHALL NOT iterate the `string[]` via `Array.includes()`

#### Scenario: Discriminated union narrows event type without casts

- **WHEN** the event handler switches on `event.type`
- **THEN** each `case` SHALL access `event.payload` fields with full TypeScript narrowing
- **AND** the source SHALL contain no `as unknown as` cast on any `CartWsEvent` value

### Requirement: Retry queue persists failed mutations and replays them when online

The `retryQueueStore` SHALL maintain a FIFO queue persisted to `localStorage` under key `pwamenu-retry-queue`. Each entry SHALL have `{ id, operation, payload, enqueuedAt, attempts }` with `operation` in `{'cart.add'|'cart.update'|'cart.remove'|'rounds.submit'}`. The queue SHALL be drained by: (a) the browser `online` event; (b) a periodic 15-second timer while non-empty; (c) a successful response after any prior failure. Entries SHALL be removed from the queue on successful replay, and discarded after 3 failed attempts or when `enqueuedAt + 5 minutes < now`. Queue length SHALL be capped at 50 entries; when exceeded, the oldest entry SHALL be dropped with a warning logged via `utils/logger.ts`. If `localStorage` is unavailable, the queue SHALL operate in memory. The replay executor SHALL be idempotent: before reapplying a `cart.add` entry, it MUST verify the item id is not already present in `cartStore` and skip the insertion if it is.

#### Scenario: Failed add is enqueued and replayed on reconnect

- **GIVEN** the queue is empty
- **WHEN** `cartStore.addItem(product, 1)` is called and `POST /api/diner/cart/add` fails with network error
- **THEN** `retryQueueStore.queue.length` SHALL equal `1`
- **AND** the entry SHALL have `operation: 'cart.add'` with the product payload
- **WHEN** the browser emits `online` and a subsequent `POST /api/diner/cart/add` returns `200`
- **THEN** `retryQueueStore.queue.length` SHALL equal `0`

#### Scenario: Queue drains in FIFO order

- **GIVEN** the queue contains three entries enqueued at t0, t1, t2
- **WHEN** drain begins
- **THEN** the entry enqueued at t0 SHALL be replayed before the one at t1
- **AND** the one at t1 SHALL be replayed before the one at t2

#### Scenario: Entry older than 5 minutes is discarded on load

- **GIVEN** an entry with `enqueuedAt` more than 5 minutes in the past is persisted in `localStorage`
- **WHEN** the store hydrates on app mount
- **THEN** the stale entry SHALL NOT appear in `retryQueueStore.queue`

#### Scenario: After 3 failed attempts, entry is discarded and toast is emitted

- **GIVEN** an entry with `attempts: 2` in the queue
- **WHEN** a drain attempt fails again (HTTP 5xx)
- **THEN** the entry SHALL be removed from the queue
- **AND** a toast with `t('errors.retry.gave_up')` SHALL be emitted

#### Scenario: localStorage unavailable falls back to in-memory queue

- **WHEN** `localStorage.setItem` throws `SecurityError`
- **THEN** the queue SHALL still accept the enqueue in memory
- **AND** a warning SHALL be logged via `utils/logger.ts`
- **AND** the store SHALL NOT crash the application

#### Scenario: Retry executor is idempotent on already-persisted items

- **GIVEN** the user enqueued a `cart.add` offline and the server already persisted the same item via a delayed WS event received before the retry runs
- **WHEN** the retry executor attempts to replay the entry
- **THEN** it SHALL detect the item already exists in `cartStore.items` by id
- **AND** it SHALL NOT duplicate the item (no second `replaceAll([...existing, item])` when `some(i => i.id === item.id)` is true)
- **AND** the entry SHALL be removed from the queue

### Requirement: Cart and rounds pages respect mobile layout constraints

The pages `/cart`, `/cart/confirm`, and `/rounds` SHALL include `overflow-x-hidden w-full max-w-full` on their top-level container and SHALL respect iOS safe-area insets via `env(safe-area-inset-*)` padding on sticky elements (CTA footer, header). No element SHALL exceed the viewport width at any breakpoint between 320px and 768px. All interactive controls (buttons, icon buttons, toggles) SHALL have a minimum touch target of 44x44 CSS pixels to meet WCAG 2.5.5 AA. In particular, the minus/plus/remove buttons of `CartItem` SHALL be sized with `min-w-[44px] min-h-[44px]` (or equivalent Tailwind classes).

#### Scenario: Root container has overflow constraints

- **WHEN** the user opens `/cart` at a 320px viewport
- **THEN** the root container SHALL NOT overflow horizontally
- **AND** `overflow-x-hidden w-full max-w-full` SHALL be applied to the outermost layout element

#### Scenario: CartItem buttons meet WCAG 2.5.5 AA

- **WHEN** a `CartItem` renders at any breakpoint between 320px and 768px
- **THEN** each of its minus, plus, and remove buttons SHALL have a computed width of at least 44px and a computed height of at least 44px
- **AND** the buttons SHALL be tappable on a real mobile device without misclicks

## ADDED Requirements

### Requirement: OfflineBanner signals network/WS disconnection and pending retries

The pwaMenu SHALL render an `OfflineBanner` component at the top of the viewport (below the header) whenever either `useDinerWS` reports `isConnected === false` OR the retry queue has pending entries. The banner SHALL reuse the existing `selectFailedEntries` selector (or its equivalent pending-count selector) from `retryQueueStore` and SHALL NOT duplicate selector logic. The banner SHALL be dismissible only by reconnection; user dismissal is NOT supported (the state is informational, not advisory). The banner text SHALL be translated in `es`, `en`, and `pt` via `t()`.

#### Scenario: Banner appears when WS disconnects

- **GIVEN** the app is on any page and WS was connected
- **WHEN** `useDinerWS` transitions to `isConnected === false`
- **THEN** the `OfflineBanner` SHALL render at the top of the viewport
- **AND** its text SHALL be the value of `t('offline.banner.disconnected')`

#### Scenario: Banner appears when retry queue has pending entries

- **GIVEN** WS is connected but `retryQueueStore` has 1+ entries
- **WHEN** the page renders
- **THEN** the `OfflineBanner` SHALL render with the pending-count text via `t('offline.banner.pending', { count })`

#### Scenario: Banner disappears on full recovery

- **GIVEN** `OfflineBanner` is visible
- **WHEN** WS reconnects AND the retry queue drains to 0 entries
- **THEN** the `OfflineBanner` SHALL unmount

#### Scenario: Selector reuse (no duplicate selector logic)

- **WHEN** `OfflineBanner` reads the retry queue state
- **THEN** it SHALL call the existing `selectFailedEntries` (or the established pending-entries selector) exported by `retryQueueStore`
- **AND** it SHALL NOT redefine a new selector with equivalent logic inline

### Requirement: useDinerWS hook keeps callback stable without double-ref indirection

The hook `useDinerWS` SHALL expose subscriber callbacks with stable referential identity across renders using `useCallback` with a dependency array of `[]` (empty), reading the latest handlers from a single ref populated via a dedicated effect. The hook SHALL NOT layer an additional outer ref on top of the already-stable `useCallback([])`; the doubled indirection present at `useDinerWS.ts:57-95` SHALL be removed.

#### Scenario: Single ref + stable callback — no double indirection

- **WHEN** `useDinerWS` is inspected
- **THEN** there SHALL be exactly one `useRef` per handler set (no duplicate ref wrapping a `useCallback([])` that itself reads a ref)
- **AND** the callback identity SHALL be stable across renders

### Requirement: CartConfirmPage uses React 19 useActionState

The page `CartConfirmPage` SHALL submit the round using `useActionState` (React 19), matching the pattern documented by the `react19-form-pattern` skill used in other forms across the three frontends. The form SHALL post via the action, surface pending state via the returned `isPending`, and validate via server-action-style error return values.

#### Scenario: Submit uses useActionState

- **WHEN** the user submits the round via `CartConfirmPage`
- **THEN** the submission SHALL flow through the `useActionState` hook
- **AND** the submit button SHALL be disabled while `isPending === true`
- **AND** validation errors SHALL be surfaced from the action's return value, not from an ad-hoc local state

### Requirement: EMPTY_ARRAY is typed as readonly never[]

The shared constant `EMPTY_ARRAY` used as a stable fallback in selectors SHALL be typed as `readonly never[]` so that any consumer expecting `readonly T[]` or `T[]` assigns without an `as unknown as T[]` cast. Consumers SHALL NOT mutate the constant; attempts to mutate SHALL fail typechecking.

#### Scenario: Selector fallback assigns to readonly T[] without casts

- **WHEN** a selector returns `EMPTY_ARRAY` as fallback for `readonly CartItem[]`
- **THEN** the assignment SHALL compile without any `as unknown as CartItem[]` cast

#### Scenario: Mutation attempts are rejected at compile time

- **WHEN** a consumer writes `EMPTY_ARRAY.push(x)` or similar mutation
- **THEN** the TypeScript compiler SHALL emit an error (readonly array)
