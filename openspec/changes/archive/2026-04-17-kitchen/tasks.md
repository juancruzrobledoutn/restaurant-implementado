## 1. Constants and enums

- [x] 1.1 Add `KitchenTicketStatus` StrEnum (`IN_PROGRESS`, `READY`, `DELIVERED`) to `backend/shared/config/constants.py`
- [x] 1.2 Add `ServiceCallStatus` StrEnum (`CREATED`, `ACKED`, `CLOSED`) to `backend/shared/config/constants.py`
- [x] 1.3 Add `SERVICE_CALL_OPEN_STATUSES` frozenset for the duplicate-guard query

## 2. Models

- [x] 2.1 Create `backend/rest_api/models/kitchen_ticket.py` with `KitchenTicket` (AuditMixin, FK round unique, status CHECK, timestamps, priority default False, tenant_id/branch_id denormalised)
- [x] 2.2 In the same file, add `KitchenTicketItem` (AuditMixin, FK ticket, FK round_item unique per ticket, is_prepared default False, prepared_at nullable)
- [x] 2.3 Create `backend/rest_api/models/service_call.py` with `ServiceCall` (AuditMixin, FKs session/table/branch/acked_by/closed_by, status CHECK, acked_at/closed_at nullable, tenant_id denormalised)
- [x] 2.4 Register the three new models in `backend/rest_api/models/__init__.py`
- [x] 2.5 Add `Round.ticket` back-populated relationship (uselist=False) in `backend/rest_api/models/round.py`
- [x] 2.6 Add `TableSession.service_calls` back-populated relationship in `backend/rest_api/models/table_session.py`
- [x] 2.7 Import the three new models in `backend/tests/conftest.py` so SQLite test schema includes them

## 3. Alembic migration 010

- [x] 3.1 Create `backend/alembic/versions/010_kitchen.py` with `down_revision = "009_rounds"` and `revision = "010_kitchen"`
- [x] 3.2 `upgrade()`: create `kitchen_ticket` table with columns, FKs (ondelete=RESTRICT), CHECK `ck_kitchen_ticket_status_valid`, indexes `ix_kitchen_ticket_branch_status`, `uq_kitchen_ticket_round` (unique)
- [x] 3.3 `upgrade()`: create `kitchen_ticket_item` table with FKs, unique `(ticket_id, round_item_id)`, index `ix_kitchen_ticket_item_ticket`
- [x] 3.4 `upgrade()`: create `service_call` table with FKs, CHECK `ck_service_call_status_valid`, indexes `ix_service_call_session_status`, `ix_service_call_branch_status`
- [x] 3.5 `downgrade()`: drop tables in reverse FK order (service_call, kitchen_ticket_item, kitchen_ticket)
- [ ] 3.6 Run `alembic upgrade head` in dev DB (`menu_ops_basejr`) and verify tables appear (manual — deferred; SQLite tests exercise the schema)
- [ ] 3.7 Run `alembic downgrade -1` and then `alembic upgrade head` — confirm idempotent (manual — deferred)

## 4. Pydantic schemas

- [x] 4.1 Create `backend/rest_api/schemas/kitchen_ticket.py` with `KitchenTicketItemOutput`, `KitchenTicketOutput` (nested items + round/session/table/sector summary), `KitchenTicketStatusUpdateInput` (Literal["READY", "DELIVERED"])
- [x] 4.2 Create `backend/rest_api/schemas/service_call.py` with `ServiceCallOutput`, `ServiceCallStatusUpdateInput` (Literal["ACKED", "CLOSED"]), `ServiceCallDuplicateError` (409 body)
- [x] 4.3 Create `WaiterMenuResponse` and nested types in `backend/rest_api/schemas/waiter_menu.py`

## 5. TicketService

