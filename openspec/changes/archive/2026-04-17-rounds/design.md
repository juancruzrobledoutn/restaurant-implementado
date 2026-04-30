## Context

After C-08 (`table-sessions`) and C-09 (`ws-gateway-base`), the platform has live sessions, diners, a shared cart, and a working WebSocket gateway with authentication, routing, catch-up, and a ready-to-fire `OutboxEvent` model. What it does NOT have is a way to turn any of this into an actual order. No pedido ever reaches the kitchen, the diner's cart is a dead-end, and the ws-gateway has nothing real to route — `event_type_to_category` is intentionally empty in C-09. C-10 is the change that turns the platform from "live but silent" into "live and ordering".

Constraints inherited from the project:

- **Clean Architecture**: thin FastAPI routers, `BranchScopedService` subclasses, `PermissionContext` for staff auth, `current_table_context` for diner auth.
- **Multi-tenant**: every query filters by `tenant_id` (indirect — through `session.branch.tenant_id` chain).
- **SQLAlchemy booleans**: always `.is_(True)` / `.is_(False)`.
- **Commits**: always `safe_commit(db)` — NEVER `db.commit()`.
- **Soft delete** on `Round` and `RoundItem` (both carry `AuditMixin`). Canceled rounds remain with `is_active=True, status="CANCELED"` (soft delete only happens when archived by retention, not when canceled — canceled is a state, not a deletion).
- **Prices in integer cents** — `price_cents_snapshot` is `Integer`, never `Numeric`.
- **SQL reserved words**: `round` is not reserved in PostgreSQL 16, so the table name stays `round` (no `app_round` prefix needed — verified against `information_schema.sql_reserved_words`).
- **ws-gateway is already deployed** and consumes events from Redis. C-10 only needs to PUBLISH. Routing, authentication, catch-up, and DLQ are all out of scope.

Governance: **MEDIO**. No money moves in C-10, but the `price_cents_snapshot` captured here is what C-12 bills, and `ROUND_SUBMITTED` is the first event to trigger kitchen work — correctness matters. Full RBAC + multi-tenant test coverage is required before merge.

Stakeholders:
- **Diners** (pwaMenu, C-18) — submit rounds from their cart.
- **Waiters** (pwaWaiter, C-21) — create quick-command rounds, confirm diner rounds, mark served, void items.
- **Managers / Admins** (Dashboard, C-16) — push rounds to kitchen, cancel rounds.
- **Kitchen** (pwaKitchen, C-11) — move rounds through IN_KITCHEN → READY.
- **ws-gateway** (C-09) — consumer of the 8 new event types.
- **Billing** (C-12) — reads `RoundItem.price_cents_snapshot` of rounds in `SUBMITTED+` with `is_voided=False`.

## Goals / Non-Goals

**Goals:**
- Implement `Round` and `RoundItem` models with the full 7-state machine and item void fields.
- Implement `RoundService` that owns every state transition, with role gates enforced at the service layer (not router).
- Ship the transactional outbox infrastructure (`OutboxService.write_event`, `outbox_worker`) — first real producer in the project.
- Publish the 8 WebSocket events with the correct pattern (Direct Redis for the 5 informational, Outbox for the 2 critical: `ROUND_SUBMITTED` and `ROUND_READY`, plus the `ROUND_ITEM_VOIDED` info event on void).
- Ship the 10 REST endpoints across 4 routers (`diner_rounds`, `waiter_rounds`, `admin_rounds`, `kitchen_rounds`) with strict RBAC.
- Validate stock on `CONFIRMED → SUBMITTED` transition (querying aggregated demand vs. `BranchProduct.stock` + recipe-level ingredient availability). Return 409 with a structured payload on insufficient stock.
- Hard-delete `CartItem` rows consumed by `POST /api/diner/rounds` in the same transaction as the round insert (idempotent on failure).
- Guarantee that kitchen listings NEVER return PENDING or CONFIRMED rounds — enforced in the repository layer, not the router.
- Provide Alembic migration 008 that chains on top of `007_table_sessions` and has a working `downgrade()`.
- Full pytest coverage: every valid transition, every invalid transition, every role gate, every invariant, the stock validation path (both happy and sad), the cart-consumption rollback, and the outbox atomicity.

