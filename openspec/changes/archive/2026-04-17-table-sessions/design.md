## Context

After C-07, a branch has physical sectors and tables, but the system is silent at runtime — no table is "open", no diner exists, no cart can be built, and pwaMenu has nothing to authenticate against. C-08 is the change where the table comes alive: it introduces the runtime session record, the diners that sit at it, the cart they share, and the HMAC Table Token they present on every request. It is the single largest lever in Gate 5: without `TableSession`, C-09 (WS Gateway) has no `TableTokenAuthStrategy` to implement, C-10 (rounds) has nothing to hang a round off, and C-17 (pwaMenu-shell) has no entry point.

Constraints inherited from the project:

- Clean Architecture: thin FastAPI routers, `BranchScopedService` subclasses, `PermissionContext` for staff auth.
- Multi-tenant: every query MUST filter by `tenant_id` (through the `branch → tenant` chain).
- SQLAlchemy booleans: always `.is_(True)` / `.is_(False)`.
- Commits: always `safe_commit(db)`.
- Soft delete universal (`is_active = False`), EXCEPT for ephemeral records — cart items qualify and follow hard delete.
- Prices in integer cents (irrelevant here — C-08 does not manipulate prices, only references `product_id`).
- SQL reserved words: `table_session`, `diner`, `cart_item` are all safe words (no `app_` prefix needed).

Governance: MEDIO (table sessions are operational, not financial — but the state machine and multi-tenant checks still demand rigour).

## Goals / Non-Goals

**Goals:**
- Implement 3 models: `TableSession`, `Diner`, `CartItem` with correct FKs, indexes, AuditMixin use, and lifecycle rules.
- Implement the `OPEN → PAYING → CLOSED` state machine at the service layer (not at the router layer).
- Guarantee the single-active-session invariant per table at the data layer (partial unique index) AND the service layer (defensive check + `with_for_update()` locks).
- Ship a stateless HMAC Table Token helper that the diner endpoints consume and that C-09 will reuse in the WS Gateway.
- Ship the 7 endpoints (3 waiter, 2 staff read, 1 public join, 1 diner session) with proper RBAC and input validation.
- Hard-delete `cart_item` rows when a session is closed — in the same transaction as the session soft-delete.
- Provide a migration 007 that chains cleanly on top of `006_allergens` and has a working `downgrade()`.
- Pytest coverage for every state transition, every permission gate, and every invariant (multi-tenant, token tamper, expired token, single active session).

