## 1. Pre-implementación — Skills y contexto (OBLIGATORIO)

- [x] 1.1 Leer `.agents/SKILLS.md` y cargar todas las skills aplicables a este change: `websocket-engineer`, `redis-best-practices`, `api-security-best-practices`, `fastapi-domain-service`, `clean-architecture`, `python-testing-patterns`, y cualquier otra que aplique según los tasks
- [x] 1.2 Releer `knowledge-base/02-arquitectura/04_eventos_y_websocket.md` (catálogo de eventos, routing, outbox)
- [x] 1.3 Releer `knowledge-base/02-arquitectura/01_arquitectura_general.md` §WS Gateway (composición + submódulos)
- [x] 1.4 Releer `knowledge-base/03-seguridad/01_modelo_de_seguridad.md` §WebSocket (close codes, revalidación, rate limiting)
- [x] 1.5 Releer `knowledge-base/07-anexos/07_estandar_calidad_gateway.md` (estándar de calidad y hallazgos de la auditoría)
- [x] 1.6 Verificar que C-08 (`table-sessions`) está archivado en `openspec/changes/archive/` y que `shared/security/table_token.py` con `verify_table_token()` existe en el repo

## 2. Scaffolding del servicio `ws_gateway/`

- [x] 2.1 Crear directorio `ws_gateway/` al tope del repo con subdirectorios `core/`, `components/auth/`, `components/connection/`, `components/events/`, `components/resilience/`, `routers/`, `tests/`
- [x] 2.2 Crear `ws_gateway/__init__.py` y todos los `__init__.py` de los subdirectorios
- [x] 2.3 Crear `ws_gateway/main.py` con `FastAPI(lifespan=...)`, incluyendo `app.include_router` para websocket, catchup y health
- [x] 2.4 Crear `ws_gateway/Dockerfile` (Python 3.12-slim, instala deps, expone 8001, `CMD uvicorn ws_gateway.main:app --host 0.0.0.0 --port 8001`)
- [x] 2.5 Agregar servicio `ws_gateway` a `devOps/docker-compose.yml` (puerto 8001, `depends_on: [redis]`, healthcheck contra `GET /health`)
- [x] 2.6 Actualizar `.env.example` en la raíz y en `devOps/` con todas las variables `WS_*` listadas en `proposal.md §Impact`
- [x] 2.7 Extender `backend/shared/config/settings.py` con las nuevas `WS_*` settings (Pydantic Settings, con defaults apropiados y `validate_production_secrets()` actualizado para exigir `WS_ALLOWED_ORIGINS` en producción)
- [x] 2.8 Verificar que `ws_gateway` arranca con `docker compose up ws_gateway` y responde `GET http://localhost:8001/health` con 200

## 3. Constantes y configuración central

- [x] 3.1 Crear `ws_gateway/core/constants.py` con: close codes (`WSCloseCode.NORMAL=1000`, `AUTH_FAILED=4001`, `FORBIDDEN=4003`, `RATE_LIMITED=4029`, `SERVER_ERROR=1011`, `GOING_AWAY=1001`), intervalos (`HEARTBEAT_INTERVAL=30`, `HEARTBEAT_TIMEOUT=60`, `JWT_REVALIDATION_INTERVAL=300`, `TABLE_TOKEN_REVALIDATION_INTERVAL=1800`, `CLEANUP_INTERVAL=60`), límites (`MAX_CONNECTIONS=1000`, `MAX_CONNECTIONS_PER_USER=3`, `BROADCAST_WORKERS=10`, `BROADCAST_QUEUE_SIZE=5000`, `CATCHUP_TTL=300`, `CATCHUP_MAX_EVENTS=100`), canales Redis (`CHANNEL_BRANCH_WAITERS="branch:{}:waiters"`, etc.), streams (`STREAM_CRITICAL="events:critical"`, `STREAM_GROUP="ws_gateway_group"`, `STREAM_DLQ="events:dlq"`, `STREAM_MAX_DELIVERIES=3`), `DEFAULT_CORS_ORIGINS` (localhost dev), `RATE_LIMIT_MSGS=30`, `RATE_LIMIT_WINDOW=1`
- [x] 3.2 Crear `ws_gateway/core/dependencies.py` con singletons FastAPI: `get_redis_pool()`, `get_connection_manager()`, `get_event_router()`, `get_circuit_breaker(resource)`, `get_settings()`
- [x] 3.3 Crear `ws_gateway/core/logger.py` que reexporte `get_logger()` de `backend/shared/` con un namespace `ws_gateway.*`