**Non-Goals:**
- **Kitchen UI / `KitchenTicket` lifecycle** (C-11). C-10 produces `ROUND_SUBMITTED` which C-11 will consume to create `KitchenTicket` rows; we do NOT touch `KitchenTicket` here.
- **Billing / price totals** (C-12). C-10 snapshots `price_cents_snapshot` per item; computing a session total, applying promotions, or tying rounds to a `Check` is C-12.
- **Promotions applied at round time**. The proposal talks about `price_cents_snapshot` from `BranchProduct.price_cents`. Any promotion logic (percent discount, BOGO, etc.) arrives in a later change — C-10 does the raw price capture.
- **Ingredient stock decrement on submit**. C-10 READS `BranchProduct.stock` and `Recipe.ingredients` to validate; it does NOT decrement. Stock decrement belongs with the inventory module (not yet planned).
- **Dashboard UI, pwaMenu UI, pwaWaiter UI, pwaKitchen UI**. C-10 is backend-only. The 4 frontends will consume these endpoints in their respective changes (C-16, C-18, C-21, C-11).
- **Outbox as a separate service**. The worker runs in-process inside `rest_api` (single-instance assumption). Horizontal scaling requires extracting it; out of scope.
- **Rate limiting on `POST /api/diner/rounds`**. Relies on the global middleware already shipped in C-09 — no per-endpoint override here.
- **Event catch-up wiring for `ROUND_*`**. The ws-gateway already has `/ws/catchup` — once these events hit Redis they land in the catch-up sorted set automatically. No work here.
- **Round archiving / retention policy**. Rounds stay in the DB forever in C-10; retention is a later operational concern.

## Decisions

### D-01: `RoundService` owns the state machine, with a single `transition(from, to, role)` validator

**Decision**: Implement a single internal method `_assert_transition_allowed(current_status, new_status, actor_role)` that the public methods (`confirm`, `submit`, `start_kitchen`, `mark_ready`, `serve`, `cancel`) delegate to. The validator consults a lookup table `_VALID_TRANSITIONS: dict[tuple[str, str], set[str]]` keyed by `(from_status, to_status)` with value = set of roles allowed.

**Alternatives considered**:
- A `transitions` library (pytransitions or similar): adds a dependency for ~40 lines of logic we already own. Rejected.
- One public method per transition with inline role checks: duplicates the "raise 409 / raise 403" logic across 7 methods. Rejected.
- A single `update_status(new_status)` endpoint that inspects current state: harder to test role gates (routing depends on role + state). Rejected — we keep 4 role-scoped routers and a small fan-out per router.

**Rationale**: The 7 transitions are well-defined by business rules (see `knowledge-base/01-negocio/04_reglas_de_negocio.md §2`). A declarative table makes the mapping auditable at a glance and test coverage trivial (`pytest.mark.parametrize` over the table). Role gating is uniform: one helper, one failure mode (`PermissionError → 403`).

### D-02: Two creation paths share one private `_create_round(...)` helper

**Decision**: `POST /api/diner/rounds` and `POST /api/waiter/sessions/{id}/rounds` both end up in `RoundService._create_round(session_id, items, created_by_role, ...)`. The diner path first resolves the caller's `CartItem` rows into `items`, hard-deletes them, and calls `_create_round(initial_status="PENDING")`. The waiter path receives `items` directly from the request body and calls `_create_round(initial_status="PENDING")` (NO `auto_confirm` flag — waiter always creates in PENDING and issues a second `PATCH` to confirm, keeping the state machine linear).

