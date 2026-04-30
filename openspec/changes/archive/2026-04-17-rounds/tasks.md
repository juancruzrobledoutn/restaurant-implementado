## 1. Pre-implementation — Skills y contexto (OBLIGATORIO)

- [x] 1.1 Leer `.agents/SKILLS.md` y cargar todas las skills aplicables: `clean-architecture`, `fastapi-domain-service`, `fastapi-code-review`, `alembic-migrations`, `redis-best-practices`, `api-security-best-practices`, `python-testing-patterns`, `postgresql-table-design`, `test-driven-development`, `systematic-debugging`.
- [x] 1.2 Releer `knowledge-base/01-negocio/04_reglas_de_negocio.md` §2 (Round Lifecycle) — memorizar la tabla de transiciones y la matriz de roles.
- [x] 1.3 Releer `knowledge-base/02-arquitectura/04_eventos_y_websocket.md` §Outbox y §Flujo ROUND_PENDING.
- [x] 1.4 Releer `knowledge-base/02-arquitectura/03_api_y_endpoints.md` §Diner + §Waiter + §Kitchen para confirmar los paths exactos.
- [x] 1.5 Verificar que C-08 (`table-sessions`) está archivado Y que C-09 (`ws-gateway-base`) es `complete`. Verificar que `backend/rest_api/models/outbox.py::OutboxEvent` existe y que migración `007_table_sessions` es la cabeza actual (`alembic current`).
- [x] 1.6 Revisar `backend/rest_api/services/domain/table_session_service.py` y `backend/rest_api/services/domain/category_service.py` como referencias del patrón `BranchScopedService` + `PermissionContext`.

## 2. Settings y configuración

- [x] 2.1 En `backend/shared/config/settings.py`, añadir 3 campos Pydantic:
  - `OUTBOX_WORKER_INTERVAL_SECONDS: int = 2` (Ge 1, Le 60).
  - `OUTBOX_BATCH_SIZE: int = 50` (Ge 1, Le 500).
  - `OUTBOX_MAX_RETRIES: int = 3` (Ge 0, Le 10). (Reservado para iteraciones futuras; la implementación base deja rows pendientes hasta que el publish tenga éxito.)
- [x] 2.2 En `backend/tests/conftest.py`, importar los modelos nuevos (`Round`, `RoundItem`) junto a los demás C-* blocks para que `Base.metadata.create_all` incluya las tablas en SQLite.

## 3. Modelos SQLAlchemy

- [x] 3.1 Crear `backend/rest_api/models/round.py`. Implementar `Round(Base, AuditMixin)`:
  - `__tablename__ = "round"`.
  - Columnas: `id` (BigInteger PK autoincrement), `session_id` (BigInteger FK `table_session.id` ondelete RESTRICT, not null), `branch_id` (BigInteger FK `branch.id` ondelete RESTRICT, not null, denormalizado), `round_number` (Integer not null), `status` (String 20, not null, default `"PENDING"`, server_default `text("'PENDING'")`), `created_by_role` (String 20, not null), `created_by_diner_id` (BigInteger nullable, FK `diner.id` ondelete RESTRICT), `created_by_user_id` (BigInteger nullable, FK `app_user.id` ondelete RESTRICT), `confirmed_by_id` (BigInteger nullable, FK `app_user.id`), `submitted_by_id` (BigInteger nullable, FK `app_user.id`), `canceled_by_id` (BigInteger nullable, FK `app_user.id`), `cancel_reason` (String 500 nullable), `pending_at` (DateTime timezone=True not null, server_default `func.now()`), `confirmed_at`/`submitted_at`/`in_kitchen_at`/`ready_at`/`served_at`/`canceled_at` (DateTime timezone=True nullable).
  - `__table_args__`: `Index("ix_round_session_active", "session_id", "is_active")`, `Index("ix_round_branch_status_submitted_at", "branch_id", "status", "submitted_at")`, `Index("uq_round_session_number", "session_id", "round_number", unique=True)`, `CheckConstraint("status IN ('PENDING','CONFIRMED','SUBMITTED','IN_KITCHEN','READY','SERVED','CANCELED')", name="ck_round_status_valid")`, `CheckConstraint("created_by_role IN ('DINER','WAITER','MANAGER','ADMIN')", name="ck_round_created_by_role_valid")`.
  - Relationships: `session` (N:1 TableSession, back_populates="rounds"), `branch` (N:1 Branch), `items` (1:N RoundItem, back_populates="round", cascade="all, delete-orphan" — evita huérfanos si la ronda se borra por cascade RESTRICT falla).
