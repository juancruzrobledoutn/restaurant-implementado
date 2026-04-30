## ADDED Requirements

### Requirement: Round model
The system SHALL store rounds with fields: `id` (BigInteger PK), `session_id` (FK to `table_session`, ondelete RESTRICT, not null), `branch_id` (FK to `branch`, ondelete RESTRICT, not null, denormalised for fast branch-scoped queries), `round_number` (Integer, not null, sequential within a session starting at 1), `status` (String 20, one of `PENDING`, `CONFIRMED`, `SUBMITTED`, `IN_KITCHEN`, `READY`, `SERVED`, `CANCELED`, default `PENDING`, server_default `PENDING`), `created_by_role` (String 20, one of `DINER`, `WAITER`, `MANAGER`, `ADMIN`, not null), `created_by_diner_id` (BigInteger, nullable, FK to `diner`), `created_by_user_id` (BigInteger, nullable, FK to `app_user`), `confirmed_by_id` (BigInteger, nullable, FK to `app_user`), `submitted_by_id` (BigInteger, nullable, FK to `app_user`), `canceled_by_id` (BigInteger, nullable, FK to `app_user`), `cancel_reason` (String 500, nullable), `pending_at` (DateTime, not null, server_default `now()`), `confirmed_at` (DateTime, nullable), `submitted_at` (DateTime, nullable), `in_kitchen_at` (DateTime, nullable), `ready_at` (DateTime, nullable), `served_at` (DateTime, nullable), `canceled_at` (DateTime, nullable), plus `AuditMixin` fields. Table name: `round`. Indexes: `(session_id, is_active)`, `(branch_id, status, submitted_at)`, `(session_id, round_number)` unique. Relationships: `session` (N:1 to TableSession), `items` (1:N to RoundItem), `branch` (N:1 to Branch).

#### Scenario: Create a PENDING round
- **WHEN** a Round is inserted with `session_id=42`, `branch_id=1`, `round_number=1`, `created_by_role='DINER'`, `created_by_diner_id=100`
- **THEN** the row SHALL persist with `status='PENDING'`, `is_active=True`, `pending_at=now()`, and all other transition timestamps NULL

#### Scenario: round_number is unique within a session
- **WHEN** two Round rows are inserted with the same `session_id` and the same `round_number`
- **THEN** the database SHALL reject the second insert via the unique index on `(session_id, round_number)`

#### Scenario: round_number is NOT unique across sessions
- **WHEN** session A has round_number=1 AND session B also has round_number=1
- **THEN** both rows SHALL coexist without conflict

#### Scenario: branch_id matches the session's table's branch
- **WHEN** a Round is created referencing `session_id=42` whose table belongs to `branch_id=1`
- **THEN** the round's `branch_id` SHALL equal `1`

---

### Requirement: RoundItem model with void support
The system SHALL store round items with fields: `id` (BigInteger PK), `round_id` (FK to `round`, ondelete RESTRICT, not null), `product_id` (FK to `product`, ondelete RESTRICT, not null), `diner_id` (FK to `diner`, ondelete RESTRICT, nullable — waiter-created items may have no diner), `quantity` (Integer, not null, CHECK `quantity > 0`), `notes` (String 500, nullable), `price_cents_snapshot` (Integer, not null, CHECK `price_cents_snapshot >= 0`), `is_voided` (Boolean, not null, default `False`, server_default `false`), `void_reason` (String 500, nullable), `voided_at` (DateTime, nullable), `voided_by_id` (BigInteger, nullable, FK to `app_user`), plus `AuditMixin` fields. Table name: `round_item`. Indexes: `(round_id)`, `(round_id, is_voided)`. Relationships: `round` (N:1 to Round), `product` (N:1 to Product), `diner` (N:1 to Diner, optional).

#### Scenario: Create a round item with a price snapshot
- **WHEN** a RoundItem is inserted with `round_id=5`, `product_id=10`, `quantity=2`, `price_cents_snapshot=12550`
- **THEN** the row SHALL persist with `is_voided=False`, `void_reason=NULL`

#### Scenario: quantity must be positive
- **WHEN** a RoundItem insert is attempted with `quantity=0`
- **THEN** the database SHALL reject it via `CHECK (quantity > 0)`

#### Scenario: price snapshot cannot be negative
- **WHEN** a RoundItem insert is attempted with `price_cents_snapshot=-1`
- **THEN** the database SHALL reject it via `CHECK (price_cents_snapshot >= 0)`