**Alternatives considered**:
- `auto_confirm=true` flag on the waiter endpoint: reduces HTTP round-trips by one, but splits the CONFIRMED transition across two entry points (creation AND transition), doubling test surface. Rejected — kept linear for now, revisit if latency is a real user complaint.
- Separate `DinerRoundService` and `WaiterRoundService`: unjustified duplication — the state machine is identical, only the input plumbing differs.

**Rationale**: Both paths share 90% of the logic (round-number assignment, branch-denormalisation, price snapshot, validation that session is `OPEN`, timestamp writes, event publication). The remaining 10% is cart-consumption vs. direct-items, which lives in the thin router function, not the service.

### D-03: Price snapshot happens on **round creation**, not on submit

**Decision**: `RoundItem.price_cents_snapshot` is populated in `_create_round(...)` from `BranchProduct.price_cents` (joined via `product_id + branch_id`). If no `BranchProduct` row exists for the pair, fall back to `Product.base_price_cents` (the global default). If BOTH are missing, raise `ValidationError("product_unpriced")`.

**Alternatives considered**:
- Snapshot on `SUBMITTED` transition: would let the diner see an outdated price in their "pending" round view when the menu price changes between creation and submit. Rejected — the diner chose to order at the price they saw.
- No snapshot, compute live in billing: defeats the whole purpose of a snapshot and opens a race condition window (price change mid-evening).

**Rationale**: The price the diner confirmed when pressing "submit order" is the price they pay. Any later menu change is irrelevant to this round. This matches the invariant documented in `knowledge-base/01-negocio/04_reglas_de_negocio.md §353` (`backendCents` is captured at the moment of round creation).

### D-04: Stock validation on `CONFIRMED → SUBMITTED`, NOT on creation

**Decision**: `RoundService.submit(round_id, ...)` is the ONLY method that consults stock. The diner-side creation flow intentionally does NOT check stock — it's OK for a diner to submit a round that later cannot be fulfilled; the waiter/manager will see the 409 when trying to push to kitchen and can decide what to do (call the diner back, offer alternatives, cancel the round). The check iterates `round.items.where(RoundItem.is_voided.is_(False))`, aggregates by `product_id`, and compares against `BranchProduct.stock` AND the recipe ingredients' `Ingredient.stock`. On insufficient, raise `StockInsufficientError` with body:
```json
{ "code": "stock_insufficient",
  "shortages": [{ "product_id": 42, "requested": 3, "available": 1 }] }
```

**Alternatives considered**:
- Validate on `(new) → PENDING`: blocks the diner at submit time, forcing them to pick different items before staff involvement. Fairer UX, but real restaurants prefer the human-in-the-loop approach — the waiter will often "check the fridge" rather than trust stale stock numbers. Business rule: staff decides.
- Validate on every transition: wasteful and causes false negatives (stock could recover between IN_KITCHEN and READY).

**Rationale**: Matches the business rule explicitly — "Validación de stock antes de submit (409 si insuficiente)" in the change scope. The waiter sees the 409 and resolves it with the customer.

### D-05: `ROUND_SUBMITTED` and `ROUND_READY` are the ONLY outbox events; the rest go Direct Redis

**Decision**: `RoundService.submit(...)` and `RoundService.mark_ready(...)` call `OutboxService.write_event(db, event_type, payload)` INSIDE the same transaction as the status flip. All other transitions (`confirm`, `start_kitchen`, `serve`, `cancel`, `void_item`, `create`) publish via `shared/infrastructure/events.publish_event(...)` AFTER `safe_commit(db)` — fire-and-forget, best-effort.

**Alternatives considered**:
- All events through outbox: simplifies the mental model but doubles infra latency for events that don't need the guarantee (CART_* / ROUND_CONFIRMED deliberately chose Direct Redis for latency — see `02_eventos.md §Clasificación`).
- All events direct: fine for informational events, unacceptable for `ROUND_SUBMITTED` (kitchen must not miss an order) and `ROUND_READY` (diner/waiter must not miss a plate).