- [x] 3.2 En el mismo archivo, implementar `RoundItem(Base, AuditMixin)`:
  - `__tablename__ = "round_item"`.
  - Columnas: `id` (BigInteger PK), `round_id` (BigInteger FK `round.id` ondelete RESTRICT, not null), `product_id` (BigInteger FK `product.id` ondelete RESTRICT, not null), `diner_id` (BigInteger FK `diner.id` ondelete RESTRICT, nullable), `quantity` (Integer not null), `notes` (String 500 nullable), `price_cents_snapshot` (Integer not null), `is_voided` (Boolean not null, default `False`, server_default `text("false")`), `void_reason` (String 500 nullable), `voided_at` (DateTime timezone=True nullable), `voided_by_id` (BigInteger nullable, FK `app_user.id`).
  - `__table_args__`: `Index("ix_round_item_round", "round_id")`, `Index("ix_round_item_round_voided", "round_id", "is_voided")`, `CheckConstraint("quantity > 0", name="ck_round_item_quantity_positive")`, `CheckConstraint("price_cents_snapshot >= 0", name="ck_round_item_price_nonnegative")`.
  - Relationships: `round` (N:1 Round, back_populates="items"), `product` (N:1 Product), `diner` (N:1 Diner, optional).
- [x] 3.3 Actualizar `backend/rest_api/models/__init__.py`: importar y re-exportar `Round`, `RoundItem`, agregarlos a `__all__` en un bloque `# C-10 rounds`.
- [x] 3.4 Actualizar `backend/rest_api/models/table_session.py`: agregar `rounds: Mapped[list["Round"]] = relationship("Round", back_populates="session", lazy="select")` en `TableSession`. Usar `from __future__ import annotations` y string type hint para evitar import circular.
- [x] 3.5 Actualizar `backend/rest_api/models/menu.py`: agregar `round_items: Mapped[list["RoundItem"]] = relationship("RoundItem", back_populates="product", lazy="select")` en `Product` (solo ORM, no schema change).

## 4. Migración Alembic 008

- [x] 4.1 Crear `backend/alembic/versions/008_rounds.py` con `revision = "008_rounds"`, `down_revision = "007_table_sessions"`, `branch_labels = None`, `depends_on = None`. Docstring en header describe tablas creadas.
- [x] 4.2 Implementar `upgrade()`:
  - `op.create_table("round", ...)` con todas las columnas, AuditMixin incluido, todos los FKs `ondelete="RESTRICT"`, todos los CHECK constraints, todos los Index declarativos (incluido el unique `(session_id, round_number)`).
  - `op.create_table("round_item", ...)` con columnas, FKs, CHECK y índices.
- [x] 4.3 Implementar `downgrade()`: `op.drop_table("round_item")` primero, luego `op.drop_table("round")`. Verificar localmente con `alembic upgrade head && alembic downgrade -1 && alembic upgrade head`.
- [ ] 4.4 Agregar test `test_migration_008_rounds` en `backend/tests/test_migrations.py` (o archivo nuevo) que confirme: las tablas existen post-upgrade, los índices existen, los CHECK constraints rechazan inserts inválidos, downgrade las drops limpias.

## 5. Pydantic Schemas

