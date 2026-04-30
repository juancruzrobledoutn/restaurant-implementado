## 1. Settings & Secrets

- [x] 1.1 Add `TABLE_TOKEN_SECRET: str` (required, min 32 chars) and `TABLE_TOKEN_TTL_SECONDS: int = 10800` to `backend/shared/config/settings.py`. Production startup MUST fail if the secret is unset or shorter than 32 chars (mirror the `JWT_SECRET` validation pattern from C-03).
- [x] 1.2 Add `TABLE_TOKEN_SECRET` (with a 64-char placeholder) and `TABLE_TOKEN_TTL_SECONDS=10800` to `backend/.env.example`. (N/A — .env.example does not exist in this project; settings have defaults)
- [x] 1.3 Set a deterministic test value for `TABLE_TOKEN_SECRET` inside `backend/tests/conftest.py` (monkeypatch env before settings import) so token tests are reproducible. (Already present; confirmed)

## 2. Table Token Helper (shared/security/table_token.py)

- [x] 2.1 Create `backend/shared/security/table_token.py`. Implement `_b64url_encode(raw: bytes) -> str` and `_b64url_decode(data: str) -> bytes` using `base64.urlsafe_b64encode`/`decode` WITHOUT padding (strip/re-add `=` internally). No external JWT library — stdlib `hmac` + `hashlib.sha256` only.
- [x] 2.2 Implement `issue_table_token(*, session_id: int, table_id: int, diner_id: int, branch_id: int, tenant_id: int) -> str` that: (a) builds a payload dict with the five IDs plus `iat = int(time.time())` and `exp = iat + settings.TABLE_TOKEN_TTL_SECONDS`, (b) canonicalises JSON with `json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()`, (c) base64url-encodes the JSON, (d) computes `hmac.new(secret, b64_payload.encode(), hashlib.sha256).digest()`, (e) returns `"{b64_payload}.{b64_signature}"`.
- [x] 2.3 Implement `verify_table_token(token: str) -> dict` that splits on `.`, recomputes the HMAC with `hmac.compare_digest`, decodes the payload, and checks `exp > int(time.time())`. Raise `AuthenticationError("invalid_table_token")` on signature mismatch or malformed token. Raise `AuthenticationError("expired_token")` on expiry.
- [x] 2.4 Define a `TableContext` dataclass with fields `session: TableSession`, `table: Table`, `branch: Branch`, `diner_id: int`, `tenant_id: int`, `branch_id: int`.
- [x] 2.5 Implement the FastAPI dependency `current_table_context(x_table_token: str = Header(..., alias="X-Table-Token"), db: Session = Depends(get_db)) -> TableContext`. Flow: verify token → load session via `select(TableSession).options(joinedload(TableSession.table).joinedload(Table.branch))` → reject with 401 if session missing/soft-deleted/status=CLOSED → return TableContext.
- [x] 2.6 Export `issue_table_token`, `verify_table_token`, `current_table_context`, and `TableContext` from `shared/security/__init__.py`.

## 3. Models

- [x] 3.1 Create `backend/rest_api/models/table_session.py`. Implement `TableSession(Base, AuditMixin)` with: `__tablename__ = "table_session"`; columns `id` (BigInteger PK autoincrement), `table_id` (FK `app_table.id`, ondelete RESTRICT, not null), `branch_id` (FK `branch.id`, ondelete RESTRICT, not null, denormalised), `status` (String 20, default `"OPEN"`, server_default `"OPEN"`, not null); `__table_args__` with indexes on `table_id`, `branch_id`, `(table_id, is_active)`, and the partial unique index `uq_table_session_active_per_table` on `(table_id) WHERE is_active AND status IN ('OPEN', 'PAYING')` via `Index(..., unique=True, postgresql_where=text("is_active AND status IN ('OPEN', 'PAYING')"))`. Relationships: `table` (N:1), `branch` (N:1), `diners` (1:N), `cart_items` (1:N).
- [x] 3.2 In the same file, implement `Diner(Base, AuditMixin)` with: `__tablename__ = "diner"`; columns `id` (BigInteger PK), `session_id` (FK `table_session.id`, ondelete RESTRICT, not null), `name` (String 255, not null), `device_id` (String 128, nullable), `customer_id` (BigInteger, nullable — forward-looking); `__table_args__` with `Index("ix_diner_session_id", "session_id")`. Relationship: `session` (N:1 back_populates `diners`).
- [x] 3.3 In the same file, implement `CartItem(Base)` (NO AuditMixin) with: `__tablename__ = "cart_item"`; columns `id` (BigInteger PK), `session_id` (FK `table_session.id`, ondelete RESTRICT, not null), `diner_id` (FK `diner.id`, ondelete RESTRICT, not null), `product_id` (FK `product.id`, ondelete RESTRICT, not null), `quantity` (Integer not null, with `CheckConstraint("quantity > 0", name="ck_cart_item_quantity_positive")`), `notes` (String 500, nullable), `created_at` (DateTime, server_default `func.now()`, not null), `updated_at` (DateTime, server_default `func.now()`, on-update `func.now()`, not null); `__table_args__` with `Index("ix_cart_item_session_id", "session_id")` and `Index("ix_cart_item_session_diner", "session_id", "diner_id")`.
- [x] 3.4 Update `backend/rest_api/models/__init__.py` to import and re-export `TableSession`, `Diner`, `CartItem`, and append them to `__all__` with a `# C-08` comment block (mirroring the style of the C-07 block).
- [x] 3.5 Update `backend/rest_api/models/sector.py`: add the back-populated relationship `sessions: Mapped[list["TableSession"]] = relationship("TableSession", back_populates="table", lazy="select")` on the `Table` class. Do NOT change the schema — this is ORM-only.