**Rationale**: Pattern alignment with `knowledge-base/02-arquitectura/04_eventos_y_websocket.md §Clasificación` — identical rule applied verbatim.

### D-06: `OutboxService.write_event` does NOT commit; caller owns the transaction

**Decision**: `OutboxService.write_event(db, event_type, payload) -> OutboxEvent` inserts a row via `db.add(OutboxEvent(...))` and returns without flushing/committing. RoundService is responsible for the final `safe_commit(db)` that persists the status change AND the outbox row atomically.

**Alternatives considered**:
- `write_event` commits internally: breaks the outbox contract — the whole point is that the business state change and the event row commit together.

**Rationale**: This is THE defining property of the outbox pattern. Documenting it in the service's docstring + enforcing it via a test that asserts "rollback removes both the state change AND the outbox row" locks the invariant.

### D-07: Outbox worker runs in-process in `rest_api/main.py` `lifespan`

**Decision**: `backend/rest_api/services/infrastructure/outbox_worker.py` exposes `start_worker(app)` and `stop_worker(app)`. `lifespan` calls `await start_worker(app)` on startup and `await stop_worker(app)` on shutdown. The worker is a single `asyncio.Task` that loops: query pending events (`WHERE processed_at IS NULL`, limit `OUTBOX_BATCH_SIZE`), publish each to Redis via `publish_event()`, mark `processed_at = now()`, sleep `OUTBOX_WORKER_INTERVAL_SECONDS`.

**Alternatives considered**:
- Separate worker container: cleaner separation, but requires docker-compose changes, a new Dockerfile, and health-check plumbing — premature for a single-instance deployment. Deferred to operations.
- Celery / RQ / Arq: full task-queue infra for a loop that polls a single table. Rejected.

**Rationale**: Matches "the worker ships with this change but is non-essential for unit tests" from the proposal. The worker is thin enough (~80 LOC) to live inline. Migration to a separate container is a later ops decision, not a code change.

### D-08: Soft-delete semantics for rounds — "CANCELED" is a state, "archived" is soft delete

**Decision**: A canceled round keeps `is_active=True, status="CANCELED"`. Soft-delete (`is_active=False, deleted_at, deleted_by_id`) is reserved for administrative cleanup / retention. The canceled state is a first-class terminal state in the machine; the UX still needs to show canceled rounds in the session's history, so they MUST remain in active queries (filtered by status where appropriate).

**Alternatives considered**:
- `CANCELED` sets `is_active=False`: breaks the session history view — canceled rounds would vanish from `GET /api/diner/rounds` unless every query added `OR status='CANCELED'`. Rejected.

**Rationale**: Consistency with `TableSession` in C-08 (where `CLOSED` is a state AND the session is soft-deleted in the same operation) would be surface-level only — here, there is no cleanup analog to "hard-delete cart items", so the patterns differ by necessity.

### D-09: `round_number` is sequential per session, assigned server-side inside the transaction

**Decision**: `_create_round(...)` does `SELECT MAX(round_number) FROM round WHERE session_id = :sid FOR UPDATE` against the parent session row (already locked), then inserts `round_number = max + 1`. The `SELECT FOR UPDATE` is on `table_session`, not `round` — the lock is at the session level, which already serializes diner/waiter activity for a table.

**Alternatives considered**:
- PostgreSQL sequence per session: requires a DDL-level sequence per session row (impossible without dynamic SQL).
- UUID for `round_number`: breaks the UX contract ("ronda #1", "ronda #2", etc.).
- Client-supplied `round_number`: trusts the client with a server-assigned invariant. Rejected.

**Rationale**: `session_id FOR UPDATE` is already the locking point used by `TableSessionService` for state transitions (C-08 D-02). Reusing the same lock means no new deadlock vectors; it just extends the critical section by one more `INSERT`.

### D-10: Kitchen listings are enforced at the repository level, not the router