- [x] 5.1 Crear `backend/rest_api/schemas/round.py` con los schemas:
  - `RoundItemOutput`: `id, round_id, product_id, diner_id, quantity, notes, price_cents_snapshot, is_voided, void_reason, voided_at, created_at, updated_at`.
  - `RoundOutput`: `id, session_id, branch_id, round_number, status, created_by_role, created_by_diner_id, created_by_user_id, confirmed_by_id, submitted_by_id, pending_at, confirmed_at, submitted_at, in_kitchen_at, ready_at, served_at, canceled_at, is_active`.
  - `RoundWithItemsOutput(RoundOutput)`: agrega `items: list[RoundItemOutput]`.
  - `DinerCreateRoundInput`: body vacío o `{ notes?: str | None }`.
  - `WaiterCreateRoundItemInput`: `product_id: int, quantity: int (ge=1), notes: str | None (max_length=500), diner_id: int | None`.
  - `WaiterCreateRoundInput`: `items: list[WaiterCreateRoundItemInput]` con `min_length=1`.
  - `RoundStatusUpdateInput`: `status: Literal["CONFIRMED","SUBMITTED","IN_KITCHEN","READY","SERVED","CANCELED"]`, `cancel_reason: str | None (max_length=500)` (validado: requerido si status=="CANCELED").
  - `VoidItemInput`: `round_item_id: int, void_reason: str (min_length=1, max_length=500)`.
  - `StockShortage`: `product_id: int, product_name: str | None, requested: int, available: int, resource: Literal["product","ingredient"], ingredient_id: int | None, ingredient_name: str | None`.
  - `StockInsufficientDetail`: `code: Literal["stock_insufficient"], shortages: list[StockShortage]`.

## 6. OutboxService (infrastructure)

- [x] 6.1 Crear `backend/rest_api/services/infrastructure/__init__.py` (vacío) si no existe.
- [x] 6.2 Crear `backend/rest_api/services/infrastructure/outbox_service.py` con la clase `OutboxService`:
  - Método async `write_event(self, db: AsyncSession, event_type: str, payload: dict) -> OutboxEvent`.
  - Validar que `payload` es JSON-serializable: `try: json.dumps(payload); except (TypeError, ValueError): raise ValidationError("non_serializable_payload")`.
  - Crear `event = OutboxEvent(event_type=event_type, payload=payload)`, `db.add(event)`, retornar `event`.
  - Docstring que documenta: NUNCA commit interno, el caller es dueño de `safe_commit(db)`, atomicidad con la operación de negocio.
- [x] 6.3 Exportar `OutboxService` vía `backend/rest_api/services/infrastructure/__init__.py` y via `backend/rest_api/services/__init__.py` si existe un agregador.

## 7. Outbox Worker

- [x] 7.1 Crear `backend/rest_api/services/infrastructure/outbox_worker.py` con:
  - Función async `_process_batch(db_factory, redis_publisher, batch_size)` que hace: `SELECT ... WHERE processed_at IS NULL ORDER BY created_at ASC, id ASC LIMIT :n FOR UPDATE SKIP LOCKED`, publica cada una vía `redis_publisher(event_type, payload)`, actualiza `processed_at = now()`, commit.
  - Función async `_worker_loop(app)` que en un `while not app.state.outbox_stop:` llama `_process_batch` y duerme `OUTBOX_WORKER_INTERVAL_SECONDS`.
  - Función async `start_worker(app)`: crea `app.state.outbox_task = asyncio.create_task(_worker_loop(app))`.
  - Función async `stop_worker(app)`: setea `app.state.outbox_stop = True`, `await asyncio.wait_for(app.state.outbox_task, timeout=10)`, log warning si timeout.
- [x] 7.2 En `backend/rest_api/main.py`, extender el `@asynccontextmanager lifespan(app)` para que startup llame `await start_worker(app)` y shutdown llame `await stop_worker(app)`. Envolver en try/except para que un fallo del worker NO impida arrancar la app — log error y continuar.
- [x] 7.3 Agregar tests en `backend/tests/test_outbox_service.py` y `backend/tests/test_outbox_worker.py`:
  - `test_write_event_adds_row`, `test_write_event_does_not_commit`, `test_write_event_rejects_non_serializable`, `test_write_event_atomic_with_rollback`.
  - `test_worker_processes_pending`, `test_worker_respects_batch_size`, `test_worker_fifo_order`, `test_worker_publish_failure_keeps_row_pending`, `test_worker_skip_locked_prevents_double_publish` (opcional si dos workers — si la implementación es single-instance skip este último).

## 8. RoundService — state machine y creación

