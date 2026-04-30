# dashboard-billing-pages Specification

## Purpose
TBD - created by archiving change dashboard-billing. Update Purpose after archive.
## Requirements
### Requirement: Checks page lists billing checks for the selected branch

The Dashboard SHALL provide a page at `/checks` that lists `app_check` records of the currently selected branch, accessible to ADMIN and MANAGER only. The page SHALL follow the canonical Dashboard read-only pattern: branch-guard fallback card when no branch is selected, `<TableSkeleton>` while loading, `usePagination`, `<HelpButton>` in the `PageContainer`, and a date picker filter in the header.

The page SHALL display three KPI cards in the header (daily count of checks, total revenue billed in the day in cents, and count of pending `REQUESTED` checks), computed client-side from the visible page via `useMemo`. The table SHALL render columns: `id`, `created_at` (time only), `total_cents` (formatted via `formatPrice`), `covered_cents` (sum of allocations), `status` badge (`REQUESTED` yellow / `PAID` green), and actions (view detail, print receipt).

The `billingAdminAPI.listChecks({ branchId, from, to, status, page, pageSize })` SHALL call `GET /api/admin/checks` with query params. Results SHALL be stored in `billingAdminStore.checks` and consumed via stable selectors (`selectChecks`, `selectChecksLoading`, `selectChecksFilter`) that use `useShallow` for arrays and return the module-level `EMPTY_CHECKS` constant as fallback.

#### Scenario: ADMIN opens /checks without selecting a branch
- **WHEN** an ADMIN with no `selectedBranchId` navigates to `/checks`
- **THEN** the page SHALL render a fallback card with the Spanish message "Selecciona una sucursal para ver sus cuentas" and a button that navigates to `/`

#### Scenario: MANAGER views checks of today
- **WHEN** a MANAGER with `selectedBranchId=42` and default filter `date=today` opens `/checks`
- **THEN** `billingAdminAPI.listChecks` SHALL be called with `{ branchId: 42, from: todayISO, to: todayISO, page: 1, pageSize: 20 }` and the response SHALL populate `billingAdminStore.checks`

#### Scenario: KPI card renders total billed of the day
- **WHEN** `billingAdminStore.checks` contains 5 checks with total_cents `[10000, 20000, 30000, 15000, 25000]` for the selected day
- **THEN** the "Total facturado" KPI card SHALL display `$1.000,00` (100000 cents formatted by `formatPrice`)

#### Scenario: Badge color reflects check status
- **WHEN** a row with `status="REQUESTED"` renders
- **THEN** the status cell SHALL render a `<Badge variant="warning">` with the text "Solicitada" and include `<span className="sr-only">Estado:</span>` for accessibility

#### Scenario: KITCHEN user cannot access /checks
- **WHEN** a KITCHEN-role user navigates to `/checks`
- **THEN** the route guard SHALL redirect to `/` and render no content

#### Scenario: Branch change refetches checks
- **WHEN** `selectedBranchId` changes from 42 to 43 while the user is on `/checks`
- **THEN** the `useEffect` depending on `selectedBranchId` SHALL call `billingAdminAPI.listChecks({ branchId: 43, ... })` and the KPI cards SHALL recompute from the new dataset

---

### Requirement: Check detail modal shows charges, allocations, and payments

The Dashboard SHALL provide a `<CheckDetailModal>` component that opens when the user clicks the "Ver detalle" action on a `/checks` row. The modal SHALL fetch the full check via `billingAPI.getCheck(sessionId)` (existing endpoint `GET /api/billing/check/{session_id}`) on open and display three collapsible sections: `Cargos` (table of `ChargeOut` with `amount_cents`, `remaining_cents`, `diner_id`, `description`), `Asignaciones FIFO` (table of `AllocationOut` with `charge_id`, `payment_id`, `amount_cents`), and `Pagos` (table of `PaymentOut` with `method`, `status`, `amount_cents`, `external_id`, `created_at`).

The modal SHALL include a `<HelpButton size="sm">` as the first element and a "Imprimir recibo" button in the footer that invokes `receiptAPI.printCheck(checkId)` (existing helper from C-16).

#### Scenario: Opening detail modal fetches full check
- **WHEN** the user clicks "Ver detalle" on a row with `session_id=100`
- **THEN** `billingAPI.getCheck(100)` SHALL be called and while pending the modal body SHALL display a skeleton; on resolution the three tables SHALL render