## 4. Circuit Breaker + Backoff (resilience)

- [x] 4.1 Crear `ws_gateway/components/resilience/circuit_breaker.py` con la clase `CircuitBreaker` (estados `CLOSED`/`OPEN`/`HALF_OPEN`, `failure_threshold=5`, `recovery_timeout=30`, métodos `can_execute()`, `record_success()`, `record_failure()`, thread-safe con `threading.Lock`, métricas `state_changes`, `rejected_calls`)
- [x] 4.2 Crear `ws_gateway/components/resilience/backoff.py` con `DecorrelatedJitter` (`base=1`, `cap=30`, jitter ±30%) para retries en reconexión del subscriber
- [x] 4.3 Crear `ws_gateway/tests/test_circuit_breaker.py` con tests: 5 fallos consecutivos → OPEN; durante OPEN `can_execute()` retorna False; transcurrido `recovery_timeout` → HALF_OPEN en próximo `can_execute()`; éxito en HALF_OPEN → CLOSED + reset counter; fallo en HALF_OPEN → OPEN nuevamente; thread-safety (múltiples threads record_failure concurrentes no pierden conteos)
- [x] 4.4 Crear `ws_gateway/tests/test_backoff.py` con tests: rango del jitter, monotonicidad del delay exponencial, respeta `cap`

## 5. Auth Strategies

- [x] 5.1 Crear `ws_gateway/components/auth/strategies.py` con: `AuthResult` (pydantic: `tenant_id`, `user_id`, `diner_id?`, `session_id?`, `table_id?`, `branch_ids`, `sector_ids`, `roles`, `expires_at`, `token_type`), `AuthStrategy` ABC (`async authenticate(token) -> AuthResult`, `async revalidate(auth_result) -> AuthResult`, `revalidation_interval -> int`)
- [x] 5.2 Implementar `JWTAuthStrategy`: usa `shared.security.auth.verify_jwt_claims()`, verifica blacklist Redis `jwt:blacklist:{jti}` con fail-closed, extrae `roles` y valida contra `allowed_roles` del endpoint, retorna `AuthResult` con `branch_ids` del JWT
- [x] 5.3 Implementar `TableTokenAuthStrategy`: usa `shared.security.table_token.verify_table_token()`, verifica HMAC + TTL, verifica estado de sesión no-CLOSED (consulta via Redis cache `session:{id}:status` poblado por backend REST o HTTP call al backend si cache miss — **decidir en review**; simplificación aceptable en C-09: aceptar token válido y confiar en que el backend revoca al cerrar sesión vía blacklist)
- [x] 5.4 Implementar `CompositeAuthStrategy(*strategies)`: chain of responsibility, try each, primera que no raise gana
- [x] 5.5 Implementar `NullAuthStrategy`: retorna `AuthResult` sintético, **solo para tests**; `ws_gateway/main.py` verifica `ENVIRONMENT != "production"` o falla al arrancar si un router está configurado con `NullAuthStrategy`
- [x] 5.6 Crear `ws_gateway/components/auth/revalidation.py` con `AuthRevalidator`: tarea background que recorre conexiones activas y llama a `strategy.revalidate()` cuando `now - last_revalidated > revalidation_interval`; cierra con 4001 si falla
- [x] 5.7 Crear `ws_gateway/tests/test_auth_strategies.py` con casos: JWT válido aceptado; JWT expirado rechazado (4001); JWT blacklisted rechazado; Redis caído durante blacklist → fail-closed (4001); rol incorrecto para endpoint (rechazado antes de establecer conexión — test a nivel de strategy); Table Token válido; Table Token tampered (HMAC inválido); Table Token expirado; `NullAuthStrategy` rechazada en production; `CompositeAuthStrategy` prueba ambas y gana la primera exitosa
- [x] 5.8 Crear `ws_gateway/tests/test_revalidation.py` con tests: revalidación exitosa no afecta conexión; revalidación falla → close 4001; intervalo respetado (mock `time.time()`)