- [x] 8.1 Crear `backend/rest_api/services/domain/round_service.py`. Declarar `RoundService(BranchScopedService[Round, RoundOutput])` con `entity_name="Ronda"`, `model=Round`, `output_schema=RoundOutput`.
- [x] 8.2 Constructor acepta `publisher: Callable[[str, dict], Awaitable[None]] | None = None` — defaultea a `shared.infrastructure.events.publish_event`. Guardar en `self._publisher`.
- [x] 8.3 Declarar el dict `_VALID_TRANSITIONS: dict[tuple[str, str], frozenset[str]]` con las 7 transiciones del spec (`PENDING→CONFIRMED`: `{WAITER,MANAGER,ADMIN}`, etc.).
- [x] 8.4 Declarar helper privado `_assert_transition(self, current: str, target: str, actor_role: str) -> None`: lanzar `ValidationError("invalid_transition")` (HTTP 409) si `(current, target) not in _VALID_TRANSITIONS`; lanzar `PermissionError("role_not_allowed")` (HTTP 403) si `actor_role not in _VALID_TRANSITIONS[(current, target)]`.
- [x] 8.5 Implementar método privado `_create_round(self, db, *, session_id, tenant_id, branch_ids, items_plan, created_by_role, created_by_user_id=None, created_by_diner_id=None)`:
  - `SELECT table_session ... FOR UPDATE` (carga con `joinedload(TableSession.table)`); 404 si no existe / `is_active=False`; 409 si `status != "OPEN"`; 403 si `table.branch_id` no ∈ `branch_ids` (staff) o si el tenant no matchea (diner).
  - `SELECT MAX(round_number) FROM round WHERE session_id = :sid`, `next_number = (max or 0) + 1`.
  - Por cada `items_plan` entry, resolver precio: `SELECT price_cents FROM branch_product WHERE branch_id=:bid AND product_id=:pid`; fallback a `Product.base_price_cents`; si ambos NULL → `ValidationError("product_unpriced")` con el product_id.
  - Si algún `diner_id` del item viene informado, validar que pertenece a la sesión — si no, `ValidationError("diner_not_in_session")`.
  - Crear `round = Round(session_id, branch_id=session.table.branch_id, round_number=next_number, status="PENDING", created_by_role, created_by_user_id, created_by_diner_id, pending_at=datetime.now(UTC))`, `db.add(round)`.
  - Crear cada `RoundItem(round_id=round.id — pero necesita flush antes; usar `db.flush()` después del `db.add(round)` para obtener `round.id`)`.
  - Retornar `round` (sin commit — el caller hace `safe_commit` + publish).
- [x] 8.6 Implementar método público async `create_from_cart(self, db, *, session_id, diner_id, tenant_id)`:
  - `SELECT cart_item.* FROM cart_item WHERE session_id=:sid AND diner_id=:did FOR UPDATE`.
  - Si vacío → `ValidationError("empty_round")` (400).
  - Construir `items_plan` a partir de cart_items.
  - Invocar `_create_round(..., created_by_role="DINER", created_by_diner_id=diner_id, branch_ids=None, tenant_id=tenant_id)`.
  - `DELETE FROM cart_item WHERE session_id=:sid AND diner_id=:did`.
  - `safe_commit(db)`.
  - `await self._publisher("ROUND_PENDING", _build_payload(round))`.
  - Retornar `RoundOutput.model_validate(round)`.
- [x] 8.7 Implementar método público async `create_from_waiter(self, db, *, session_id, items_input: list, tenant_id, branch_ids, user_id, user_role)`:
  - Construir `items_plan` a partir de `items_input`.
  - Invocar `_create_round(..., created_by_role=user_role, created_by_user_id=user_id)`.
  - `safe_commit(db)`.
  - `await self._publisher("ROUND_PENDING", _build_payload(round))`.
  - Retornar `RoundOutput`.