**Decision**: `RoundService.list_for_kitchen(branch_id)` — the only method the kitchen router calls — has a hardcoded filter `Round.status.in_(("SUBMITTED", "IN_KITCHEN", "READY"))`. The router does not construct the query; it just calls the method. This way the "kitchen never sees PENDING/CONFIRMED" invariant is enforced in one place and cannot be bypassed by a router change.

**Alternatives considered**:
- Enforce in the router: easy to forget when someone adds a new endpoint. Rejected.

**Rationale**: Security rules that sit in the service layer are hard to forget. A future developer adding a kitchen endpoint calls the service and gets the filter for free.

### D-11: Void-item uses a sub-route, not a full transition

**Decision**: `POST /api/waiter/rounds/{id}/void-item` with body `{ round_item_id, void_reason }`. The endpoint mutates a SINGLE `RoundItem` (sets `is_voided=True`, `void_reason`, `voided_at`, `voided_by_id`), does NOT change `Round.status`, and emits `ROUND_ITEM_VOIDED` (Direct Redis) with the round + item IDs so kitchen can strike through the line. Allowed states: `SUBMITTED`, `IN_KITCHEN`, `READY`. Forbidden in PENDING/CONFIRMED (just edit the cart / round before submitting) and SERVED/CANCELED (terminal).

**Alternatives considered**:
- Full `Round` PATCH with an `items[].is_voided` array: allows atomic multi-item voids but complicates the state machine (does voiding every item auto-cancel the round?). Rejected — one item at a time, explicit audit trail per void.
- A dedicated `void_reason` enum: premature abstraction. A free-text `void_reason` with a 500-char limit is enough for the compliance audit; the enum can arrive in C-12 if billing needs it.

**Rationale**: Voiding is a book-keeping operation, not a state transition. Decoupling it from the round-level state machine keeps the main flow linear.

### D-12: All WebSocket events publish via an injected publisher (tests pass a mock)

**Decision**: `RoundService.__init__` takes a `publisher: Callable[[str, dict], Awaitable[None]] | None = None`. If `None`, it falls back to `shared.infrastructure.events.publish_event`. Tests inject a `MagicMock` and assert calls. Production code gets the default. This keeps the service testable without Redis.

**Alternatives considered**:
- Patch `publish_event` globally in tests: hides the dependency. Rejected.

**Rationale**: Matches how `TableSessionService` handles its (currently stubbed) event emissions. Consistent DI pattern across the service layer.

## Risks / Trade-offs

- **[Stock validation race]** Two waiters submit two rounds for the same product within microseconds. Each sees `stock=1 available`; both pass validation; kitchen receives orders for 2 units when only 1 exists. **Mitigation**: `SELECT ... FOR UPDATE` on `BranchProduct` rows during the stock check — serializes concurrent submits of overlapping products. Documented in the `submit` method's docstring.
- **[Outbox worker single-instance]** The worker polls in-process; running two `rest_api` instances would double-publish every event. **Mitigation**: For now, document "run one instance of rest_api". When horizontal scaling arrives, add a `PostgreSQL advisory lock` on the worker loop (one process wins the lock, others idle). Follow-up ticket tracked in `knowledge-base/06-estado-del-proyecto/07_backlog_pendiente.md`.
- **[Outbox worker crash between publish and mark-processed]** An event is published to Redis, the worker crashes, the event is re-delivered to ws-gateway on next poll. **Mitigation**: Accept at-least-once — ws-gateway already de-duplicates via event `id` in its catch-up sorted set. This is the entire point of the outbox + Redis Streams contract.
- **[Price snapshot vs. menu change mid-meal]** If a manager changes `BranchProduct.price_cents` between diner create and diner submit (if quick_command path), the snapshot was already taken at round-creation time, so billing is safe. Risk is ZERO for C-10's scope.
- **[Kitchen can PATCH a round into IN_KITCHEN → READY without ever seeing SUBMITTED → IN_KITCHEN]** Race where the kitchen staff has an open UI with a stale round status. **Mitigation**: The state machine's `(from, to)` check catches it — `IN_KITCHEN → READY` from a round in `SUBMITTED` fails with 409, forcing the client to reload. ws-gateway broadcasts `ROUND_IN_KITCHEN` so the kitchen UI refreshes automatically.
- **[Void-item abuse as silent cancel]** A waiter voids all items of a round instead of canceling it → same effective result, different audit trail. **Mitigation**: Out of scope for code. Operational policy: if every item is voided, the dashboard view flags it. Add a metric to `knowledge-base/06-estado-del-proyecto/07_backlog_pendiente.md` for a later "suspicious void pattern" detector.
- **[`POST /api/diner/rounds` with empty cart]** Caller has no CartItem rows but still POSTs. **Mitigation**: Service raises `ValidationError("empty_round")` → 400. Covered by test.
- **[`round_number` gap after cancel]** Round #3 is canceled; the next round is still #4 (gaps are fine — canceled rounds remain in the session and keep their number). **Mitigation**: Documented — not a bug, matches the invoicing convention.