## 6. ConnectionIndex + ConnectionStats + Sharded Locks

- [x] 6.1 Crear `ws_gateway/components/connection/index.py` con `ConnectionIndex`: dicts `_by_user: dict[int, set[Connection]]`, `_by_branch: dict[tuple[int,int], set[Connection]]` (key = `(tenant_id, branch_id)`), `_by_sector: dict[tuple[int,int,int], set[Connection]]`, `_by_session: dict[int, set[Connection]]`, `_all: set[Connection]`. Métodos: `register`, `unregister`, `get_by_branch(tenant_id, branch_id)`, `get_by_session(session_id)`, `get_by_sector(tenant_id, branch_id, sector_id)`, `get_by_user(user_id)`, `count_total()`, `count_by_user(user_id)`
- [x] 6.2 Agregar `get_tenant_branch_lock(tenant_id, branch_id) -> asyncio.Lock` usando `WeakValueDictionary` con clave `(tenant_id, branch_id)`; los locks se GC'ean cuando no hay referencias
- [x] 6.3 Crear `ws_gateway/components/connection/stats.py` con `ConnectionStats`: counters `active_connections`, `total_connections_opened`, `total_connections_closed`, `messages_sent`, `messages_failed`, `broadcast_latency_p95`, `circuit_breaker_states` (dict por recurso), `worker_pool_stats` (dict)
- [x] 6.4 Crear `ws_gateway/tests/test_connection_index.py` con casos: register + get_by_branch retorna la conexión; register con `tenant_id=1, branch_id=1` no aparece en query `tenant_id=2, branch_id=1` (multi-tenant isolation); unregister elimina de todos los índices; `count_by_user` devuelve conteo correcto; `get_by_sector` filtra correctamente
- [x] 6.5 Crear `ws_gateway/tests/test_locks.py` con casos: `get_tenant_branch_lock(1,1)` devuelve el mismo lock dos veces; `get_tenant_branch_lock(1,1)` y `get_tenant_branch_lock(1,2)` devuelven locks distintos; GC del lock cuando no hay referencias activas

## 7. Rate Limiter + Heartbeat

- [x] 7.1 Crear `ws_gateway/components/connection/rate_limiter.py` con `RateLimiter` que usa Redis + Lua script atómico: key `ws:ratelimit:{user_or_diner_id}:{device_id}`, `INCR` + `EXPIRE` en una operación, retorna si `count > RATE_LIMIT_MSGS`
- [x] 7.2 Agregar `RateLimiter.mark_abusive(user_id, ttl=60)` que `SETEX ws:abusive:{user_id} 60 "1"` y `is_abusive(user_id)` que `EXISTS` esa key; durante `is_abusive` nuevas conexiones rechazadas con 4029
- [x] 7.3 Crear `ws_gateway/components/connection/heartbeat.py` con `HeartbeatTracker`: `last_seen: dict[connection_id, float]`, `update(connection_id)`, `is_stale(connection_id, timeout=60)`, `cleanup_stale() -> list[connection_id]`
- [x] 7.4 Crear `ws_gateway/tests/test_rate_limiter.py` con tests: 30 msgs dentro de ventana → OK; 31 msg → close 4029; reconexión con mismo `user_id`/`device_id` no resetea counter (comportamiento clave); después del window expiry → counter reset; Lua atomicidad (concurrencia: 100 tareas paralelas intentando 30 msg cada una, el total bloqueado es exacto)
- [x] 7.5 Crear `ws_gateway/tests/test_heartbeat.py` con tests: `update` actualiza `last_seen`; `is_stale` retorna True después de timeout; `cleanup_stale` devuelve sólo las conexiones vencidas; cualquier mensaje (no sólo ping) resetea el timer