#### Scenario: Modal shows remaining_cents per charge
- **WHEN** a charge has `amount_cents=5000` and two allocations summing `3500`
- **THEN** the Cargos table row SHALL display "Pendiente: $15,00" (corresponding to `remaining_cents=1500` from the `CheckOut.charges[].remaining_cents` field returned by backend)

#### Scenario: Print receipt button opens printable view
- **WHEN** the user clicks "Imprimir recibo" in the modal footer for a check with id 77
- **THEN** `receiptAPI.printCheck(77)` SHALL be invoked (the helper opens a printable window / blob) and the modal SHALL remain open

#### Scenario: Modal closes via footer cancel and backdrop
- **WHEN** the user clicks the `Cancelar` footer button or the backdrop
- **THEN** the modal SHALL close and the local loading state SHALL reset

---

### Requirement: Payments page lists payments with filters and method totals

The Dashboard SHALL provide a page at `/payments` that lists `payment` records of the currently selected branch, accessible to ADMIN and MANAGER only. The page SHALL follow the canonical Dashboard read-only pattern with branch-guard, `<TableSkeleton>`, `usePagination`, `<HelpButton>` in the `PageContainer`.

The header SHALL include three filter controls: date range picker (default today..today), method select (`all | cash | card | transfer | mercadopago`), and status select (`all | APPROVED | REJECTED | PENDING`). Filter state SHALL live in `billingAdminStore.paymentsFilter` and SHALL persist via Zustand `persist` middleware.

The table SHALL render columns: `created_at`, `check_id` (with link/action to open `CheckDetailModal`), `method` (translated label with icon), `amount_cents` (formatted), `status` badge (green `APPROVED` / red `REJECTED` / yellow `PENDING`).

Below the paginated table, a summary section SHALL aggregate the CURRENT filtered payments by `method`, summing `amount_cents` **only for `status === "APPROVED"`**, using `useMemo`. The summary SHALL render a small table with columns: `Método`, `Cantidad`, `Total`. `REJECTED` / `PENDING` / `FAILED` payments SHALL be excluded from totals but SHALL remain visible in the main table.

#### Scenario: ADMIN filters payments by method "cash"
- **WHEN** the ADMIN selects `method=cash` in the filter
- **THEN** `billingAdminAPI.listPayments` SHALL be called with `method=cash` and the table SHALL only show cash payments; the method summary SHALL show a single row for `cash`

#### Scenario: Method summary excludes rejected payments
- **WHEN** filtered payments include 3 APPROVED cash payments ($10, $20, $30) and 1 REJECTED cash payment ($100)
- **THEN** the summary row for `cash` SHALL show `Cantidad: 3` and `Total: $60,00` — the $100 REJECTED is excluded from totals but visible in the main table

#### Scenario: Status badge reflects payment state
- **WHEN** a row with `status="REJECTED"` renders
- **THEN** the status cell SHALL render a `<Badge variant="danger">` with the Spanish label "Rechazado" and include `<span className="sr-only">Estado:</span>`

#### Scenario: Date range filter persisted in localStorage
- **WHEN** the user selects `from=2026-04-01`, `to=2026-04-15` and reloads the page
- **THEN** on reload the filter SHALL restore the same dates (persisted via Zustand `persist` middleware) and the listing SHALL call the backend with those dates

#### Scenario: WAITER cannot access /payments
- **WHEN** a WAITER-role user navigates to `/payments`
- **THEN** the route guard SHALL redirect to `/` and render no content

---

### Requirement: billingAdminStore is a modular Zustand 5 store with typed filters

The Dashboard SHALL implement a `billingAdminStore` under `Dashboard/src/stores/billingAdminStore/` with modular structure (`store.ts`, `selectors.ts`, `types.ts`, `index.ts`). The store SHALL hold two domain arrays (`checks`, `payments`), their loading flags (`checksLoading`, `paymentsLoading`), their filters (`checksFilter`, `paymentsFilter`), and actions `fetchChecks`, `fetchPayments`, `upsertCheck`, `upsertPayment`, `setChecksFilter`, `setPaymentsFilter`, and `reset`.

Selectors SHALL follow the `zustand-store-pattern` skill: no destructuring allowed in consumers, `useShallow` for any filtered/mapped arrays, and module-level `EMPTY_CHECKS: CheckSummary[] = []` and `EMPTY_PAYMENTS: PaymentSummary[] = []` constants for nullable fallbacks.

