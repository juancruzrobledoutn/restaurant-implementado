## Why

With table sessions (C-08) and the WebSocket gateway (C-09) in place, the system now has "live" tables and a real-time delivery channel, but no actual orders can flow through it — there is no way for a diner or a waiter to place an order, no kitchen queue, and no first producer for the outbox pattern. C-10 introduces the **round**: the atomic unit of ordering in the restaurant flow. It wires together the diner's cart, the waiter's confirmation, the manager's kitchen dispatch, and the kitchen's preparation status into a single seven-state machine, and it becomes the first real domain that writes to `outbox_event` (ROUND_SUBMITTED, ROUND_READY) and publishes the direct-Redis round events that the ws-gateway already knows how to route. Without C-10, C-11 (kitchen) has nothing to display, C-12 (billing) has nothing to charge, and C-18/C-21 (diner ordering / waiter ops) have no backend to hit.

## What Changes

- **Models** (both `AuditMixin`, soft delete):
  - `Round` (`round` table) with `session_id`, `round_number` (sequential per session), `status` (PENDING/CONFIRMED/SUBMITTED/IN_KITCHEN/READY/SERVED/CANCELED), `submitted_by_id` (nullable FK `app_user`), `confirmed_by_id` (nullable FK `app_user`), `branch_id` (denormalised for scoping), timestamps for every state transition (`pending_at`, `confirmed_at`, `submitted_at`, `in_kitchen_at`, `ready_at`, `served_at`, `canceled_at`).
  - `RoundItem` (`round_item` table) with `round_id`, `product_id`, `quantity`, `notes`, `diner_id` (nullable — the waiter can create items without a specific diner), `price_cents_snapshot` (int — captured at round creation from `BranchProduct.price_cents`), `is_voided` (bool default False), `void_reason` (string nullable), `voided_at` (datetime nullable), `voided_by_id` (nullable FK `app_user`).
- **Domain services**:
  - `RoundService` extending `BranchScopedService[Round, RoundOutput]` — owns the state machine, stock validation, price snapshot, and event publication. All transitions go through this service.
  - `RoundItemService` — helper for the void-item flow (scoped from `RoundService` or collapsed into `RoundService.void_item()`; final shape decided in design).
- **State machine enforced at the service layer** (`PENDING → CONFIRMED → SUBMITTED → IN_KITCHEN → READY → SERVED`, `→ CANCELED` from any non-terminal state). Role gating:
  - `(new) → PENDING`: Diner (via Table Token) OR WAITER (quick-comand path for clients without phones).
  - `PENDING → CONFIRMED`: WAITER, MANAGER, ADMIN.
  - `CONFIRMED → SUBMITTED`: **MANAGER, ADMIN only**. Waiters cannot push to kitchen.
  - `SUBMITTED → IN_KITCHEN`: KITCHEN, MANAGER, ADMIN.
  - `IN_KITCHEN → READY`: KITCHEN, MANAGER, ADMIN.
  - `READY → SERVED`: WAITER, KITCHEN, MANAGER, ADMIN.
  - `→ CANCELED`: MANAGER, ADMIN.
  - Kitchen MUST NOT see PENDING or CONFIRMED rounds — listings filter by `status IN ('SUBMITTED', 'IN_KITCHEN', 'READY')`.