## 8. ConnectionBroadcaster (Worker Pool)

- [x] 8.1 Crear `ws_gateway/components/connection/broadcaster.py` con `ConnectionBroadcaster`: `asyncio.Queue(maxsize=5000)`, `start_workers(n=10)`, `stop_workers()`, `enqueue(connection, message)`, `broadcast(connections, message)` que mete todos en la cola. Cada worker: `while running: (conn, msg) = await queue.get(); try: await asyncio.wait_for(conn.websocket.send_text(json.dumps(msg)), timeout=5); self.observer.record_success() except: conn.mark_dead(); self.observer.record_failure()`
- [x] 8.2 Implementar fallback `_broadcast_batch(connections, message)` cuando `queue.full()`: `for chunk in batches(connections, 50): await asyncio.gather(*[send_one(c, msg) for c in chunk], return_exceptions=True)`. Loggear warning cuando se activa fallback
- [x] 8.3 Crear `BroadcastObserver` con `record_success(worker_id, latency_ms)`, `record_failure(worker_id, reason)`, agrega a `ConnectionStats`
- [x] 8.4 Crear `ws_gateway/tests/test_broadcaster.py` con tests: broadcast a 100 conexiones OK (todas reciben); slow consumer (5.5s) se marca dead y los demás entregan; queue full → activa fallback y entrega; `stop_workers` drena la cola y termina; 400 conexiones delivered en <500ms (p95)

## 9. ConnectionLifecycle + ConnectionCleanup + ConnectionManager facade

- [x] 9.1 Crear `ws_gateway/components/connection/connection.py` con la dataclass `Connection`: `websocket`, `auth: AuthResult`, `connection_id: str (uuid)`, `opened_at`, `last_revalidated_at`, `is_dead: bool`, `mark_dead()`
- [x] 9.2 Crear `ws_gateway/components/connection/lifecycle.py` con `ConnectionLifecycle.accept(websocket, auth) -> Connection`: 1) chequear `count_total() < MAX_CONNECTIONS`; 2) chequear `count_by_user(auth.user_id) < MAX_CONNECTIONS_PER_USER`; 3) `RateLimiter.is_abusive(auth.user_id)` → rechazar; 4) `await websocket.accept()`; 5) tomar locks en orden `tenant_branch_lock → user_lock → connection_lock`; 6) `index.register(conn)`; 7) retornar `Connection`. `disconnect(conn, code)` hace lo inverso con mismo lock ordering
- [x] 9.3 Documentar en docstring del método el orden canónico de locks (anti-deadlock)
- [x] 9.4 Crear `ws_gateway/components/connection/cleanup.py` con `ConnectionCleanup`: tarea background que cada `CLEANUP_INTERVAL=60` segundos: 1) `HeartbeatTracker.cleanup_stale()` → cerrar conexiones idle con 1011; 2) remover conexiones `is_dead=True` del index; 3) purgar locks huérfanos del `WeakValueDictionary`
- [x] 9.5 Crear `ws_gateway/components/connection/manager.py` con `ConnectionManager` (facade). Recibe `ConnectionManagerDependencies` (lifecycle, index, broadcaster, cleanup, stats). Métodos públicos: `connect`, `disconnect`, `broadcast_to_branch`, `broadcast_to_session`, `broadcast_to_sector`, `broadcast_to_user`, `broadcast_to_kitchen`, `broadcast_to_admin_only`, `get_stats`
- [x] 9.6 Crear `ws_gateway/tests/test_connection_lifecycle.py` con tests: accept OK; 4ta conexión del mismo user → rechaza con 4029; conexión 1001 global → 4029; user abusivo → 4029; lock ordering correcto (test con 20 connects concurrentes sobre misma branch → sin deadlocks en <2s)
- [x] 9.7 Crear `ws_gateway/tests/test_connection_cleanup.py` con tests: limpia stales cada `CLEANUP_INTERVAL`; remueve dead del index; purga locks huérfanos
- [x] 9.8 Crear `ws_gateway/tests/test_connection_manager.py` con tests: facade delega correctamente; broadcast fan-out correcto por categoría

