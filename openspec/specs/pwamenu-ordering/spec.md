## Purpose

pwaMenu ordering — shared cart, round submission, WebSocket real-time sync, and retry queue for the diner-facing PWA (port 5176).
## Requirements
### Requirement: Cart store maintains shared cart with local and remote items

The `cartStore` Zustand store SHALL hold a shared cart state for the current table session as a normalized record `items: Record<string, CartItem>` keyed by `item_id` (string). Each `CartItem` SHALL include `id`, `productId`, `productName`, `quantity`, `notes`, `priceCentsSnapshot`, `dinerId`, `dinerName`, `pending` (boolean), and `addedAt` (ISO timestamp). The store SHALL expose pure selectors (`selectItems`, `selectTotalCents`, `selectMyItems`, `selectSharedItems`) composed with `useShallow` for object/array returns, and SHALL NEVER be consumed via destructuring.

#### Scenario: Own items are distinguished from shared items

- **WHEN** the store holds items with `dinerId` values `'8'` (current diner) and `'9'` (other diner)
- **AND** `sessionStore.getState().dinerId` equals `'8'`
- **THEN** `selectMyItems(state)` SHALL return only items with `dinerId === '8'`
- **AND** `selectSharedItems(state)` SHALL return only items with `dinerId !== '8'`

#### Scenario: EMPTY_ARRAY is returned when no items exist

- **WHEN** the store `items` object is empty
- **THEN** `selectItems(state)` SHALL return a reference-stable empty array constant (same reference on every call)
- **AND** a React component using `useStore(selectItems)` SHALL NOT re-render on unrelated state changes

#### Scenario: Total cents is computed from non-pending items only for UI totals

- **WHEN** the store holds one confirmed item (qty 2 at 1000 cents) and one pending item (qty 1 at 500 cents)
- **THEN** `selectTotalCents(state)` SHALL return `2500` (includes pending for optimistic UX)
- **AND** `selectConfirmedTotalCents(state)` SHALL return `2000` (excludes pending)

### Requirement: Optimistic cart additions appear instantly and reconcile with backend

Adding an item to the cart via `cartStore.addItem(product, quantity, notes?)` SHALL insert an optimistic entry with `pending: true` and a temporary id prefixed with `tmp_` immediately (synchronously), THEN dispatch `POST /api/diner/cart/add`. On success (2xx), the temporary item SHALL be replaced by the backend-confirmed item keyed by the real `item_id`. On failure (non-2xx or network error), the temporary item SHALL be removed from the store and the operation SHALL be enqueued in `retryQueueStore`.

#### Scenario: Add succeeds — tmp item is replaced by real item

- **GIVEN** the store has no items
- **WHEN** `cartStore.addItem({ id: '42', name: 'Milanesa', priceCents: 12550 }, 2)` is called
- **THEN** within the same synchronous frame, `selectItems(state)` SHALL include exactly one item with `id` starting with `tmp_` and `pending: true`
- **AND** when `POST /api/diner/cart/add` resolves with `{ item_id: 101, ... }`
- **THEN** `selectItems(state)` SHALL include exactly one item with `id === '101'` and `pending: false`
- **AND** no item with `tmp_` prefix SHALL remain

#### Scenario: Add fails — tmp item is removed and enqueued for retry

- **GIVEN** the store has no items
- **WHEN** `cartStore.addItem(product, 1)` is called
- **AND** `POST /api/diner/cart/add` fails with network error
- **THEN** within 1 second, `selectItems(state)` SHALL contain zero items
- **AND** `retryQueueStore.getState().queue` SHALL contain one entry with `operation === 'cart.add'` and the product payload

#### Scenario: WS event CART_ITEM_ADDED arrives during pending — items are merged

- **GIVEN** an optimistic tmp item exists for `productId: '42'`, `dinerId: '8'`, created less than 10 seconds ago
- **WHEN** a `CART_ITEM_ADDED` WS event arrives with `{ item_id: 101, product_id: 42, diner_id: 8, quantity: 2 }`
- **THEN** `selectItems(state)` SHALL include exactly one item with `id === '101'` and `pending: false`
- **AND** no item with `tmp_` prefix for the same product SHALL remain

### Requirement: Cart WebSocket events update the store idempotently

The pwaMenu WebSocket client SHALL subscribe to `CART_ITEM_ADDED`, `CART_ITEM_UPDATED`, `CART_ITEM_REMOVED`, and `CART_CLEARED` on the `/ws/diner` connection and SHALL update `cartStore` accordingly. Each event SHALL be deduplicated by `event_id` using a capped FIFO set of the last 200 processed event ids. Duplicate events SHALL be silently ignored (no store mutation).

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