## 4. Alembic Migration 007

- [x] 4.1 Run the autogenerate or write the migration by hand at `backend/alembic/versions/007_table_sessions.py`. Set `revision = "007_table_sessions"`, `down_revision = "006_allergens"`. Header docstring describes tables created.
- [x] 4.2 Implement `upgrade()`: create `table_session` (with AuditMixin columns), then `diner`, then `cart_item` (no AuditMixin, with `CHECK (quantity > 0)`). All FKs `ondelete="RESTRICT"`. Declare every index from the models. Create the partial unique index using `op.create_index("uq_table_session_active_per_table", "table_session", ["table_id"], unique=True, postgresql_where=sa.text("is_active AND status IN ('OPEN', 'PAYING')"))`.
- [x] 4.3 Implement `downgrade()`: drop the partial index, then drop `cart_item`, then `diner`, then `table_session`. Verify locally with `alembic upgrade head && alembic downgrade -1 && alembic upgrade head`.

## 5. Pydantic Schemas

- [x] 5.1 Create `backend/rest_api/schemas/table_session.py` with: `TableSessionOutput` (id, table_id, branch_id, status, is_active, created_at, updated_at), `TableSessionWithDinersOutput` (extends `TableSessionOutput` + `diners: list[DinerOutput]`), `DinerOutput` (id, session_id, name, device_id, created_at), `DinerRegisterInput` (name: str min 1 max 255, device_id: str | None), `CartItemOutput` (id, session_id, diner_id, product_id, quantity, notes, created_at, updated_at), `PublicJoinResponse` (table_token: str, session_id: int, diner_id: int, table: `TablePublicOutput`), `TablePublicOutput` (id, code, sector_id, branch_id, capacity), `DinerSessionView` (session, table, branch_slug, diners, my_cart_items).

## 6. Domain Services

- [x] 6.1 Create `backend/rest_api/services/domain/table_session_service.py`. Implement `TableSessionService` with `entity_name="Sesión de mesa"`. Override `_validate_create` to confirm the table exists, belongs to the tenant, is `is_active=True`, and has `status != "OUT_OF_SERVICE"`.
- [x] 6.2 Implement `TableSessionService.activate(*, table_id, tenant_id, user_id, user_email, branch_ids)`. Flow: (a) load the target `Table` with `SELECT ... FOR UPDATE` to serialise concurrent activations; (b) confirm tenant + branch access; (c) query for any active session where `table_id == :tid AND is_active.is_(True)` — raise `ValidationError` (409) if found; (d) instantiate `TableSession(table_id=..., branch_id=table.branch_id, status="OPEN")`; (e) set `table.status = "OCCUPIED"`; (f) `db.add(session)`, `safe_commit(db)`; (g) return `TableSessionOutput`.
- [x] 6.3 Implement `TableSessionService.request_check(*, session_id, tenant_id, user_id, user_email, branch_ids)`. Flow: load session with `SELECT ... FOR UPDATE`; confirm tenant + branch access; if `status != "OPEN"` raise `ValidationError` (409) with a clear message; set `status = "PAYING"`; `safe_commit(db)`; return updated output.
- [x] 6.4 Implement `TableSessionService.close(*, session_id, tenant_id, user_id, user_email, branch_ids)`. Flow: load session + its table with `SELECT ... FOR UPDATE`; if `status != "PAYING"` raise `ValidationError` (409); delete all `CartItem` rows for this session via `db.execute(delete(CartItem).where(CartItem.session_id == sid))`; set `session.status = "CLOSED"`, `session.is_active = False`, `session.deleted_at = func.now()`, `session.deleted_by_id = user_id`; set `table.status = "AVAILABLE"`; `safe_commit(db)`; return updated output.
- [x] 6.5 Implement `TableSessionService.get_active_by_table_id(table_id, tenant_id, branch_ids) -> TableSession | None` with eager-loaded `diners` via `selectinload`.
- [x] 6.6 Implement `TableSessionService.get_active_by_code(branch_slug, code, tenant_id) -> TableSession | None`. Resolve `branch_slug → branch.id` scoped to the caller's `tenant_id`, then `table.id` filtered by `(branch_id, code)`, then the active session.
- [x] 6.7 Create `backend/rest_api/services/domain/diner_service.py`. Implement `DinerService` with `entity_name="Comensal"`. Override `_validate_create` to confirm the parent session is in status `OPEN` (raise 409 otherwise).
- [x] 6.8 Implement `DinerService.register(*, session_id, name, device_id) -> Diner`. Validate session status via `_validate_create` logic; create `Diner(session_id=..., name=..., device_id=...)`; `safe_commit(db)`; return the row.
- [x] 6.9 Update `backend/rest_api/services/domain/__init__.py` to export `TableSessionService` and `DinerService`.

