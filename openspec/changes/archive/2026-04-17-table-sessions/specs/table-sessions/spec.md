## ADDED Requirements

### Requirement: TableSession model
The system SHALL store table sessions with fields: `id` (BigInteger PK), `table_id` (FK to `app_table`, ondelete RESTRICT), `branch_id` (FK to `branch`, ondelete RESTRICT, denormalised for fast branch-scoped queries), `status` (String 20, one of `OPEN`, `PAYING`, `CLOSED`, default `OPEN`), plus `AuditMixin` fields (`is_active`, `created_at`, `updated_at`, `deleted_at`, `deleted_by_id`, `deleted_by_email`). Table name: `table_session`. Indexes on `table_id`, `branch_id`, and `(table_id, is_active)`. A partial unique index `uq_table_session_active_per_table` on `(table_id) WHERE is_active AND status IN ('OPEN', 'PAYING')` SHALL enforce that a table has at most one non-closed session at a time.

#### Scenario: Create an OPEN session for a free table
- **WHEN** a TableSession is created with `table_id=10`, `branch_id=1`
- **THEN** the row SHALL be persisted with `status='OPEN'`, `is_active=True`, and audit timestamps set

#### Scenario: Session carries branch_id denormalised from table
- **WHEN** a TableSession is created referencing `table_id=10` whose `branch_id=1`
- **THEN** the session's `branch_id` SHALL equal `1` and MUST NOT diverge from the table's branch

#### Scenario: A table can only have one active session at a time
- **WHEN** a TableSession with `table_id=10`, `status='OPEN'`, `is_active=True` exists
- **AND** another session with `table_id=10`, `status='OPEN'` is inserted
- **THEN** the database SHALL reject the second insert via the partial unique index

#### Scenario: A closed session does not block new activation
- **WHEN** a TableSession with `table_id=10`, `status='CLOSED'`, `is_active=False` exists
- **AND** a new TableSession with `table_id=10`, `status='OPEN'` is inserted
- **THEN** the database SHALL accept the new session successfully

---

### Requirement: Diner model
The system SHALL store diners with fields: `id` (BigInteger PK), `session_id` (FK to `table_session`, ondelete RESTRICT), `name` (String 255, not null), `device_id` (String 128, nullable), `customer_id` (BigInteger, nullable — forward-looking FK that C-19 will activate), plus `AuditMixin` fields. Table name: `diner`. Index on `session_id`. Relationships: `session` (N:1 to TableSession).

#### Scenario: Register a diner in an OPEN session
- **WHEN** a Diner is created with `session_id=42`, `name='Juan'`, `device_id='dev-abc123'`
- **THEN** the row SHALL be persisted with `is_active=True`

#### Scenario: A diner with no device_id is valid
- **WHEN** a Diner is created with `session_id=42`, `name='Mozo walk-in'`, `device_id=NULL`
- **THEN** the row SHALL be persisted — `device_id` is optional (waiter-entered diners do not have devices)

---

### Requirement: CartItem model (ephemeral)
The system SHALL store cart items with fields: `id` (BigInteger PK), `session_id` (FK to `table_session`, ondelete RESTRICT), `diner_id` (FK to `diner`, ondelete RESTRICT), `product_id` (FK to `product`, ondelete RESTRICT), `quantity` (Integer, not null, CHECK `quantity > 0`), `notes` (String 500, nullable), `created_at` (DateTime, not null, server default `now()`), `updated_at` (DateTime, not null, server default `now()`, on-update `now()`). Table name: `cart_item`. **CartItem SHALL NOT inherit AuditMixin** — it is an ephemeral record that is hard-deleted when its session closes. Indexes on `session_id` and `(session_id, diner_id)`.

#### Scenario: Create a cart item under an OPEN session
- **WHEN** a CartItem is created with `session_id=42`, `diner_id=100`, `product_id=5`, `quantity=2`, `notes='sin cebolla'`
- **THEN** the row SHALL be persisted with `created_at` and `updated_at` set

#### Scenario: CartItem has no is_active column
- **WHEN** the `cart_item` table is introspected
- **THEN** it SHALL NOT contain `is_active`, `deleted_at`, `deleted_by_id`, or `deleted_by_email` columns

