## ADDED Requirements

### Requirement: Customer model is multi-tenant and supports opt-in with consent audit

The system SHALL extend the `customer` table with the following columns: `tenant_id` (BigInteger FK to `tenant`, NOT NULL after backfill), `consent_version` (String 20, nullable), `consent_granted_at` (DateTime with timezone, nullable), `consent_ip_hash` (String 64, nullable — SHA-256 hex of `client_ip + tenant_salt`), `opted_in` (Boolean, NOT NULL, default FALSE). The existing columns (`id`, `device_id`, `name`, `email`, `is_active`) SHALL remain. The table SHALL have a unique partial index on `(device_id, tenant_id) WHERE is_active = TRUE` to prevent duplicates per tenant. The `email` column SHALL be nullable and SHALL be set only after opt-in.

#### Scenario: Customer without opt-in has no PII

- **WHEN** a customer row is created via `CustomerService.get_or_create_by_device(device_id='dev-1', tenant_id=1)` for a device that has never joined before
- **THEN** the row SHALL have `device_id='dev-1'`, `tenant_id=1`, `opted_in=FALSE`, `name=NULL`, `email=NULL`, `consent_version=NULL`
- **AND** the row SHALL be idempotent: a second call with the same arguments SHALL return the existing row, not create a new one

#### Scenario: Same device in two tenants creates two distinct customers

- **GIVEN** a customer exists with `device_id='dev-1'` AND `tenant_id=1`
- **WHEN** `CustomerService.get_or_create_by_device(device_id='dev-1', tenant_id=2)` is called
- **THEN** a new row SHALL be created with `tenant_id=2`
- **AND** the two rows SHALL have distinct `id` values

#### Scenario: Opt-in records consent audit fields

- **GIVEN** a customer exists with `opted_in=FALSE`
- **WHEN** `CustomerService.opt_in(customer_id, name='Ana', email='ana@example.com', client_ip='1.2.3.4', consent_version='v1')` is called at time `t`
- **THEN** the customer row SHALL have `opted_in=TRUE`, `name='Ana'`, `email='ana@example.com'`, `consent_version='v1'`, `consent_granted_at` approximately equal to `t`
- **AND** `consent_ip_hash` SHALL equal `sha256('1.2.3.4' + tenant_salt).hex()` (64-char lowercase hex)
- **AND** the plain-text IP SHALL NOT be stored anywhere

---

### Requirement: CustomerService provides domain logic for loyalty

The system SHALL provide `CustomerService` in `backend/rest_api/services/customer_service.py` extending `BaseCRUDService[Customer, CustomerOut]`. The service SHALL implement: `get_or_create_by_device(device_id, tenant_id) -> Customer`, `get_profile(customer_id, tenant_id) -> CustomerProfileOut`, `opt_in(customer_id, tenant_id, name, email, client_ip, consent_version) -> Customer`, `get_visit_history(customer_id, tenant_id, branch_id=None, limit=20) -> list[VisitOut]`, `get_preferences(customer_id, tenant_id, top_n=5) -> list[PreferenceOut]`. All methods SHALL filter by `tenant_id` — the router SHALL resolve `tenant_id` from the Table Token context and pass it explicitly. The service SHALL use `safe_commit(db)` and SHALL NEVER call `db.commit()` directly. Logging SHALL be via `get_logger()` and SHALL NEVER include `name`, `email`, or raw `device_id` in log messages — only `customer_id` and hashed identifiers.

#### Scenario: get_or_create is idempotent within a tenant

- **GIVEN** `CustomerService.get_or_create_by_device('dev-1', tenant_id=1)` has been called and returned `customer_id=7`
- **WHEN** the same call is made a second time in a different transaction
- **THEN** it SHALL return the same `customer_id=7`
- **AND** no new row SHALL be inserted

#### Scenario: opt_in is only allowed when customer is not opted in

- **GIVEN** a customer with `opted_in=TRUE`
- **WHEN** `CustomerService.opt_in(...)` is called again
- **THEN** the service SHALL raise a domain error with code `already_opted_in`
- **AND** no database mutation SHALL occur

#### Scenario: Visit history respects tenant_id

- **GIVEN** a customer has 3 sessions in tenant 1 and 2 sessions in tenant 2 (same `device_id`, different `customer_id` per tenant)
- **WHEN** `CustomerService.get_visit_history(customer_id=customer_tenant1.id, tenant_id=1)` is called
- **THEN** it SHALL return exactly 3 `VisitOut` entries
- **AND** none of them SHALL belong to tenant 2

#### Scenario: Preferences return top products by quantity

