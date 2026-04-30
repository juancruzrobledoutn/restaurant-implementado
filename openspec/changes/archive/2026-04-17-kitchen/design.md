## Context

C-10 (rounds) landed the round state machine, a working outbox (via `OutboxService.write_event` + `outbox_worker`), and kitchen-facing round endpoints (`GET /api/kitchen/rounds`, `PATCH /api/kitchen/rounds/{id}`). What it intentionally did **not** ship:

- **Kitchen tickets as a first-class entity.** C-10 treats the round as both the business unit and the kitchen work unit — fine for the state machine, but it forces every kitchen-side concept (priority flag, per-item preparation flag, per-ticket notes) to live on the round, and it means the kitchen and billing share a table. Knowledge-base docs (`02-arquitectura/02_modelo_de_datos.md` §2.6, `01-negocio/04_reglas_de_negocio.md` §6) describe a dedicated `kitchen_ticket` + `kitchen_ticket_item` pair. C-11 creates it.
- **The diner's "llamar al mozo" call.** No endpoint, no model.
- **The waiter quick-command menu.** Waiters currently have no way to see a compact product list — the public menu returns heavy payloads (images, allergens, nested categories) that choke older tablets.

What C-11 builds on:

- `RoundService.submit_round()`, `.start_kitchen()`, `.mark_ready()`, `.serve_round()`, `.cancel_round()` — all extend points for ticket lifecycle.
- `OutboxService.write_event(db, event_type, payload)` — already transactional, caller owns commit.
- `BranchScopedService[Model, Output]` — base for every new service.
- `MANAGEMENT_ROLES`, `KITCHEN_VISIBLE_STATUSES`, `RoundStatus` — already in `shared/config/constants.py`.
- `PermissionContext.require_kitchen_or_management()` — already in `rest_api/services/permissions.py`.

Constraints:

- Multi-tenant: every query must filter by `tenant_id`. The `BranchScopedService` base does this; we add `tenant_id` as a denormalised column on `KitchenTicket` and `ServiceCall` (not strictly needed with the FK chain, but faster for the hot-path listing queries and aligns with how C-10's `Round` does it).
- Migration chain: latest alembic is `009_rounds.py`; the new migration is `010_kitchen.py` with `down_revision = "009"`.
- No model collisions: confirmed that `KitchenTicket`, `KitchenTicketItem`, and `ServiceCall` don't exist anywhere in the backend (C-13 staff-management, the suspected potential collision site, does not define `ServiceCall` — it handles users, user-branch-roles, and waiter-sector assignments).
- Test suite baseline: 544 passed, 2 skipped. C-11 must not regress any of those; new tests extend the count.

Stakeholders:
- Backend team (C-11 owner).
- Frontend (Dashboard C-16, pwaWaiter C-20/C-21, pwaMenu C-18) depend on the ticket and service-call events — the event names and payloads are public contract.
- Kitchen staff — the UX target. Backend ships the data; Dashboard ships the "beep + flash".

## Goals / Non-Goals

**Goals:**
- Ship a `KitchenTicket` + `KitchenTicketItem` model with full auto-creation on round submit, cancellation cascade, and the IN_PROGRESS/READY/DELIVERED state machine.
- Ship a `ServiceCall` model and the 3 endpoints (diner POST, waiter PATCH, waiter GET) with outbox-reliable `SERVICE_CALL_CREATED` event, duplicate guard, and per-session rate limit.
- Ship the compact `GET /api/waiter/branches/{id}/menu` endpoint — minimal payload for fast rendering.
- Zero regression in the C-10 test suite.
- Ship 25+ new tests covering ticket lifecycle, service call flow, rate limit, duplicate guard, RBAC, multi-tenant isolation, and the waiter menu shape.

**Non-Goals:**
- Frontend beep/flash on `TICKET_CREATED` / `ROUND_SUBMITTED`. That's a dashboard-side concern. Backend ships the events and the contract; C-16 consumes them.
- Per-item kitchen tracking UI (marking individual `KitchenTicketItem.is_prepared`). The column ships, the endpoint doesn't. A follow-up change will expose it once the UI exists.
- Ticket priority flag ("urgente"). Column exists (`priority` default False), no endpoint mutates it yet — reserved.
- Kitchen station routing (splitting a ticket across hot/cold stations). Single-ticket-per-round stays the invariant for C-11. A future C-XX can add a `station_id` FK and a ticket-split service.
- Billing integration. C-12 owns billing; ticket status never affects the check.
- Multi-instance outbox worker (PG advisory lock). Single-instance holds through C-11; documented as a known limitation in C-10.
- Deleting service calls. They're soft-deleted automatically via `AuditMixin` if an admin triggers a session cleanup; no dedicated `DELETE /api/waiter/service-calls/{id}` endpoint ships.

## Decisions

### D-01: One ticket per round, created eagerly on SUBMITTED

**Decision**: `KitchenTicket` is created inside the same transaction as the round's CONFIRMED → SUBMITTED transition, one-to-one with the round, unique constraint on `kitchen_ticket.round_id`.

**Alternatives considered**:
- *Lazy creation on first kitchen GET*. Rejected: the kitchen display would have to tolerate "round without ticket" and bake a fallback; the `TICKET_CREATED` event couldn't fire from the service layer; racing kitchen readers could create duplicates.
- *Many-to-many round ↔ ticket* (to allow splitting one round across hot/cold stations). Rejected as premature — no actual kitchen in pilot has two stations wired up; deferred to a future change with a clean, separate model.

**Why**: a unique constraint at the DB level makes the invariant self-enforcing; eager creation gives the kitchen a stable id to target for `PATCH`; the cascade logic in `RoundService` stays readable (one ticket, one state change).

### D-02: Ticket state mirrors the SUBMITTED-onward slice of round state

| Round status | Ticket status | Ticket timestamps set |
|--------------|---------------|------------------------|
| SUBMITTED | IN_PROGRESS | — (created_at only) |
| IN_KITCHEN | IN_PROGRESS | `started_at` |
| READY | READY | `ready_at` |
| SERVED | DELIVERED | `delivered_at` |
| CANCELED (from SUBMITTED+) | IN_PROGRESS (but `is_active=False`) | — |

**Decision**: Ticket transitions are driven **from `RoundService`** — every round transition that matters to the kitchen calls into `TicketService` within the same DB session. The `PATCH /api/kitchen/tickets/{id}` endpoint is a convenience wrapper that flips both the ticket and the parent round by delegating to `TicketService.set_status()`, which internally calls `RoundService.mark_ready` or `RoundService.serve_round` based on the requested target.

**Alternatives considered**:
- *Independent ticket state machine*. Rejected: would allow the ticket and round to desync (ticket READY, round still IN_KITCHEN) — confusing for the UI and for billing.
- *Round drives everything, ticket is a view*. Rejected: loses the ability for the kitchen to update ticket-only fields (`priority`, per-item `is_prepared`) in future changes.

**Why**: the kitchen UI should drive the round through the ticket — that's its mental model — but the authoritative state remains on the round. The ticket is a "shadow" projection with the same two meaningful transitions (READY and DELIVERED) plus the SUBMITTED-born creation.

### D-03: Cancellation on SUBMITTED+ soft-deletes the ticket, does not transition it

**Decision**: `RoundService.cancel_round()` on a round whose status is SUBMITTED, IN_KITCHEN, or READY calls `TicketService.cancel_for_round(round_id, db)`, which sets `is_active=False` on the ticket (and its items). No new ticket status is introduced. Cancellation of a PENDING or CONFIRMED round has no ticket to touch — method is idempotent (no-op if no ticket exists).

**Alternatives considered**:
- *Add a `CANCELED` ticket status*. Rejected: adds a state with no distinct UI behaviour (the kitchen should just see the ticket disappear).
- *Hard-delete the ticket on cancel*. Rejected: audit trail and debug value outweigh the cleanup benefit.

**Why**: soft delete is the project-wide convention (`is_active=False`), works with the existing kitchen listing filter (`is_active.is_(True)`), and preserves the row for forensics.

### D-04: `SERVICE_CALL_CREATED` via outbox, ACK/CLOSE via direct Redis

**Decision**: the diner's `POST /api/diner/service-call` writes an `OutboxEvent` inside the creation transaction; the waiter's subsequent `PATCH .../service-calls/{id}` emits `SERVICE_CALL_ACKED` / `SERVICE_CALL_CLOSED` via `shared.infrastructure.events.publish_event` directly after commit.

**Rationale**:
- Create is load-bearing — if Redis blips when the diner presses the button, the call MUST still reach the waiter. Outbox gives at-least-once.
- ACK/CLOSE are best-effort — if the waiter's "close" event doesn't reach other tablets because of a Redis hiccup, they'll see the call as still-open and re-close it on their next refresh. No data loss.

**Alternatives considered**:
- *Everything via outbox*. Rejected: the worker poll interval (2s by default) adds noticeable lag to ACK/CLOSE propagation, which should be immediate.
- *Everything via direct Redis*. Rejected: loses the creation-delivery guarantee.

### D-05: Duplicate-guard for service calls based on `(session_id, status IN CREATED|ACKED)`

**Decision**: `ServiceCallService.create()` does a `SELECT ... WHERE session_id = :sid AND status IN ('CREATED', 'ACKED') AND is_active` inside the same transaction; if a row exists, raise `ConflictError` with `{existing_service_call_id: int}`. The router translates to `409 Conflict`.

**Alternatives considered**:
- *Unique partial index on `(session_id)` WHERE status IN ('CREATED','ACKED')*. Rejected: SQLite (used in tests) doesn't support partial indexes portably, and the service-layer check is already atomic within the transaction thanks to the read-before-write pattern. We add a regular non-unique index on `(session_id, status)` for query speed.
- *Queue-based deduplication in Redis*. Rejected: over-engineered for a 3/min rate-limit use case.

**Why**: service-layer guard is explicit, portable across DBs, and the performance cost is one indexed point-lookup per call.

### D-06: Rate limit keyed by session (not IP)

**Decision**: the `POST /api/diner/service-call` route gets a custom SlowAPI keyer that extracts the session id from the table token claim: `limiter.limit("3/minute", key_func=lambda request: f"svc_call:{request.state.session_id}")`.

**Alternatives considered**:
- *IP-based* (SlowAPI default). Rejected: two tables sharing a NAT / public wifi share the limit.
- *Table-token-string-based*. Equivalent but noisier (includes the expiry timestamp).
- *Per-diner* (from `X-Diner-Id` header). Rejected: diners don't always identify, and the spam vector is "one diner on one table mashing the button" — session scope is the right grain.

**Why**: sessions are stable for the 3h of a meal and unique per table; the spam threat model is "one table smashing the button", which this covers.

### D-07: Waiter menu endpoint bypasses the Redis menu cache

**Decision**: `GET /api/waiter/branches/{branch_id}/menu` reads directly from the DB with eager loading (similar to `_build_menu` in `public_menu.py`). No caching in C-11. If later profiling shows load, a separate cache key (`waiter_menu:{branch_id}`) can be added without touching the public menu cache.

**Alternatives considered**:
- *Reuse the public menu Redis cache*. Rejected: different payload shape — would mean double-serialising and stripping fields at read time, negating the cache benefit.
- *Cache from day one*. Rejected: no baseline for load yet, premature optimisation.

### D-08: `TICKET_CREATED` fires after the commit, carries no item detail

**Decision**: `RoundService.submit_round` publishes `TICKET_CREATED` to direct Redis **after** the `safe_commit(db)` call (same order as `ROUND_SUBMITTED`'s outbox write — the outbox write is IN the transaction, the direct publish is AFTER). Payload: `{ ticket_id, round_id, branch_id, tenant_id }` only. Consumers that need items call `GET /api/kitchen/tickets?branch_id={id}`.

**Why**: keeps the event payload small and stable. Items can churn (voids, adds) independently; pushing them in the event means every subscriber has to parse and reconcile. A pull-on-notification pattern is more robust.

### D-09: Ticket listing response includes items and minimal nested context

**Decision**: `GET /api/kitchen/tickets` response shape:
```
[
  {
    "id": int,
    "round_id": int,
    "round_number": int,
    "session_id": int,
    "table_id": int,
    "table_number": str,
    "sector_name": str | null,
    "status": "IN_PROGRESS" | "READY" | "DELIVERED",
    "started_at": datetime | null,
    "ready_at": datetime | null,
    "delivered_at": datetime | null,
    "created_at": datetime,
    "items": [
      {
        "id": int,
        "round_item_id": int,
        "product_id": int,
        "product_name": str,
        "quantity": int,
        "notes": str | null,
        "is_voided": bool
      }
    ]
  }
]
```

**Rationale**: one round-trip for the entire kitchen board. Eager-load the chain `KitchenTicket → KitchenTicketItem → RoundItem → Product` and `KitchenTicket → Round → TableSession → Table → BranchSector` in the query. Yes, it's a wide join — the expected volume (<100 active tickets per branch) makes this fine without pagination.

### D-10: Voided round items DO NOT get ticket items

**Decision**: `TicketService.create_from_round()` iterates `round.items` filtering `not is_voided` when building `KitchenTicketItem` rows. If a round item is voided AFTER the ticket is created (mid-flight void via C-10's `POST /api/waiter/rounds/{id}/void-item`), the existing `KitchenTicketItem` stays in the DB but gains a computed flag via join in the response (`is_voided=True` in the output schema, populated from `RoundItem.is_voided`).

**Why**: voided items are still informative to the kitchen (someone already started cooking) — the brigade needs to know to STOP. Deleting the ticket item would hide that signal.

## Risks / Trade-offs

- **Risk: Ticket ↔ round state can desync if a bug lets one transition without the other** → Mitigation: every `RoundService` transition method that touches the kitchen must call `TicketService` in the same DB session before `safe_commit`. Tests assert round.status and ticket.status/is_active after every transition, including cancellation from every valid source state.
- **Risk: Outbox event `TICKET_CREATED` is direct-Redis, not outbox — it can be lost** → Mitigation: documented in proposal. The consumer can always re-pull via `GET /api/kitchen/tickets` after a reconnect — the ws-gateway's catch-up mechanism from C-09 (Redis sorted set, 5-min TTL) covers short windows; longer outages still end in "polling reconciles". The authoritative source of truth is the DB, not the event stream.
- **Risk: Duplicate service calls still possible in a race window** → Mitigation: the service-layer read-before-write is inside a single transaction. Two concurrent diner POSTs could both read "no open call", both insert, and both commit — the tests cover this with a SELECT ... FOR UPDATE on the session row OR (portable fallback) a retry on unique-violation. Decision: we use `SELECT FOR UPDATE` on `TableSession` in the same transaction to serialise. For SQLite tests this is a no-op but the logical guard of "one TX at a time" holds under the test model.
- **Risk: Rate-limit keyer depends on `request.state.session_id` being set by the table-token middleware** → Mitigation: add a defensive fallback — if `session_id` is missing, fall back to the raw table token string; a missing token already fails auth before the limiter runs. Tests cover both shapes.
- **Trade-off: Waiter menu has no cache** → Accepted. Adds a DB round-trip per waiter-menu open, but waiters open this far less often than diners open the public menu. Reconsider if p95 > 200ms.
- **Trade-off: The ticket response eagerly loads 5 levels of joins** → Accepted for v1. Adds latency on very large kitchens; indexed paths keep it to one query with a few selectinloads. If this shows up as a hotspot, split into `GET /api/kitchen/tickets` (summary) + `GET /api/kitchen/tickets/{id}` (detail).
- **Trade-off: `TICKET_IN_PROGRESS` event partially duplicates `ROUND_IN_KITCHEN`** → Accepted. The two have different subscription models (round-aware clients vs ticket-aware clients) and C-16's kitchen board subscribes to ticket events specifically. The slight duplication is worth the decoupling.

## Migration Plan

- **Forward (010_kitchen.py)**:
  - Create `kitchen_ticket` table with PK `id`, FKs to `round` (unique) and `branch` (RESTRICT); indexes `ix_kitchen_ticket_branch_status` on `(branch_id, status)` and `ix_kitchen_ticket_round` on `(round_id)`.
  - Create `kitchen_ticket_item` table with PK `id`, FKs to `kitchen_ticket` and `round_item` (both RESTRICT); unique `(ticket_id, round_item_id)`.
  - Create `service_call` table with PK `id`, FKs to `table_session`, `app_table`, `branch`, and `app_user` (for acked_by and closed_by — both nullable); indexes `ix_service_call_session_status` on `(session_id, status)` and `ix_service_call_branch_status` on `(branch_id, status)`.
  - CHECK constraints: `ck_kitchen_ticket_status_valid` enumerating IN_PROGRESS/READY/DELIVERED; `ck_service_call_status_valid` enumerating CREATED/ACKED/CLOSED.
- **Rollback**: standard Alembic `downgrade()` drops the three tables in reverse FK order. Safe because no older table points to any of them.
- **Data seed**: none. The tables start empty; all rows are created by live traffic.
- **Order of deployment**: single deploy. No feature flag — the endpoints are new and the `RoundService` changes are backward-compatible with existing rounds (any round already in SUBMITTED+ without a ticket won't magically get one retroactively; a brief post-deploy check counts "SUBMITTED rounds without ticket" and logs — expected zero in prod since C-10 freshly shipped).

## Open Questions

1. Should `PATCH /api/kitchen/tickets/{id}` allow the IN_PROGRESS → IN_PROGRESS no-op (for future per-item "start cooking" toggles)? **Tentative: no** — if the status doesn't change, return 400. Per-item tracking will be a separate endpoint when it ships.
2. Should the service-call duplicate-guard allow creating a new call once the previous one is CLOSED? **Yes** — closed is terminal, a new ask is legitimate.
3. Do we need a `DELETE /api/waiter/service-calls/{id}` for admins to clean up stuck rows? **Deferred** — soft-delete via the generic cleanup path suffices for v1.
4. Do we expose `priority` on `POST /api/diner/service-call` (e.g. `{priority: "URGENT"}`)? **Deferred** — not in the knowledge-base spec; ship without and add in a follow-up if staff ask for it.