#### Scenario: quantity must be positive
- **WHEN** a CartItem insert is attempted with `quantity=0` or `quantity=-1`
- **THEN** the database SHALL reject it via the `CHECK (quantity > 0)` constraint

---

### Requirement: TableSession state machine
The system SHALL enforce the state machine `OPEN → PAYING → CLOSED`. No other transitions are permitted. All transitions MUST happen inside `TableSessionService`; routers MUST NOT manipulate `status` directly. Each transition MUST use `safe_commit(db)` and MUST NOT call `db.commit()`.

#### Scenario: Activate transitions (no session) → OPEN
- **WHEN** `TableSessionService.activate(table_id, user_id, user_email)` is called for a table with no active session
- **THEN** a new TableSession SHALL be created with `status='OPEN'` AND the table's `status` SHALL be set to `OCCUPIED`

#### Scenario: Request-check transitions OPEN → PAYING
- **WHEN** `TableSessionService.request_check(session_id, ...)` is called on a session with `status='OPEN'`
- **THEN** the session's `status` SHALL become `PAYING`

#### Scenario: Close transitions PAYING → CLOSED
- **WHEN** `TableSessionService.close(session_id, ...)` is called on a session with `status='PAYING'`
- **THEN** the session SHALL be soft-deleted (`is_active=False`, `status='CLOSED'`) AND its cart_items SHALL be hard-deleted AND the table's `status` SHALL return to `AVAILABLE`

#### Scenario: Cannot request check from CLOSED
- **WHEN** `request_check` is called on a session with `status='CLOSED'`
- **THEN** the service SHALL raise a conflict error (HTTP 409)

#### Scenario: Cannot close a session still in OPEN
- **WHEN** `close` is called on a session with `status='OPEN'`
- **THEN** the service SHALL raise a conflict error (HTTP 409) — check must be requested first

#### Scenario: Cannot activate a table with an existing active session
- **WHEN** `activate` is called for a table with an active `OPEN` session
- **THEN** the service SHALL raise a conflict error (HTTP 409) BEFORE attempting the insert

#### Scenario: Cannot activate a table that is OUT_OF_SERVICE
- **WHEN** `activate` is called for a table with `status='OUT_OF_SERVICE'`
- **THEN** the service SHALL raise a conflict error (HTTP 409)

---

### Requirement: Only OPEN sessions accept new diners and cart items
The system SHALL reject registration of new diners or insertion of cart items into any session whose `status` is not `OPEN`. Attempts MUST return HTTP 409 with an explanatory message.

#### Scenario: Diner cannot join a PAYING session
- **WHEN** a join request is made for a session with `status='PAYING'`
- **THEN** the system SHALL return 409 with a message indicating the table is already in billing

#### Scenario: Diner cannot join a CLOSED session
- **WHEN** a join request is made for a session with `status='CLOSED'`
- **THEN** the system SHALL return 409 with a message indicating the table is closed

#### Scenario: Cart item cannot be added after request-check
- **WHEN** a cart item creation is attempted on a session with `status='PAYING'`
- **THEN** the service SHALL raise a conflict error (HTTP 409)

---

### Requirement: Close hard-deletes cart items atomically
When `TableSessionService.close()` succeeds, all `cart_item` rows belonging to that session SHALL be hard-deleted in the same database transaction as the session soft-delete. If the transaction fails, neither the cart deletion nor the session change SHALL persist.

#### Scenario: Close empties cart_item
- **WHEN** a session has 5 `cart_item` rows AND `close()` is called
- **THEN** after `safe_commit()`, `SELECT COUNT(*) FROM cart_item WHERE session_id = :sid` SHALL return 0

#### Scenario: Close failure rolls back cart deletion
- **WHEN** `close()` encounters a database error after deleting cart_items but before committing
- **THEN** the cart_items SHALL still exist after rollback (all-or-nothing semantics)

---