- **GIVEN** a customer has rounds containing product 'Milanesa' (quantity 5), 'Coca' (quantity 3), 'Ensalada' (quantity 2), 'Pizza' (quantity 1), 'Helado' (quantity 1), 'Cafe' (quantity 1) across 3 visits
- **WHEN** `CustomerService.get_preferences(customer_id, tenant_id, top_n=5)` is called
- **THEN** it SHALL return exactly 5 `PreferenceOut` entries ordered by quantity desc
- **AND** 'Milanesa' SHALL be first with `quantity=5`

#### Scenario: Logs do not include PII

- **WHEN** `CustomerService.opt_in(customer_id=7, name='Ana', email='ana@example.com', ...)` is called
- **THEN** grep of the log output SHALL NOT contain `'Ana'` or `'ana@example.com'` or the plain IP
- **AND** the log line SHALL contain `customer_id=7` and a label like `opt-in completed`

---

### Requirement: Customer router exposes opt-in and profile endpoints

The system SHALL provide the router `/api/customer/` in `backend/rest_api/routers/customer.py` authenticated by `X-Table-Token` (via `current_table_context` dependency). The router SHALL expose:

- `GET /api/customer/profile` (20/min per IP): returns the customer profile for the device of the current table token. Returns 200 with `CustomerProfileOut` or 404 if no customer exists.
- `POST /api/customer/opt-in` (3/min per IP): body `{ name: string, email: string, consent_version: string, consent_granted: boolean }`. Returns 201 with `CustomerProfileOut` on success, 400 on validation error, 409 if already opted in.
- `GET /api/customer/history` (20/min per IP): returns last 20 visits for the customer.
- `GET /api/customer/preferences` (20/min per IP): returns top 5 products.

The router SHALL contain zero business logic — it SHALL delegate all processing to `CustomerService`. Responses SHALL NEVER include the raw `device_id` — only a short deterministic prefix for client-side caching.

#### Scenario: GET /api/customer/profile returns 404 when no customer exists

- **GIVEN** a valid Table Token for a session whose diner has `customer_id=NULL`
- **WHEN** `GET /api/customer/profile` is called
- **THEN** the response SHALL be 404 with body `{ code: 'customer_not_found' }`

#### Scenario: POST /api/customer/opt-in creates consent audit

- **GIVEN** a valid Table Token for a session whose diner has `customer_id=7` AND `opted_in=FALSE`
- **WHEN** `POST /api/customer/opt-in` is called with body `{ name: 'Ana', email: 'ana@example.com', consent_version: 'v1', consent_granted: true }`
- **THEN** the response SHALL be 201 with `opted_in: true`
- **AND** the customer row SHALL have `consent_ip_hash` set (non-null)
- **AND** `consent_granted_at` SHALL be within 5 seconds of the request time

#### Scenario: POST /api/customer/opt-in rejects missing consent checkbox

- **WHEN** `POST /api/customer/opt-in` is called with body `{ name: 'Ana', email: 'ana@example.com', consent_version: 'v1', consent_granted: false }`
- **THEN** the response SHALL be 400 with `{ code: 'consent_required' }`
- **AND** no database mutation SHALL occur

#### Scenario: Rate limit on opt-in blocks bruteforce

- **WHEN** the same IP sends 4 `POST /api/customer/opt-in` requests within 60 seconds
- **THEN** the 4th request SHALL return 429

#### Scenario: Response never includes raw device_id

- **WHEN** `GET /api/customer/profile` returns 200 for a customer with `device_id='dev-abc123xyz'`
- **THEN** the response body SHALL NOT contain the string `'dev-abc123xyz'`
- **AND** the response body MAY contain a short prefix (e.g., `device_hint: 'dev-abc'`) for client-side identification

---

### Requirement: Public join-table endpoint activates customer_id

The endpoint `POST /api/public/tables/code/{code}/join?branch_slug={slug}` SHALL, when the request body includes a non-null `device_id` AND the feature flag `ENABLE_CUSTOMER_TRACKING` is `true` (default), call `CustomerService.get_or_create_by_device(device_id, tenant_id)` and set `diner.customer_id` to the returned customer id. The linkage SHALL occur in the same transaction as the diner creation via `safe_commit(db)`. When `device_id` is null or the feature flag is disabled, `diner.customer_id` SHALL remain null (pre-C-19 behavior).

#### Scenario: Join with device_id links customer_id

- **GIVEN** `ENABLE_CUSTOMER_TRACKING=true` AND no customer exists for `device_id='dev-1'` in tenant 1
- **WHEN** a `POST /api/public/tables/code/T01/join?branch_slug=centro` arrives with body `{ name: 'Juan', device_id: 'dev-1' }` and the table resolves to tenant 1
- **THEN** a new `customer` row SHALL be created with `device_id='dev-1'`, `tenant_id=1`, `opted_in=FALSE`
- **AND** the created `diner` row SHALL have `customer_id` equal to the new customer id

