# dashboard-orders Specification

## Purpose
TBD - created by archiving change dashboard-orders. Update Purpose after archive.
## Requirements
### Requirement: Orders page is reachable for management roles

The Dashboard SHALL expose a `/orders` route rendered inside `MainLayout` and reachable from the sidebar entry `layout.sidebar.orders` for users with role `ADMIN` or `MANAGER`. The sidebar slot previously disabled (`disabled: true`) SHALL become enabled by this change. The route SHALL be lazy-loaded and wrapped in `ProtectedRoute`.

#### Scenario: Manager navigates to Orders

- **WHEN** a user authenticated with role `MANAGER` clicks the "Órdenes" entry in the sidebar
- **THEN** the router navigates to `/orders`
- **AND** the `Orders` page is rendered inside `MainLayout` with its breadcrumb `layout.breadcrumbs.orders`

#### Scenario: Admin navigates to Orders

- **WHEN** a user authenticated with role `ADMIN` opens `/orders` directly
- **THEN** the page loads successfully without role-based redirect

#### Scenario: Unauthenticated user is redirected

- **WHEN** an anonymous client requests `/orders`
- **THEN** `ProtectedRoute` redirects to `/login`

---

### Requirement: Backend lists admin rounds with filters and pagination

The backend SHALL expose `GET /api/admin/rounds` returning a paginated, filterable list of rounds for the active branch. The endpoint SHALL be protected by JWT and require `MANAGER` or `ADMIN` role (`PermissionContext.require_management()`). All results SHALL be scoped by `tenant_id` and — for non-ADMIN — restricted to `branch_ids` present in the JWT. The response shape SHALL be `{ items: RoundAdminOutput[], total: int, limit: int, offset: int }`.