## Migration Plan

1. **Pre-deploy checks**:
   - Verify `openspec list --json` shows `ws-gateway-base` as `complete` and archived.
   - Verify `alembic current` shows `007_table_sessions` as the latest head.
   - Verify `backend/rest_api/models/outbox.py` exists (it does — shipped with C-09 prep).

2. **Migrate**:
   - `cd backend && alembic upgrade head` applies `008_rounds`. Creates `round`, `round_item`, and the indexes.
   - Smoke-test: `alembic downgrade -1 && alembic upgrade head` must round-trip cleanly.

3. **Deploy**:
   - Roll out `rest_api` containers with the new routers and the outbox worker.
   - On first startup, `lifespan.startup` launches `start_worker(app)` — verify the worker logs "outbox_worker started" in container output.
   - Watch `outbox_event.processed_at` field: rows written by `ROUND_SUBMITTED` paths should hit `processed_at != NULL` within `OUTBOX_WORKER_INTERVAL_SECONDS * 2`.

4. **Rollback**:
   - `alembic downgrade 007_table_sessions` drops `round` and `round_item` (cascade via `ondelete=RESTRICT` requires pre-deletion — the downgrade first `DELETE FROM round_item; DELETE FROM round` before `DROP TABLE`).
   - `outbox_event` rows for `ROUND_*` types remain — they're idempotent and harmless (ws-gateway will just receive historical events the next time it polls).
   - Revert rest_api to the previous container tag. Outbox worker stops cleanly on `SIGTERM` (drains current batch).

5. **Feature flag**: None. C-10 is a greenfield module — there's no toggle, only presence or absence.

## Open Questions

- **Q-01**: Should `POST /api/waiter/sessions/{session_id}/rounds` accept an `auto_confirm=true` query param to skip the `PATCH /api/waiter/rounds/{id}` round-trip? Current decision (D-02) says no, keep linear. Revisit if user testing shows latency complaints.
- **Q-02**: Does `RoundItem.diner_id` need a unique constraint with `round_id` (one line per diner per product per round), or do we accept duplicates (e.g., "2× Coca" as one line vs. "1× Coca + 1× Coca")? Current plan: duplicates are allowed — the UX decides whether to merge on the frontend. Server stores what it's given.
- **Q-03**: When a `BranchProduct.price_cents` is `NULL` AND `Product.base_price_cents` is `NULL`, we raise `ValidationError("product_unpriced")`. Should this happen at C-04 model level via `NOT NULL`? If so, this `if` branch becomes dead code. TODO: check C-04 migrations for column nullability before finalising the check in `_create_round`. Fallback: keep the defensive check with a log warning.
- **Q-04**: Does the kitchen endpoint need a `sector_id` filter for multi-kitchen branches (e.g., grill vs. bar)? Current spec says no — `KITCHEN` role sees everything in the branch. If a restaurant has 2 kitchens, they'll both see all rounds, and the sorting by `submitted_at` handles the throughput. Revisit in C-11 if the UX requires per-station filtering.