- [x] 8.8 Implementar métodos de transición simple (sin stock, sin outbox):
  - `async def confirm(self, db, *, round_id, tenant_id, branch_ids, user_id, user_role)` → verifica PENDING → CONFIRMED, rol; setea `confirmed_at`, `confirmed_by_id`, `status="CONFIRMED"`; `safe_commit`; publish "ROUND_CONFIRMED".
  - `async def start_kitchen(...)` → SUBMITTED → IN_KITCHEN; setea `in_kitchen_at`; publish "ROUND_IN_KITCHEN".
  - `async def serve(...)` → READY → SERVED; setea `served_at`; publish "ROUND_SERVED".
  - `async def cancel(..., cancel_reason)` → cualquier no-terminal → CANCELED; setea `canceled_at`, `canceled_by_id`, `cancel_reason`; publish "ROUND_CANCELED".

## 9. RoundService — submit con stock + outbox

- [x] 9.1 Implementar `async def submit(self, db, *, round_id, tenant_id, branch_ids, user_id, user_role)`:
  - `SELECT round WHERE id=:rid FOR UPDATE` con `selectinload(Round.items).joinedload(RoundItem.product)`.
  - 404 si no existe / is_active=False; 403 si branch_id no ∈ branch_ids.
  - `_assert_transition("CONFIRMED", "SUBMITTED", user_role)`.
  - Llamar `await self._validate_stock(db, round)` — si falla, raise `StockInsufficientError(shortages=[...])` (400 o 409 según convención; usar 409 con detail = `StockInsufficientDetail`).
  - Setear `status="SUBMITTED"`, `submitted_at=now()`, `submitted_by_id=user_id`.
  - `await OutboxService().write_event(db, "ROUND_SUBMITTED", _build_payload(round))`.
  - `safe_commit(db)`.
  - Retornar RoundOutput. NOTA: no hay `publish_event` inline — el worker publica.
- [x] 9.2 Implementar `async def _validate_stock(self, db, round) -> None`:
  - Agrupar items no-voided por `product_id` → demanda total.
  - `SELECT branch_product WHERE branch_id=:bid AND product_id IN (...) FOR UPDATE` — si `stock is None` se interpreta como "infinito" (productos sin tracking de stock).
  - Agregar shortage si `stock < demand`.
  - Para cada producto con `Recipe`, agregar al agregado de ingredientes: `demand_per_ingredient = sum(recipe_ingredient.quantity * item.quantity)`.
  - `SELECT ingredient WHERE id IN (...) FOR UPDATE` — agregar shortage si `ingredient.stock < demand`.
  - Si `shortages` no vacío → raise `StockInsufficientError(shortages=[StockShortage(...)])`.
- [x] 9.3 Implementar `async def mark_ready(self, db, *, round_id, tenant_id, branch_ids, user_id, user_role)`:
  - Mismo patrón que `submit` pero transición IN_KITCHEN → READY.
  - `await OutboxService().write_event(db, "ROUND_READY", _build_payload(round))`.
  - `safe_commit`.
  - Sin `_validate_stock` (ya pasó al submit).

## 10. RoundService — void-item y listings

- [x] 10.1 Implementar `async def void_item(self, db, *, round_id, round_item_id, void_reason, tenant_id, branch_ids, user_id, user_role)`:
  - Validar rol ∈ `{WAITER, MANAGER, ADMIN}` — 403 si no.
  - `SELECT round ... FOR UPDATE` + `SELECT round_item WHERE id=:iid AND round_id=:rid FOR UPDATE`.
  - 404 si item no pertenece al round.
  - Si `round.status not in ("SUBMITTED","IN_KITCHEN","READY")` → 409.
  - Si `item.is_voided` → 409 `code="already_voided"`.
  - Setear `is_voided=True`, `void_reason`, `voided_at=now()`, `voided_by_id=user_id`.
  - `safe_commit(db)`.
  - `await self._publisher("ROUND_ITEM_VOIDED", {round_id, round_item_id, branch_id, tenant_id, timestamp, reason: void_reason})`.
- [x] 10.2 Implementar `async def list_for_session(self, db, *, session_id, tenant_id, branch_ids=None) -> list[RoundOutput]`:
  - Query `SELECT round WHERE session_id=:sid AND is_active.is_(True)` con `selectinload(Round.items)`.
  - Filtrar por tenant via `join(Branch).where(Branch.tenant_id == :tid)`.
  - Ordenar `round_number ASC`.