#### Scenario: Second join from same device reuses customer

- **GIVEN** a customer exists with `device_id='dev-1'` AND `tenant_id=1` AND `id=7`
- **WHEN** a `POST /api/public/tables/code/T02/join?branch_slug=centro` arrives with body `{ name: 'Juan', device_id: 'dev-1' }` and the table resolves to tenant 1
- **THEN** the created `diner` row SHALL have `customer_id=7`
- **AND** no new customer row SHALL be inserted

#### Scenario: Join without device_id leaves customer_id null

- **WHEN** a `POST /api/public/tables/code/T01/join?branch_slug=centro` arrives with body `{ name: 'Walk-in' }` (no `device_id`)
- **THEN** the created `diner` row SHALL have `customer_id=NULL`
- **AND** no customer row SHALL be inserted

#### Scenario: Feature flag disabled preserves pre-C-19 behavior

- **GIVEN** `ENABLE_CUSTOMER_TRACKING=false`
- **WHEN** a `POST /api/public/tables/code/T01/join?branch_slug=centro` arrives with body `{ name: 'Juan', device_id: 'dev-1' }`
- **THEN** the created `diner` row SHALL have `customer_id=NULL`
- **AND** no customer row SHALL be inserted or queried

---

### Requirement: pwaMenu customer store hydrates profile on demand

The `customerStore` Zustand store SHALL hold `{ profile: CustomerProfile | null, visitHistory: Visit[], preferences: Preference[], optedIn: boolean, consentVersion: string | null, loadedAt: string | null }`. The store SHALL be populated lazily by `customerStore.load()` which calls `GET /api/customer/profile`, `GET /api/customer/history`, and `GET /api/customer/preferences` in parallel. The store SHALL NOT persist any data to `localStorage` or `IndexedDB` — data lives only in memory for the duration of the session. On 404 from `/api/customer/profile`, the store SHALL set `profile = null` and NOT raise an error.

#### Scenario: load() populates all three slices

- **WHEN** `customerStore.load()` is called AND the three endpoints return successful responses
- **THEN** `customerStore.profile` SHALL be a non-null object
- **AND** `customerStore.visitHistory` SHALL be an array
- **AND** `customerStore.preferences` SHALL be an array
- **AND** `customerStore.loadedAt` SHALL be a valid ISO timestamp

#### Scenario: 404 on profile sets profile to null gracefully

- **WHEN** `customerStore.load()` is called AND `GET /api/customer/profile` returns 404
- **THEN** `customerStore.profile` SHALL equal `null`
- **AND** no error SHALL be thrown
- **AND** `customerStore.visitHistory` SHALL still be populated if its endpoint succeeded

#### Scenario: No persistence to storage

- **GIVEN** `customerStore.profile` is populated with `{ name: 'Ana', email: 'ana@example.com' }`
- **WHEN** the browser reloads or the service worker reactivates
- **THEN** `localStorage.getItem('customer-store')` SHALL be `null`
- **AND** `customerStore.profile` SHALL be `null` until `load()` is called again

---

### Requirement: Opt-in form uses React 19 useActionState with consent validation

The component `OptInForm` in pwaMenu SHALL use React 19's `useActionState` hook to manage form submission. The form SHALL include fields `name` (required, 2+ chars), `email` (required, valid email regex client-side), and `consent` (checkbox, required, NOT pre-checked). The submit action SHALL call `POST /api/customer/opt-in`. On success, the form SHALL reset and navigate to `/profile`. On 400/409, the form SHALL display the localized error without clearing user input. The checkbox label SHALL use the key `consent.legalText` which SHALL be flagged for legal review.

#### Scenario: Checkbox is not pre-checked

- **WHEN** `OptInForm` renders for the first time
- **THEN** the consent checkbox SHALL have `checked === false`

#### Scenario: Submit without consent is blocked client-side

- **GIVEN** `name` and `email` are valid
- **WHEN** the user clicks "Enviar" with consent checkbox unchecked
- **THEN** the form SHALL NOT call `POST /api/customer/opt-in`
- **AND** an inline error with key `consent.required` SHALL be visible

#### Scenario: 409 already opted in shows friendly message

- **WHEN** `POST /api/customer/opt-in` returns 409 `{ code: 'already_opted_in' }`
- **THEN** the form SHALL display the translated key `consent.alreadyOptedIn`
- **AND** after 3 seconds, SHALL navigate to `/profile`

#### Scenario: Success navigates to profile

- **WHEN** `POST /api/customer/opt-in` returns 201 `{ opted_in: true, ... }`
- **THEN** `customerStore.optedIn` SHALL equal `true`
- **AND** the router SHALL navigate to `/profile`