## 10. EventRouter + Catchup Publisher

- [x] 10.1 Crear `ws_gateway/components/events/router.py` con `EventRouter`: registro `event_type_to_category: dict[str, EventCategory]` (enum `KITCHEN_EVENTS`/`SESSION_EVENTS`/`ADMIN_ONLY_EVENTS`/`BRANCH_WIDE_WAITER_EVENTS`/`SECTOR_EVENTS`). Método `async route(event: dict)`: extrae `event_type`, `tenant_id`, `branch_id`, `session_id?`, `sector_id?`; busca categoría; consulta `index` con filtro por `tenant_id`; delega a `broadcaster.broadcast(connections, payload)`; eventos sin categoría registrada → warn log + drop. Incluir filtrado multi-tenant como primer check
- [x] 10.2 En C-09 el registro arranca **vacío** (los eventos reales llegan en C-10+). Agregar `register_event(event_type, category)` y documentar con comentario extenso
- [x] 10.3 Agregar helper `_allowed_to_receive(connection, category, event) -> bool` que encapsula la lógica por categoría (p.ej., `SECTOR_EVENTS`: waiter con `sector_id` en sus `sector_ids`, ó role ∈ `{ADMIN, MANAGER}`)
- [x] 10.4 Crear `ws_gateway/components/events/catchup_publisher.py` con `CatchupPublisher`: método `publish_for_catchup(event)` que hace `ZADD catchup:branch:{branch_id} {timestamp_ms} {event_json}` + `ZREMRANGEBYRANK key 0 -101` + `EXPIRE key 300`; si `event.session_id` también escribe a `catchup:session:{session_id}`. Todo protegido por `catchup_circuit_breaker`
- [x] 10.5 Conectar `EventRouter.route()` para llamar también a `CatchupPublisher.publish_for_catchup()` **antes** del broadcast (así aunque el broadcast falle el catch-up funciona)
- [x] 10.6 Crear `ws_gateway/tests/test_event_router.py` con tests: evento `KITCHEN_EVENTS` solo a `/ws/kitchen` de la branch; evento `SECTOR_EVENTS` filtrado por sector para waiters + todos los ADMIN/MANAGER; evento cross-tenant NO entregado; evento con `event_type` desconocido → drop + warn; `BRANCH_WIDE_WAITER_EVENTS` entrega a todos los waiters de la branch; `SESSION_EVENTS` sólo a diners de esa sesión
- [x] 10.7 Crear `ws_gateway/tests/test_catchup_publisher.py` con tests: ZADD + ZREMRANGEBYRANK mantiene máx 100; EXPIRE 300s; escritura dual en branch + session keys cuando corresponde

## 11. Redis Pub/Sub Subscriber

- [x] 11.1 Crear `ws_gateway/components/events/redis_subscriber.py` con `RedisSubscriber`: suscribe a patterns `branch:*:waiters`, `branch:*:kitchen`, `branch:*:admin`, `sector:*:waiters`, `session:*`. Loop `async for message in pubsub.listen()`: parse JSON, validate schema (campos mínimos: `event_type`, `tenant_id`, `branch_id`, `payload`, `timestamp_ms`), delega a `EventRouter.route()`. Todo envuelto en `pubsub_circuit_breaker.can_execute()`
- [x] 11.2 Implementar `process_event_batch()` que colecta hasta N mensajes en `batch_window_ms=50` y procesa en paralelo con `asyncio.gather`
- [x] 11.3 Manejo de reconexión: si Redis falla, `DecorrelatedJitter` backoff para reintentar `pubsub.subscribe()`. Circuit breaker protege
- [x] 11.4 Crear `ws_gateway/tests/test_redis_subscriber.py` (con real Redis en `docker-compose.test.yml` o `fakeredis` según primitiva): `PUBLISH` evento válido → Router recibe; evento con schema inválido → drop + warn; desconexión de Redis → reintento con backoff; circuit breaker abre tras 5 fallos

