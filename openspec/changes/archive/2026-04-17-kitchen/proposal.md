## Why

C-10 (rounds) delivers the round state machine and makes `SUBMITTED+` rounds available to the kitchen via `GET /api/kitchen/rounds`, but it intentionally stops there — a round is a business entity, not a work unit. The kitchen needs a **ticket**: a first-class, per-round, trackable artefact that the kitchen brigade owns, marks as in-progress, and flags as ready without mutating the round itself. Without it, every kitchen UI must compute ticket-like state on the fly, two kitchens can't share a single round that mixes a hot dish and a cold starter, and there is no place to hang per-ticket fields the brigade will eventually need (priority flag, kitchen station, preparation notes). C-11 also closes two smaller gaps that are load-bearing for GATE 9: a lightweight **waiter menu endpoint** (no images, no allergens, no nesting beyond subcategory) for the quick-command flow, and **service calls** — the diner's "llamar al mozo" button — which are the second real producer of outbox events (after rounds). Together, these three capabilities make the kitchen display functional, the waiter quick-command practical, and the dining-room call flow complete.

## What Changes

- **Models** (both use `AuditMixin`, soft delete):
  - `KitchenTicket` (`kitchen_ticket` table) with `tenant_id` (denormalised for scoping), `branch_id` (denormalised), `round_id` (FK `round`, unique — one ticket per round), `status` (`IN_PROGRESS`/`READY`/`DELIVERED` — NOTE: the "created" state from the knowledge-base spec collapses to `IN_PROGRESS` at creation, because the ticket only exists once the kitchen has *seen* the round; we keep the DB column permissive for future states), `started_at` (nullable — set when the kitchen moves the round SUBMITTED→IN_KITCHEN), `ready_at` (nullable — set on READY), `delivered_at` (nullable — set on SERVED), `priority` (bool default False — reserved for future "urgente" flag, not exposed in endpoints yet).
  - `KitchenTicketItem` (`kitchen_ticket_item` table) with `ticket_id` (FK `kitchen_ticket`), `round_item_id` (FK `round_item`, unique per ticket — one ticket item per non-voided round item), `is_prepared` (bool default False — reserved for future per-item tracking, not exposed yet), `prepared_at` (nullable).
  - `ServiceCall` (`service_call` table) with `tenant_id`, `branch_id`, `session_id` (FK `table_session`), `table_id` (FK `app_table`, denormalised for the ws event payload), `status` (`CREATED`/`ACKED`/`CLOSED`), `acked_by_id` (nullable FK `app_user`), `closed_by_id` (nullable FK `app_user`), `created_at` (inherited from AuditMixin), `acked_at` (nullable), `closed_at` (nullable).
- **Domain services**:
  - `TicketService` extending `BranchScopedService[KitchenTicket, KitchenTicketOutput]` — owns the creation-on-submit, the IN_PROGRESS/READY/DELIVERED transitions, and the kitchen listing with status filter.
  - `ServiceCallService` extending `BranchScopedService[ServiceCall, ServiceCallOutput]` — owns the CREATED/ACKED/CLOSED machine and writes `SERVICE_CALL_CREATED` to the outbox.
  - `WaiterMenuService` — stateless helper reading `Category`/`Subcategory`/`Product`/`BranchProduct` and returning the compact menu (no images, no allergens, no branch info). Read-only; does not touch `MenuCacheService` (the waiter menu has its own key so admin invalidations still apply).
- **Ticket lifecycle hooked into `RoundService`**:
  - `RoundService.submit_round()` (CONFIRMED → SUBMITTED) MUST create the `KitchenTicket` row in the same transaction, with `status='IN_PROGRESS'` and one `KitchenTicketItem` per non-voided `RoundItem`. The existing `ROUND_SUBMITTED` outbox event gains a `ticket_id` field in its payload.
  - `RoundService.start_kitchen()` (SUBMITTED → IN_KITCHEN) now also flips the ticket's `started_at` timestamp (the ticket stays in `IN_PROGRESS`).
  - `RoundService.mark_ready()` (IN_KITCHEN → READY) transitions the ticket to `READY` and sets `ready_at`.
  - `RoundService.serve_round()` (READY → SERVED) transitions the ticket to `DELIVERED` and sets `delivered_at`.
  - `RoundService.cancel_round()` (→ CANCELED): when a round is canceled after SUBMITTED, its ticket is soft-deleted (`is_active=False`) — not transitioned, because a canceled round has no kitchen state.