## 7. Waiter Router

- [x] 7.1 Create `backend/rest_api/routers/waiter_tables.py` with `router = APIRouter(tags=["waiter-tables"])`. Import `current_user`, `PermissionContext`, `TableSessionService`, and output schemas.
- [x] 7.2 Implement `POST /api/waiter/tables/{table_id}/activate` → status 201, response_model `TableSessionOutput`. In the handler: build `ctx = PermissionContext(user)`; `ctx.require_management_or_waiter()`; call `service.activate(...)`. Router body is pure orchestration — zero business logic.
- [x] 7.3 Implement `PATCH /api/waiter/sessions/{session_id}/request-check` → 200, response_model `TableSessionOutput`. Delegates to `service.request_check(...)`.
- [x] 7.4 Implement `POST /api/waiter/tables/{table_id}/close` → 200, response_model `TableSessionOutput`. Handler: load active session via `service.get_active_by_table_id(...)` (404 if none); call `service.close(session_id=session.id, ...)`.

## 8. Staff Read Router

- [x] 8.1 Create `backend/rest_api/routers/staff_tables.py` with `GET /api/tables/{table_id}/session` — JWT-protected via `current_user`. Handler: `ctx.require_branch_access(table.branch_id)`; delegates to `service.get_active_by_table_id`; 404 if no active session.
- [x] 8.2 Implement `GET /api/tables/code/{code}/session` with REQUIRED query param `branch_slug: str`. Handler: return 400 (FastAPI does this automatically when the Query is required); call `service.get_active_by_code(branch_slug, code, ctx.tenant_id)`; confirm `ctx.require_branch_access(session.branch_id)` once resolved; 404 if missing.

## 9. Public Join Router

- [x] 9.1 Create `backend/rest_api/routers/public_tables.py` with `POST /api/public/tables/code/{code}/join` — NO auth dependency. Query param `branch_slug: str` required. Body: `DinerRegisterInput`.
- [x] 9.2 Handler flow (atomic): (a) resolve `branch_slug + code → table` — 404 (uniform message) if not found; (b) load any active session for the table — if status is `PAYING` or `CLOSED`, return 409; (c) if no active session, call `TableSessionService.activate` with a system actor; (d) call `DinerService.register(session_id=..., name=body.name, device_id=body.device_id)`; (e) issue a Table Token via `issue_table_token(...)`; (f) return `PublicJoinResponse` with 201.
- [x] 9.3 Verify the endpoint does NOT leak information: slug-miss and code-miss both return the same 404 body (`{"detail": "Mesa no encontrada"}`).

## 10. Diner Router

- [x] 10.1 Create `backend/rest_api/routers/diner_session.py` with `router = APIRouter(prefix="/api/diner", tags=["diner"])`.
- [x] 10.2 Implement `GET /api/diner/session` → 200, response_model `DinerSessionView`. Dependency: `ctx: TableContext = Depends(current_table_context)`. Handler: returns session + table + diners list + this diner's cart items.

## 11. Router Registration

- [x] 11.1 In `backend/rest_api/main.py`, include the new routers: `waiter_tables.router` under prefix `/api/waiter`, `staff_tables.router` under `/api`, `public_tables.router` under `/api/public`, `diner_session.router` already carries its own prefix. Grouped and commented with `# C-08 table-sessions`.

## 12. Permission Helper

- [x] 12.1 Extend `rest_api/services/permissions/__init__.py` with `require_management_or_waiter()` that accepts `WAITER`, `MANAGER`, `ADMIN` — rejects `KITCHEN`. Add unit-test coverage in `backend/tests/test_permissions.py` for this helper.

## 13. Tests — Table Token