## 12. Redis Streams Consumer

- [x] 12.1 Crear `ws_gateway/components/events/stream_consumer.py` con `StreamConsumer`:
  - Al arrancar: `XGROUP CREATE events:critical ws_gateway_group $ MKSTREAM` (ignorar `BUSYGROUP`)
  - Loop: `messages = await redis.xreadgroup(group=ws_gateway_group, consumer=f"consumer-{uuid}", streams={"events:critical":">"}, count=50, block=100)`
  - Por cada mensaje: parse → `EventRouter.route()` → si éxito `XACK events:critical ws_gateway_group msg_id` + `XDEL events:critical msg_id`
  - En fallo: NO ack; el mensaje queda pending
  - Cada 30s: `XAUTOCLAIM events:critical ws_gateway_group consumer-{uuid} min-idle-time=60000 0-0 COUNT 100` para reclamar pending de consumers muertos
  - Si `delivery_count > STREAM_MAX_DELIVERIES=3`: `XADD events:dlq * payload {...} reason {...}` + `XACK` + `XDEL` del stream original
- [x] 12.2 Todo protegido por `stream_circuit_breaker` independiente del Pub/Sub
- [x] 12.3 Crear `ws_gateway/tests/test_stream_consumer.py` (requiere Redis real 7+): `XADD` evento → consumer lo lee + route + ACK + XDEL; consumer muere sin ACK → otro consumer reclama vía `XAUTOCLAIM`; 4ta entrega (3 retries + 1) → va al DLQ + se limpia del stream; circuit breaker abre tras 5 fallos

## 13. Endpoints WebSocket

- [x] 13.1 Crear `ws_gateway/routers/websocket.py` con un `APIRouter`. Definir helper `_websocket_endpoint(endpoint_name, strategy, allowed_roles_check)` que encapsula: validar `Origin`, obtener token de query string, `strategy.authenticate()`, `conn_manager.connect()`, try/finally para disconnect, loop `async for message in websocket.iter_json()` con rate-limiter check y heartbeat update
- [x] 13.2 Implementar `/ws/waiter`: `JWTAuthStrategy` con `allowed_roles = {WAITER, MANAGER, ADMIN}`. Si rol no válido → close 4003 sin enviar mensaje
- [x] 13.3 Implementar `/ws/kitchen`: `JWTAuthStrategy` con `allowed_roles = {KITCHEN, MANAGER, ADMIN}`
- [x] 13.4 Implementar `/ws/admin`: `JWTAuthStrategy` con `allowed_roles = {ADMIN, MANAGER}`
- [x] 13.5 Implementar `/ws/diner`: `TableTokenAuthStrategy` sin roles; bind a `session_id`, `diner_id`, `table_id`, `branch_id`, `tenant_id`
- [x] 13.6 Implementar handler de mensajes inbound: `{"type":"ping"}` → respond `{"type":"pong"}`; cualquier otro mensaje: update heartbeat + rate-limit check; si exceeded → close 4029
- [x] 13.7 Implementar validación de `Origin` header en el handshake contra `WS_ALLOWED_ORIGINS`; missing/unknown → reject 403 ANTES de `websocket.accept()`
- [x] 13.8 Crear `ws_gateway/tests/test_endpoints.py` con tests integrados (usando `TestClient.websocket_connect`): `/ws/admin` con JWT válido de ADMIN → OK; `/ws/admin` con JWT de KITCHEN → close 4003; `/ws/diner` con Table Token válido → OK; `/ws/diner` con Table Token tampered → close 4001; rate-limit 31 msg → close 4029; heartbeat ping → pong; `Origin` inválido → rechazado con 403; no-origin y `WS_ALLOW_NO_ORIGIN=false` → rechazado

## 14. Endpoints HTTP de Catchup