- **Endpoints**:
  - `GET /api/kitchen/tickets?branch_id={id}&status={IN_PROGRESS|READY|DELIVERED}` — JWT KITCHEN/MANAGER/ADMIN. Lists active tickets for the branch with optional status filter. NEVER returns tickets whose round is PENDING or CONFIRMED (impossible by construction — tickets are only created on SUBMITTED — but asserted in tests). Includes nested items and minimal round/session/table info so the kitchen UI doesn't need a second round.
  - `PATCH /api/kitchen/tickets/{ticket_id}` — JWT KITCHEN/MANAGER/ADMIN. Body: `{ status: "READY" | "DELIVERED" }`. Moves the ticket between states. **SIDE EFFECT**: this endpoint cascades to the parent round — `READY` also flips the round IN_KITCHEN→READY, and `DELIVERED` flips it READY→SERVED. We expose the cascade via `TicketService.set_status()` so the kitchen can drive from either `/api/kitchen/rounds` or `/api/kitchen/tickets` without the frontend juggling two URLs.
  - `GET /api/waiter/branches/{branch_id}/menu` — JWT WAITER/MANAGER/ADMIN. Compact menu optimised for the waiter quick-command flow. Response shape: `{ categories: [{ id, name, order, subcategories: [{ id, name, order, products: [{ id, name, price_cents, is_available }] }] }] }`. No images, no allergens, no branch metadata — smaller payload than the public menu, intended for fast list rendering on older tablets. Filters: `Category.is_active`, `Subcategory.is_active`, `Product.is_active`, `BranchProduct.is_active`, and `BranchProduct.is_available`. Does NOT filter by whether the product has stock — stock is a submit-time concern, not a menu-time concern.
  - `POST /api/diner/service-call` — Table-Token auth. Body: `{ table_token: implicit }` (no body fields needed — session and table are resolved from the token). Creates a `ServiceCall` row in `CREATED` state and writes `SERVICE_CALL_CREATED` to the outbox. Rate-limited to 3/minute per session to prevent spam. If the session has a `ServiceCall` in `CREATED` or `ACKED` state, returns 409 with the existing call's id instead of creating a duplicate.
  - `PATCH /api/waiter/service-calls/{call_id}` — JWT WAITER/MANAGER/ADMIN. Body: `{ status: "ACKED" | "CLOSED" }`. `ACKED` (CREATED → ACKED, sets `acked_by_id`/`acked_at`) emits `SERVICE_CALL_ACKED` (direct Redis). `CLOSED` (CREATED or ACKED → CLOSED, sets `closed_by_id`/`closed_at`) emits `SERVICE_CALL_CLOSED` (direct Redis).
  - `GET /api/waiter/service-calls?branch_id={id}&status={CREATED|ACKED}` — JWT WAITER/MANAGER/ADMIN. Lists open service calls (default status filter is `CREATED,ACKED` — closed calls excluded unless explicitly requested).