### Requirement: WebSocket diner client uses ref pattern with exponential backoff reconnection

The pwaMenu WebSocket client (`dinerWS`) SHALL connect to `ws://<host>/ws/diner?table_token=<TOKEN>` when `sessionStore.token` is non-null, using a two-effect pattern: effect 1 establishes the connection and returns a disconnect cleanup; effect 2 subscribes handlers and returns `unsubscribe`. On disconnect with a recoverable close code, the client SHALL attempt to reconnect with exponential backoff starting at 1 second, multiplied by 2 each attempt, capped at 30 seconds, with +/-30% jitter, up to 50 attempts. On non-recoverable close codes (`4001` AUTH_FAILED, `4003` FORBIDDEN, `4029` RATE_LIMITED), the client SHALL NOT reconnect and SHALL clear the session and redirect to `/scan`.

#### Scenario: Client connects with token and subscribes handlers

- **GIVEN** `sessionStore.token === 'valid-token'`
- **WHEN** a React component mounts and invokes `useDinerWS({ onCartAdded: handler })`
- **THEN** a WebSocket connection SHALL open against `/ws/diner?table_token=valid-token`
- **AND** the handler SHALL be invoked when `CART_ITEM_ADDED` arrives

#### Scenario: Handler unsubscribe does not close the connection

- **GIVEN** a component with `useDinerWS({ onCartAdded: handler1 })` is mounted
- **WHEN** the component updates `handler1` to `handler2` via props
- **THEN** the underlying WebSocket connection SHALL remain open (single connection preserved)
- **AND** only `handler2` SHALL receive subsequent events

#### Scenario: Reconnect uses exponential backoff with jitter

- **WHEN** the WebSocket closes with code `1006` (abnormal)
- **THEN** the client SHALL schedule a reconnect after a delay between `700ms` and `1300ms` (1s ± 30%)
- **AND** if that reconnect also fails, the next delay SHALL be between `1400ms` and `2600ms` (2s ± 30%)

#### Scenario: AUTH_FAILED close does not trigger reconnect

- **WHEN** the WebSocket closes with code `4001`
- **THEN** the client SHALL NOT schedule any reconnect
- **AND** `sessionStore.getState().token` SHALL be `null`
- **AND** `window.location.pathname` SHALL equal `/scan`

### Requirement: Event catch-up replays missed events after reconnection

On successful reconnection (transition from `RECONNECTING` to `CONNECTED`), the client SHALL invoke `GET /ws/catchup/session?session_id=<id>&since=<lastEventTimestamp>` (header `X-Table-Token`) and SHALL process returned events in order through the same handlers used by live WS events. The `lastEventTimestamp` SHALL be updated on every received event. If the catch-up response indicates `too_old` (the `since` exceeds the 5-minute Redis TTL), the client SHALL fall back to `GET /api/diner/cart` and `GET /api/diner/rounds` to rehydrate state from scratch.

#### Scenario: Catch-up returns events — they are applied in order

- **GIVEN** `cartStore.items` is empty and the WS reconnects
- **WHEN** `GET /ws/catchup/session` returns `{ events: [{ type: 'CART_ITEM_ADDED', item: {...}, event_id: 'a' }, { type: 'CART_ITEM_UPDATED', item: {...}, event_id: 'b' }] }`
- **THEN** both events SHALL be processed in array order
- **AND** `cartStore` SHALL reflect the ADD followed by the UPDATE

#### Scenario: Catch-up too_old falls back to full rehydration

- **WHEN** `GET /ws/catchup/session` responds with `{ status: 'too_old' }`
- **THEN** the client SHALL invoke `GET /api/diner/cart` and `GET /api/diner/rounds`
- **AND** the stores SHALL be replaced with the returned data (full replacement, not merge)

#### Scenario: Duplicate events from catch-up are deduplicated

- **GIVEN** event with `event_id: 'x'` was processed via live WS
- **WHEN** catch-up returns an event with the same `event_id: 'x'`
- **THEN** the store SHALL NOT be mutated a second time

### Requirement: Group confirmation page submits the round

The `/cart/confirm` route SHALL render a summary grouped by diner showing every item with its quantity, per-item subtotal, and total, AND SHALL display an optional round notes textarea. A primary CTA button labeled `t('cart.confirm.submit')` SHALL invoke `POST /api/diner/rounds` with `{ notes?: string }`. On success (2xx) the page SHALL clear the cart from local state, navigate to `/rounds`, and emit a toast with `t('rounds.submitted')`. On 409 with reason `session_paying`, the page SHALL redirect to `/menu` and show `t('errors.cart.session_paying')`. On 409 with reason `insufficient_stock`, the page SHALL display the returned product list inline with translated messaging.