The `persist` middleware SHALL only persist `checksFilter` and `paymentsFilter` (not the data arrays — those are fetched on mount). The persist key SHALL be `STORAGE_KEYS.BILLING_ADMIN_STORE` and the version SHALL be declared in `STORE_VERSIONS.BILLING_ADMIN_STORE`.

#### Scenario: useChecks selector returns stable reference for empty state
- **WHEN** the store is created and no fetch has run
- **THEN** `useBillingAdminStore(selectChecks)` SHALL return the module-level `EMPTY_CHECKS` constant (the same reference across renders)

#### Scenario: upsertCheck replaces existing check by id
- **WHEN** `billingAdminStore.checks` contains a check with `id=10, status="REQUESTED"` and the action `upsertCheck({ id: 10, status: "PAID", ... })` is dispatched
- **THEN** the array length SHALL remain unchanged and the check at id=10 SHALL have `status="PAID"`

#### Scenario: upsertPayment adds new payment when id not present
- **WHEN** `billingAdminStore.payments` has no payment with `id=55` and `upsertPayment({ id: 55, status: "APPROVED", ... })` is dispatched
- **THEN** the payment SHALL be appended to the array and the `status` badge SHALL render correctly

#### Scenario: Consumer destructuring the store triggers lint error
- **WHEN** a developer writes `const { checks } = useBillingAdminStore()`
- **THEN** the ESLint rule (project-wide) SHALL flag this pattern and code review SHALL reject it (patterns enforced by `zustand-store-pattern` skill)

#### Scenario: Filter persist survives reload
- **WHEN** the user sets `paymentsFilter.method="card"` and reloads the page
- **THEN** after rehydrate, `billingAdminStore.paymentsFilter.method` SHALL still equal `"card"` and the data arrays SHALL be empty until the next fetch runs

---

### Requirement: Real-time subscription to billing Outbox events via ref pattern

The Dashboard SHALL subscribe to WebSocket events `CHECK_REQUESTED`, `CHECK_PAID`, `PAYMENT_APPROVED`, and `PAYMENT_REJECTED` for the selected branch, using `dashboardWS.onFiltered(selectedBranchId, '*', handler)` inside a component (not inside the store). The subscription SHALL follow the two-effect ref pattern from `ws-frontend-subscription` skill: one effect keeps a `useRef` pointing at the latest handler, and the second effect subscribes once with `[selectedBranchId]` deps and returns the `unsubscribe` function for cleanup.

The handler SHALL switch on event type and call `upsertCheck` for `CHECK_*` events and `upsertPayment` for `PAYMENT_*` events. If the event payload only contains identifiers (no full entity), the handler SHALL refetch the full entity via `billingAPI.getCheck(sessionId)` or `billingAdminAPI.getPayment(paymentId)` and then upsert.

The subscription SHALL be active while either `/checks` or `/payments` is mounted. If both pages share a common bridge component or mount point in `MainLayout`, the implementation SHALL ensure only ONE subscription is active at a time (no duplicate handlers).

#### Scenario: CHECK_PAID event upserts check in store
- **WHEN** the WebSocket delivers `{ type: "CHECK_PAID", branch_id: 42, entity: { id: 10, status: "PAID", total_cents: 15000 } }` and the user is on `/checks` for branch 42
- **THEN** the handler SHALL call `upsertCheck` and the row with id=10 SHALL re-render with the green `PAID` badge; the KPI "cuentas pendientes" SHALL decrement by one

#### Scenario: Subscription re-subscribes on branch change
- **WHEN** `selectedBranchId` changes from 42 to 43
- **THEN** the previous subscription SHALL be unsubscribed (cleanup returns `unsubscribe`) and a new subscription for branch 43 SHALL be created

#### Scenario: Handler closure always references latest state
- **WHEN** a WS event arrives after the user changed `paymentsFilter`
- **THEN** the handler (via `handleEventRef.current`) SHALL see the latest filter state and behave accordingly — no stale closure

#### Scenario: Unmounting the page cleans up the subscription
- **WHEN** the user navigates away from `/checks` to `/`
- **THEN** the `useEffect` cleanup SHALL call the `unsubscribe` returned by `dashboardWS.onFiltered` and subsequent WS events SHALL not invoke the handler

