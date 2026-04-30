## MODIFIED Requirements

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