#### Scenario: Void an item
- **WHEN** a RoundItem is updated with `is_voided=True`, `void_reason='cliente cambió de idea'`, `voided_at=now()`, `voided_by_id=7`
- **THEN** the row SHALL retain its `price_cents_snapshot` and `quantity` unchanged — void is additive, not subtractive

---

### Requirement: Round state machine
The system SHALL enforce the state machine `PENDING → CONFIRMED → SUBMITTED → IN_KITCHEN → READY → SERVED`, with `CANCELED` reachable from any non-terminal state (`PENDING`, `CONFIRMED`, `SUBMITTED`, `IN_KITCHEN`, `READY`). `SERVED` and `CANCELED` are terminal — no further transitions are permitted. All transitions MUST happen inside `RoundService`; routers MUST NOT manipulate `status` directly. Each transition MUST use `safe_commit(db)` and MUST NOT call `db.commit()`. Each transition MUST write the corresponding timestamp field (`confirmed_at`, `submitted_at`, etc.) atomically with the status change.

#### Scenario: PENDING → CONFIRMED
- **WHEN** `RoundService.confirm(round_id, ...)` is called on a PENDING round by a WAITER, MANAGER, or ADMIN
- **THEN** the round's `status` SHALL become `CONFIRMED`, `confirmed_at` SHALL be set to `now()`, and `confirmed_by_id` SHALL be set to the caller's `user_id`

#### Scenario: CONFIRMED → SUBMITTED
- **WHEN** `RoundService.submit(round_id, ...)` is called on a CONFIRMED round by a MANAGER or ADMIN
- **THEN** the round's `status` SHALL become `SUBMITTED`, `submitted_at` SHALL be set to `now()`, and `submitted_by_id` SHALL be set to the caller's `user_id`

#### Scenario: SUBMITTED → IN_KITCHEN
- **WHEN** `RoundService.start_kitchen(round_id, ...)` is called on a SUBMITTED round by a KITCHEN, MANAGER, or ADMIN
- **THEN** the round's `status` SHALL become `IN_KITCHEN` and `in_kitchen_at` SHALL be set to `now()`

#### Scenario: IN_KITCHEN → READY
- **WHEN** `RoundService.mark_ready(round_id, ...)` is called on an IN_KITCHEN round by a KITCHEN, MANAGER, or ADMIN
- **THEN** the round's `status` SHALL become `READY` and `ready_at` SHALL be set to `now()`

#### Scenario: READY → SERVED
- **WHEN** `RoundService.serve(round_id, ...)` is called on a READY round by a WAITER, KITCHEN, MANAGER, or ADMIN
- **THEN** the round's `status` SHALL become `SERVED` and `served_at` SHALL be set to `now()`

#### Scenario: Any non-terminal → CANCELED
- **WHEN** `RoundService.cancel(round_id, ...)` is called on a round in any of `PENDING`, `CONFIRMED`, `SUBMITTED`, `IN_KITCHEN`, `READY` by a MANAGER or ADMIN
- **THEN** the round's `status` SHALL become `CANCELED`, `canceled_at` SHALL be set to `now()`, `canceled_by_id` SHALL be set to the caller's `user_id`, and `is_active` SHALL remain `True` (canceled is a state, not a soft delete)

#### Scenario: Invalid transition returns 409
- **WHEN** `RoundService.submit()` is called on a round with `status='PENDING'`
- **THEN** the service SHALL raise a conflict error (HTTP 409) with a message naming the current and attempted states

#### Scenario: Terminal state is final
- **WHEN** any state-changing method is called on a round with `status='SERVED'` or `status='CANCELED'`
- **THEN** the service SHALL raise a conflict error (HTTP 409)

---

### Requirement: Role gating per transition
Each state transition SHALL check the caller's role against a fixed allow-list. Unauthorized transitions MUST return HTTP 403, never silently succeed or return 404. The allow-list is: `(new)→PENDING` = `DINER|WAITER|MANAGER|ADMIN`; `PENDING→CONFIRMED` = `WAITER|MANAGER|ADMIN`; `CONFIRMED→SUBMITTED` = `MANAGER|ADMIN`; `SUBMITTED→IN_KITCHEN` = `KITCHEN|MANAGER|ADMIN`; `IN_KITCHEN→READY` = `KITCHEN|MANAGER|ADMIN`; `READY→SERVED` = `WAITER|KITCHEN|MANAGER|ADMIN`; `*→CANCELED` = `MANAGER|ADMIN`.