#### Scenario: Successful submit navigates to rounds list

- **GIVEN** the cart has 3 items and session is OPEN
- **WHEN** the user clicks the submit CTA
- **AND** `POST /api/diner/rounds` returns `200 { round_id: 7, round_number: 1, status: 'PENDING' }`
- **THEN** `cartStore.getState().items` SHALL be empty
- **AND** `window.location.pathname` SHALL equal `/rounds`
- **AND** `roundsStore.getState().rounds['7']` SHALL exist with `status === 'PENDING'`

#### Scenario: Submit rejected with session_paying redirects to menu

- **WHEN** `POST /api/diner/rounds` returns `409 { detail: { reason: 'session_paying' } }`
- **THEN** a toast with the translated message for `errors.cart.session_paying` SHALL appear
- **AND** `window.location.pathname` SHALL equal `/menu`

#### Scenario: Submit rejected with insufficient_stock shows inline detail

- **WHEN** `POST /api/diner/rounds` returns `409 { detail: { reason: 'insufficient_stock', products: [{ product_id: 42, name: 'Milanesa', requested: 5, available: 2 }] } }`
- **THEN** the page SHALL remain on `/cart/confirm`
- **AND** the product name and missing quantity SHALL be rendered translated in a warning panel

### Requirement: Rounds store tracks per-session round status in real time

The `roundsStore` SHALL hold rounds for the current session as `Record<string, Round>` keyed by `round_id` (string), updated by: (a) initial fetch via `GET /api/diner/rounds` when the user enters `/rounds`; (b) WS events `ROUND_PENDING`, `ROUND_CONFIRMED`, `ROUND_SUBMITTED`, `ROUND_IN_KITCHEN`, `ROUND_READY`, `ROUND_SERVED`, `ROUND_CANCELED` filtered to the current session id; (c) the submit response from `POST /api/diner/rounds`. Each `Round` SHALL include `id`, `roundNumber`, `status`, `items` (array), `submittedAt` (ISO), `readyAt` (ISO, nullable), and `servedAt` (ISO, nullable). Events SHALL be deduplicated by `event_id`.

#### Scenario: ROUND_READY updates the status and timestamp

- **GIVEN** a round `{ id: '7', status: 'IN_KITCHEN', readyAt: null }` exists in the store
- **WHEN** `ROUND_READY` arrives with `{ round_id: 7, ready_at: '2026-04-18T14:30:00Z' }`
- **THEN** `roundsStore.getState().rounds['7'].status` SHALL equal `'READY'`
- **AND** `roundsStore.getState().rounds['7'].readyAt` SHALL equal `'2026-04-18T14:30:00Z'`

#### Scenario: Event for a different session is ignored

- **GIVEN** `sessionStore.sessionId === '12'`
- **WHEN** a `ROUND_SUBMITTED` event arrives with `session_id: 99`
- **THEN** `roundsStore` SHALL be unchanged

### Requirement: Retry queue persists failed mutations and replays them when online

The `retryQueueStore` SHALL maintain a FIFO queue persisted to `localStorage` under key `pwamenu-retry-queue`. Each entry SHALL have `{ id, operation, payload, enqueuedAt, attempts }` with `operation` in `{'cart.add'|'cart.update'|'cart.remove'|'rounds.submit'}`. The queue SHALL be drained by: (a) the browser `online` event; (b) a periodic 15-second timer while non-empty; (c) a successful response after any prior failure. Entries SHALL be removed from the queue on successful replay, and discarded after 3 failed attempts or when `enqueuedAt + 5 minutes < now`. Queue length SHALL be capped at 50 entries; when exceeded, the oldest entry SHALL be dropped with a warning logged via `utils/logger.ts`. If `localStorage` is unavailable, the queue SHALL operate in memory.

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

### Requirement: UI blocks new orders when session status is PAYING

When `sessionStore.getState().tableStatus === 'PAYING'`, the pwaMenu UI SHALL: (a) disable the quantity increase button in `ProductCard` with a tooltip keyed to `t('cart.blocked.paying.tooltip')`; (b) hide the "Submit round" CTA on `/cart/confirm` and render a banner with `t('cart.blocked.paying.banner')`; (c) disable add/update buttons in the cart drawer. The session status SHALL be refreshed from `GET /api/diner/session` on entry to `/cart` and `/cart/confirm` as a defensive check against missed `TABLE_STATUS_CHANGED` events. The `CHECK_REQUESTED` WS event (emitted when any diner or the waiter requests the check) SHALL be handled in addition to `TABLE_STATUS_CHANGED` to transition `sessionStore.tableStatus` to `'PAYING'` — both events converge to the same UI state.