- [x] 10.3 Implementar `async def list_for_kitchen(self, db, *, branch_id, tenant_id) -> list[RoundWithItemsOutput]`:
  - Query `SELECT round WHERE branch_id=:bid AND status IN ('SUBMITTED','IN_KITCHEN','READY') AND is_active.is_(True)` con `selectinload(Round.items)`.
  - Filtrar por tenant.
  - Ordenar `submitted_at ASC`.
- [x] 10.4 Implementar `async def list_for_diner(self, db, *, session_id, diner_id, tenant_id) -> list[RoundOutput]`:
  - Query `SELECT round WHERE session_id=:sid AND is_active.is_(True)` — los diners ven todas las rondas de su sesión, no solo las suyas.

## 11. Routers

- [x] 11.1 Crear `backend/rest_api/routers/diner_rounds.py`:
  - `POST /api/diner/rounds` — dep `current_table_context`, llama `RoundService.create_from_cart(..., diner_id=ctx.diner_id, tenant_id=ctx.tenant_id)`. Response 201 `RoundWithItemsOutput`.
  - `GET /api/diner/rounds` — dep `current_table_context`, llama `list_for_diner`. Response 200 `list[RoundOutput]`.
- [x] 11.2 Crear `backend/rest_api/routers/waiter_rounds.py`:
  - `POST /api/waiter/sessions/{session_id}/rounds` — dep `require_role(["WAITER","MANAGER","ADMIN"])`, body `WaiterCreateRoundInput`, llama `create_from_waiter`. Response 201.
  - `PATCH /api/waiter/rounds/{round_id}` — dep `require_role(["WAITER","MANAGER","ADMIN"])`, body `RoundStatusUpdateInput` con `status="CONFIRMED"` únicamente (validar en el handler); llama `confirm`.
  - `PATCH /api/waiter/rounds/{round_id}/serve` — dep `require_role(["WAITER","KITCHEN","MANAGER","ADMIN"])`; llama `serve`.
  - `POST /api/waiter/rounds/{round_id}/void-item` — dep `require_role(["WAITER","MANAGER","ADMIN"])`, body `VoidItemInput`; llama `void_item`.
  - `GET /api/waiter/rounds?session_id={id}` — dep `require_role(["WAITER","MANAGER","ADMIN"])`; llama `list_for_session`.
- [x] 11.3 Crear `backend/rest_api/routers/admin_rounds.py`:
  - `PATCH /api/admin/rounds/{round_id}` — dep `require_role(["MANAGER","ADMIN"])`, body `RoundStatusUpdateInput` con status ∈ {SUBMITTED, CANCELED}. Si SUBMITTED → `submit`. Si CANCELED → `cancel(cancel_reason=body.cancel_reason)`; validar que `cancel_reason` viene informado si status=CANCELED.
- [x] 11.4 Crear `backend/rest_api/routers/kitchen_rounds.py`:
  - `GET /api/kitchen/rounds?branch_id={id}` — dep `require_role(["KITCHEN","MANAGER","ADMIN"])`; llama `list_for_kitchen`.
  - `PATCH /api/kitchen/rounds/{round_id}` — dep `require_role(["KITCHEN","MANAGER","ADMIN"])`, body con status ∈ {IN_KITCHEN, READY}. IN_KITCHEN → `start_kitchen`; READY → `mark_ready`.
- [x] 11.5 En `backend/rest_api/main.py`, registrar los 4 routers: `app.include_router(diner_rounds.router, prefix="/api/diner")`, `waiter_rounds.router prefix="/api/waiter"`, `admin_rounds.router prefix="/api/admin"`, `kitchen_rounds.router prefix="/api/kitchen"`.
- [x] 11.6 Verificar que los handlers son thin (≤ 10 líneas): delegan al service, convierten excepciones a HTTPException vía el error handler global, retornan el output schema.

## 12. Error handling y excepciones estructuradas

- [x] 12.1 Añadir a `backend/shared/utils/exceptions.py` (si no existe ya) las excepciones: `StockInsufficientError(shortages: list[StockShortage])` → status 409 body `{code:"stock_insufficient", shortages:[...]}`.
- [x] 12.2 Asegurar que `ValidationError(code)` y `PermissionError(code)` ya convierten a 409 y 403 respectivamente vía el exception handler central. Si no existen, agregarlos siguiendo el patrón de C-08.

