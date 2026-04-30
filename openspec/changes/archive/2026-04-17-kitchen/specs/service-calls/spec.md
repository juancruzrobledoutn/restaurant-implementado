## ADDED Requirements

### Requirement: Service call data model

The system SHALL maintain a `service_call` table representing a diner's request to the waiter ("llamar al mozo"). The table SHALL include columns `id`, `tenant_id`, `branch_id`, `session_id` (FK `table_session`), `table_id` (FK `app_table`), `status` (one of `CREATED`, `ACKED`, `CLOSED`), `acked_by_id` (nullable FK `app_user`), `closed_by_id` (nullable FK `app_user`), `acked_at` (nullable datetime), `closed_at` (nullable datetime), plus the `AuditMixin` fields.

The `status` column is constrained to the three valid values via a CHECK constraint. `tenant_id`, `branch_id`, and `table_id` are denormalised from the session chain for scoping and ws-payload performance.

#### Scenario: Table created by migration

- **WHEN** Alembic migration 010_kitchen is applied
- **THEN** the `service_call` table exists with the columns, indexes, FKs, and CHECK constraint described in design.md §Migration Plan

#### Scenario: Invalid status rejected at DB level

- **WHEN** an insert is attempted with `status='DONE'`
- **THEN** the DB raises a CHECK constraint violation

### Requirement: Diner creates a service call

The system SHALL provide `POST /api/diner/service-call` for diners to request the waiter. The endpoint REQUIRES Table-Token auth (not JWT); JWT-authenticated users SHALL be rejected with 403. The endpoint SHALL NOT accept any body parameters — session and table are resolved from the token.

On success, the endpoint SHALL:
- Insert a `service_call` row with `status='CREATED'`, `session_id` / `table_id` / `branch_id` / `tenant_id` from the session chain.
- Write a `SERVICE_CALL_CREATED` event to the outbox in the same transaction.
- Return 201 with the new service call's id.

Duplicate-guard: if the session already has a service call in status `CREATED` or `ACKED` with `is_active=True`, the endpoint SHALL return 409 Conflict with `{"detail": {"existing_service_call_id": <id>}}` and SHALL NOT create a second row.

Rate limit: the endpoint SHALL be rate-limited to 3 requests per minute per `session_id`. Exceeding returns 429.

#### Scenario: First call succeeds

- **WHEN** a diner with Table Token posts to `/api/diner/service-call` and no open call exists for the session
- **THEN** the response is 201 with the new id
- **AND** the `service_call` row exists with `status='CREATED'`, `is_active=True`
- **AND** a row in `outbox_event` exists with `event_type='SERVICE_CALL_CREATED'` and matching payload

#### Scenario: Duplicate while CREATED returns 409 with existing id

- **WHEN** a second diner (or the same diner) on the same session posts to `/api/diner/service-call` while an open call in `CREATED` state already exists
- **THEN** the response is 409 Conflict with `existing_service_call_id` set to the open call's id
- **AND** no new row is created

#### Scenario: Duplicate while ACKED returns 409

- **WHEN** a service call exists in `ACKED` state for the session, and a diner posts another
- **THEN** the response is 409 Conflict

#### Scenario: New call after previous CLOSED succeeds

- **WHEN** the previous call is CLOSED, and a diner posts another
- **THEN** the response is 201 and a new row is created

#### Scenario: JWT user cannot create service call

- **WHEN** a JWT-authenticated user (WAITER, MANAGER, etc.) posts to `/api/diner/service-call`
- **THEN** the response is 403 Forbidden

#### Scenario: Rate limit triggered

- **WHEN** a diner sends 4 posts within 60 seconds (bypassing the duplicate-guard by closing between each)
- **THEN** the 4th response is 429 Too Many Requests

### Requirement: Waiter acknowledges or closes a service call

The system SHALL provide `PATCH /api/waiter/service-calls/{id}` for staff to move a service call through its state machine. The endpoint REQUIRES JWT with role WAITER, MANAGER, or ADMIN, and accepts `{ status: "ACKED" | "CLOSED" }`.

Allowed transitions:
- `CREATED → ACKED` (sets `acked_by_id = user.id`, `acked_at = now()`)
- `CREATED → CLOSED` (sets `closed_by_id = user.id`, `closed_at = now()`)
- `ACKED → CLOSED` (sets `closed_by_id = user.id`, `closed_at = now()`)