- [x] 14.1 Crear `ws_gateway/routers/catchup.py` con `APIRouter(prefix="/ws")`
- [x] 14.2 Implementar `GET /ws/catchup?branch_id&since&token`:
  - Verificar JWT via `verify_jwt_claims(token)` (si inválido → 401)
  - Verificar `branch_id in user.branch_ids` (si no → 403)
  - `events = await redis.zrangebyscore(f"catchup:branch:{branch_id}", min=since, max="+inf", withscores=False)`
  - Parse JSON y retornar
  - Si `since` < `min_score` del set → 410 Gone
- [x] 14.3 Implementar `GET /ws/catchup/session?session_id&since&table_token`:
  - Verificar Table Token (si inválido → 401)
  - Verificar `session_id == token.session_id` (si no → 403)
  - `events = await redis.zrangebyscore(f"catchup:session:{session_id}", min=since, max="+inf")`
  - Filtrar por whitelist: `ROUND_*`, `CART_*`, `CHECK_*`, `PAYMENT_*`, `TABLE_STATUS_CHANGED`, `PRODUCT_AVAILABILITY_CHANGED`
  - Retornar
- [x] 14.4 Crear `ws_gateway/tests/test_catchup_endpoints.py` con tests: staff con JWT válido recupera eventos; staff con `branch_id` fuera de sus branches → 403; `since` viejo → 410; diner recupera eventos filtrados; diner con `session_id` distinto al del token → 403; diner no ve eventos `ENTITY_*`; Table Token tampered → 401

## 15. Endpoints Health y Metrics

- [x] 15.1 Crear `ws_gateway/routers/health.py`
- [x] 15.2 Implementar `GET /health`: retorna `{"status":"ok"}` si el proceso está vivo
- [x] 15.3 Implementar `GET /health/detailed`: intenta `PING` Redis; `XLEN events:dlq`; `XPENDING events:critical ws_gateway_group` → lag; estados de los 3 circuit breakers; `ConnectionStats.active_connections`. 200 si Redis OK + consumer group existe; 503 si algo falla
- [x] 15.4 Implementar `GET /ws/metrics`: protegido por `ENVIRONMENT in {"dev","staging"}` o por `WS_METRICS_TOKEN` query param; retorna stats completas en JSON. En producción sin token → 404
- [x] 15.5 Crear `ws_gateway/tests/test_health.py` con tests: `/health` → 200; `/health/detailed` con Redis OK → 200; `/health/detailed` con Redis caído → 503; `/ws/metrics` en production sin token → 404; `/ws/metrics` con `WS_METRICS_TOKEN` correcto → 200

## 16. Lifespan orquestado y shutdown graceful

- [x] 16.1 En `ws_gateway/main.py`, implementar `@asynccontextmanager async def lifespan(app)`:
  - Startup: 1) `broadcaster.start_workers(10)`; 2) `redis_subscriber.start()`; 3) `stream_consumer.start()`; 4) `cleanup.start()`; 5) `auth_revalidator.start()`
  - Shutdown: 1) rechazar nuevos handshakes (flag `accepting_new=False`); 2) `auth_revalidator.stop()`; 3) `cleanup.stop()`; 4) `stream_consumer.stop()` (flush pending ACKs); 5) `redis_subscriber.stop()`; 6) cerrar todas las conexiones con 1001 (batch); 7) `broadcaster.stop_workers(timeout=5)` (drena cola)
- [x] 16.2 Middleware que en `accepting_new=False` responda 503 a nuevos handshakes
- [x] 16.3 Registrar signal handler SIGTERM que inicie shutdown graceful (uvicorn ya hace esto pero verificarlo)
- [x] 16.4 Crear `ws_gateway/tests/test_lifespan.py` con tests: startup inicializa todos los componentes en orden; shutdown los detiene en orden inverso; shutdown con 10 conexiones activas las cierra con 1001; shutdown con 100 mensajes en cola los drena antes de timeout

## 17. Fail-start en config inválida