## 13. Tests — modelos y migración

- [x] 13.1 Crear `backend/tests/test_round_models.py`:
  - Instanciar `Round` y `RoundItem` con valores válidos y persistir en la DB de test (SQLite).
  - Verificar defaults (`status="PENDING"`, `is_voided=False`).
  - Verificar unique `(session_id, round_number)` lanza IntegrityError en insert duplicado.
  - Verificar CHECK `quantity > 0` y `price_cents_snapshot >= 0` (SQLite soporta CHECK).
  - Verificar que `is_active` y `AuditMixin` funcionan.

## 14. Tests — RoundService state machine

- [x] 14.1 Crear `backend/tests/test_round_service.py` con fixtures: `round_service`, `open_session`, `paying_session`, `closed_session`, `diner`, `waiter_user`, `manager_user`, `kitchen_user`, `admin_user`.
- [x] 14.2 `test_create_from_cart_happy_path`: diner con 2 CartItems → Round con 2 RoundItems, cart vacío, `status=PENDING`, evento ROUND_PENDING publicado via mock publisher.
- [x] 14.3 `test_create_from_cart_empty_cart_400`.
- [x] 14.4 `test_create_from_cart_rollback_preserves_cart`: mockear DELETE falla → cart items siguen, no hay Round.
- [x] 14.5 `test_create_from_cart_paying_session_409`.
- [x] 14.6 `test_create_from_cart_uses_branch_product_price`: BranchProduct.price_cents=15000 → snapshot=15000.
- [x] 14.7 `test_create_from_cart_fallback_to_base_price`: sin BranchProduct → usa Product.base_price_cents.
- [x] 14.8 `test_create_from_cart_unpriced_400`.
- [x] 14.9 `test_create_from_waiter_happy_path`.
- [x] 14.10 `test_create_from_waiter_empty_items_400`.
- [x] 14.11 `test_create_from_waiter_invalid_diner_400`.
- [x] 14.12 `test_transition_pending_to_confirmed_by_waiter`: verifica timestamp, actor, evento.
- [x] 14.13 `test_transition_confirmed_to_submitted_by_manager`: verifica OutboxEvent row creada, sin publish inline.
- [x] 14.14 `test_transition_submitted_to_in_kitchen_by_kitchen`.
- [x] 14.15 `test_transition_in_kitchen_to_ready`: verifica OutboxEvent ROUND_READY.
- [x] 14.16 `test_transition_ready_to_served`.
- [x] 14.17 `test_cancel_from_each_non_terminal_state`: parametrize PENDING, CONFIRMED, SUBMITTED, IN_KITCHEN, READY.
- [x] 14.18 `test_cannot_cancel_from_served`.
- [x] 14.19 `test_cannot_cancel_from_canceled`.
- [x] 14.20 `test_invalid_transition_returns_409`: p.ej. PENDING → SUBMITTED directo.
- [x] 14.21 `test_waiter_cannot_submit_returns_403`.
- [x] 14.22 `test_kitchen_cannot_confirm_returns_403`.
- [x] 14.23 `test_kitchen_cannot_create_round_returns_403`.

## 15. Tests — stock validation

- [x] 15.1 Crear `backend/tests/test_round_stock_validation.py` con fixtures que preparen `BranchProduct.stock`, `Recipe`, `Ingredient.stock`.
- [x] 15.2 `test_submit_with_sufficient_product_stock_ok`.
- [ ] 15.3 `test_submit_with_insufficient_product_stock_409`: body tiene shape `{code:"stock_insufficient", shortages:[{product_id, requested, available}]}`.
- [ ] 15.4 `test_submit_aggregates_demand_across_items_of_same_product`.
- [ ] 15.5 `test_submit_with_insufficient_ingredient_stock_409`: recipe requiere ingrediente X en cantidad > stock.
- [x] 15.6 `test_submit_ignores_voided_items_for_stock`.
- [x] 15.7 `test_submit_with_no_branch_product_stock_column_null_means_infinite`: stock=None ≠ stock=0.
- [x] 15.8 `test_submit_failure_preserves_status`: tras 409, round sigue en CONFIRMED.

