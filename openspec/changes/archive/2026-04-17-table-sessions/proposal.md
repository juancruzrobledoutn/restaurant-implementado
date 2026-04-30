## Why

With sectors and tables in place (C-07), the system still has no concept of an actual dining session — there is no way to activate a table, register diners, let them assemble a cart, or move the table through its payment lifecycle. C-08 introduces table sessions, diners, cart items, and the HMAC Table Token authentication that backs the pwaMenu diner experience. It is the single most unblocking change in the gate: everything that follows (ws-gateway-base, rounds, kitchen, billing, staff-management, pwaMenu-shell) depends on a running `TableSession`.

## What Changes

- **Models**:
  - `TableSession` (table `table_session`) with state machine `OPEN → PAYING → CLOSED`, FKs to `app_table` and `branch` (denormalised for fast scoping), `AuditMixin` for soft delete of closed sessions.
  - `Diner` (table `diner`) with FK to `TableSession`, `name`, optional `device_id`, optional future `customer_id` (kept nullable — customer loyalty arrives in C-19), `AuditMixin`.
  - `CartItem` (table `cart_item`) with FKs to `table_session`, `diner`, `product`; `quantity`, optional `notes`. **Ephemeral** — no `AuditMixin`, hard-deleted when the session closes.
- **Domain services**:
  - `TableSessionService` extending `BranchScopedService[TableSession, TableSessionOutput]` — activation (create `OPEN`), status transitions (`OPEN → PAYING`, `PAYING → CLOSED`), close-with-cleanup (hard delete of cart_items, soft delete of session), single-active-session invariant per table.
  - `DinerService` extending `BranchScopedService[Diner, DinerOutput]` — register diner into an `OPEN` session, guard against joining `PAYING`/`CLOSED` sessions, list diners for a session.
- **Security — Table Token (HMAC)**:
  - `shared/security/table_token.py` issues and verifies HMAC-SHA256 tokens signed with `TABLE_TOKEN_SECRET`.
  - Token payload: `session_id`, `table_id`, `diner_id`, `branch_id`, `tenant_id`, `iat`, `exp` (3 hours).
  - Transport: header `X-Table-Token: {token}`. Dependency `current_table_context` parses it, validates the HMAC and TTL, loads the session, and produces a `TableContext` analogous to `PermissionContext` but for diners.
  - `TABLE_TOKEN_SECRET` environment variable required in production (same hard-fail pattern as `JWT_SECRET`).
- **Endpoints**:
  - `POST /api/waiter/tables/{table_id}/activate` — WAITER/MANAGER/ADMIN opens a new session on a free table, returns session + list of diner seats (initially empty).
  - `POST /api/waiter/tables/{table_id}/close` — WAITER/MANAGER/ADMIN closes a session in `PAYING`; hard-deletes its `cart_items`, soft-deletes the session, resets the table to `AVAILABLE`.
  - `PATCH /api/waiter/sessions/{session_id}/request-check` — WAITER/MANAGER/ADMIN transitions `OPEN → PAYING` (the real billing flow arrives in C-12; here we only expose the state change so C-08 tests and pwaMenu can rely on it).
  - `GET /api/tables/{id}/session` — JWT-authenticated (staff). Returns the current active session for a table by numeric ID.
  - `GET /api/tables/code/{code}/session?branch_slug={slug}` — JWT-authenticated (staff). Resolves the table by `(branch.slug, code)` (codes are NOT globally unique) and returns the active session.
  - `POST /api/public/tables/code/{code}/join?branch_slug={slug}` — **unauthenticated**, used by pwaMenu on QR scan. Registers a new `Diner` in the table's active `OPEN` session (or activates the session first if none) and returns a fresh Table Token.
  - `GET /api/diner/session` — Table-Token-authenticated. Returns the current session summary (session, table, diners, cart items of the calling diner).
- **Business invariants enforced server-side**:
  - A `Table` can have at most one `TableSession` with `is_active=True` at a time.
  - Only `OPEN` sessions accept new diners, cart items, and (later) rounds. Attempts on `PAYING`/`CLOSED` return `409 Conflict`.
  - Closing a session **hard-deletes** its `cart_items` in the same transaction as the soft delete of the session.
  - Table Token is validated on every diner request; expired tokens return `401` with a clear `code`.