- **Stock validation on `submit` (CONFIRMED → SUBMITTED)**: iterate `round.items` (excluding voided ones), aggregate demand per product, and check against `BranchProduct.stock` (when C-04's stock tracking is enabled) and recipe ingredient availability (C-06's `Recipe.ingredients`). If insufficient, raise `409 Conflict` with a structured payload listing the offending products and missing quantities. No state change happens on insufficient stock.
- **Void-item flow** (`POST /api/waiter/rounds/{id}/void-item`): allowed only in states `SUBMITTED`, `IN_KITCHEN`, `READY`. Sets `is_voided = True`, records `void_reason`, `voided_at`, `voided_by_id`. Does NOT change round status. Emits `ROUND_ITEM_VOIDED` (Direct Redis) so kitchen updates its display.
- **Endpoints**:
  - `POST /api/diner/rounds` — Table-Token-auth. Diner creates a round from their current cart items (pulls `CartItem` rows for the calling diner, snapshots prices, hard-deletes consumed cart items in same transaction). Body: optional `notes`. Returns `RoundOutput`. Rejects if `TableSession.status != OPEN` (409).
  - `POST /api/waiter/sessions/{session_id}/rounds` — JWT WAITER/MANAGER/ADMIN. Quick-command path: waiter sends `{ items: [{product_id, quantity, notes, diner_id?}], notes? }` directly, no cart involvement, round is created in **PENDING** state (waiter can still walk away and come back to confirm, OR the route provides `auto_confirm=true` to create directly in CONFIRMED — design to finalize).
  - `PATCH /api/waiter/rounds/{id}` — JWT WAITER/MANAGER/ADMIN. Body: `{ status: "CONFIRMED" }`. Only PENDING → CONFIRMED.
  - `PATCH /api/admin/rounds/{id}` — JWT MANAGER/ADMIN. Body: `{ status: "SUBMITTED" | "CANCELED" }`. Only CONFIRMED → SUBMITTED or any-state → CANCELED.
  - `PATCH /api/kitchen/rounds/{id}` — JWT KITCHEN/MANAGER/ADMIN. Body: `{ status: "IN_KITCHEN" | "READY" }`. Enforces the SUBMITTED → IN_KITCHEN → READY transitions only.
  - `PATCH /api/waiter/rounds/{id}/serve` — JWT WAITER/KITCHEN/MANAGER/ADMIN. READY → SERVED.
  - `POST /api/waiter/rounds/{id}/void-item` — JWT WAITER/MANAGER/ADMIN. Body: `{ round_item_id: int, void_reason: str }`. States SUBMITTED/IN_KITCHEN/READY only.
  - `GET /api/waiter/rounds?session_id={id}` — JWT WAITER/MANAGER/ADMIN. Lists rounds for a session.
  - `GET /api/kitchen/rounds?branch_id={id}` — JWT KITCHEN/MANAGER/ADMIN. Lists rounds in **SUBMITTED, IN_KITCHEN, READY** only, ordered by `submitted_at`. **Never** returns PENDING or CONFIRMED.
  - `GET /api/diner/rounds` — Table-Token-auth. Lists rounds for the calling diner's current session.
- **WebSocket events** (published from `RoundService` after `safe_commit(db)`):
  - `ROUND_PENDING` — Direct Redis (stub already in `shared/infrastructure/events.py`).
  - `ROUND_CONFIRMED` — Direct Redis.
  - `ROUND_SUBMITTED` — **Outbox** (first real producer of `OutboxEvent`). Written inside the same transaction as the status change.
  - `ROUND_IN_KITCHEN` — Direct Redis.
  - `ROUND_READY` — **Outbox**.
  - `ROUND_SERVED` — Direct Redis.
  - `ROUND_CANCELED` — Direct Redis.
  - `ROUND_ITEM_VOIDED` — Direct Redis (informational, kitchen display update).
- **Outbox plumbing** (first real use): add a thin `OutboxService.write_event(db, event_type, payload)` in `backend/rest_api/services/infrastructure/outbox_service.py` (or `shared/infrastructure/outbox.py`) that inserts an `OutboxEvent` row without committing — the caller (RoundService) owns the commit. Add an `outbox_worker` module that polls pending events and publishes to Redis Streams. The worker ships with this change but is non-essential for unit tests (they assert the row exists in `outbox_event`, not that it was published).
- **Alembic migration 008**: create `round` and `round_item` tables with indexes on `(session_id, is_active)`, `(branch_id, status, submitted_at)`, `(round_id)`, and a partial index on `outbox_event` already covered by C-09's migration 007b (no duplication here). `down_revision = "007_table_sessions"`.
- **Settings / env**:
  - `OUTBOX_WORKER_INTERVAL_SECONDS: int = 2` (how often the worker polls).
  - `OUTBOX_BATCH_SIZE: int = 50`.
  - `OUTBOX_MAX_RETRIES: int = 3` (rows that fail repeatedly get a dead-letter flag for monitoring — initial impl can just log).
- **Tests (pytest, TDD)**:
  - Every valid state transition (7 happy paths) emits the right event and flips the right timestamp.
  - Every invalid transition returns 409 (CONFIRMED → READY, PENDING → SUBMITTED direct, SERVED → anything, etc.).
  - Role gating: WAITER cannot `CONFIRMED → SUBMITTED` (403); KITCHEN cannot create rounds (403); DINER cannot confirm or submit (401/403).
  - Stock validation: round with insufficient stock → 409 with structured body; round with sufficient stock advances to SUBMITTED.
  - Void-item: allowed in SUBMITTED/IN_KITCHEN/READY, forbidden in PENDING/CONFIRMED/SERVED/CANCELED; voided items excluded from total calculations.
  - Cart consumption: `POST /api/diner/rounds` removes the diner's cart items in the same transaction as the round insert (rollback on failure leaves cart untouched).
  - Session state gate: `POST /api/diner/rounds` refuses when session is PAYING or CLOSED.
  - Kitchen visibility: `GET /api/kitchen/rounds` never returns PENDING or CONFIRMED rounds.
  - Multi-tenant isolation: tenant A cannot list/mutate tenant B's rounds (403).
  - Outbox: `SUBMITTED` transition writes a row in `outbox_event` within the same transaction; rollback removes the row atomically.
  - Direct-Redis events: mocked `publish_event` is called with the right payload after commit (and NOT called on rollback).