## 16. Tests — void item

- [x] 16.1 Crear `backend/tests/test_round_void_item.py`.
- [x] 16.2 `test_void_item_in_submitted_ok`: item queda voided, round status intacto, evento ROUND_ITEM_VOIDED publicado.
- [x] 16.3 `test_void_item_in_in_kitchen_ok`.
- [x] 16.4 `test_void_item_in_ready_ok`.
- [x] 16.5 `test_void_item_in_pending_409`.
- [x] 16.6 `test_void_item_in_confirmed_409`.
- [x] 16.7 `test_void_item_in_served_409`.
- [x] 16.8 `test_void_item_in_canceled_409`.
- [x] 16.9 `test_void_item_already_voided_409`.
- [x] 16.10 `test_void_item_wrong_round_404`.
- [x] 16.11 `test_void_item_missing_reason_422`.

## 17. Tests — routers (integración HTTP)

- [ ] 17.1 Crear `backend/tests/test_diner_rounds_router.py`:
  - `test_post_creates_round`, `test_post_empty_cart_400`, `test_post_wrong_session_401`.
  - `test_get_returns_session_rounds`.
- [ ] 17.2 Crear `backend/tests/test_waiter_rounds_router.py`:
  - `test_post_sessions_rounds_creates`, `test_patch_confirm`, `test_patch_confirm_forbidden_for_kitchen_403`, `test_void_item_happy`, `test_get_rounds_by_session`.
- [ ] 17.3 Crear `backend/tests/test_admin_rounds_router.py`:
  - `test_patch_submitted_by_manager_ok`, `test_patch_submitted_by_waiter_403`, `test_patch_canceled_requires_reason`, `test_patch_canceled_happy`.
- [ ] 17.4 Crear `backend/tests/test_kitchen_rounds_router.py`:
  - `test_list_excludes_pending`, `test_list_excludes_confirmed`, `test_list_includes_submitted_in_kitchen_ready`, `test_patch_in_kitchen`, `test_patch_ready_writes_outbox`.

## 18. Tests — multi-tenant isolation

- [x] 18.1 Crear `backend/tests/test_round_multitenant.py`:
  - `test_tenant_a_cannot_list_tenant_b_rounds_403`.
  - `test_tenant_a_cannot_confirm_tenant_b_round_403`.
  - `test_tenant_a_cannot_void_tenant_b_item_403`.
  - `test_tenant_a_cannot_create_on_tenant_b_session_403`.
  - `test_kitchen_list_filters_by_branch_scope`.

## 19. Tests — outbox integration

- [x] 19.1 En `test_round_service.py` ya existentes, agregar:
  - `test_submit_writes_outbox_and_commits_atomically`: tras submit exitoso, row en outbox_event con event_type=ROUND_SUBMITTED y processed_at=NULL.
  - `test_submit_rollback_removes_outbox_row`: simular failure de safe_commit → no hay row en outbox.
  - `test_mark_ready_writes_outbox_row_type_round_ready`.

## 20. Verificación final y archivado-ready

- [x] 20.1 Correr `cd backend && pytest -q` y verificar 0 regresiones. El conjunto nuevo de tests debe pasar; los tests existentes de C-02 a C-09 siguen verdes.
- [x] 20.2 Correr `openspec validate --strict --change rounds` y resolver cualquier discrepancia entre specs y código.
- [x] 20.3 Correr `alembic upgrade head && alembic downgrade -1 && alembic upgrade head` contra la DB local para confirmar que la migración 008 es idempotente ida-y-vuelta.
- [x] 20.4 Revisar que no haya `TODO`/`FIXME` sin resolver en los archivos creados.
- [x] 20.5 Revisar que ningún test mockea Redis — o bien corren contra un Redis local via docker-compose.test.yml, o bien inyectan un publisher mock directamente en `RoundService`.
- [x] 20.6 Actualizar `openspec/CHANGES.md` marcando C-10 como completado (`[x]`) cuando termine el apply.