### Requirement: Table Token HMAC generation and verification
The system SHALL provide a module `shared/security/table_token.py` that generates and verifies HMAC-SHA256 Table Tokens. Tokens SHALL be stateless JSON envelopes: `base64url(payload).base64url(signature)` where `signature = HMAC-SHA256(TABLE_TOKEN_SECRET, base64url(payload))`. Payload fields: `session_id`, `table_id`, `diner_id`, `branch_id`, `tenant_id`, `iat` (epoch seconds), `exp` (epoch seconds = `iat + TABLE_TOKEN_TTL_SECONDS`, default `TABLE_TOKEN_TTL_SECONDS=10800` i.e. 3 hours). The secret MUST be read from the `TABLE_TOKEN_SECRET` environment variable. Production startup MUST fail if the secret is unset or shorter than 32 characters.

#### Scenario: Generate token and verify round-trip
- **WHEN** `issue_table_token(session_id=42, table_id=10, diner_id=100, branch_id=1, tenant_id=1)` is called
- **AND** the resulting token is passed to `verify_table_token(token)`
- **THEN** verification SHALL succeed and return a payload dict with the same five IDs plus `iat` and `exp`

#### Scenario: Tampered payload fails verification
- **WHEN** a token is generated AND an attacker flips any bit in the payload portion
- **THEN** `verify_table_token(tampered_token)` SHALL raise an authentication error

#### Scenario: Expired token fails verification
- **WHEN** a token with `exp` in the past is presented
- **THEN** `verify_table_token(token)` SHALL raise an authentication error with code `expired_token`

#### Scenario: Startup fails on missing secret
- **WHEN** the application starts with `TABLE_TOKEN_SECRET` unset or length < 32
- **THEN** the application SHALL refuse to start and log a clear error

---

### Requirement: current_table_context dependency
The system SHALL provide a FastAPI dependency `current_table_context` that extracts the `X-Table-Token` header, verifies the HMAC, loads the referenced `TableSession` (joining `Table` and `Branch`), and returns a `TableContext` object exposing `session`, `table`, `branch`, `diner_id`, `tenant_id`, and `branch_id`. The dependency MUST reject the request with HTTP 401 if the header is missing, the signature fails, the token is expired, or the session no longer exists / is soft-deleted / is `CLOSED`.

#### Scenario: Valid token returns a TableContext
- **WHEN** a request arrives with a valid `X-Table-Token` header for an OPEN session
- **THEN** the dependency SHALL return a `TableContext` whose `session.status == 'OPEN'`

#### Scenario: Missing X-Table-Token returns 401
- **WHEN** a request targets a diner endpoint WITHOUT the `X-Table-Token` header
- **THEN** the system SHALL return 401

#### Scenario: Token referencing a CLOSED session returns 401
- **WHEN** a valid HMAC token is presented AND the referenced session has `status='CLOSED'` or `is_active=False`
- **THEN** the system SHALL return 401 (effective revocation-on-close)

#### Scenario: Token for a different tenant is rejected
- **WHEN** a token is forged with a valid signature but references a session belonging to tenant B, and the staff caller is from tenant A
- **THEN** the dependency MUST NOT leak cross-tenant session data — it SHALL resolve the session via its own `tenant_id` claim only

---

### Requirement: Waiter activate-table endpoint
The system SHALL provide `POST /api/waiter/tables/{table_id}/activate` protected by JWT authentication. WAITER, MANAGER, and ADMIN roles with branch access to the table SHALL be able to invoke it. The endpoint SHALL call `TableSessionService.activate()` and return 201 with the created session.

#### Scenario: Waiter activates a free table
- **WHEN** a WAITER assigned to the table's sector sends `POST /api/waiter/tables/10/activate`
- **THEN** the system SHALL return 201 with the session payload and `status='OPEN'`

#### Scenario: KITCHEN cannot activate tables
- **WHEN** a KITCHEN user sends `POST /api/waiter/tables/10/activate`
- **THEN** the system SHALL return 403

#### Scenario: Waiter without branch access cannot activate
- **WHEN** a WAITER whose `branch_ids` do not include the table's branch sends the request
- **THEN** the system SHALL return 403

#### Scenario: Activating an already-occupied table returns 409
- **WHEN** a valid caller sends `POST /api/waiter/tables/10/activate` for a table already in an OPEN session
- **THEN** the system SHALL return 409

---

