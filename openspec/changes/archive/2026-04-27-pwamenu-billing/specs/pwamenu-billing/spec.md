## ADDED Requirements

### Requirement: Billing store holds current check state for the session

The `billingStore` Zustand store SHALL hold the state of the current check for the diner's session as `{ checkId: string | null, status: 'NONE' | 'REQUESTED' | 'PAID', splitMethod: 'equal_split' | 'by_consumption' | 'custom', totalCents: number, charges: Charge[], payments: Payment[], remainingCents: number, loadedAt: string | null }`. The store SHALL expose pure selectors (`selectCheck`, `selectStatus`, `selectCharges`, `selectPayments`, `selectRemainingCents`, `selectCanRequestCheck`, `selectCanPay`) composed with `useShallow` for object/array returns, and SHALL NEVER be consumed via destructuring. `EMPTY_ARRAY` SHALL be returned as a reference-stable constant when no charges or payments exist.

#### Scenario: Initial state is NONE with no check

- **WHEN** the pwaMenu boots and no `/api/billing/check/{session_id}` call has returned
- **THEN** `selectStatus(state)` SHALL return `'NONE'`
- **AND** `selectCheck(state)` SHALL return `{ checkId: null, totalCents: 0 }` with reference-stable empty arrays for `charges` and `payments`

#### Scenario: Hydration from backend sets REQUESTED status

- **WHEN** `GET /api/billing/check/{session_id}` returns 200 with `{ id: 10, status: 'REQUESTED', total_cents: 12550, charges: [...], payments: [] }`
- **THEN** `selectStatus(state)` SHALL return `'REQUESTED'`
- **AND** `selectCharges(state).length` SHALL equal the charges array length
- **AND** `selectRemainingCents(state)` SHALL equal `12550` (no payments yet)

#### Scenario: canRequestCheck is true only when session is OPEN and check is NONE

- **GIVEN** `sessionStore.getState().tableStatus === 'OPEN'` AND `billingStore.getState().status === 'NONE'`
- **WHEN** `selectCanRequestCheck(state)` is evaluated with both stores
- **THEN** it SHALL return `true`

- **GIVEN** `sessionStore.getState().tableStatus === 'PAYING'`
- **WHEN** `selectCanRequestCheck(state)` is evaluated
- **THEN** it SHALL return `false`

---

### Requirement: Payment store holds MP flow state as explicit FSM

The `paymentStore` Zustand store SHALL hold the payment flow state as an explicit FSM with `phase: 'idle' | 'creating_preference' | 'redirecting' | 'pending' | 'approved' | 'rejected' | 'failed'`, plus `preferenceId: string | null`, `initPoint: string | null`, `paymentId: string | null`, `errorCode: string | null`, `lastTransitionAt: string | null`. Transitions SHALL be validated by a helper `transition(from, to)` that logs a WARN via `logger.warn()` and returns without mutating when the transition is invalid. The allowed transitions are: `idle → creating_preference`, `creating_preference → redirecting`, `creating_preference → failed`, `redirecting → pending`, `pending → approved | rejected`, `pending → failed` (on timeout), and `approved | rejected | failed → idle` (reset).

#### Scenario: Invalid transition is logged and ignored

- **GIVEN** `paymentStore.getState().phase === 'idle'`
- **WHEN** `paymentStore.transition('pending', 'approved')` is called
- **THEN** the store phase SHALL remain `'idle'`
- **AND** `logger.warn` SHALL be called with a message including `'invalid transition'`

#### Scenario: Valid transition updates phase and timestamp

- **GIVEN** `paymentStore.getState().phase === 'idle'`
- **WHEN** `paymentStore.transition('idle', 'creating_preference')` is called
- **THEN** `paymentStore.getState().phase` SHALL equal `'creating_preference'`
- **AND** `paymentStore.getState().lastTransitionAt` SHALL be a valid ISO timestamp

#### Scenario: Reset clears transient data

- **GIVEN** `paymentStore.getState().phase === 'approved'` with `paymentId: '99'`
- **WHEN** `paymentStore.reset()` is called
- **THEN** `paymentStore.getState()` SHALL equal `{ phase: 'idle', preferenceId: null, initPoint: null, paymentId: null, errorCode: null, lastTransitionAt: null }`

---

### Requirement: Check request flow from pwaMenu

