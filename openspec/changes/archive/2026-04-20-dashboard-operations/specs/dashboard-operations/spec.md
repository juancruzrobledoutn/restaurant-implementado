## ADDED Requirements

### Requirement: Tables Management Page

The Dashboard SHALL provide a page at `/tables` that allows ADMIN and MANAGER users to manage tables (`app_table`) of the currently selected branch. The page SHALL follow the canonical Dashboard CRUD pattern: branch-guard fallback card when no branch is selected, `<TableSkeleton>` while loading, `useFormModal` + `useConfirmDialog` + `usePagination` hook-trio, `useActionState` for form submission, and `HelpButton` inside the create/edit modal as the first form element.

The page SHALL list columns `number`, `code`, `sector`, `capacity`, `status`, and `actions` (edit, delete). Create and update SHALL require ADMIN or MANAGER; delete SHALL require ADMIN (the delete button is hidden for MANAGER). Cascade preview SHALL be shown for deletes when the table has active sessions.

#### Scenario: ADMIN opens Tables page without branch selected
- **WHEN** an ADMIN with no `selectedBranchId` navigates to `/tables`
- **THEN** the page SHALL render a fallback card with the message "Selecciona una sucursal para ver sus mesas" and a button that navigates to `/`

#### Scenario: MANAGER creates a new table
- **WHEN** a MANAGER submits the create form with `{ number, code, sector_id, capacity }` for the selected branch
- **THEN** the form SHALL call `tableAPI.create()` which hits `POST /api/admin/tables` and on success the toast shows "Mesa creada correctamente", the modal closes, and the list updates

#### Scenario: MANAGER cannot see Delete button
- **WHEN** a MANAGER views the Tables list
- **THEN** the row action column SHALL NOT render the delete button (only the edit button is visible)

#### Scenario: Duplicate table code returns 409
- **WHEN** an ADMIN attempts to create a table with a `code` that already exists for the branch
- **THEN** the store SHALL surface the 409 error via `handleError`, the toast shows the backend error message, and the form remains open with the error visible

#### Scenario: Real-time update via ENTITY_UPDATED
- **WHEN** another admin updates a table in another browser tab and the WebSocket delivers `ENTITY_UPDATED` with `entity_type: "app_table"`
- **THEN** the `tableStore` SHALL upsert the row and the `<Table>` re-renders with the new data

---

### Requirement: Sectors Management Page

The Dashboard SHALL provide a page at `/sectors` that allows ADMIN and MANAGER to manage `BranchSector` of the selected branch, following the canonical CRUD pattern. Deleting a sector SHALL cascade soft-delete all its tables, and the delete confirmation SHALL show a `<CascadePreviewList>` with the count of affected tables.

Delete SHALL be ADMIN-only. MANAGER SHALL see only create and edit buttons.

#### Scenario: ADMIN deletes a sector with 3 tables
- **WHEN** an ADMIN opens the delete dialog for a sector that has 3 active tables
- **THEN** the `<ConfirmDialog>` SHALL include a `<CascadePreviewList>` showing "Mesas: 3" and upon confirmation the cascade soft-delete executes

#### Scenario: WebSocket CASCADE_DELETE event refreshes state
- **WHEN** a CASCADE_DELETE event arrives with `entity_type: "branch_sector"`
- **THEN** the `sectorStore` SHALL remove the sector and the `tableStore` SHALL mark all affected tables as inactive without a full refetch

---

### Requirement: Staff Management Page

The Dashboard SHALL provide a page at `/staff` that allows ADMIN and MANAGER to manage users (`app_user`) and their role assignments per branch (`UserBranchRole`). The page SHALL list columns `email`, `full_name`, `roles` (grouped per branch), `status`, and `actions`.

Creating a user SHALL require ADMIN or MANAGER and SHALL include at least one role assignment (`{ branch_id, role }`). The password field SHALL be sent only on create/update and NEVER rendered in any response. Deleting a user (soft-delete) SHALL require ADMIN.

#### Scenario: MANAGER creates a WAITER user
- **WHEN** a MANAGER submits the create form with `{ email, password, first_name, last_name, assignments: [{ branch_id: 1, role: "WAITER" }] }`
- **THEN** the form SHALL call `POST /api/admin/staff` and on success the toast shows "Usuario creado correctamente"

#### Scenario: MANAGER sees no Delete button
- **WHEN** a MANAGER views the Staff list
- **THEN** the delete action SHALL be hidden from every row; only ADMIN sees delete