- **Alembic migration 007**: creates `table_session`, `diner`, `cart_item`. `down_revision = "006_allergens"`. Indexes on `table_id, is_active`, `session_id`, `branch_id`. Unique partial index (or application-level check) on `(table_id) WHERE is_active AND status != 'CLOSED'` to guarantee the single-active-session invariant.
- **Tests (pytest, TDD)**:
  - Activate a free table → `TableSession` created with `status=OPEN`, table becomes `OCCUPIED`.
  - Cannot activate a table that already has an active session (409).
  - Diner joins `OPEN` session → token returned, `Diner` row created.
  - Diner cannot join `PAYING` or `CLOSED` session (409).
  - Table Token generation + verification round-trip; expired token is rejected.
  - Table Token with tampered payload fails HMAC verification (401).
  - `request-check` moves `OPEN → PAYING`; further joins rejected.
  - `close` moves `PAYING → CLOSED`, hard-deletes all `cart_item` rows for the session, soft-deletes the session, resets table to `AVAILABLE`.
  - Cannot close a session still in `OPEN` (must request check first).
  - Lookup by table code with branch slug works; lookup without `branch_slug` returns 400.
  - Multi-tenant isolation: tenant A cannot open/read/close sessions of tenant B's tables (403).
  - RBAC: KITCHEN cannot activate or close tables (403); MANAGER and ADMIN can; WAITER can in their assigned sectors.

## Capabilities

### New Capabilities
- `table-sessions`: Table session lifecycle (OPEN/PAYING/CLOSED), diner registration, cart-item storage (ephemeral), and Table Token HMAC authentication for pwaMenu diners. Covers `TableSession`, `Diner`, `CartItem` models, the domain services, admin/waiter/public/diner endpoints, and the `shared/security/table_token.py` helper.

### Modified Capabilities
_(none — `sectors-tables` already exposed the `Table` model; C-08 consumes it without changing its requirements. The `table-sessions` spec stands on its own.)_

## Impact

- **Backend files created**:
  - `backend/rest_api/models/table_session.py` — `TableSession`, `Diner`, `CartItem` models.
  - `backend/rest_api/schemas/table_session.py` — Pydantic I/O schemas.
  - `backend/rest_api/services/domain/table_session_service.py` — `TableSessionService`.
  - `backend/rest_api/services/domain/diner_service.py` — `DinerService`.
  - `backend/rest_api/routers/waiter_tables.py` — waiter activation/close/request-check endpoints.
  - `backend/rest_api/routers/diner_session.py` — diner-facing endpoints (Table Token auth).
  - `backend/rest_api/routers/public_tables.py` — unauthenticated QR-join endpoint.
  - `backend/shared/security/table_token.py` — HMAC token issue/verify and `current_table_context` dependency.
  - `backend/alembic/versions/007_table_sessions.py` — migration.
  - `backend/tests/test_table_sessions.py`, `backend/tests/test_diner_service.py`, `backend/tests/test_table_token.py`.
- **Backend files modified**:
  - `backend/rest_api/models/__init__.py` — register the 3 new models.
  - `backend/rest_api/models/sector.py` — add `Table.sessions` back-populated relationship (no schema change, just ORM-side).
  - `backend/rest_api/services/domain/__init__.py` — export `TableSessionService`, `DinerService`.
  - `backend/rest_api/main.py` — register the 3 new routers.
  - `backend/shared/config/settings.py` — add `TABLE_TOKEN_SECRET`, `TABLE_TOKEN_TTL_SECONDS = 10800` (3 h).
- **Infrastructure**: no new services — reuses PostgreSQL only. Redis is NOT required for C-08 (Table Token is stateless HMAC; blacklisting is deferred to the WS Gateway change).
- **API surface**: 7 new endpoints (activate, close, request-check, by-id, by-code, public join, diner session).
- **Downstream impact**: unblocks C-09 (WS Gateway — needs `TableTokenAuthStrategy`), C-10 (rounds — rounds live under a session), C-13 (staff-management — waiter assignment interplay), C-17 (pwaMenu-shell — the whole diner entry flow), C-20 (pwaWaiter — table operations UI).
