## MODIFIED Requirements

### Requirement: TableSession state machine
The system SHALL enforce the state machine `OPEN → PAYING → CLOSED`. No other transitions are permitted. The `OPEN → PAYING` transition is triggered exclusively by `BillingService.request_check()` (not by routers or `TableSessionService` directly). The `PAYING → CLOSED` transition is triggered exclusively by `BillingService._resolve_check()` when all charges associated with the session's `app_check` are fully covered by allocations. All transitions MUST use `safe_commit(db)` and MUST NOT call `db.commit()`. The `POST /api/waiter/tables/{table_id}/close` endpoint SHALL only close sessions that are already `CLOSED` via billing resolution — it SHALL NOT trigger `PAYING → CLOSED` directly; it SHALL only perform post-close cleanup (table status reset, cart_item hard-delete) for sessions whose check is already PAID.

#### Scenario: Activate transitions (no session) → OPEN
- **WHEN** `TableSessionService.activate(table_id, user_id, user_email)` is called for a table with no active session
- **THEN** a new TableSession SHALL be created with `status='OPEN'` AND the table's `status` SHALL be set to `OCCUPIED`

#### Scenario: BillingService.request_check transitions OPEN → PAYING atomically
- **WHEN** `BillingService.request_check(session_id=42, ...)` is called on a session with `status='OPEN'`
- **THEN** in a single transaction: `session.status` SHALL become `'PAYING'` AND an `app_check` SHALL be created AND charges SHALL be generated AND a `CHECK_REQUESTED` Outbox event SHALL be written

#### Scenario: BillingService resolves PAYING → CLOSED when fully paid
- **WHEN** all `charge` rows for session 42's `app_check` are fully covered by allocations
- **THEN** `BillingService._resolve_check()` SHALL set `check.status='PAID'`, `session.status='CLOSED'`, `session.is_active=False`, and write `CHECK_PAID` Outbox event — all in one transaction

#### Scenario: Cannot request check from CLOSED
- **WHEN** `BillingService.request_check` is called on a session with `status='CLOSED'`
- **THEN** the service SHALL raise a ConflictError (HTTP 409)

#### Scenario: Cannot activate a table with an existing active session
- **WHEN** `activate` is called for a table with an active `OPEN` session
- **THEN** the service SHALL raise a ConflictError (HTTP 409) BEFORE attempting the insert

#### Scenario: Cannot activate a table that is OUT_OF_SERVICE
- **WHEN** `activate` is called for a table with `status='OUT_OF_SERVICE'`
- **THEN** the service SHALL raise a ConflictError (HTTP 409)

#### Scenario: Waiter close endpoint only works post-billing resolution
- **WHEN** `POST /api/waiter/tables/{table_id}/close` is called AND the session is `PAYING` with an unpaid check
- **THEN** the system SHALL return 409 — billing must resolve first

---

### Requirement: Waiter close-table endpoint
The system SHALL provide `POST /api/waiter/tables/{table_id}/close` protected by JWT authentication. WAITER, MANAGER, and ADMIN roles with branch access to the table SHALL be able to invoke it. The endpoint SHALL: (1) look up the active session for the table, (2) verify that the session has `status='CLOSED'` (i.e., billing has already resolved it) OR that it has `status='PAYING'` with a `PAID` check (idempotent cleanup), (3) perform post-close cleanup: hard-delete any remaining `cart_item` rows and reset the table's `status` to `AVAILABLE`. It SHALL NOT trigger `PAYING → CLOSED` — that belongs to `BillingService._resolve_check()`.

#### Scenario: Waiter closes a session after billing resolves it
- **WHEN** the session already has `status='CLOSED'` (set by billing) AND the endpoint is called
- **THEN** the system SHALL return 200 AND the table's `status` SHALL be `AVAILABLE` AND any remaining cart_items SHALL be hard-deleted

#### Scenario: Closing a session still PAYING with unpaid check returns 409
- **WHEN** `POST /api/waiter/tables/{table_id}/close` is called AND `session.status='PAYING'` AND `check.status='REQUESTED'`
- **THEN** the system SHALL return 409 with message indicating payment is pending

#### Scenario: Closing a table with no active session returns 404
- **WHEN** the endpoint is called on a table with no active session
- **THEN** the system SHALL return 404