The pwaMenu SHALL expose `POST /api/billing/check/request` via a service function `billingApi.requestCheck(splitMethod, customSplit?)`. The request SHALL include `X-Table-Token` header (automatic from `sessionStore`) and body `{ split_method: 'equal_split' }` for MVP (the `by_consumption` and `custom` options SHALL be documented and implemented behind a feature flag `ENABLE_SPLIT_METHODS` which is `false` by default). On success (201), the response body SHALL update `billingStore` with the new check and the router SHALL navigate to `/check`. On 409 `session_not_open`, the UI SHALL display a toast with the localized error and NOT mutate the store. On 429, the retry SHALL be enqueued via `retryQueueStore.enqueue({ operation: 'billing.requestCheck', payload: { splitMethod } })`.

#### Scenario: Happy path — diner requests check with equal_split

- **GIVEN** `sessionStore.tableStatus === 'OPEN'` AND `billingStore.status === 'NONE'`
- **WHEN** the user taps "Solicitar cuenta" on `CheckRequestPage` with `split_method='equal_split'` selected
- **AND** `POST /api/billing/check/request` resolves with `{ id: 10, status: 'REQUESTED', total_cents: 12550, charges: [...] }`
- **THEN** `billingStore.status` SHALL be `'REQUESTED'`
- **AND** the router SHALL navigate to `/check`
- **AND** `sessionStore.tableStatus` SHALL transition to `'PAYING'` via the WS event `CHECK_REQUESTED` arriving in parallel

#### Scenario: Session not open returns 409 and shows toast

- **WHEN** `POST /api/billing/check/request` returns 409 with `{ code: 'session_not_open' }`
- **THEN** a toast SHALL display the translated key `errors.billing.sessionNotOpen`
- **AND** `billingStore.status` SHALL remain unchanged

#### Scenario: Rate limited request enqueues retry

- **WHEN** `POST /api/billing/check/request` returns 429
- **THEN** `retryQueueStore.queue` SHALL contain one entry with `operation === 'billing.requestCheck'`
- **AND** a toast SHALL display `errors.billing.tooManyRequests`

#### Scenario: Non-MVP split methods are hidden behind feature flag

- **GIVEN** `import.meta.env.VITE_ENABLE_SPLIT_METHODS !== 'true'`
- **WHEN** `CheckRequestPage` renders
- **THEN** only the `equal_split` option SHALL be visible
- **AND** no `by_consumption` or `custom` option SHALL be in the DOM

---

### Requirement: MercadoPago payment initiation via redirect

The pwaMenu SHALL initiate Mercado Pago payments via `POST /api/billing/payment/preference` and then redirect the browser to the returned `init_point` URL. The pwaMenu SHALL NOT load or execute the MercadoPago JS SDK for card tokenization. The pwaMenu SHALL NOT collect, display, transmit, or log any card data (PAN, CVV, expiry, cardholder name). The redirect SHALL be performed via `window.location.assign(initPoint)` with `paymentStore.phase` transitioning from `creating_preference` to `redirecting` immediately before the redirect.

#### Scenario: Happy path — create preference and redirect

- **GIVEN** `billingStore.status === 'REQUESTED'` AND `billingStore.checkId === '10'`
- **WHEN** the user taps "Pagar con Mercado Pago" on `CheckStatusPage`
- **AND** `POST /api/billing/payment/preference` resolves with `{ preference_id: 'pref_abc', init_point: 'https://www.mercadopago.com.ar/checkout/v1/redirect?...', payment_id: '99' }`
- **THEN** `paymentStore.phase` SHALL transition `idle → creating_preference → redirecting`
- **AND** `window.location.assign` SHALL be called with the `init_point` URL

#### Scenario: Button is disabled during preference creation

- **GIVEN** `paymentStore.phase === 'creating_preference'`
- **WHEN** `CheckStatusPage` renders
- **THEN** the "Pagar con Mercado Pago" button SHALL be `disabled`
- **AND** a spinner SHALL be visible on the button

#### Scenario: No card data anywhere in the pwaMenu bundle

- **WHEN** the production build of pwaMenu is greppable for `card_number`, `cvv`, `card.PAN`, `cardholder_name`, or any MP card tokenization endpoint path (`/v1/card_tokens`)
- **THEN** no match SHALL be found
- **AND** the build process SHALL fail the CI check if any match is detected

---

### Requirement: Payment result page with WS-first, polling-fallback