#### Scenario: TABLE_STATUS_CHANGED to PAYING blocks new orders in real time

- **GIVEN** the UI is on `/cart` with items visible and `tableStatus === 'OPEN'`
- **WHEN** WS event `TABLE_STATUS_CHANGED` arrives with `{ session_id: 12, status: 'PAYING' }`
- **THEN** the CTA button SHALL become disabled
- **AND** the banner translated by `t('cart.blocked.paying.banner')` SHALL be rendered

#### Scenario: CHECK_REQUESTED WS event also triggers the block

- **GIVEN** the UI is on `/menu` with `tableStatus === 'OPEN'`
- **WHEN** WS event `CHECK_REQUESTED` arrives with `{ session_id: 12, check_id: 10, total_cents: 12550 }` AND the diner's `sessionStore.sessionId === '12'`
- **THEN** `sessionStore.tableStatus` SHALL be `'PAYING'`
- **AND** the `ProductCard` add-to-cart buttons SHALL be disabled
- **AND** `billingStore.status` SHALL also be updated to `'REQUESTED'` (by the `useBillingWS` hook) so that the `/check` route can render the current check without an extra fetch

#### Scenario: Entering /cart/confirm refetches session status

- **GIVEN** `sessionStore.tableStatus === 'OPEN'` but backend has transitioned to `PAYING`
- **WHEN** the user navigates to `/cart/confirm`
- **AND** `GET /api/diner/session` returns `{ status: 'PAYING' }`
- **THEN** the page SHALL render the blocked banner without showing the submit CTA

#### Scenario: Backend 409 session_paying triggers UI lockout on submit attempt

- **GIVEN** client still believes session is OPEN (event lost) and user clicks submit
- **WHEN** `POST /api/diner/rounds` responds `409 { detail: { reason: 'session_paying' } }`
- **THEN** `sessionStore.tableStatus` SHALL be updated to `'PAYING'`
- **AND** the user SHALL be redirected to `/menu`

### Requirement: Diner color is derived deterministically from diner id

The helper `utils/dinerColor.ts` SHALL export `getDinerColor(dinerId: string): string` that returns a hex color from a fixed 8-color palette determined by `parseInt(dinerId, 10) % 8`. The palette SHALL be defined as an immutable array with documented contrast-verified colors against a white background. The color SHALL NOT be persisted; it SHALL be recomputed on every call.

#### Scenario: Same diner id returns the same color across calls

- **WHEN** `getDinerColor('8')` is called twice
- **THEN** both calls SHALL return the same hex string

#### Scenario: Different diner ids map to different palette entries when modulo differs

- **WHEN** `getDinerColor('0')` and `getDinerColor('1')` are called
- **THEN** they SHALL return distinct hex strings from the palette

### Requirement: All user-facing strings are translated in es, en, and pt

All text surfaces introduced by this change — including but not limited to product card buttons, cart drawer copy, `/cart/confirm` labels and notes placeholder, rounds page status badges, toast messages, blocked banners, and error messages — SHALL be rendered exclusively through `t()` calls. The locale files `pwaMenu/src/i18n/locales/{es,en,pt}.json` SHALL contain every key used, with no key present in one file but missing in another. A test SHALL assert key parity across the three locales.

#### Scenario: i18n completeness test passes

- **WHEN** the test `i18n completeness` runs against the three locale files
- **THEN** the set of keys in `es.json` SHALL equal the set of keys in `en.json`
- **AND** SHALL equal the set of keys in `pt.json`

#### Scenario: No hardcoded Spanish strings in changed components

- **WHEN** the test scans `src/components/cart/`, `src/components/rounds/`, `src/pages/CartPage.tsx`, `src/pages/CartConfirmPage.tsx`, `src/pages/RoundsPage.tsx` for bare text nodes
- **THEN** no JSX text content SHALL match the regex of a Spanish word pattern without being wrapped in `t()`

### Requirement: Cart and rounds pages respect mobile layout constraints

The pages `/cart`, `/cart/confirm`, and `/rounds` SHALL include `overflow-x-hidden w-full max-w-full` on their top-level container and SHALL respect iOS safe-area insets via `env(safe-area-inset-*)` padding on sticky elements (CTA footer, header). No element SHALL exceed the viewport width at any breakpoint between 320px and 768px.

#### Scenario: Root container has overflow constraints

- **WHEN** inspecting the rendered DOM of `/cart`
- **THEN** the outermost container SHALL have classes including `overflow-x-hidden`, `w-full`, and `max-w-full`

#### Scenario: CTA footer respects safe area inset

- **WHEN** inspecting the sticky CTA footer on `/cart/confirm`
- **THEN** its `padding-bottom` SHALL include `env(safe-area-inset-bottom)`