## Capabilities

### New Capabilities
- `rounds`: The round lifecycle — models (`Round`, `RoundItem` with void fields), `RoundService` state machine, role-gated transitions, stock validation on submit, cart consumption on diner-created rounds, void-item flow, the 10 REST endpoints, and the 8 WebSocket events (5 Direct Redis + 2 Outbox + 1 item-void informational). This spec is the single source of truth for how a pedido moves from diner to served in this system.
- `event-outbox`: The transactional outbox pattern for reliable event publishing. `OutboxEvent` model already exists (introduced in C-09's migration chain for preparation), but C-10 ships the `OutboxService.write_event()` helper, the `outbox_worker` background publisher, and the guarantees (at-least-once, atomic with business data, retry with monitoring). First real producer: `ROUND_SUBMITTED` and `ROUND_READY`. This capability stays generic so C-11 (kitchen) and C-12 (billing) can write to it without modifying this spec.

### Modified Capabilities
- `table-sessions`: Add a single requirement stating that `TableSession.status == OPEN` is a precondition for creating a new `Round` against the session. The gate is enforced in `RoundService.create_from_cart()` and `RoundService.create_from_waiter()`. No change to `TableSessionService` itself — only a documented downstream invariant added to the `table-sessions` spec.

## Impact

- **Backend files created**:
  - `backend/rest_api/models/round.py` — `Round`, `RoundItem` models.
  - `backend/rest_api/schemas/round.py` — Pydantic I/O schemas (`RoundOutput`, `RoundWithItemsOutput`, `RoundItemOutput`, `DinerCreateRoundInput`, `WaiterCreateRoundInput`, `RoundStatusUpdateInput`, `VoidItemInput`, `StockInsufficientError`).
  - `backend/rest_api/services/domain/round_service.py` — `RoundService` (state machine, stock validation, cart consumption, event publication).
  - `backend/rest_api/services/infrastructure/outbox_service.py` — `OutboxService.write_event()` (transactional).
  - `backend/rest_api/services/infrastructure/outbox_worker.py` — background publisher.
  - `backend/rest_api/routers/diner_rounds.py` — diner endpoints (Table Token).
  - `backend/rest_api/routers/waiter_rounds.py` — waiter endpoints (JWT WAITER+).
  - `backend/rest_api/routers/admin_rounds.py` — admin/manager endpoints.
  - `backend/rest_api/routers/kitchen_rounds.py` — kitchen endpoints.
  - `backend/alembic/versions/008_rounds.py` — migration.
  - `backend/tests/test_round_service.py`, `test_round_state_machine.py`, `test_round_stock_validation.py`, `test_round_void_item.py`, `test_diner_rounds_router.py`, `test_waiter_rounds_router.py`, `test_admin_rounds_router.py`, `test_kitchen_rounds_router.py`, `test_outbox_service.py`, `test_outbox_worker.py`.
- **Backend files modified**:
  - `backend/rest_api/models/__init__.py` — register `Round`, `RoundItem`.
  - `backend/rest_api/models/table_session.py` — add `TableSession.rounds` back-populated relationship.
  - `backend/rest_api/models/menu.py` — add `Product.round_items` back-populated relationship (ORM-only).
  - `backend/rest_api/services/domain/__init__.py` — export `RoundService`.
  - `backend/rest_api/main.py` — register the 4 new routers, start the outbox worker in `lifespan`.
  - `backend/shared/config/settings.py` — add the 3 outbox env vars.
  - `backend/tests/conftest.py` — import the new models so SQLite test schema includes them.
- **Infrastructure**: no new services — reuses PostgreSQL, Redis, and the already-deployed `ws_gateway`. The outbox worker runs in-process inside `rest_api` (not a separate container — acceptable for dev and single-instance prod; horizontal scaling requires moving it to its own worker, deferred to operations).
- **API surface**: 10 new REST endpoints (2 create, 5 status transitions, 1 void-item, 2 list), 8 new WebSocket events.
- **Downstream impact**: unblocks C-11 (kitchen — consumes `GET /api/kitchen/rounds` and the `ROUND_*` events to render the preparation queue), C-12 (billing — bills are computed from `RoundItem.price_cents_snapshot` of `SUBMITTED+` rounds with `is_voided=False`), C-18 (pwaMenu-ordering — `POST /api/diner/rounds` is the order-submit endpoint), C-21 (pwaWaiter-ops — confirm/void/submit workflow), and C-16 (dashboard-ops — the live orders table).
- **Governance**: MEDIO — round state and financial snapshot are load-bearing for billing, but the code has no direct money movement. Full RBAC tests + multi-tenant isolation tests required before merge.