#### Scenario: Waiter cannot submit a round to kitchen
- **WHEN** a user with role `WAITER` calls `PATCH /api/admin/rounds/{id}` with `{"status":"SUBMITTED"}`
- **THEN** the system SHALL return HTTP 403

#### Scenario: Kitchen cannot create a round
- **WHEN** a user with role `KITCHEN` calls `POST /api/waiter/sessions/{id}/rounds`
- **THEN** the system SHALL return HTTP 403 (route is WAITER+)

#### Scenario: Kitchen cannot confirm a round
- **WHEN** a user with role `KITCHEN` calls `PATCH /api/waiter/rounds/{id}` with `{"status":"CONFIRMED"}`
- **THEN** the system SHALL return HTTP 403

#### Scenario: Diner cannot cancel a round
- **WHEN** a diner (Table Token authenticated) calls any cancellation endpoint
- **THEN** the system SHALL return HTTP 401 or 403 (no diner endpoint for cancel exists)

---

### Requirement: Stock validation on submit
`RoundService.submit()` SHALL validate that every non-voided `RoundItem` has enough stock before transitioning to `SUBMITTED`. The check MUST aggregate demand by `product_id` across the round, compare against `BranchProduct.stock` for the round's branch, and also verify recipe ingredient availability (`Recipe.ingredients` → `Ingredient.stock`) when the product has an associated recipe. If any product is short, the service MUST raise a structured `StockInsufficientError` (HTTP 409) and MUST NOT change the round's status. To prevent races, the stock rows MUST be locked with `SELECT ... FOR UPDATE` before the check.

#### Scenario: Sufficient stock allows submission
- **WHEN** `submit()` is called on a CONFIRMED round whose items have sufficient `BranchProduct.stock`
- **THEN** the round SHALL transition to `SUBMITTED`

#### Scenario: Insufficient product stock blocks submission
- **WHEN** `submit()` is called on a round requesting `quantity=3` of product 42 whose `BranchProduct.stock=1`
- **THEN** the service SHALL return HTTP 409 with body `{ "code": "stock_insufficient", "shortages": [{ "product_id": 42, "requested": 3, "available": 1 }] }` AND the round's `status` SHALL remain `CONFIRMED`

#### Scenario: Insufficient ingredient stock blocks submission
- **WHEN** `submit()` is called on a round for a product whose recipe requires 500g of ingredient X AND only 200g of X remain
- **THEN** the service SHALL return HTTP 409 with a `shortages` entry for the ingredient AND the round's `status` SHALL remain `CONFIRMED`

#### Scenario: Voided items are excluded from stock check
- **WHEN** a round has 3 items, one of which has `is_voided=True`
- **THEN** the stock check SHALL aggregate only the 2 non-voided items

#### Scenario: Stock check uses row-level locks
- **WHEN** two `submit()` calls for overlapping products run concurrently
- **THEN** the calls SHALL serialize via `SELECT ... FOR UPDATE` on the `BranchProduct` rows and MUST NOT both succeed with over-committed stock

---

### Requirement: Diner-created rounds consume their cart
`POST /api/diner/rounds` SHALL create a new Round in status `PENDING` from the calling diner's `CartItem` rows, snapshot the `price_cents` from `BranchProduct` (or `Product.base_price_cents` as fallback), and hard-delete the consumed `CartItem` rows in the same database transaction as the Round insert. If the transaction fails at any point, no CartItem SHALL be deleted and no Round SHALL be persisted.

#### Scenario: Submit cart creates round and empties cart
- **WHEN** diner X has 3 CartItem rows AND calls `POST /api/diner/rounds`
- **THEN** a Round SHALL be created with 3 RoundItem rows AND all 3 CartItem rows for diner X SHALL be deleted

#### Scenario: Empty cart returns 400
- **WHEN** diner X has 0 CartItem rows AND calls `POST /api/diner/rounds`
- **THEN** the system SHALL return HTTP 400 with `code='empty_round'` AND no Round SHALL be persisted