- [x] 5.1 Create `backend/rest_api/services/domain/ticket_service.py` (does not extend BranchScopedService — it's a state-machine helper, not a CRUD facade)
- [x] 5.2 Implement `create_from_round(round: Round) -> KitchenTicket` — builds ticket + items for non-voided round items, adds to session (no commit)
- [x] 5.3 Implement `mark_started(round_id)` — sets started_at, status stays IN_PROGRESS
- [x] 5.4 Implement `mark_ready(round_id)` — status → READY, ready_at = now
- [x] 5.5 Implement `mark_delivered(round_id)` — status → DELIVERED, delivered_at = now
- [x] 5.6 Implement `cancel_for_round(round_id)` — soft-deletes ticket (is_active=False) if exists; no-op if none
- [x] 5.7 Implement `set_status(ticket_id, target_status, tenant_id, branch_ids, user_id, user_role)` — validates preconditions, delegates to RoundService.mark_ready or serve
- [x] 5.8 Implement `list_for_kitchen(branch_id, tenant_id, branch_ids, status_filter)` with selectinload of items → round_item → product, round → session → table → sector
- [x] 5.9 Export `TicketService` from `backend/rest_api/services/domain/__init__.py`

## 6. ServiceCallService

- [x] 6.1 Create `backend/rest_api/services/domain/service_call_service.py` (domain helper — no BranchScopedService extension needed, state machine drives itself)
- [x] 6.2 Implement `create(session_id, tenant_id)` — FOR UPDATE on TableSession, checks for open call (CREATED/ACKED), raises `ConflictError` with code `service_call_already_open` if found, else inserts and writes `SERVICE_CALL_CREATED` outbox event in same TX
- [x] 6.3 Implement `ack(call_id, tenant_id, branch_ids, user_id)` — transition CREATED → ACKED, sets acked_by_id/acked_at, commits, publishes `SERVICE_CALL_ACKED` direct Redis
- [x] 6.4 Implement `close(call_id, tenant_id, branch_ids, user_id)` — transition CREATED|ACKED → CLOSED, sets closed_by_id/closed_at, commits, publishes `SERVICE_CALL_CLOSED` direct Redis
- [x] 6.5 Implement `list_open(branch_id, tenant_id, branch_ids, status_filter)` — default filter is `[CREATED, ACKED]`; explicit CLOSED allowed
- [x] 6.6 Export `ServiceCallService` from `backend/rest_api/services/domain/__init__.py`

## 7. WaiterMenuService

- [x] 7.1 Create `backend/rest_api/services/domain/waiter_menu_service.py` with `build_menu(branch_id, tenant_id, branch_ids) -> WaiterMenuResponse`
- [x] 7.2 Query Category → Subcategory → Product → BranchProduct with selectinload, apply is_active + is_available filters
- [x] 7.3 Sort categories/subcategories by `.order`; products by `.name` (Product has no `order` column in C-04)
- [x] 7.4 Build the nested response with only `id/name/price_cents/is_available` on products
- [x] 7.5 Export `WaiterMenuService` from `backend/rest_api/services/domain/__init__.py`

## 8. RoundService integration

- [x] 8.1 In `RoundService.submit`, after status flip: call `TicketService.create_from_round(round)` to add ticket + items (no commit)
- [x] 8.2 Expand the `ROUND_SUBMITTED` outbox payload to include `ticket_id = ticket.id`
- [x] 8.3 After commit of submit, emit `TICKET_CREATED` direct-Redis event with full payload
- [x] 8.4 In `RoundService.start_kitchen`, inline the transition and call `TicketService.mark_started(round.id)` before commit (no longer delegates to `_simple_transition`)
- [x] 8.5 After commit of start_kitchen, emit `TICKET_IN_PROGRESS` direct-Redis event
- [x] 8.6 In `RoundService.mark_ready`, call `TicketService.mark_ready(round.id)` before commit; `ROUND_READY` outbox payload gains `ticket_id`; `TICKET_READY` outbox row written alongside
- [x] 8.7 In `RoundService.serve`, inline the transition and call `TicketService.mark_delivered(round.id)` before commit; emit `TICKET_DELIVERED` direct Redis after commit
- [x] 8.8 In `RoundService.cancel`, before commit: call `TicketService.cancel_for_round(round.id)` — idempotent no-op if no ticket
- [x] 8.9 Errors from `TicketService` propagate (no silent swallow) so the transaction rolls back atomically

## 9. Routers

- [x] 9.1 Create `backend/rest_api/routers/kitchen_tickets.py` with `GET /tickets` (branch_id required, optional status filter) and `PATCH /tickets/{id}` (status=READY|DELIVERED)
- [x] 9.2 Use `PermissionContext.require_kitchen_or_management()` and map ConflictError/NotFoundError/ForbiddenError/ValidationError to 409/404/403/400 HTTP statuses
- [x] 9.3 Create `backend/rest_api/routers/waiter_service_calls.py` with `PATCH /service-calls/{id}` and `GET /service-calls?branch_id=&status=`
- [x] 9.4 Use `PermissionContext.require_management_or_waiter()` (already exists in C-08)
- [x] 9.5 Create `backend/rest_api/routers/diner_service_call.py` with `POST /service-call` — Table-Token auth via `current_table_context`
- [x] 9.6 Apply SlowAPI limiter with per-session keying (3/minute per session) to the diner POST route
- [x] 9.7 Create `backend/rest_api/routers/waiter_menu.py` with `GET /branches/{branch_id}/menu`, requires JWT WAITER/MANAGER/ADMIN
- [x] 9.8 Register the 4 new routers in `backend/rest_api/main.py` with appropriate prefixes

## 10. Unit tests — services

- [x] 10.1 Create `backend/tests/test_ticket_service.py`
- [x] 10.2 Test: submit auto-creates a ticket with IN_PROGRESS and one item per non-voided RoundItem
- [x] 10.3 Test: voided items are excluded from the new ticket's item set
- [x] 10.4 Test: `start_kitchen` sets `started_at`; status stays IN_PROGRESS
- [x] 10.5 Test: `mark_ready` sets `status=READY` and `ready_at` + TICKET_READY outbox row
- [x] 10.6 Test: `serve` sets ticket `status=DELIVERED` and `delivered_at` + TICKET_DELIVERED direct event
- [x] 10.7 Test: `cancel` on SUBMITTED+ soft-deletes the ticket (is_active=False)
- [x] 10.8 Test: `cancel` on PENDING does not error and no ticket exists
- [x] 10.9 Create `backend/tests/test_service_call_service.py`
- [x] 10.10 Test: `create` inserts row with CREATED status and writes outbox event in same transaction
- [x] 10.11 Test: `create` returns 409 if CREATED call already exists
- [x] 10.12 Test: `create` returns 409 if ACKED call already exists
- [x] 10.13 Test: `create` succeeds if previous call is CLOSED
- [x] 10.14 Test: `ack` CREATED → ACKED sets acked_by_id/acked_at; invalid from ACKED returns ConflictError
- [x] 10.15 Test: `close` from CREATED or ACKED sets closed_by_id/closed_at; from CLOSED returns ConflictError
- [x] 10.16 Test: list_open default filter excludes CLOSED calls
- [x] 10.17 Test: TicketService.list_for_kitchen (active/branch filter, status filter, cross-branch rejection)
- [x] 10.18 Test: TicketService.set_status IN_PROGRESS → 400 (ValidationError), cross-tenant → NotFoundError

## 11. Router integration tests

- [x] 11.1 Create `backend/tests/test_kitchen_tickets_router.py`
- [x] 11.2 Test: KITCHEN user `GET /api/kitchen/tickets?branch_id=1` returns active tickets filtered by tenant and branch
- [x] 11.3 Test: WAITER `GET /api/kitchen/tickets` returns 403
- [x] 11.4 Test: KITCHEN wrong-branch GET returns 403
- [x] 11.5 Test: status filter `?status=READY` narrows results
- [x] 11.6 Test: `PATCH /api/kitchen/tickets/{id}` with status=READY flips both round and ticket
- [x] 11.7 Test: `PATCH` with status=IN_PROGRESS returns 422 (Pydantic Literal validation)
- [x] 11.8 Test: `PATCH` status=DELIVERED from IN_PROGRESS returns 409
- [x] 11.9 Test: `PATCH` by WAITER returns 403
- [x] 11.10 Create `backend/tests/test_diner_service_call_router.py`
- [x] 11.11 Test: `POST /api/diner/service-call` with valid Table Token returns 201 and writes outbox row
- [x] 11.12 Test: duplicate POST while CREATED returns 409 with existing id in detail body
- [x] 11.13 Test: POST after previous CLOSED succeeds with 201
- [x] 11.14 Test: missing table token returns 422 (header required)
- [x] 11.15 Test: invalid table token returns 401
- [x] 11.16 Create `backend/tests/test_waiter_service_calls_router.py`
- [x] 11.17 Test: WAITER PATCH with ACKED succeeds from CREATED
- [x] 11.18 Test: KITCHEN PATCH returns 403
- [x] 11.19 Test: CLOSE already-closed call returns 409
- [x] 11.20 Test: GET default excludes CLOSED; explicit status=CLOSED returns closed only
- [x] 11.21 Test: GET wrong branch returns 403
- [x] 11.22 Create `backend/tests/test_waiter_menu_router.py`
- [x] 11.23 Test: WAITER GET returns 200 with compact shape, no images, no allergens
- [x] 11.24 Test: inactive category excluded
- [x] 11.25 Test: unavailable BranchProduct excluded
- [x] 11.26 Test: wrong-branch request returns 403
- [x] 11.27 Test: unauthenticated returns 401
- [x] 11.28 Test: KITCHEN user returns 403
- [x] 11.29 Test: ADMIN cross-tenant branch returns 404

## 12. Verification

- [x] 12.1 Run the full test suite: `cd backend && pytest` — 599 passed + 2 skipped (baseline 544 + 2). Zero regressions; +55 new tests.
- [x] 12.2 New tests all pass: 17 ticket service + 14 service call service + 8 kitchen tickets router + 5 diner service call router + 6 waiter service calls router + 5 waiter menu router + 6 round integration deltas updated
- [x] 12.3 `openspec validate kitchen --type change --strict` passes
- [ ] 12.4 Manual sanity check via curl/httpie — deferred to integration/e2e (SQLite tests already exercise the happy path)