### Requirement: Waiter request-check endpoint
The system SHALL provide `PATCH /api/waiter/sessions/{session_id}/request-check` protected by JWT authentication. WAITER, MANAGER, and ADMIN roles with branch access SHALL be able to invoke it. The endpoint SHALL call `TableSessionService.request_check()` and return 200 with the updated session.

#### Scenario: Waiter requests the check for an OPEN session
- **WHEN** the endpoint is called on a session with `status='OPEN'`
- **THEN** the system SHALL return 200 with `status='PAYING'`

#### Scenario: Requesting check on PAYING is idempotent-like (409)
- **WHEN** the endpoint is called on a session with `status='PAYING'`
- **THEN** the system SHALL return 409 (no second check request)

---

### Requirement: Waiter close-table endpoint
The system SHALL provide `POST /api/waiter/tables/{table_id}/close` protected by JWT authentication. WAITER, MANAGER, and ADMIN roles with branch access SHALL be able to invoke it. The endpoint SHALL look up the active session for the table, call `TableSessionService.close()`, and return 200.

#### Scenario: Waiter closes a PAYING session
- **WHEN** the endpoint is called on a table whose active session has `status='PAYING'`
- **THEN** the system SHALL return 200 AND the session SHALL be soft-deleted with `status='CLOSED'` AND all its cart_items SHALL be hard-deleted AND the table's status SHALL return to `AVAILABLE`

#### Scenario: Closing a table with no active session returns 404
- **WHEN** the endpoint is called on a table with no active session
- **THEN** the system SHALL return 404

#### Scenario: Closing a session still in OPEN returns 409
- **WHEN** the endpoint is called on a session with `status='OPEN'` (check not yet requested)
- **THEN** the system SHALL return 409

---

### Requirement: Staff get-session-by-table-id endpoint
The system SHALL provide `GET /api/tables/{table_id}/session` protected by JWT authentication. Any staff user with branch access to the table SHALL be able to invoke it. The endpoint SHALL return 200 with the active session (or 404 if none).

#### Scenario: Staff reads the active session by numeric ID
- **WHEN** an authenticated staff user sends `GET /api/tables/10/session`
- **THEN** the system SHALL return 200 with the active TableSession including its diners

#### Scenario: Staff without branch access gets 403
- **WHEN** a staff user without access to the table's branch sends the request
- **THEN** the system SHALL return 403

#### Scenario: Table with no active session returns 404
- **WHEN** the request targets a table that has never been activated or whose sessions are all closed
- **THEN** the system SHALL return 404

---

### Requirement: Staff get-session-by-table-code endpoint
The system SHALL provide `GET /api/tables/code/{code}/session?branch_slug={slug}` protected by JWT authentication. The `branch_slug` query parameter is REQUIRED. The endpoint SHALL resolve `(branch.slug, code) → table.id` before loading the session.

#### Scenario: Staff reads session by code with branch slug
- **WHEN** an authenticated staff user sends `GET /api/tables/code/INT-01/session?branch_slug=downtown`
- **THEN** the system SHALL return 200 with the session for table `INT-01` in branch `downtown`

#### Scenario: Missing branch_slug returns 400
- **WHEN** the request omits the `branch_slug` query parameter
- **THEN** the system SHALL return 400

#### Scenario: Same code in two branches is disambiguated by slug
- **WHEN** branches `downtown` and `airport` both have a table with `code='INT-01'`
- **AND** a staff user requests `GET /api/tables/code/INT-01/session?branch_slug=airport`
- **THEN** the system SHALL return the airport table's session only

---

### Requirement: Public join-table endpoint
The system SHALL provide `POST /api/public/tables/code/{code}/join?branch_slug={slug}` with NO authentication. Body: `{"name": "<diner name>", "device_id": "<optional>"}`. The endpoint SHALL (a) activate the session if none is active on the table, (b) create a `Diner` row, (c) return 201 with `{ "table_token": "<hmac>", "session_id": "<id>", "diner_id": "<id>", "table": {...} }`. The endpoint MUST NOT leak the existence of a `(slug, code)` pair — a non-existent pair returns 404 uniformly.