Query parameters:
- `branch_id` (int, required, must be in `user.branch_ids` if not ADMIN)
- `date` (YYYY-MM-DD, optional; default = today in the branch's timezone)
- `sector_id` (int, optional)
- `status` (str, optional; one of `PENDING | CONFIRMED | SUBMITTED | IN_KITCHEN | READY | SERVED | CANCELED`)
- `table_code` (str, optional; case-insensitive contains match)
- `limit` (int, optional; default 50, max 200)
- `offset` (int, optional; default 0)

Each `RoundAdminOutput` SHALL include denormalized fields for UI: `table_code`, `table_number`, `sector_id`, `sector_name`, `diner_name`, `items_count`, `total_cents`, plus all state-machine timestamps (`pending_at`, `confirmed_at`, `submitted_at`, `in_kitchen_at`, `ready_at`, `served_at`, `canceled_at`) and `cancel_reason`.

#### Scenario: Default request returns today's rounds sorted descending

- **WHEN** `GET /api/admin/rounds?branch_id=1` is called by a MANAGER of branch 1
- **THEN** the response is 200
- **AND** `items` contains rounds of branch 1 with `pending_at` within today (branch timezone)
- **AND** items are sorted by `pending_at DESC`
- **AND** `limit == 50`, `offset == 0`, `total` reflects the unfiltered count for today

#### Scenario: Filter by status returns only rounds in that state

- **WHEN** `GET /api/admin/rounds?branch_id=1&status=PENDING` is called
- **THEN** every item in the response has `status == "PENDING"`

#### Scenario: Filter by sector scopes to tables in that sector

- **WHEN** `GET /api/admin/rounds?branch_id=1&sector_id=3` is called
- **THEN** every item has `sector_id == 3`

#### Scenario: Filter by table_code does case-insensitive partial match

- **WHEN** `GET /api/admin/rounds?branch_id=1&table_code=bar` is called
- **THEN** the response contains rounds whose table code starts with `BAR-` (e.g., `BAR-01`, `BAR-12`) regardless of case

#### Scenario: Pagination returns correct slice

- **WHEN** `GET /api/admin/rounds?branch_id=1&limit=10&offset=20` is called and 35 rounds match
- **THEN** `items.length == 10`, `total == 35`, `limit == 10`, `offset == 20`

#### Scenario: Cross-tenant access is forbidden

- **WHEN** a MANAGER of tenant A calls `GET /api/admin/rounds?branch_id=X` with `X` belonging to tenant B
- **THEN** the backend returns 403 (ForbiddenError)

#### Scenario: Non-management role is forbidden

- **WHEN** a WAITER calls `GET /api/admin/rounds?branch_id=1`
- **THEN** the backend returns 403

#### Scenario: Invalid status returns 422

- **WHEN** `GET /api/admin/rounds?branch_id=1&status=FOO` is called
- **THEN** the backend returns 422 (Pydantic validation error)

#### Scenario: Query is optimized — no N+1

- **WHEN** 100 rounds for branch 1 match the request
- **THEN** the backend issues one query for items (with JOINs to Table, BranchSector, Diner, RoundItem) plus one query for the total count
- **AND** the total number of SQL statements does not grow with the number of rounds

---

### Requirement: Backend fetches a single round with items for the detail modal

The backend SHALL expose `GET /api/admin/rounds/{round_id}` returning a single round enriched with the same denormalized fields as the list endpoint, plus the embedded list of `RoundItemOutput` (including voided items with `is_voided=true`). The endpoint SHALL require `MANAGER` or `ADMIN` role and enforce `tenant_id` + `branch_ids` scoping identical to the list endpoint.

#### Scenario: Manager reads round detail

- **WHEN** a MANAGER calls `GET /api/admin/rounds/42` and round 42 belongs to their branch
- **THEN** the response is 200
- **AND** the body contains the round with `items` array embedded (each item with `product_id`, `quantity`, `notes`, `price_cents_snapshot`, `is_voided`, `void_reason`)

#### Scenario: Round not found returns 404

- **WHEN** a MANAGER calls `GET /api/admin/rounds/999999` and no such round exists for their tenant/branch
- **THEN** the backend returns 404

---

### Requirement: Orders page exposes dual view (columns and list) with persisted preference

The Orders page SHALL provide a toggle between a column view and a list view. The column view SHALL render exactly four columns — `PENDING`, `CONFIRMED`, `SUBMITTED`, `READY` — with compact cards per round. The list view SHALL render a table with columns: round number, table code, sector, status (as `Badge`), items count, total, created at, actions. The selected view SHALL persist in `localStorage` under key `orders.viewMode` with values `'columns' | 'list'`. The default view is `'columns'`.

#### Scenario: Default mount renders columns view

- **WHEN** a user opens `/orders` for the first time (no `orders.viewMode` in `localStorage`)
- **THEN** the page renders the four-column view

#### Scenario: Toggle persists across reloads

- **WHEN** a user toggles to "Lista" view and then reloads the page
- **THEN** the page renders the list view

#### Scenario: Column view shows card per round

- **WHEN** the store contains 2 PENDING, 1 CONFIRMED, 3 SUBMITTED, 0 READY rounds matching the filters
- **THEN** the PENDING column shows 2 cards, CONFIRMED shows 1, SUBMITTED shows 3, READY shows empty state
- **AND** each card displays table code, sector name, items count, and time in state

#### Scenario: List view paginates with 50 rows by default

- **WHEN** the user switches to list view with no explicit page size
- **THEN** at most 50 rows are shown and a `Pagination` component exposes next/previous

---

### Requirement: Orders page filters rounds by date, sector, status and table code

The page SHALL expose four filters in a sticky header: `date` (default = today), `sector_id` (select populated from the active branch's sectors), `status` (select with the seven round states + "Todos"), `table_code` (text input). Filter changes SHALL trigger a server-side `fetchRounds(filters)` call. A "Limpiar filtros" button SHALL reset filters to defaults (today + no other filter). `branch_id` SHALL come from the active `branchStore` and trigger a refetch when it changes.

#### Scenario: Changing date refetches the list

- **WHEN** the user picks a date of yesterday in the date filter
- **THEN** the page calls `GET /api/admin/rounds?branch_id=<active>&date=<yesterday>`

#### Scenario: Status "Todos" omits the status query parameter

- **WHEN** the user selects "Todos" in the status filter
- **THEN** the fetch request does NOT include `status=` in the URL

#### Scenario: Clearing filters restores defaults

- **WHEN** the user has `date=2026-04-01`, `sector_id=3`, `status=CANCELED` and clicks "Limpiar filtros"
- **THEN** the filters return to `date=today` and the other fields are cleared
- **AND** a fetch is issued with only `branch_id` and the default date

#### Scenario: Empty filter result shows empty state

- **WHEN** the API returns `items: []` for the current filters
- **THEN** the page shows a friendly empty-state message and a "Limpiar filtros" CTA

---

### Requirement: Round detail modal shows full lifecycle

Clicking a card or row SHALL open a `Modal` rendering the round detail: state-machine timestamps (each transition timestamp shown as local time, missing transitions shown as "—"), items list (product name, quantity, notes, voided marker), diner (if any), table and sector, `cancel_reason` (if `CANCELED`), and actions (Cancel button — only visible for MANAGER/ADMIN and only when status ∈ `{PENDING, CONFIRMED, SUBMITTED, IN_KITCHEN, READY}`).

#### Scenario: Manager opens round detail

- **WHEN** a MANAGER clicks a round card in the SUBMITTED column
- **THEN** the detail modal opens and shows all timestamps from `pending_at` through `submitted_at`, items of the round, and a visible "Cancelar ronda" button

#### Scenario: Cancel button is hidden for served rounds

- **WHEN** the opened round has `status == "SERVED"`
- **THEN** the detail modal renders but the "Cancelar ronda" button is not rendered

#### Scenario: Cancel button is hidden for waiter role

- **WHEN** a WAITER (edge-case access) opens the detail modal
- **THEN** the "Cancelar ronda" button is not rendered regardless of status

---

### Requirement: Round cancellation requires a reason and emits ROUND_CANCELED

Clicking the "Cancelar ronda" button SHALL open a `ConfirmDialog` with a required textarea for `cancel_reason` (min 1, max 500 characters). Submit SHALL call `PATCH /api/admin/rounds/{id}` with body `{ status: "CANCELED", cancel_reason }`. On success, a toast SHALL confirm the action and the backend SHALL emit the `ROUND_CANCELED` WebSocket event, which the local store handler SHALL consume to update or remove the round from the list. On 409/403/404 the UI SHALL show an error toast describing the failure.

#### Scenario: Successful cancellation

- **WHEN** a MANAGER types "Cliente canceló" and confirms
- **THEN** the frontend issues `PATCH /api/admin/rounds/42 { "status": "CANCELED", "cancel_reason": "Cliente canceló" }`
- **AND** on 200 response a success toast is shown
- **AND** the round is updated in the list via the `ROUND_CANCELED` WS event handler

#### Scenario: Empty reason prevents submission

- **WHEN** the textarea is empty or whitespace-only and the user clicks "Cancelar ronda"
- **THEN** the submit button is disabled (or shows inline validation error)
- **AND** no PATCH request is issued

#### Scenario: Reason exceeds 500 characters

- **WHEN** the textarea has 501 characters
- **THEN** client-side validation prevents submission and informs the user

#### Scenario: Backend rejects cancellation (already served)

- **WHEN** the target round is already `SERVED` and the PATCH returns 409
- **THEN** the UI shows an error toast with the conflict message
- **AND** the dialog closes
- **AND** the list refetches the round to reconcile local state

---

### Requirement: roundsAdminStore follows Zustand conventions and is non-persisted

The Dashboard SHALL implement a Zustand store named `roundsAdminStore` with the following invariants:

- Never destructure the store; consumers SHALL access state via named selectors.
- Arrays SHALL fall back to a stable `EMPTY_ROUNDS` constant (never `?? []` inline).
- Actions SHALL be grouped in a `useRoundsAdminActions()` hook that uses `useShallow`.
- The store SHALL NOT call `persist()` — state lives only in memory.
- The store SHALL expose selectors: `selectAdminRounds`, `selectRoundsFilters`, `selectSelectedRound`, `selectRoundsLoading`, `selectRoundsTotal`.
- IDs in store state SHALL be `string` (converted at the API boundary); money SHALL be integer cents.

#### Scenario: Selector returns stable empty array when no data

- **WHEN** the store is freshly mounted and no fetch has completed
- **THEN** `selectAdminRounds(state)` returns the exact same `EMPTY_ROUNDS` reference across calls

#### Scenario: Actions hook memoizes via useShallow

- **WHEN** a component subscribes via `useRoundsAdminActions()` and the state changes in unrelated fields
- **THEN** the returned action object identity does not change (no unnecessary re-render)

#### Scenario: IDs from API are normalized to strings

- **WHEN** the API responds with `id: 42` (number)
- **THEN** the round stored has `id: "42"` (string)

---

### Requirement: Store consumes WebSocket round events respecting active filters

The store SHALL register handlers for the seven round events — `ROUND_PENDING`, `ROUND_CONFIRMED`, `ROUND_SUBMITTED`, `ROUND_IN_KITCHEN`, `ROUND_READY`, `ROUND_SERVED`, `ROUND_CANCELED` — using a single hook `useRoundsAdminWebSocketSync()` implemented with the ref pattern (two effects) described in the `ws-frontend-subscription` skill. Each handler SHALL evaluate whether the round passes the currently active filter before inserting, updating or removing it from the store. On WS reconnect the hook SHALL invoke `fetchRounds(currentFilters)` to reconcile state.

Filter matching rules:
- `branch_id` MUST match the active filter.
- `date` MUST match `pending_at.slice(0, 10)` in the branch's local timezone.
- If `filters.sector_id` is set, the round's `sector_id` MUST equal it.
- If `filters.status` is set, the round's `status` MUST equal it.
- If `filters.table_code` is set, the round's `table_code` MUST contain it (case-insensitive).

#### Scenario: Matching event upserts round in store

- **WHEN** `ROUND_PENDING` arrives with a round whose `branch_id`, `date` and other fields pass the active filter
- **AND** the round is not yet in the store
- **THEN** the round is added to the store

#### Scenario: Non-matching event is ignored

- **WHEN** `ROUND_PENDING` arrives for a different `branch_id` than the active filter
- **THEN** the round is NOT added to the store

#### Scenario: Round transitioning out of filter is removed

- **WHEN** the active filter is `status=PENDING` and `ROUND_CONFIRMED` arrives for a round already in the store
- **THEN** the round is removed from the store (no longer matches status filter)

#### Scenario: Round transitioning within filter is updated in place

- **WHEN** the active filter is `status=` (empty) and `ROUND_CONFIRMED` arrives for a round already in the store
- **THEN** the round status updates to `CONFIRMED` in place (same array index)

#### Scenario: Reconnect refetches the list

- **WHEN** the WebSocket reconnects after a network drop
- **THEN** the hook invokes `fetchRounds(currentFilters)` to reconcile server and local state

#### Scenario: Partial WS payload is merged, not overwritten

- **WHEN** `ROUND_SERVED` arrives with only `{ id, status, served_at }` for a round already in the store
- **THEN** the existing round's `table_code`, `sector_name` and other denormalized fields are preserved
- **AND** only the status and `served_at` are updated

---

### Requirement: Orders page provides HelpButton with structured help content

The Orders page SHALL include the `HelpButton` component in its header (required by the `help-system-content` convention). The `helpContent.tsx` map SHALL register an entry under the key `orders` with the established structure: title, short description, bullet list of the round states, notes on filters and the cancellation rule (only MANAGER/ADMIN, reason required).

#### Scenario: HelpButton renders on Orders page

- **WHEN** the Orders page is rendered
- **THEN** the `HelpButton` component is present in the header region

#### Scenario: Help popover shows orders-specific content

- **WHEN** the user clicks the HelpButton
- **THEN** the popover renders the content registered under `orders` in `helpContent.tsx`

---

### Requirement: Page and store are covered by unit tests

The change SHALL include:

- Backend pytest tests for `RoundService.list_for_admin` (filters by date/sector/status/table_code, pagination math, tenant isolation, RBAC) and for the router (`test_admin_rounds_list_router.py`): 200/403/422/404 paths.
- Frontend Vitest tests for `roundsAdminStore`: `fetchRounds` happy/error, each WS handler (including partial payload merge and transition out of filter), `cancelRound` delegates to API and triggers refetch on conflict, `clearFilters` resets state.
- Frontend Vitest tests for the `Orders` page: renders empty state, filter changes call store action, clicking card opens modal, cancel button visibility by role, `ConfirmDialog` submit path.

#### Scenario: Store test covers WS upsert

- **WHEN** the test dispatches a simulated `ROUND_PENDING` event through the store handler
- **THEN** the assertion verifies the round appears in `selectAdminRounds(state)`

#### Scenario: RBAC test covers waiter hiding the button

- **WHEN** the Orders page is rendered in a test with an `authStore` whose roles are `['WAITER']`
- **THEN** the "Cancelar ronda" button is not present in the DOM for any round

#### Scenario: Backend test asserts no N+1

- **WHEN** `list_for_admin` is called in a test with 20 seeded rounds
- **THEN** the assertion on `db.execute.call_count` (or SQL statement log) verifies the number of queries is constant (≤ 2, one for items and one for count)