#### Scenario: ADMIN revokes a role from a branch
- **WHEN** an ADMIN opens the edit modal for a user and removes a role assignment (branch_id + role)
- **THEN** the form SHALL call `DELETE /api/admin/staff/{id}/branches/{branch_id}` and update the user's roles list in the store

#### Scenario: Duplicate email returns 409
- **WHEN** an ADMIN creates a user with an email that already exists in the tenant
- **THEN** the form SHALL show the backend error message and the modal remains open

---

### Requirement: Waiter Assignments Page

The Dashboard SHALL provide a page at `/waiter-assignments` that allows ADMIN and MANAGER to manage daily waiter-to-sector assignments (`WaiterSectorAssignment`). The page SHALL have a date picker (default `today`) and filter by `selectedBranchId`. Rows SHALL show `waiter_name`, `sector_name`, `date`, and a delete action (hard delete, since assignments are ephemeral).

Creating an assignment SHALL open a modal with selectors for waiter (filtered to users with WAITER role on the current branch) and sector (filtered to sectors of the current branch), plus the date field.

#### Scenario: MANAGER creates a waiter assignment for today
- **WHEN** a MANAGER submits the create form with `{ user_id, sector_id, date: today }`
- **THEN** the form SHALL call `POST /api/admin/sectors/{sector_id}/assignments` and the new row appears in the list sorted by sector name

#### Scenario: Duplicate assignment returns 409
- **WHEN** a MANAGER creates an assignment that duplicates `(user_id, sector_id, date)`
- **THEN** the toast SHALL show the duplication error and the modal remains open

#### Scenario: Deleting an assignment is a hard delete
- **WHEN** an ADMIN deletes an assignment
- **THEN** the row SHALL disappear from the list and `DELETE /api/admin/sectors/{sector_id}/assignments/{id}` SHALL be invoked

---

### Requirement: Kitchen Display Page

The Dashboard SHALL provide a page at `/kitchen-display` that shows three columns titled `Enviado`, `En cocina`, and `Listo`, corresponding to rounds with status `SUBMITTED`, `IN_KITCHEN`, and `READY` for the selected branch.

Each column SHALL render one `<KitchenTicketCard>` per active round, sorted ascending by `submitted_at`. Each card SHALL display: table number, sector name, diner count, a live timer (`now - submitted_at`) updated every 30 seconds, a list of items (`quantity × product_name` plus notes), and an urgency badge colored by elapsed time (`<5min` verde, `5-10min` amarillo, `10-15min` naranja, `>15min` rojo).

The page SHALL subscribe to the WebSocket via `dashboardWS.onFiltered(selectedBranchId, '*', ...)` for events `ROUND_SUBMITTED`, `ROUND_IN_KITCHEN`, `ROUND_READY`, `ROUND_CANCELED`, following the two-effect ref pattern. On WebSocket reconnect (`onConnectionChange(true)`), the store SHALL refetch the full snapshot via `GET /api/kitchen/rounds?branch_id=X`.

The page SHALL include a persisted audio alert toggle (localStorage key `kitchenDisplay.audio`). When enabled and a `ROUND_READY` event arrives, a short audio file SHALL be played.

ADMIN and MANAGER SHALL see action buttons on each card that transition status via `PATCH /api/admin/rounds/{id}` (for ADMIN/MANAGER) — SUBMITTED → IN_KITCHEN, IN_KITCHEN → READY, READY → SERVED.

#### Scenario: Kitchen Display loads initial snapshot
- **WHEN** an ADMIN navigates to `/kitchen-display` with a selected branch
- **THEN** the page SHALL call `GET /api/kitchen/rounds?branch_id=X` and render three columns with the returned rounds grouped by status

#### Scenario: New round arrives via WebSocket
- **WHEN** a `ROUND_SUBMITTED` event for the selected branch arrives
- **THEN** a new `<KitchenTicketCard>` SHALL appear in the "Enviado" column without a page reload

#### Scenario: Round transitions from IN_KITCHEN to READY
- **WHEN** a `ROUND_READY` event arrives and the audio toggle is ON
- **THEN** the card SHALL move from "En cocina" to "Listo" and the audio file SHALL play

#### Scenario: WebSocket reconnects after network drop
- **WHEN** `dashboardWS.onConnectionChange(true)` fires after a disconnect
- **THEN** the store SHALL refetch the full snapshot and replace its state with the fresh data