#### Scenario: First diner joins and activates the table
- **WHEN** a POST arrives for a free table with body `{"name": "Juan", "device_id": "dev-1"}`
- **THEN** a new TableSession SHALL be created with `status='OPEN'` AND a Diner SHALL be created AND the response SHALL include a valid Table Token

#### Scenario: Second diner joins an already-OPEN session
- **WHEN** the same table already has an OPEN session AND another POST arrives
- **THEN** the existing session SHALL NOT be duplicated AND a new Diner SHALL be appended AND a fresh Table Token SHALL be returned

#### Scenario: Join attempt on a PAYING session returns 409
- **WHEN** a POST arrives for a table whose session has `status='PAYING'`
- **THEN** the system SHALL return 409

#### Scenario: Join with unknown slug/code returns 404
- **WHEN** a POST arrives with a `(slug, code)` pair that does not match any table
- **THEN** the system SHALL return 404 with a uniform error (not disclosing whether slug or code is the miss)

---

### Requirement: Diner get-session endpoint
The system SHALL provide `GET /api/diner/session` authenticated by the `X-Table-Token` header via `current_table_context`. The endpoint SHALL return the diner's current session view: `{ session, table, branch (minimal), diners, my_cart_items }`. It MUST NOT expose cart items of other diners (those are shared via the future WebSocket in C-18) and MUST NOT expose internal financial fields.

#### Scenario: Authenticated diner reads own session
- **WHEN** a request arrives with a valid `X-Table-Token` for an OPEN session
- **THEN** the system SHALL return 200 with the session view limited to this diner's cart items

#### Scenario: Diner without token gets 401
- **WHEN** a request arrives without `X-Table-Token`
- **THEN** the system SHALL return 401

#### Scenario: Diner token for a closed session gets 401
- **WHEN** a request arrives with a token whose session has since been closed
- **THEN** the system SHALL return 401

---

### Requirement: Multi-tenant isolation for table sessions
Every `TableSession`, `Diner`, and `CartItem` query SHALL filter by `tenant_id` through the `branch → tenant` chain. A user or diner from tenant A MUST NOT be able to see, modify, or close sessions belonging to tenant B under any circumstance.

#### Scenario: Tenant A staff cannot activate tenant B table
- **WHEN** a user whose `tenant_id=1` sends `POST /api/waiter/tables/99/activate` where table 99 belongs to tenant 2
- **THEN** the system SHALL return 403

#### Scenario: Tenant A staff cannot read tenant B session
- **WHEN** a user whose `tenant_id=1` sends `GET /api/tables/99/session` where table 99 belongs to tenant 2
- **THEN** the system SHALL return 403 or 404 (never 200 with data)

#### Scenario: Forged Table Token with foreign tenant_id
- **WHEN** an attacker presents a validly-signed Table Token whose payload claims `tenant_id=2` but the session actually belongs to tenant 1
- **THEN** the dependency SHALL return 401 (the token's signature binds payload integrity, so this scenario implies a leaked secret — the test covers the signature check explicitly)

---

### Requirement: Alembic migration 007 for table sessions
The system SHALL include Alembic migration `007_table_sessions` that creates tables `table_session`, `diner`, and `cart_item`. `down_revision` SHALL be `"006_allergens"`. `upgrade()` SHALL create tables in dependency order (session → diner → cart_item), all FKs `ondelete=RESTRICT`, all indexes declared in the model, and the partial unique index `uq_table_session_active_per_table`. `downgrade()` SHALL drop tables in reverse order and drop the partial index first.

#### Scenario: Migration applies cleanly on top of 006
- **WHEN** `alembic upgrade head` is run on a DB at revision `006_allergens`
- **THEN** tables `table_session`, `diner`, `cart_item` SHALL exist with all specified columns, FKs, indexes, and constraints

#### Scenario: Partial unique index is created
- **WHEN** the migration runs
- **THEN** a partial unique index named `uq_table_session_active_per_table` SHALL exist on `table_session (table_id) WHERE is_active AND status IN ('OPEN', 'PAYING')`

#### Scenario: Downgrade reverses cleanly
- **WHEN** `alembic downgrade 006_allergens` is run
- **THEN** tables `cart_item`, `diner`, `table_session` SHALL be dropped (in that order) along with the partial unique index