- [x] 17.1 En `ws_gateway/main.py` (antes de construir la app), validar:
  - Si `ENVIRONMENT=production` y `WS_ALLOWED_ORIGINS` está vacío → `sys.exit(1)` con mensaje claro
  - Si algún router está configurado con `NullAuthStrategy` y `ENVIRONMENT != "test"` → `sys.exit(1)`
  - Si `JWT_SECRET` o `TABLE_TOKEN_SECRET` son defaults en production → `sys.exit(1)` (ya hay check en `shared/config/settings.py`, re-verificar)
- [x] 17.2 Crear `ws_gateway/tests/test_fail_start.py` con tests: production + `WS_ALLOWED_ORIGINS=""` → el constructor del app raisea; `NullAuthStrategy` en production → raisea

## 18. Documentación y comentarios en código

- [x] 18.1 En `ws_gateway/main.py`, docstring explicando la arquitectura: Composition + Strategy + Circuit Breaker + Worker Pool
- [x] 18.2 En `connection_manager.py` (facade), enumerar los 5 submódulos y el lock ordering canónico
- [x] 18.3 En `stream_consumer.py`, explicar el ciclo de vida del mensaje (XREADGROUP → route → XACK + XDEL, o → DLQ si max deliveries)
- [x] 18.4 Agregar README `ws_gateway/README.md` con: descripción del servicio, endpoints, variables de entorno, cómo correr tests, troubleshooting (Redis down, consumer group lag, DLQ inspection)

## 19. Tests de integración end-to-end del Gateway (sin backend REST)

- [x] 19.1 Crear `ws_gateway/tests/test_integration.py` que levanta el Gateway con Redis real y testea:
  - Publicar evento sintético vía `XADD events:critical * ...` → conexión WS de prueba recibe
  - `PUBLISH branch:1:admin ...` → conexión WS recibe
  - Escribir directo a `ZADD catchup:branch:1 ...` + `GET /ws/catchup?branch_id=1&since=0` retorna el evento
  - Reconexión de WS: el cliente cierra + reabre, rate-limit counter acumula (no se resetea)
- [x] 19.2 Configurar `ws_gateway/tests/conftest.py` con fixtures: `redis_client` (real via docker-compose.test.yml o localhost:6380), `test_jwt_token(role, tenant, branches)`, `test_table_token(session_id, tenant)`, `gateway_app` (FastAPI), `ws_client` (TestClient)

## 20. CI y verificación final

- [x] 20.1 Agregar job `ws_gateway` a `.github/workflows/ci.yml`: setup Python 3.12, Redis 7 service, `pip install -e ws_gateway[test]`, `pytest ws_gateway/tests/ --cov=ws_gateway --cov-fail-under=85`
- [x] 20.2 Verificar que `pytest ws_gateway/tests/ -q` pasa localmente
- [x] 20.3 Verificar cobertura ≥ 85% en `ws_gateway/components/`
- [x] 20.4 `docker compose up ws_gateway backend redis` arranca sin errores y `GET http://localhost:8001/health/detailed` retorna 200 con Redis OK
- [x] 20.5 Test manual: abrir una conexión WS desde navegador (wscat o similar) con JWT válido → handshake OK, ping/pong, close con `close 1000` desde cliente
- [x] 20.6 Actualizar `openspec/CHANGES.md` marcando C-09 como completado (`[x]`) cuando termine el apply

## 21. Checks pre-archive (solo después de que todo apply)

- [x] 21.1 Ejecutar `openspec verify --change ws-gateway-base` y resolver cualquier discrepancia entre specs y código
- [x] 21.2 Revisar que no haya `TODO` ni `FIXME` sin resolver en `ws_gateway/`
- [x] 21.3 Confirmar que `ws_gateway/README.md` está actualizado
- [x] 21.4 Confirmar que no hay código "preparado para C-10" que inflate el scope — los handlers de `ROUND_*`, `CHECK_*`, etc., pertenecen a sus changes respectivos
- [x] 21.5 Confirmar que el registro `event_type_to_category` del `EventRouter` está vacío en C-09 (excepto eventos sintéticos de test) — los eventos reales se agregan en C-10/11/12/13