#### Scenario: Transaction rollback preserves cart
- **WHEN** the Round INSERT succeeds but the subsequent DELETE of cart items fails (simulated DB error)
- **THEN** the transaction SHALL roll back AND the diner's CartItem rows SHALL still exist AND no Round SHALL exist for this attempt

#### Scenario: Other diners' cart items are untouched
- **WHEN** diner X has 3 CartItem rows AND diner Y on the same session has 2 CartItem rows AND diner X submits
- **THEN** only diner X's CartItem rows SHALL be deleted AND diner Y's 2 CartItem rows SHALL remain

#### Scenario: Price snapshot uses BranchProduct price when available
- **WHEN** `BranchProduct.price_cents=15000` exists for the round's branch + product AND the diner submits
- **THEN** the created RoundItem's `price_cents_snapshot` SHALL equal `15000`

#### Scenario: Price snapshot falls back to Product.base_price_cents
- **WHEN** no `BranchProduct` row exists for the branch + product AND `Product.base_price_cents=12000`
- **THEN** the created RoundItem's `price_cents_snapshot` SHALL equal `12000`

#### Scenario: Unpriced product rejects the round
- **WHEN** neither `BranchProduct.price_cents` nor `Product.base_price_cents` has a value
- **THEN** the system SHALL return HTTP 400 with `code='product_unpriced'` naming the product

---

### Requirement: Session state gate for new rounds
The system SHALL refuse the creation of a new Round (either via the diner endpoint or the waiter endpoint) when the target `TableSession` has `status != 'OPEN'`. Attempts MUST return HTTP 409.

#### Scenario: Cannot create round in PAYING session
- **WHEN** the target TableSession has `status='PAYING'` AND `POST /api/diner/rounds` is called
- **THEN** the system SHALL return HTTP 409

#### Scenario: Cannot create round in CLOSED session
- **WHEN** the target TableSession has `status='CLOSED'` AND `POST /api/waiter/sessions/{id}/rounds` is called
- **THEN** the system SHALL return HTTP 409

#### Scenario: Cannot create round in soft-deleted session
- **WHEN** the target TableSession has `is_active=False`
- **THEN** the system SHALL return HTTP 404 (the session is effectively absent)

---

### Requirement: Waiter quick-command round creation
`POST /api/waiter/sessions/{session_id}/rounds` SHALL allow WAITER, MANAGER, or ADMIN users to create a Round directly by supplying `items: [{ product_id, quantity, notes?, diner_id? }]` in the request body, bypassing the cart. The Round SHALL be created in status `PENDING` with `created_by_role='WAITER'` (or `MANAGER` / `ADMIN`) and `created_by_user_id` set to the caller. The items MUST snapshot prices the same way as diner-submitted rounds.

#### Scenario: Waiter creates a round without a diner_id on items
- **WHEN** a WAITER sends `{ items: [{ product_id: 5, quantity: 2 }] }`
- **THEN** the Round SHALL be created with one RoundItem where `diner_id=NULL`

#### Scenario: Waiter creates a round with explicit diner_id
- **WHEN** a WAITER sends `{ items: [{ product_id: 5, quantity: 2, diner_id: 100 }] }` AND diner 100 belongs to the target session
- **THEN** the RoundItem SHALL have `diner_id=100`

#### Scenario: Invalid diner_id is rejected
- **WHEN** a WAITER sends `{ items: [{ product_id: 5, quantity: 2, diner_id: 999 }] }` AND diner 999 does not belong to the session
- **THEN** the system SHALL return HTTP 400 with `code='diner_not_in_session'`

#### Scenario: Empty items array is rejected
- **WHEN** a WAITER sends `{ items: [] }`
- **THEN** the system SHALL return HTTP 400 with `code='empty_round'`

---

### Requirement: Kitchen visibility is filtered at the service layer
The system SHALL ensure that kitchen-facing list endpoints NEVER return Rounds whose `status` is `PENDING` or `CONFIRMED`. The filter MUST be applied in `RoundService.list_for_kitchen()` — not in the router — so that any new kitchen endpoint automatically inherits the filter.

#### Scenario: Kitchen list excludes PENDING
- **WHEN** a KITCHEN user calls `GET /api/kitchen/rounds?branch_id=1` AND a round in that branch has `status='PENDING'`
- **THEN** the response SHALL NOT include that round

#### Scenario: Kitchen list excludes CONFIRMED
- **WHEN** a KITCHEN user calls `GET /api/kitchen/rounds?branch_id=1` AND a round in that branch has `status='CONFIRMED'`
- **THEN** the response SHALL NOT include that round