- **WebSocket events** (all published from services after `safe_commit(db)`):
  - `TICKET_CREATED` — Direct Redis — emitted after `RoundService.submit_round` commits. Payload: `{ ticket_id, round_id, branch_id, tenant_id }`. (The existing `ROUND_SUBMITTED` outbox event continues to fire; this new `TICKET_CREATED` event is for kitchen-display components that subscribe to tickets, not rounds.)
  - `TICKET_IN_PROGRESS` — Direct Redis — fires when the kitchen starts a ticket (currently equivalent to `ROUND_IN_KITCHEN`, but targets ticket subscribers).
  - `TICKET_READY` — **Outbox** — fires when a ticket goes READY. Mirrors `ROUND_READY` but scoped to ticket listeners (dashboards, pwaWaiter service-call UI).
  - `TICKET_DELIVERED` — Direct Redis — fires on DELIVERED (parent round becomes SERVED).
  - `SERVICE_CALL_CREATED` — **Outbox** (load-bearing for reliability — the diner's call MUST reach the waiter even if Redis hiccups). Payload: `{ service_call_id, session_id, table_id, branch_id, tenant_id }`.
  - `SERVICE_CALL_ACKED` — Direct Redis.
  - `SERVICE_CALL_CLOSED` — Direct Redis.
- **Rate limiting**: `POST /api/diner/service-call` gets a 3/minute-per-session limit via the existing `SlowAPI` limiter setup (the session id comes from the table token, not the IP — two diners on the same tablet share the limit, which matches real-world use). Other kitchen endpoints retain the standard 60/min JWT default.
- **Role gating**:
  - Only KITCHEN, MANAGER, ADMIN can `GET /api/kitchen/tickets` or `PATCH` a ticket.
  - Only WAITER, MANAGER, ADMIN can `PATCH /api/waiter/service-calls/{id}`.
  - Only Table-Token (diner) auth can `POST /api/diner/service-call` — JWT users cannot create service calls.
- **Kitchen alerts (client-side)**: the decision log in design.md records that Web Audio API beep + visual flash on `TICKET_CREATED` / `ROUND_SUBMITTED` is a **frontend** concern and lives in Dashboard/pwaWaiter. Backend only guarantees the event delivery — no backend code ships for "beep/flash".
- **Alembic migration 010**: create `kitchen_ticket`, `kitchen_ticket_item`, `service_call` with appropriate indexes: `(branch_id, status)` on ticket, `(ticket_id)` on ticket_item, `(session_id, status)` and `(branch_id, status)` on service_call, unique `(round_id)` on ticket (one-ticket-per-round invariant enforced at DB level). `down_revision = "009_rounds"`.
- **Tests (pytest, TDD)**:
  - Ticket auto-creation: a `submit_round` call produces exactly one `KitchenTicket` (status=IN_PROGRESS) with one `KitchenTicketItem` per non-voided `RoundItem`. Voided items after submit do NOT get a ticket item retroactively (voids are a round-item concern).
  - Ticket visibility: `GET /api/kitchen/tickets` excludes tickets whose `is_active=False` (canceled rounds); excludes tickets across branches the user isn't assigned to.
  - Ticket transition: `PATCH .../tickets/{id}` with status=READY flips both ticket and round; status=DELIVERED flips both ticket and round; invalid transitions (IN_PROGRESS→DELIVERED direct) return 409.
  - Cancellation cascade: a `RoundService.cancel_round()` on a SUBMITTED round soft-deletes its ticket (is_active=False); a cancel on a PENDING/CONFIRMED round has no ticket to touch and does not error.
  - Service call happy path: `POST /api/diner/service-call` creates a row, writes an outbox event, returns 201; mock publisher sees the event after worker poll.
  - Service call duplicate guard: a second `POST /api/diner/service-call` while one is `CREATED` returns 409 with existing id.
  - Service call rate limit: 4th call within 60s returns 429.
  - Service call ack/close: waiter ACK sets `acked_by_id`/`acked_at`; waiter close from any open state sets `closed_at`.
  - Service call closed excluded: `GET /api/waiter/service-calls` without explicit status filter never returns CLOSED calls.
  - Waiter menu: response contains all active/available products with prices, no images, no allergens; unauthenticated call returns 401; diner token returns 403.
  - Multi-tenant isolation: tenant A cannot ACK tenant B's service call (403); tenant A cannot see tenant B's tickets.
  - Role gating: WAITER cannot `PATCH /api/kitchen/tickets/{id}` (403); KITCHEN cannot `PATCH /api/waiter/service-calls/{id}` (403).

## Capabilities

### New Capabilities
- `kitchen-tickets`: The per-round ticket lifecycle — `KitchenTicket` and `KitchenTicketItem` models, `TicketService` state machine (IN_PROGRESS → READY → DELIVERED), the auto-creation hook in `RoundService.submit_round`, the cancellation soft-delete cascade, the 2 REST endpoints (list + patch), and the 4 WebSocket events (`TICKET_CREATED`, `TICKET_IN_PROGRESS`, `TICKET_READY` outbox, `TICKET_DELIVERED`). This spec is the single source of truth for how a kitchen-side work unit is modelled and moved in this system.
- `service-calls`: The diner's "llamar al mozo" feature end-to-end — `ServiceCall` model, `ServiceCallService` CREATED/ACKED/CLOSED machine, the 3 REST endpoints (diner create, waiter patch, waiter list), duplicate-guard semantics, per-session rate limiting, and the 3 WebSocket events (`SERVICE_CALL_CREATED` outbox, `SERVICE_CALL_ACKED` direct, `SERVICE_CALL_CLOSED` direct). Second real producer of the transactional outbox.
- `waiter-menu`: The compact menu endpoint `GET /api/waiter/branches/{id}/menu` for the waiter quick-command flow — no images, no allergens, JWT-protected, honours branch scoping. Different capability from `menu-catalog` because the contract is different (payload shape, filters, auth) and it has its own caching concerns.

### Modified Capabilities
- `rounds`: Extend the `RoundService` contract to document the ticket-creation side effect on `submit_round` and the ticket-transition side effects on `start_kitchen`, `mark_ready`, `serve_round`, and `cancel_round`. The `ROUND_SUBMITTED` outbox payload gains a `ticket_id` field. No change to round state machine itself.
- `event-outbox`: Add `SERVICE_CALL_CREATED` and `TICKET_READY` to the documented list of at-least-once event types producing to the outbox. No change to outbox infrastructure.

## Impact

- **Backend files created**:
  - `backend/rest_api/models/kitchen_ticket.py` — `KitchenTicket`, `KitchenTicketItem` models.
  - `backend/rest_api/models/service_call.py` — `ServiceCall` model.
  - `backend/rest_api/schemas/kitchen_ticket.py` — Pydantic I/O schemas (`KitchenTicketOutput`, `KitchenTicketItemOutput`, `KitchenTicketStatusUpdateInput`, `WaiterMenuResponse`, nested types).
  - `backend/rest_api/schemas/service_call.py` — `ServiceCallOutput`, `ServiceCallStatusUpdateInput`.
  - `backend/rest_api/services/domain/ticket_service.py` — `TicketService`.
  - `backend/rest_api/services/domain/service_call_service.py` — `ServiceCallService`.
  - `backend/rest_api/services/domain/waiter_menu_service.py` — `WaiterMenuService`.
  - `backend/rest_api/routers/kitchen_tickets.py` — `/api/kitchen/tickets` endpoints.
  - `backend/rest_api/routers/waiter_service_calls.py` — `/api/waiter/service-calls` endpoints.
  - `backend/rest_api/routers/diner_service_call.py` — `/api/diner/service-call` endpoint.
  - `backend/rest_api/routers/waiter_menu.py` — `/api/waiter/branches/{id}/menu` endpoint.
  - `backend/alembic/versions/010_kitchen.py` — migration.
  - `backend/tests/test_ticket_service.py` — unit tests for `TicketService` (auto-creation, transitions, cancellation cascade).
  - `backend/tests/test_kitchen_tickets_router.py` — integration tests for `/api/kitchen/tickets`.
  - `backend/tests/test_service_call_service.py` — unit tests for `ServiceCallService`.
  - `backend/tests/test_diner_service_call_router.py` — integration tests for POST, including rate-limit + duplicate guard.
  - `backend/tests/test_waiter_service_calls_router.py` — integration tests for PATCH + GET.
  - `backend/tests/test_waiter_menu_router.py` — integration tests for the compact menu.
- **Backend files modified**:
  - `backend/rest_api/models/__init__.py` — register `KitchenTicket`, `KitchenTicketItem`, `ServiceCall`.
  - `backend/rest_api/models/round.py` — add `Round.ticket` back-populated relationship (uselist=False).
  - `backend/rest_api/models/table_session.py` — add `TableSession.service_calls` back-populated relationship.
  - `backend/rest_api/services/domain/round_service.py` — call `TicketService.create_from_round()` in `submit_round`; update `start_kitchen`, `mark_ready`, `serve_round`, `cancel_round` to propagate ticket status; expand the `ROUND_SUBMITTED` payload to include `ticket_id`.
  - `backend/rest_api/services/domain/__init__.py` — export `TicketService`, `ServiceCallService`, `WaiterMenuService`.
  - `backend/rest_api/main.py` — register the 4 new routers.
  - `backend/shared/config/constants.py` — add `KitchenTicketStatus` StrEnum (`IN_PROGRESS`, `READY`, `DELIVERED`) and `ServiceCallStatus` StrEnum (`CREATED`, `ACKED`, `CLOSED`).
  - `backend/tests/conftest.py` — import the three new models so the SQLite test schema includes them; add a `SlowAPI` test fixture that disables rate limiting for non-rate-limit tests and enables it per-test where needed (pattern already used in C-09 for ws-gateway).
- **Infrastructure**: no new services. The existing outbox worker (C-10) publishes the new `TICKET_READY` and `SERVICE_CALL_CREATED` events transparently — no worker changes.
- **API surface**: 5 new REST endpoints (GET/PATCH tickets, POST diner service call, PATCH+GET waiter service calls, GET waiter menu). 7 new WebSocket events (4 ticket + 3 service call).
- **Downstream impact**: unblocks C-12 (billing — consumes `RoundItem.price_cents_snapshot` from SUBMITTED+ rounds, which now always have a ticket; charges are built per-round, not per-ticket, so tickets stay a kitchen-only concept), C-16 (dashboard-ops — the kitchen board page subscribes to `TICKET_*` events), C-21 (pwaWaiter-ops — the service-call list subscribes to `SERVICE_CALL_*` events and the compact menu powers quick-command).
- **Governance**: MEDIO — kitchen state and service calls are operational, not financial. RBAC + multi-tenant + rate-limit tests are mandatory before merge. No billing implications.