The route `/payment/result` SHALL read query params `status`, `payment_id`, `preference_id` from the MP return URL and transition `paymentStore.phase` to `'pending'`. The page SHALL first await a WebSocket event `PAYMENT_APPROVED` or `PAYMENT_REJECTED` for the matching `payment_id`. If no event arrives within 30 seconds, the page SHALL start polling `GET /api/billing/payment/{payment_id}/status` every 3 seconds for a maximum of 20 attempts (60 seconds total). When the status is finally resolved (APPROVED, REJECTED, or FAILED), `paymentStore` SHALL transition accordingly. If polling exhausts without resolution, the page SHALL display a timeout message with a manual refresh button.

#### Scenario: WS event arrives first — store updates immediately

- **GIVEN** the page is mounted with `payment_id='99'` AND `paymentStore.phase === 'pending'`
- **WHEN** a WS event `PAYMENT_APPROVED` with `{ payment_id: 99 }` arrives 5 seconds later
- **THEN** `paymentStore.phase` SHALL transition to `'approved'`
- **AND** no HTTP request to `/api/billing/payment/99/status` SHALL be made
- **AND** the page SHALL display the translated key `payment.approved`

#### Scenario: WS times out — polling resolves the status

- **GIVEN** the page is mounted with `payment_id='99'` AND no WS events have been received for 30 seconds
- **WHEN** polling starts and `GET /api/billing/payment/99/status` returns `{ status: 'APPROVED' }` on the 3rd attempt
- **THEN** `paymentStore.phase` SHALL transition to `'approved'`
- **AND** polling SHALL stop (no 4th attempt)

#### Scenario: Polling exhausts — show timeout with manual refresh

- **GIVEN** the page has made 20 polling attempts without resolution
- **WHEN** the 20th polling response is `{ status: 'PENDING' }`
- **THEN** `paymentStore.phase` SHALL transition to `'failed'` with `errorCode: 'polling_timeout'`
- **AND** a message with the key `payment.timeoutCheckLater` SHALL be visible
- **AND** a manual "Actualizar" button SHALL restart the flow with one extra polling call

#### Scenario: Rejected payment shows error and allows retry

- **GIVEN** `paymentStore.phase === 'pending'`
- **WHEN** `PAYMENT_REJECTED` arrives with `{ payment_id: 99, error_code: 'cc_rejected_insufficient_amount' }`
- **THEN** `paymentStore.phase` SHALL transition to `'rejected'`
- **AND** the page SHALL display the translated key `payment.rejected.cc_rejected_insufficient_amount`
- **AND** a CTA "Intentar con otra tarjeta" SHALL navigate back to `/check`

---

### Requirement: Check status page reacts to CHECK_PAID WS event

The route `/check` (`CheckStatusPage`) SHALL subscribe via `useBillingWS()` to the WS events `CHECK_PAID`, `PAYMENT_APPROVED`, and `PAYMENT_REJECTED` scoped to the current session. When `CHECK_PAID` arrives with matching `session_id`, `billingStore.status` SHALL transition to `'PAID'` and `sessionStore.tableStatus` SHALL transition to `'CLOSED'`. The page SHALL display a confirmation UI with the final total and a CTA "Dejar opinión" (future placeholder — currently a no-op button).

#### Scenario: CHECK_PAID arrives and page shows confirmation

- **GIVEN** the user is on `/check` AND `billingStore.status === 'REQUESTED'`
- **WHEN** a WS event `CHECK_PAID` with `{ session_id: 42, check_id: 10 }` arrives AND the diner's `sessionStore.sessionId === '42'`
- **THEN** `billingStore.status` SHALL equal `'PAID'`
- **AND** `sessionStore.tableStatus` SHALL equal `'CLOSED'`
- **AND** the confirmation heading with key `check.paidTitle` SHALL be visible

#### Scenario: CHECK_PAID for a different session is ignored

- **GIVEN** `sessionStore.sessionId === '42'`
- **WHEN** a WS event `CHECK_PAID` arrives with `{ session_id: 88 }`
- **THEN** `billingStore.status` SHALL remain unchanged

---

### Requirement: Diner WebSocket handler routes billing events to stores