#### Scenario: Urgency badge color reflects elapsed time
- **WHEN** a round has `submitted_at` 12 minutes ago
- **THEN** the urgency badge SHALL render with the orange color class (`10-15min` range)

#### Scenario: MANAGER marks a ready round as served
- **WHEN** a MANAGER clicks "Marcar entregado" on a READY card
- **THEN** the card SHALL call `PATCH /api/admin/rounds/{id}` with `{ status: "SERVED" }` and disappear from the display

---

### Requirement: Sales Page

The Dashboard SHALL provide a page at `/sales` that shows daily operational KPIs for the selected branch. The page SHALL include a date picker (default today) and 3 KPI cards: `Ingresos del día`, `Órdenes`, `Ticket promedio`, plus a table `Top productos del día` (top 10 by revenue).

The page SHALL fetch data via `GET /api/admin/sales/daily?branch_id=X&date=YYYY-MM-DD` and `GET /api/admin/sales/top-products?branch_id=X&date=YYYY-MM-DD&limit=10`. The KPI values stored in the `salesStore` SHALL be in cents (int); the components display them converted to pesos with `formatPrice(cents)`.

Each row of the top products table SHALL include a `<ReceiptButton>` only if the row represents an order (linked to a paid `Check`). The button SHALL open `GET /api/admin/checks/{id}/receipt` in a new window and trigger `window.print()`.

#### Scenario: ADMIN views today's sales
- **WHEN** an ADMIN opens `/sales` with a selected branch
- **THEN** the page SHALL render the 3 KPI cards and the top products table with data from today

#### Scenario: KPI shows 0 when there are no sales
- **WHEN** the branch has no paid checks for the selected date
- **THEN** the 3 KPI cards SHALL show `$0.00`, `0`, and `$0.00` respectively, and the top products table SHALL show a `<Table>` empty state

#### Scenario: Changing date refetches data
- **WHEN** the user selects a different date in the picker
- **THEN** the page SHALL refetch both endpoints and update the KPIs and the table

#### Scenario: Receipt button prints the check
- **WHEN** the user clicks `<ReceiptButton>` for a specific order
- **THEN** the browser SHALL open the receipt URL in a new window and the print dialog opens automatically

---

### Requirement: Dashboard Navigation and Help Content

The Dashboard `MainLayout` sidebar SHALL include new entries for the 6 new pages (Tables, Sectors, Staff, Waiter Assignments, Kitchen Display, Sales), visible only to users whose roles permit access (ADMIN, MANAGER). `helpContent.tsx` SHALL include an entry per new page following the canonical JSX structure (title → intro → feature list → tip box). Every `<PageContainer>` SHALL receive the corresponding `helpContent` prop. Every create/edit modal SHALL have a `<HelpButton size="sm">` as the first element inside the form.

#### Scenario: KITCHEN user does not see Staff link
- **WHEN** a KITCHEN user views the sidebar
- **THEN** the Staff, Waiter Assignments, Sales links SHALL NOT be rendered (they require management role)

#### Scenario: Every new page renders a HelpButton
- **WHEN** any of the 6 new pages mount
- **THEN** the `<PageContainer>` SHALL receive `helpContent.<pageKey>` and the HelpButton icon is rendered in the header

---

### Requirement: Zustand Stores for Operations

The Dashboard SHALL introduce 6 Zustand stores: `tableStore`, `sectorStore`, `staffStore`, `waiterAssignmentStore`, `kitchenDisplayStore`, `salesStore`. Each store SHALL follow the canonical pattern: `create(persist(...))` with `version` from `STORE_VERSIONS`, selectors exported separately, `useShallow` for object/array selectors, `EMPTY_*` stable constants for nullable fallbacks, and never destructuring in components.

The `kitchenDisplayStore` SHALL NOT use `persist` because its data is highly ephemeral; the audio toggle preference SHALL be stored in `localStorage['kitchenDisplay.audio']` separately.

Each of the 5 persisted stores SHALL include a `migrate` function (currently version 1, no-op) in preparation for future shape changes.

#### Scenario: tableStore selector returns filtered branch tables
- **WHEN** a component calls `useTableStore(useShallow((s) => s.tables.filter((t) => t.branch_id === branchId)))`
- **THEN** the selector SHALL return a stable reference when the underlying array is unchanged and SHALL NOT trigger infinite renders

#### Scenario: kitchenDisplayStore is not persisted
- **WHEN** the app reloads
- **THEN** `kitchenDisplayStore.rounds` SHALL be empty and a fresh fetch is triggered on Kitchen Display mount