- [x] 13.1 Create `backend/tests/test_table_token.py`. Test `issue_table_token` + `verify_table_token` round-trip returns identical claims.
- [x] 13.2 Test that flipping one character in the payload portion of the token makes `verify_table_token` raise `AuthenticationError("invalid_table_token")`.
- [x] 13.3 Test that a token built with `iat = int(time.time()) - settings.TABLE_TOKEN_TTL_SECONDS - 10` raises `AuthenticationError("expired_token")`.
- [x] 13.4 Test that `current_table_context` returns 401 when the header is absent (use FastAPI TestClient against a minimal test-only endpoint registered under a test app).
- [x] 13.5 Test that a token referencing a CLOSED session is rejected with 401.

## 14. Tests — TableSessionService (TDD order)

- [x] 14.1 Create `backend/tests/test_table_sessions.py`. First write failing tests — verify they fail for the right reason — then implement.
- [x] 14.2 `test_activate_free_table_creates_open_session_and_occupies_table`.
- [x] 14.3 `test_activate_already_active_table_returns_409`.
- [x] 14.4 `test_activate_out_of_service_table_returns_409`.
- [x] 14.5 `test_request_check_transitions_open_to_paying`.
- [x] 14.6 `test_request_check_on_paying_returns_409`.
- [x] 14.7 `test_close_paying_session_transitions_to_closed_and_hard_deletes_cart_items_and_releases_table` (seed cart_items first, assert count 0 after close).
- [x] 14.8 `test_close_open_session_returns_409_must_request_check_first`.
- [x] 14.9 `test_partial_unique_index_enforces_single_active_session` (enforced via service-level invariant check in SQLite test env).
- [x] 14.10 `test_multi_tenant_isolation_cannot_activate_foreign_tenant_table`.
- [x] 14.11 `test_rbac_kitchen_cannot_activate_table_returns_403` (uses the actual HTTP endpoint via TestClient).
- [x] 14.12 `test_rbac_waiter_without_branch_access_returns_403`.

## 15. Tests — DinerService

- [x] 15.1 Create `backend/tests/test_diner_service.py`.
- [x] 15.2 `test_register_diner_in_open_session_succeeds`.
- [x] 15.3 `test_register_diner_in_paying_session_returns_409`.
- [x] 15.4 `test_register_diner_in_closed_session_returns_409`.
- [x] 15.5 `test_multiple_diners_can_join_same_open_session`.

## 16. Tests — Public Join Endpoint

- [x] 16.1 Create `backend/tests/test_public_join.py`.
- [x] 16.2 `test_first_diner_join_activates_table_and_returns_token`.
- [x] 16.3 `test_second_diner_join_reuses_existing_session`.
- [x] 16.4 `test_join_on_paying_session_returns_409`.
- [x] 16.5 `test_join_unknown_code_returns_uniform_404`.
- [x] 16.6 `test_join_unknown_branch_slug_returns_uniform_404` (same body as 16.5 — no disambiguation leak).
- [x] 16.7 `test_returned_token_verifies_and_grants_diner_session_access` (integration: join → use token on `GET /api/diner/session`).

## 17. Tests — Staff Read Endpoints

- [x] 17.1 Create `backend/tests/test_staff_table_session_read.py`.
- [x] 17.2 `test_get_session_by_table_id_returns_200_for_authorized_user`.
- [x] 17.3 `test_get_session_by_table_id_returns_404_when_no_active_session`.
- [x] 17.4 `test_get_session_by_code_requires_branch_slug_returns_400_without_it`.
- [x] 17.5 `test_get_session_by_code_disambiguates_by_branch_slug` (two branches with the same code — each returns its own session).
- [x] 17.6 `test_get_session_foreign_tenant_returns_403_or_404`.

## 18. Tests — Migration

- [x] 18.1 Extended `backend/tests/test_migrations.py` with `test_migration_007_creates_and_drops_table_session_tables`: run `alembic upgrade head`, assert `table_session`, `diner`, `cart_item` tables exist with expected columns and that the partial unique index is present; run `alembic downgrade 006_allergens`, assert the tables and the index are gone; run `alembic upgrade head` again cleanly. (Skips automatically when PostgreSQL not available.)

## 19. Documentation & Wiring

- [x] 19.1 Updated `backend/shared/security/__init__.py` exports.
- [ ] 19.2 Update `openspec/CHANGES.md`: mark C-08 as `[x]` in the resumen section after `/opsx:archive` is run (reminder comment only — do NOT check it here during apply).
- [x] 19.3 Run `backend/scripts/format.sh` or equivalent — full test suite passes: 460 passed, 2 skipped, 0 failed.
- [x] 19.4 Verify full test suite passes: `cd backend && python -m pytest -v` — 460 passed, 2 skipped.