Any other transition (e.g. `CLOSED → ACKED`, `ACKED → ACKED`, `ACKED → CREATED`) SHALL return 409 Conflict.

After commit, the endpoint SHALL emit `SERVICE_CALL_ACKED` (on → ACKED) or `SERVICE_CALL_CLOSED` (on → CLOSED) via direct Redis with payload `{service_call_id, session_id, table_id, branch_id, tenant_id, acted_by_user_id}`.

Multi-tenant and branch-scope isolation SHALL apply: a user cannot patch a service call outside their tenant or outside their assigned branches.

#### Scenario: Waiter ACKs an open call

- **WHEN** a WAITER with access to the call's branch PATCHes with `status=ACKED` against a call in CREATED
- **THEN** the call's `status` becomes ACKED, `acked_by_id` is the waiter's id, `acked_at` is set
- **AND** a `SERVICE_CALL_ACKED` direct-Redis event fires after commit

#### Scenario: Waiter CLOSES an ACKED call

- **WHEN** a WAITER PATCHes `status=CLOSED` against a call in ACKED
- **THEN** the call's `status` becomes CLOSED, `closed_by_id` is set, `closed_at` is set
- **AND** a `SERVICE_CALL_CLOSED` direct-Redis event fires after commit

#### Scenario: Cannot re-ACK an already-ACKED call

- **WHEN** a PATCH with `status=ACKED` is sent against a call in ACKED
- **THEN** the response is 409 Conflict, no state change, no event

#### Scenario: Cross-tenant PATCH forbidden

- **WHEN** a WAITER in tenant A tries to PATCH a call that belongs to tenant B
- **THEN** the response is 403 Forbidden or 404 Not Found, no state change

#### Scenario: KITCHEN role rejected

- **WHEN** a KITCHEN user PATCHes a service call
- **THEN** the response is 403 Forbidden

### Requirement: Waiter lists open service calls

The system SHALL provide `GET /api/waiter/service-calls?branch_id={id}&status={CREATED|ACKED|CLOSED}` for staff to list service calls. The endpoint REQUIRES JWT with role WAITER, MANAGER, or ADMIN.

Default behaviour (no `status` query) SHALL return only calls in `CREATED` or `ACKED` (open calls). Explicit `status=CLOSED` SHALL be accepted for historical listing.

Results SHALL be filtered by `tenant_id` and — for non-ADMIN users — by the caller's assigned `branch_ids`. Soft-deleted calls (`is_active=False`) SHALL be excluded.

#### Scenario: Default listing returns CREATED and ACKED

- **WHEN** a WAITER calls `GET /api/waiter/service-calls?branch_id=1` with no status filter
- **THEN** the response contains all CREATED and ACKED calls for branch 1, no CLOSED calls

#### Scenario: CLOSED filter returns only closed calls

- **WHEN** `GET /api/waiter/service-calls?branch_id=1&status=CLOSED` is called
- **THEN** the response contains only calls with `status='CLOSED'`

#### Scenario: Branch scope enforced for non-admin

- **WHEN** a WAITER with `branch_ids=[1]` calls `GET /api/waiter/service-calls?branch_id=2`
- **THEN** the response is 403 Forbidden

### Requirement: Service call events

The system SHALL emit WebSocket events for each service call transition:

| Event | Delivery | When |
|-------|----------|------|
| `SERVICE_CALL_CREATED` | **Outbox** | After diner POST is committed |
| `SERVICE_CALL_ACKED` | Direct Redis | After waiter PATCH → ACKED is committed |
| `SERVICE_CALL_CLOSED` | Direct Redis | After waiter PATCH → CLOSED is committed |

The `SERVICE_CALL_CREATED` event uses the outbox for at-least-once delivery because losing it would leave staff unaware of a diner in need.

#### Scenario: Creation writes an outbox row atomically with the service call

- **WHEN** `POST /api/diner/service-call` succeeds
- **THEN** the DB transaction that inserted the `service_call` row also inserted one `outbox_event` row with `event_type='SERVICE_CALL_CREATED'`

#### Scenario: Ack emits direct Redis event

- **WHEN** a waiter ACKs a call
- **THEN** after commit, `publish_event` is called with `event_type='SERVICE_CALL_ACKED'` and the expected payload

#### Scenario: Close emits direct Redis event

- **WHEN** a waiter CLOSES a call
- **THEN** after commit, `publish_event` is called with `event_type='SERVICE_CALL_CLOSED'` and the expected payload
