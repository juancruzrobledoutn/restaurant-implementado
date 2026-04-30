## MODIFIED Requirements

### Requirement: Diner model
The system SHALL store diners with fields: `id` (BigInteger PK), `session_id` (FK to `table_session`, ondelete RESTRICT), `name` (String 255, not null), `device_id` (String 128, nullable), `customer_id` (BigInteger FK to `customer`, ondelete SET NULL, nullable — populated by `CustomerService.get_or_create_by_device()` when the join endpoint receives a `device_id` and `ENABLE_CUSTOMER_TRACKING=true`), plus `AuditMixin` fields. Table name: `diner`. Index on `session_id`. Index on `customer_id`. Relationships: `session` (N:1 to TableSession), `customer` (N:1 to Customer, nullable).

#### Scenario: Register a diner in an OPEN session
- **WHEN** a Diner is created with `session_id=42`, `name='Juan'`, `device_id='dev-abc123'`
- **THEN** the row SHALL be persisted with `is_active=True`

#### Scenario: A diner with no device_id is valid
- **WHEN** a Diner is created with `session_id=42`, `name='Mozo walk-in'`, `device_id=NULL`
- **THEN** the row SHALL be persisted — `device_id` is optional (waiter-entered diners do not have devices)
- **AND** `customer_id` SHALL be `NULL`

#### Scenario: Diner with device_id gets customer_id linked when tracking is enabled
- **GIVEN** `ENABLE_CUSTOMER_TRACKING=true` AND no customer exists for `device_id='dev-1'` in the tenant
- **WHEN** a Diner is created via the public join endpoint with `device_id='dev-1'`
- **THEN** a new customer row SHALL be created first
- **AND** the diner row SHALL have `customer_id` equal to the new customer's id

#### Scenario: Diner with repeat device_id reuses existing customer
- **GIVEN** a customer exists with `device_id='dev-1'` in the tenant with `id=7`
- **WHEN** a Diner is created via the public join endpoint with `device_id='dev-1'`
- **THEN** the diner row SHALL have `customer_id=7`
- **AND** no new customer row SHALL be inserted

---

### Requirement: Public join-table endpoint
The system SHALL provide `POST /api/public/tables/code/{code}/join?branch_slug={slug}` with NO authentication. Body: `{"name": "<diner name>", "device_id": "<optional>"}`. The endpoint SHALL (a) activate the session if none is active on the table, (b) create a `Diner` row, (c) when `device_id` is provided AND the feature flag `ENABLE_CUSTOMER_TRACKING` is `true`, call `CustomerService.get_or_create_by_device(device_id, tenant_id)` and set `diner.customer_id` atomically in the same `safe_commit(db)`, (d) return 201 with `{ "table_token": "<hmac>", "session_id": "<id>", "diner_id": "<id>", "table": {...} }`. The endpoint MUST NOT leak the existence of a `(slug, code)` pair — a non-existent pair returns 404 uniformly. The response body SHALL NOT expose the `customer_id` — customer data is accessed via `/api/customer/profile` with the returned Table Token.

#### Scenario: First diner joins and activates the table
- **WHEN** a POST arrives for a free table with body `{"name": "Juan", "device_id": "dev-1"}`
- **THEN** a new TableSession SHALL be created with `status='OPEN'` AND a Diner SHALL be created AND the response SHALL include a valid Table Token
- **AND** when `ENABLE_CUSTOMER_TRACKING=true`, a customer SHALL be created or reused for `(device_id='dev-1', tenant_id)` AND linked to the diner

#### Scenario: Second diner joins an already-OPEN session
- **WHEN** the same table already has an OPEN session AND another POST arrives
- **THEN** the existing session SHALL NOT be duplicated AND a new Diner SHALL be appended AND a fresh Table Token SHALL be returned
- **AND** the new diner's `customer_id` SHALL be linked according to its own `device_id`

#### Scenario: Join attempt on a PAYING session returns 409
- **WHEN** a POST arrives for a table whose session has `status='PAYING'`
- **THEN** the system SHALL return 409

#### Scenario: Join with unknown slug/code returns 404
- **WHEN** a POST arrives with a `(slug, code)` pair that does not match any table
- **THEN** the system SHALL return 404 with a uniform error (not disclosing whether slug or code is the miss)

#### Scenario: Feature flag disabled preserves pre-C-19 behavior
- **GIVEN** `ENABLE_CUSTOMER_TRACKING=false`
- **WHEN** a POST arrives with body `{"name": "Juan", "device_id": "dev-1"}`
- **THEN** the diner SHALL be created with `customer_id=NULL`
- **AND** no customer row SHALL be inserted or queried

#### Scenario: Response never exposes customer_id
- **WHEN** the endpoint returns 201 after linking a customer
- **THEN** the response body SHALL NOT contain the key `customer_id`
- **AND** the response body SHALL contain only `table_token`, `session_id`, `diner_id`, `table`