#### Scenario: Kitchen list includes SUBMITTED, IN_KITCHEN, READY
- **WHEN** a KITCHEN user calls `GET /api/kitchen/rounds?branch_id=1` AND rounds exist in all three statuses
- **THEN** the response SHALL include all three AND SHALL be ordered by `submitted_at` ascending

#### Scenario: Kitchen list excludes SERVED and CANCELED
- **WHEN** a KITCHEN user calls `GET /api/kitchen/rounds?branch_id=1` AND rounds exist in `status='SERVED'` and `status='CANCELED'`
- **THEN** the response SHALL NOT include those rounds

---

### Requirement: Void-item endpoint
`POST /api/waiter/rounds/{round_id}/void-item` SHALL allow WAITER, MANAGER, or ADMIN users to mark a specific `RoundItem` as voided. The endpoint accepts `{ round_item_id, void_reason }`. It MUST set `is_voided=True`, `void_reason`, `voided_at=now()`, `voided_by_id=caller.user_id`. It MUST NOT change the parent Round's `status`. It MUST emit `ROUND_ITEM_VOIDED` (Direct Redis). The operation is only allowed when the parent Round is in `SUBMITTED`, `IN_KITCHEN`, or `READY`.

#### Scenario: Void an item in SUBMITTED round
- **WHEN** a WAITER voids a RoundItem on a SUBMITTED round with reason "cliente cambió de idea"
- **THEN** the item SHALL have `is_voided=True` AND the Round's `status` SHALL remain `SUBMITTED` AND a `ROUND_ITEM_VOIDED` event SHALL be published

#### Scenario: Cannot void an item in PENDING round
- **WHEN** a WAITER attempts to void an item in a PENDING round
- **THEN** the system SHALL return HTTP 409 (use cart / round edit instead)

#### Scenario: Cannot void an item in CONFIRMED round
- **WHEN** a WAITER attempts to void an item in a CONFIRMED round
- **THEN** the system SHALL return HTTP 409

#### Scenario: Cannot void an item in SERVED round
- **WHEN** a WAITER attempts to void an item in a SERVED round
- **THEN** the system SHALL return HTTP 409

#### Scenario: Cannot void an item in CANCELED round
- **WHEN** a WAITER attempts to void an item in a CANCELED round
- **THEN** the system SHALL return HTTP 409

#### Scenario: Double-void is idempotent
- **WHEN** a RoundItem is already `is_voided=True` AND the endpoint is called again for the same item
- **THEN** the system SHALL return HTTP 409 with `code='already_voided'`

#### Scenario: Void reason is required
- **WHEN** the request body omits `void_reason` or provides an empty string
- **THEN** the system SHALL return HTTP 422 (schema validation)

#### Scenario: round_item_id must belong to the round
- **WHEN** `round_item_id=999` does not belong to `round_id=5`
- **THEN** the system SHALL return HTTP 404

---

### Requirement: Multi-tenant isolation
Every Round and RoundItem query and mutation SHALL be filtered by the caller's `tenant_id`, derived indirectly through `round.branch.tenant_id`. Cross-tenant access MUST return HTTP 403 when attempting to read/mutate an existing round or HTTP 404 when the target does not exist. The service MUST NOT leak tenant boundaries via differential error codes for existing vs. non-existing rounds — but it MAY use 403 for known "wrong tenant" cases caught by the permission layer.

#### Scenario: Tenant A cannot list tenant B's rounds
- **WHEN** user from tenant A calls `GET /api/waiter/rounds?session_id=X` where session X belongs to tenant B
- **THEN** the system SHALL return HTTP 403 or HTTP 404

#### Scenario: Tenant A cannot confirm tenant B's round
- **WHEN** user from tenant A calls `PATCH /api/waiter/rounds/{id}` where the round belongs to tenant B
- **THEN** the system SHALL return HTTP 403 or HTTP 404 AND the round's `status` SHALL remain unchanged

#### Scenario: Tenant A cannot void tenant B's round item
- **WHEN** user from tenant A calls `POST /api/waiter/rounds/{id}/void-item` where the round belongs to tenant B
- **THEN** the system SHALL return HTTP 403 or HTTP 404 AND the item's `is_voided` SHALL remain unchanged

---