The `useBillingWS()` hook SHALL register handlers on the `dinerWS` client for `CHECK_REQUESTED`, `CHECK_PAID`, `PAYMENT_APPROVED`, and `PAYMENT_REJECTED`. The hook SHALL be mounted exactly once in `App.tsx` inside the provider tree, using the ref pattern (two effects: setup + subscribe, `return unsubscribe` always). Each event handler SHALL deduplicate by `event_id` using the existing FIFO set from C-18 (capped at 200 entries). Handlers SHALL update the corresponding stores and SHALL NOT perform navigation — navigation is driven by `billingStore` subscribers in route components.

#### Scenario: CHECK_REQUESTED updates billingStore and sessionStore

- **WHEN** a WS event `CHECK_REQUESTED` arrives with `{ event_id: 'e1', session_id: 42, check_id: 10, total_cents: 12550 }`
- **THEN** `billingStore.status` SHALL equal `'REQUESTED'`
- **AND** `billingStore.checkId` SHALL equal `'10'`
- **AND** `sessionStore.tableStatus` SHALL equal `'PAYING'`
- **AND** `cartStore.isBlocked` SHALL equal `true`

#### Scenario: Duplicate event_id is silently ignored

- **GIVEN** a WS event `CHECK_REQUESTED` with `event_id: 'e1'` has already been processed
- **WHEN** a second event with the same `event_id: 'e1'` arrives
- **THEN** no store mutation SHALL occur
- **AND** no new WARN log SHALL be emitted

#### Scenario: Handler is unsubscribed on unmount

- **GIVEN** `useBillingWS()` is mounted in `App.tsx`
- **WHEN** the component unmounts
- **THEN** all registered handlers for `CHECK_*` and `PAYMENT_*` SHALL be removed from `dinerWS`
- **AND** a subsequent WS event SHALL NOT trigger the removed handlers

---

### Requirement: i18n coverage for billing, payment, and consent

All user-visible strings in `billingStore`, `paymentStore`, `CheckRequestPage`, `CheckStatusPage`, `PaymentResultPage`, `ProfilePage`, and `OptInForm` SHALL use the `t()` function from `react-i18next`. The keys SHALL be organized in the i18n locale files (`es.json`, `en.json`, `pt.json`) under namespaces `check`, `payment`, `customer`, `consent`, and `errors.billing`. Every added key SHALL exist in all three locales. The consent text (`consent.body`, `consent.legalText`) SHALL be flagged as `needs_legal_review: true` in the locale metadata until explicitly reviewed and approved by a human.

#### Scenario: All new keys exist in all three locales

- **WHEN** the CI validation script `check-i18n-parity.js` runs
- **THEN** every key added under `check`, `payment`, `customer`, `consent`, or `errors.billing` in `es.json` SHALL exist in `en.json` AND `pt.json`
- **AND** no key SHALL have the value equal to the key name (stale placeholder)

#### Scenario: Consent legal text is flagged for review

- **WHEN** a human reviewer inspects `es.json` before apply
- **THEN** the key `consent.legalText.needsLegalReview` SHALL be `true`
- **AND** the apply phase SHALL NOT proceed without explicit approval of the consent text

---

### Requirement: Return URL of MercadoPago contains no secrets

The environment variable `VITE_MP_RETURN_URL` SHALL be set to `{origin}/payment/result` where `{origin}` is the pwaMenu origin. The return URL SHALL NOT contain the session ID, the table token, the check ID, or any user identifier. Upon the MP redirect back, the `PaymentResultPage` SHALL read `payment_id` and `preference_id` from the query string and match them against the current `paymentStore` state (same `paymentId` and `preferenceId` that were stored before the redirect). Mismatches SHALL be logged (without PII) and the page SHALL display an error.

#### Scenario: Matching payment_id allows the flow to proceed

- **GIVEN** `paymentStore.paymentId === '99'` AND `paymentStore.preferenceId === 'pref_abc'`
- **WHEN** the browser lands on `/payment/result?payment_id=99&preference_id=pref_abc&status=approved`
- **THEN** the page SHALL transition `paymentStore.phase` to `'pending'` and await the WS or polling resolution

#### Scenario: Mismatched payment_id displays error

- **GIVEN** `paymentStore.paymentId === '99'`
- **WHEN** the browser lands on `/payment/result?payment_id=77&preference_id=pref_xyz&status=approved`
- **THEN** `paymentStore.phase` SHALL transition to `'failed'` with `errorCode: 'payment_mismatch'`
- **AND** a message with key `payment.mismatch` SHALL be visible
- **AND** no polling SHALL be started