**Non-Goals:**
- WebSocket broadcast of `TABLE_SESSION_STARTED` / `TABLE_CLEARED` / `TABLE_STATUS_CHANGED`: deferred to C-09 (gateway doesn't exist yet in C-08; we will emit the domain events via an internal `publish_*` stub that no-ops if no gateway is configured).
- Full billing (`Check`, `Charge`, `Payment`, `Allocation`): deferred to C-12. C-08 only exposes `request-check` as a state transition. No money is moved.
- Rounds and `RoundItem`: deferred to C-10. `CartItem` is the staging area that C-10 converts into a round.
- Customer loyalty / `customer_id` linkage: the FK column is added to `diner` (nullable) for schema stability, but the loyalty flow lives in C-19.
- Redis-backed Table Token blacklist: not needed in C-08 — tokens are stateless and short-lived (3 h). Revocation-on-close is enforced by the server rejecting tokens whose `session_id` is no longer `OPEN`/`PAYING`.
- Dashboard or pwaMenu UI: C-08 is backend-only.
- Rate limiting of public join endpoint: deferred to C-09 (the WS Gateway brings Redis + the shared rate-limiting middleware into scope).

## Decisions

### D-01: Separate `TableSessionService` and `DinerService`, both extending `BranchScopedService`

**Decision**: Two domain services. `TableSessionService` owns the session state machine and the close-with-cart-cleanup. `DinerService` owns diner registration and the single-diner-per-device safeguard.

**Alternatives considered**:
- A single `TableSessionService` that also handles diners: less code duplication but collapses two distinct responsibilities (state machine vs. participant registration). Tests become larger and failures harder to localize.
- Standalone services with no base class: loses the branch-access validation machinery from `BranchScopedService`.

**Rationale**: Follows the established pattern from C-04 (`CategoryService`, `SubcategoryService`, `ProductService`) and C-07 (`SectorService`, `TableService`). Each service maps one-to-one to a primary model, which keeps permission checks, validation hooks, and tests cohesive.

### D-02: Single-active-session invariant — partial unique index + defensive service check

**Decision**: Enforce the invariant at **two layers**:
1. DB-level partial unique index: `CREATE UNIQUE INDEX uq_table_session_active_per_table ON table_session (table_id) WHERE is_active AND status IN ('OPEN', 'PAYING')`.
2. Service-level check inside `activate()`: SELECT `... FOR UPDATE` on the `app_table` row, then query for any active session before inserting.

**Alternatives considered**:
- Service-only check: race condition between two simultaneous activations on the same table (two waiters tapping "activate" at once) would slip through. PostgreSQL does not serialize bare SELECTs.
- DB-only constraint (no service check): the error surfaces as an opaque `IntegrityError` with a cryptic message — bad UX for the waiter app and bad log signal.

**Rationale**: Belt and suspenders. The service check surfaces a clean `409 Conflict` with a domain-level message ("La mesa ya tiene una sesión activa"). The partial unique index is the authoritative, race-proof backstop. `with_for_update()` on the table row (locking at the table, not the session) is the same pattern used by `fastapi-domain-service` skill for state machines.

### D-03: Table Token = stateless HMAC-SHA256 JSON envelope

**Decision**: Token format is a base64url-encoded JSON payload concatenated with a base64url-encoded HMAC-SHA256 signature over that payload. Payload fields: `session_id`, `table_id`, `diner_id`, `branch_id`, `tenant_id`, `iat` (issued at, epoch seconds), `exp` (expires at, epoch seconds — `iat + TABLE_TOKEN_TTL_SECONDS`). Secret lives in `TABLE_TOKEN_SECRET` env var. Transport header: `X-Table-Token`.

```
table_token = base64url(json_payload) + "." + base64url(hmac_sha256(secret, base64url(json_payload)))
```

**Alternatives considered**:
- Reuse PyJWT with HS256: more dependencies, more surface area (JWT's `alg` field alone has historical CVEs — the "alg: none" attack, the HS/RS confusion). For a 5-field, 3-hour token, a plain HMAC envelope is simpler and strictly tighter.
- Sign the whole token (payload + header) with the JWT library anyway: fine, but the knowledge base (`03-seguridad/01_modelo_de_seguridad.md` §Table Token) literally calls it "HMAC" — we honour the existing architectural decision instead of silently upgrading it.
- Store tokens in Redis with a random-id handle: adds Redis as a hard dependency for C-08 (currently not required), breaks statelessness, and complicates C-09 (the WS Gateway must validate tokens before it even has a Redis connection for the request).

**Rationale**: Stateless HMAC is the smallest thing that works. The secret never leaves the server. Tampering the payload invalidates the signature. Expiry is explicit (`exp` claim). Revocation-on-close is cheap: the token carries `session_id`, and any diner request first checks that the referenced session is still `OPEN`/`PAYING` — a closed session automatically rejects all its tokens on the next request without needing a blacklist.

### D-04: Token verification dependency returns a `TableContext` analogous to `PermissionContext`

**Decision**: `current_table_context` is a FastAPI dependency that:
1. Reads `X-Table-Token` from the request headers (raises 401 if missing).
2. Verifies the HMAC signature (401 on mismatch).
3. Checks `exp > now()` (401 on expiry, with `WWW-Authenticate: Bearer realm="table", error="expired_token"`).
4. Loads the `TableSession` from the DB, joining `Table` and `Branch` (raises 401 if the session doesn't exist or is soft-deleted, 409 if it's `CLOSED`).
5. Returns a `TableContext(session, table, branch, diner_id, tenant_id)` that routers consume like they consume `PermissionContext`.

**Alternatives considered**:
- Return the raw payload dict: every router would reimplement the "load session" step. Violates DRY and invites bugs (one router forgets to check `is_active`).
- Store the context in `request.state`: works but is discoverable only by magic — dependency injection is explicit and typed.

**Rationale**: Mirrors the staff-side `PermissionContext` API so the codebase has one mental model for auth. Centralising the DB lookup guarantees every diner endpoint starts from a live, tenant-scoped session.

### D-05: `CartItem` is ephemeral — no `AuditMixin`, hard-deleted on close

**Decision**: `CartItem` has no `AuditMixin`. It has `id`, `session_id`, `diner_id`, `product_id`, `quantity`, `notes`, `created_at`, `updated_at` (plain timestamps for debugging, not for audit). On `close()`, the service issues `DELETE FROM cart_item WHERE session_id = :sid` inside the same transaction that soft-deletes the session.

**Alternatives considered**:
- Soft-delete cart items: the knowledge base explicitly labels them "registro efímero. Se usa hard delete" (`02_modelo_de_datos.md` §cart_item, `01-negocio/04_reglas_de_negocio.md` §Soft Delete rule 2). Overriding that convention would bloat the table with thousands of dead rows per active session.
- Delete cart items immediately on `request-check` instead of on close: tempting (it frees memory sooner), but it breaks the invariant that the cart is the history of "what this session wanted" up until the moment the check was requested. Leaving them until close lets auditing tools reconstruct intent post-mortem during billing debugging.

**Rationale**: Follows the established project convention. Ephemeral records must be hard-deleted; letting them accumulate poisons query planner stats on a hot table.

### D-06: `TableSession.branch_id` is denormalised (not derived from `table.branch_id`)

**Decision**: Store `branch_id` directly on `table_session` (FK to `branch.id`), even though it is always equal to `table.branch_id`.

**Alternatives considered**:
- Derive `branch_id` via join: one fewer column, one more join on every query. All diner-facing endpoints filter by branch via the table — this would turn a PK lookup into a 2-table join on the hot path.

**Rationale**: The knowledge base explicitly lists `branch_id` on `table_session` ("denormalizado para consultas rápidas", `02_modelo_de_datos.md` §table_session). The WS Gateway (C-09) routes events by branch — it needs `branch_id` directly on the session without chasing the table row. Denormalisation here is intentional and safe because `table.branch_id` is immutable (a table cannot change branch after creation).

### D-07: `GET /api/tables/code/{code}/session` requires `branch_slug` as a query parameter

**Decision**: The endpoint shape is `GET /api/tables/code/{code}/session?branch_slug={slug}`. Without `branch_slug`, return 400. The service resolves `branch_slug → branch.id → table.id` (filtered by `branch_id` AND `code`) before loading the session.

**Alternatives considered**:
- Resolve via tenant only: the knowledge base is unambiguous — "los códigos **NO son únicos** entre sucursales... siempre se requiere el `branch_slug`" (`01-negocio/04_reglas_de_negocio.md` §Códigos de mesa). A tenant with 10 branches would get ambiguous results.
- Accept `branch_id` instead of `branch_slug`: works, but pwaMenu uses slugs in URLs (`VITE_BRANCH_SLUG`) and should not learn internal integer IDs. Slugs also protect against enumeration.

**Rationale**: Pure consistency with the knowledge base and with the URL design philosophy ("Las URLs públicas... usan el slug... no el ID numérico, para evitar enumeración", `01-negocio/04_reglas_de_negocio.md` §1).

### D-08: Public `POST /api/public/tables/code/{code}/join` is the one unauthenticated write

**Decision**: This endpoint has no auth at all — any client can POST with `branch_slug` + `code`. It atomically: (a) activates the session if none is active, (b) creates a `Diner` row (taking `name` and optional `device_id` from the body), (c) returns a fresh Table Token. Subsequent diners joining the same session go through the same endpoint, which detects the existing `OPEN` session and only appends a diner.

**Alternatives considered**:
- Require a QR-scanned one-time code: nicer for brute-force protection, but adds a new table and a background sweeper. Not in scope for C-08, and the threat (an attacker guessing `branch_slug` + `code`) requires guessing both a public slug and a 1-3 char table code — low payoff.
- Split into "activate" (staff only) + "join" (public): blocks the common case where the first diner arrives before the waiter has activated anything. The knowledge base describes this as "QR scan por comensal o activación manual por mozo" (`01-negocio/04_reglas_de_negocio.md` §Table Session transitions) — both paths are valid.

**Rationale**: Matches the documented flow. Rate limiting will be applied globally at the gateway level in C-09.

### D-09: `TABLE_TOKEN_SECRET` is a new required env var; tests use a fixture

**Decision**: Add `TABLE_TOKEN_SECRET` to `shared/config/settings.py`. Production startup MUST fail if it's unset (same pattern as `JWT_SECRET` from C-03). Default in dev/test: a documented 64-char string read from `.env.example`. The pytest conftest sets a deterministic test secret so token tests are reproducible.

**Alternatives considered**:
- Reuse `JWT_SECRET`: mixes two trust domains. A leaked JWT_SECRET would let attackers forge both staff JWTs and diner tokens — worse blast radius.
- Generate per-tenant secrets: adds rotation complexity and forces a DB lookup on every token verify. Overkill for C-08; revisit if we ever need per-tenant revocation (not currently a requirement).

**Rationale**: Keeps the two token families cryptographically independent. Mirrors the existing `JWT_SECRET` validation pattern.

### D-10: Table status transitions mirror session lifecycle

**Decision**: When a session opens, the service sets `table.status = "OCCUPIED"`. When a session is closed, the service sets `table.status = "AVAILABLE"`. `OUT_OF_SERVICE` is only settable via the admin table endpoint from C-07 and blocks `activate()` (409).

**Alternatives considered**:
- Leave `table.status` to be computed on the fly by joining `table_session`: simpler writes, but every pwaWaiter table-grid render would join two tables.
- Introduce an event-driven projection: overkill for a single status field.

**Rationale**: The column exists (C-07). Keeping it in sync with the session state machine is cheap and makes the pwaWaiter grid a straight read. The same service that changes session status changes table status, inside the same transaction, with `safe_commit()`.

## Risks / Trade-offs

- **[Risk] Two writers activate the same table at the millisecond** → **Mitigation**: `with_for_update()` on `app_table` row before any SELECT against `table_session`, plus the partial unique index as the DB-level backstop. Tests must include a scenario that simulates this race (two service calls in parallel fixture).
- **[Risk] A closed session's Table Token is presented again** → **Mitigation**: `current_table_context` loads the session and rejects it if `is_active=False` or `status='CLOSED'`. This gives us effective revocation-on-close without a blacklist. Test: close session, reuse old token, expect 401.
- **[Risk] Clock skew between issuer and verifier** → **Mitigation**: single-process, single-machine for backend — no skew. If the backend is ever multi-region, revisit. For now, ±60s leeway on `exp` is NOT applied (simplicity wins).
- **[Risk] Orphaned `cart_item` rows if `close()` crashes mid-transaction** → **Mitigation**: both the `DELETE cart_item` and the session soft-delete happen inside the same SQLAlchemy session + `safe_commit()`. Either both succeed or both roll back. Tests assert zero cart_items after successful close.
- **[Risk] A diner with an expired token silently re-enters** → **Mitigation**: pwaMenu (C-17) is responsible for detecting 401 on table endpoints and re-running the join flow. C-08 guarantees the backend rejects the expired token cleanly with the right error code.
- **[Trade-off] No `TABLE_SESSION_STARTED` WebSocket event in C-08** → Accepted. The gateway doesn't exist yet (C-09). The service layer exposes a `publish_table_event(...)` hook that is a no-op in C-08 and gets wired in C-09. This keeps the contract future-proof without faking infrastructure.
- **[Trade-off] Public join endpoint has no per-IP rate limiting in C-08** → Accepted. Brute force is bounded by the need to guess both a public `branch_slug` AND a table `code` (typically 1–3 chars but restaurant-defined). C-09 will add rate limiting via the Redis + Lua middleware. The endpoint does NOT leak whether a `(slug, code)` pair exists: 404s are uniform.
- **[Trade-off] No DB-enforced "diner belongs to session's branch" constraint** → Enforced at the service layer via FK chains (`diner.session_id → session.branch_id → branch.tenant_id`). A cross-branch `diner` row would require tampering with internal IDs, which the services reject.

## Migration Plan

- Migration file: `backend/alembic/versions/007_table_sessions.py`.
- `revision = "007_table_sessions"`, `down_revision = "006_allergens"`.
- `upgrade()` creates 3 tables in order (FK chain): `table_session` → `diner` → `cart_item`. All FKs `ondelete=RESTRICT` (prevents accidental cascades at the DB level — session closure is an application-level hard delete on cart_item rows).
- Partial unique index created in `upgrade()` via `op.create_index(..., postgresql_where=...)` for the single-active-session invariant.
- `downgrade()` drops tables in reverse order: `cart_item` → `diner` → `table_session`, plus the partial unique index first.
- Data migration: none — C-08 starts with empty tables. The seed script (C-02) is not extended in this change.
- Rollback strategy in production: `alembic downgrade -1` is safe on empty tables. If data has accumulated, rollback is destructive and requires a backup; this is documented in `devOps/RUNBOOK.md` (updated in a later change, not C-08).

## Open Questions

_(none — all decisions grounded in the knowledge base and the approved C-07 patterns. Any ambiguity the implementer hits during `/opsx:apply` should be raised as a checkpoint, since governance is MEDIO.)_