### Requirement: WebSocket event publication
Every state transition in `RoundService` SHALL publish exactly one WebSocket event with the corresponding event type. Events MUST be published AFTER `safe_commit(db)` succeeds (for Direct Redis events) or written to `outbox_event` INSIDE the same transaction (for Outbox events). The event type mapping is: `PENDING → ROUND_PENDING` (Direct); `CONFIRMED → ROUND_CONFIRMED` (Direct); `SUBMITTED → ROUND_SUBMITTED` (**Outbox**); `IN_KITCHEN → ROUND_IN_KITCHEN` (Direct); `READY → ROUND_READY` (**Outbox**); `SERVED → ROUND_SERVED` (Direct); `CANCELED → ROUND_CANCELED` (Direct). The void-item operation SHALL emit `ROUND_ITEM_VOIDED` (Direct).

#### Scenario: Successful transition publishes the right event
- **WHEN** `RoundService.confirm()` succeeds on a PENDING round
- **THEN** `publish_event("ROUND_CONFIRMED", payload)` SHALL be called exactly once AFTER commit

#### Scenario: Failed transition publishes nothing
- **WHEN** `RoundService.confirm()` fails with a 409 invalid-state error
- **THEN** no event SHALL be published

#### Scenario: SUBMITTED uses outbox, not direct
- **WHEN** `RoundService.submit()` succeeds
- **THEN** an `OutboxEvent` row with `event_type='ROUND_SUBMITTED'` SHALL exist in the database AFTER commit AND `publish_event` SHALL NOT be called inline for this event

#### Scenario: READY uses outbox, not direct
- **WHEN** `RoundService.mark_ready()` succeeds
- **THEN** an `OutboxEvent` row with `event_type='ROUND_READY'` SHALL exist in the database AFTER commit AND `publish_event` SHALL NOT be called inline for this event

#### Scenario: Event payload carries the minimum routing fields
- **WHEN** any ROUND_* event is published
- **THEN** the payload SHALL include `round_id`, `session_id`, `branch_id`, `tenant_id`, `status`, and `timestamp`

#### Scenario: Rollback removes outbox rows
- **WHEN** `RoundService.submit()` writes the outbox event AND the subsequent commit fails
- **THEN** the `outbox_event` row SHALL NOT exist after rollback (transactional atomicity)

---

### Requirement: REST endpoint catalogue
The system SHALL expose the following endpoints for the round lifecycle:
- `POST /api/diner/rounds` — Table Token auth, creates round from cart.
- `POST /api/waiter/sessions/{session_id}/rounds` — JWT WAITER/MANAGER/ADMIN, creates round from body.
- `GET /api/diner/rounds` — Table Token auth, lists rounds for the caller's session.
- `GET /api/waiter/rounds?session_id={id}` — JWT WAITER/MANAGER/ADMIN, lists rounds for a session.
- `GET /api/kitchen/rounds?branch_id={id}` — JWT KITCHEN/MANAGER/ADMIN, lists SUBMITTED/IN_KITCHEN/READY only.
- `PATCH /api/waiter/rounds/{id}` — JWT WAITER/MANAGER/ADMIN, body `{status:"CONFIRMED"}`.
- `PATCH /api/admin/rounds/{id}` — JWT MANAGER/ADMIN, body `{status:"SUBMITTED"|"CANCELED", cancel_reason?}`.
- `PATCH /api/kitchen/rounds/{id}` — JWT KITCHEN/MANAGER/ADMIN, body `{status:"IN_KITCHEN"|"READY"}`.
- `PATCH /api/waiter/rounds/{id}/serve` — JWT WAITER/KITCHEN/MANAGER/ADMIN, transitions READY → SERVED.
- `POST /api/waiter/rounds/{id}/void-item` — JWT WAITER/MANAGER/ADMIN, body `{round_item_id, void_reason}`.

#### Scenario: All endpoints are registered
- **WHEN** the FastAPI app starts
- **THEN** the 10 endpoints SHALL be discoverable via `GET /openapi.json`

#### Scenario: Unauthenticated requests are rejected
- **WHEN** any of these endpoints is called without auth
- **THEN** the system SHALL return HTTP 401

#### Scenario: Wrong-role requests are rejected
- **WHEN** an endpoint is called by a user whose role is NOT in the endpoint's allow-list
- **THEN** the system SHALL return HTTP 403
