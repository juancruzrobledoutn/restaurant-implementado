## Why

Hasta C-08 el sistema tiene datos vivos (mesas, sesiones abiertas, diners, cart items), pero **todo se comunica por HTTP**: no hay un solo canal en tiempo real. Sin el Gateway, no puede existir la experiencia del proyecto — la cocina no se entera de un `ROUND_SUBMITTED` hasta que refresca, el mozo no ve una llamada de servicio, la mesa no se actualiza cuando otro comensal agrega un item al carrito compartido, el comensal no ve que su pedido ya salió a cocina. C-09 levanta el `ws_gateway` como **servicio separado en el puerto 8001**, con los 4 endpoints (`/ws/waiter`, `/ws/kitchen`, `/ws/admin`, `/ws/diner`), las dos estrategias de auth (JWT + Table Token HMAC), el Worker Pool de broadcast, el Circuit Breaker, el heartbeat, el consumer group de Redis Streams con DLQ y el endpoint HTTP de event catch-up. Es el cimiento sobre el que se apoyan C-10 (rounds), C-11 (kitchen), C-12 (billing), C-17-19 (pwaMenu) y C-20-21 (pwaWaiter): **ninguno de estos changes funciona en tiempo real sin C-09**.

## What Changes

- **Nuevo servicio `ws_gateway/`** (FastAPI independiente en puerto 8001, con su propio `main.py`, `Dockerfile` y entry en `devOps/docker-compose.yml`), siguiendo Composition Pattern: el `ConnectionManager` es una fachada delgada que delega en submódulos (`ConnectionLifecycle`, `ConnectionBroadcaster`, `ConnectionCleanup`, `ConnectionIndex`, `ConnectionStats`).
- **4 endpoints WebSocket** con auth por query string:
  - `/ws/waiter?token=JWT` — roles `WAITER`, `MANAGER`, `ADMIN`.
  - `/ws/kitchen?token=JWT` — roles `KITCHEN`, `MANAGER`, `ADMIN`.
  - `/ws/admin?token=JWT` — roles `ADMIN`, `MANAGER`.
  - `/ws/diner?table_token=TOKEN` — autenticado con Table Token HMAC emitido en C-08.
- **Strategy Pattern para autenticación**: `JWTAuthStrategy`, `TableTokenAuthStrategy`, `CompositeAuthStrategy` (chain of responsibility) y `NullAuthStrategy` (testing). Revalidación en background: JWT cada 5 min, Table Token cada 30 min. Si la revalidación falla, cierre con 4001.
- **Sharded Locks por tenant+branch**: `get_tenant_branch_lock(tenant_id, branch_id)` para aislamiento multi-tenant en operaciones concurrentes de connect/disconnect; evita que un tenant grande bloquee a otros.
- **Worker Pool de broadcast** (10 workers, cola de 5.000 mensajes) con fallback a batch `asyncio.gather(chunk=50)` si la cola se satura. Observa `BroadcastObserver` para métricas por worker.
- **Circuit Breaker** (`ws_gateway/components/resilience/circuit_breaker.py`) genérico: 5 fallos consecutivos → `OPEN` durante 30 s → `HALF_OPEN` → `CLOSED` en éxito. Protege todas las llamadas a Redis.
- **Heartbeat protocol**: cliente envía `{"type":"ping"}` cada 30 s, servidor responde `{"type":"pong"}`. Sin tráfico en 60 s → desconexión. Limpieza periódica cada 60 s de conexiones muertas y locks huérfanos.
- **Close codes canónicos**: `1000` (cierre normal), `4001` (auth fallida o revalidación falló), `4003` (prohibido — sin permiso para la branch/sector), `4029` (rate limit excedido). Los códigos `4001`/`4003`/`4029` marcan a los clientes como "no reconectar".
- **Redis Streams consumer group** para eventos críticos (`events:critical`, grupo `ws_gateway_group`) con `XREADGROUP` + `XAUTOCLAIM` para reclamar pendientes. Eventos que fallan `N` reintentos van al **Dead Letter Queue** `events:dlq`.
- **Redis Pub/Sub** coexiste con Streams: pub/sub para eventos de baja latencia (canales `branch:*:waiters`, `branch:*:kitchen`, `branch:*:admin`, `sector:*:waiters`, `session:*`); Streams sólo para los eventos outbox que no pueden perderse.
- **EventRouter**: clasifica cada evento entrante por categoría (`KITCHEN_EVENTS`, `SESSION_EVENTS`, `ADMIN_ONLY_EVENTS`, `BRANCH_WIDE_WAITER_EVENTS`, `SECTOR_EVENTS`) y consulta `ConnectionIndex` para obtener el fan-out. En C-09 el router está **vacío de eventos** (no llega ningún `ROUND_*` todavía porque `Round` aparece en C-10) pero la infraestructura de routing y las categorías quedan operativas y testeadas con eventos de prueba.
- **Event catch-up HTTP** (2 endpoints montados en el mismo servicio `ws_gateway`):
  - `GET /ws/catchup?branch_id=&since=&token=` — staff (JWT). Lee del sorted set `catchup:branch:{id}` (máx. 100 eventos, TTL 5 min).
  - `GET /ws/catchup/session?session_id=&since=&table_token=` — diner. Lee de `catchup:session:{id}` y filtra a `ROUND_*`, `CART_*`, `CHECK_*`, `PAYMENT_*`, `TABLE_STATUS_CHANGED`, `PRODUCT_AVAILABILITY_CHANGED`.
- **Rate limiting WebSocket**: 30 mensajes por ventana deslizante por conexión. Exceder → close code `4029`. El contador se acumula al reconectar (previene reset de rate limit evadiendo el límite por reconexión).
- **Origin validation** + CORS específico para WebSocket (`DEFAULT_CORS_ORIGINS` en `ws_gateway/components/core/constants.py`; el backend REST y el Gateway mantienen listas independientes porque el Gateway sólo acepta conexiones desde los 3 frontends, nunca desde herramientas server-to-server).
- **Connection limits**: máximo 3 conexiones por usuario (multi-tab Dashboard) y 1.000 conexiones totales por instancia. Exceder → close code `4029`.
- **Health endpoints en el Gateway**: `GET /health` (básico), `GET /health/detailed` (Redis + consumer group lag + DLQ size). `GET /ws/metrics` (sólo en dev/staging, protegido) retorna conexiones activas, mensajes/seg, circuit breaker state y stats del worker pool.
- **Lifespan orquestado**: `lifespan` de FastAPI arranca en orden (broadcast workers → redis subscriber → stream consumer → heartbeat cleanup) y hace shutdown graceful con timeouts por tarea.
- **Componente `catchup_publisher`**: al procesar cada evento el Gateway también lo escribe al sorted set correspondiente de catch-up con `ZADD` y `EXPIRE` 300 s, truncando con `ZREMRANGEBYRANK` a los 100 más recientes.
- **Sin nuevos modelos SQLAlchemy ni migración Alembic**. El Gateway lee desde Redis; la persistencia vive en el backend REST. El trabajo de publicación de eventos al Gateway (outbox processor, publish_event) ya existirá en C-10 y C-11 — C-09 sólo consume.
- **Tests** (pytest + pytest-asyncio con `httpx.AsyncClient`/`starlette.testclient.WebSocketTestSession` + fakeredis):
  - Conexión WS OK con JWT válido; con Table Token válido.
  - Auth fallida → close 4001 (JWT expirado, firma inválida, Table Token tampered, token revocado en blacklist Redis con fail-closed).
  - Rol incorrecto → close 4003 (p.ej., `KITCHEN` intenta `/ws/admin`).
  - Branch/sector mismatch → close 4003.
  - Heartbeat: ping del cliente → pong del servidor; sin pong en 60 s → desconexión automática.
  - Rate limiting: 31 mensajes en la ventana → close 4029; reconexión no resetea el contador.
  - Circuit breaker: 5 fallos consecutivos de Redis → estado `OPEN`; durante `OPEN` no se intenta Redis; pasados 30 s → `HALF_OPEN` → `CLOSED` en éxito.
  - Redis Streams: consumer group `XREADGROUP` entrega evento → broadcast; mensaje sin ACK reclamado por `XAUTOCLAIM`; mensaje con N fallos → DLQ.
  - Disconnect graceful: `shutdown` cierra todas las conexiones con close 1001, drena el worker pool y los pending acks del stream antes de matar el proceso.
  - Event catch-up: staff recibe todos los eventos desde `since`; diner sólo recibe los eventos whitelisted de su session; `since` fuera del TTL retorna 410.
  - Multi-tenant isolation: una conexión del tenant A nunca recibe eventos del tenant B aunque compartan `branch_id` numérico.
  - Connection limits: cuarta conexión del mismo `user_id` → close 4029; conexión 1001 global → close 4029.
  - Origin validation: `Origin` no whitelisted → handshake rechazado con 403.

## Capabilities

### New Capabilities
- `ws-gateway`: Servicio WebSocket independiente con los 4 endpoints de rol, autenticación dual (JWT / Table Token), Strategy + Composition + Circuit Breaker + Worker Pool + Sharded Locks + Heartbeat, consumo de Redis Streams con consumer group y DLQ, EventRouter con 5 categorías de fan-out y 2 endpoints HTTP de event catch-up. Define el contrato de close codes, límites de conexión y rate limiting WS que el resto del sistema consume.

### Modified Capabilities
_(ninguna — `table-sessions` emite Table Tokens sin cambios; `auth` emite JWT sin cambios. C-09 consume ambos sistemas sin modificar sus requirements.)_

## Impact

- **Nuevo servicio / directorio**: `ws_gateway/` al tope del repo (hermano de `backend/`), con su propio `pyproject.toml` o entry en el existente (decisión en design.md), su `Dockerfile`, tests en `ws_gateway/tests/`.
- **Archivos creados (estructura canónica del Gateway)**:
  - `ws_gateway/main.py` — FastAPI app, lifespan, registro de routers y health.
  - `ws_gateway/core/constants.py` — close codes, intervalos (heartbeat, JWT revalidation, table token revalidation), límites (conexiones, workers, cola), canales Redis, rate limiting WS, `DEFAULT_CORS_ORIGINS`.
  - `ws_gateway/core/dependencies.py` — singletons: Redis pool, ConnectionManager, EventRouter, CircuitBreaker compartido.
  - `ws_gateway/components/auth/strategies.py` — `AuthStrategy` ABC + `JWTAuthStrategy` + `TableTokenAuthStrategy` + `CompositeAuthStrategy` + `NullAuthStrategy`.
  - `ws_gateway/components/auth/revalidation.py` — tarea background que revalida tokens periódicamente.
  - `ws_gateway/components/connection/manager.py` — `ConnectionManager` (facade) + `ConnectionManagerDependencies`.
  - `ws_gateway/components/connection/lifecycle.py` — `ConnectionLifecycle` (accept/disconnect, lock ordering anti-deadlock).
  - `ws_gateway/components/connection/broadcaster.py` — `ConnectionBroadcaster` (Worker Pool + fallback batch), `BroadcastObserver`.
  - `ws_gateway/components/connection/cleanup.py` — `ConnectionCleanup` (stale, dead, locks).
  - `ws_gateway/components/connection/index.py` — `ConnectionIndex` (dicts por user_id, branch_id, sector_id, session_id) con sharded locks por `(tenant_id, branch_id)`.
  - `ws_gateway/components/connection/stats.py` — `ConnectionStats`.
  - `ws_gateway/components/connection/rate_limiter.py` — sliding window por conexión (penalidad acumulativa en Redis).
  - `ws_gateway/components/connection/heartbeat.py` — `HeartbeatTracker`, loop de ping/pong.
  - `ws_gateway/components/events/router.py` — `EventRouter` con las 5 categorías.
  - `ws_gateway/components/events/redis_subscriber.py` — Pub/Sub subscriber con `process_event_batch()` + circuit breaker.
  - `ws_gateway/components/events/stream_consumer.py` — consumer group `ws_gateway_group` + `XREADGROUP` + `XAUTOCLAIM` + DLQ.
  - `ws_gateway/components/events/catchup_publisher.py` — sorted sets por branch y session con TTL 5 min.
  - `ws_gateway/components/resilience/circuit_breaker.py` — `CircuitBreaker` thread-safe con métricas.
  - `ws_gateway/components/resilience/backoff.py` — `DecorrelatedJitter` para reintentos.
  - `ws_gateway/routers/websocket.py` — los 4 endpoints `/ws/*`.
  - `ws_gateway/routers/catchup.py` — `/ws/catchup` y `/ws/catchup/session`.
  - `ws_gateway/routers/health.py` — `/health`, `/health/detailed`, `/ws/metrics`.
  - `ws_gateway/Dockerfile` — Python 3.12, puerto 8001.
  - `ws_gateway/tests/conftest.py`, `ws_gateway/tests/test_auth_strategies.py`, `test_connection_manager.py`, `test_broadcaster.py`, `test_circuit_breaker.py`, `test_heartbeat.py`, `test_rate_limiter.py`, `test_stream_consumer.py`, `test_event_router.py`, `test_catchup.py`, `test_integration_endpoints.py`.
- **Archivos modificados**:
  - `devOps/docker-compose.yml` — agregar servicio `ws_gateway` (puerto 8001, depende de `redis` y `backend`, healthcheck con `/health`).
  - `backend/shared/security/auth.py` — exportar `verify_jwt_claims()` reusable desde el Gateway (sin nueva lógica).
  - `backend/shared/security/table_token.py` — exportar `verify_table_token()` reusable (ya existe en C-08, sólo se consume).
  - `backend/shared/config/settings.py` — agregar configuración WS (`WS_HOST`, `WS_PORT=8001`, `WS_MAX_CONNECTIONS=1000`, `WS_MAX_CONNECTIONS_PER_USER=3`, `WS_HEARTBEAT_INTERVAL=30`, `WS_HEARTBEAT_TIMEOUT=60`, `WS_RATE_LIMIT_PER_WINDOW=30`, `WS_RATE_LIMIT_WINDOW_SECONDS=1`, `WS_CATCHUP_TTL_SECONDS=300`, `WS_CATCHUP_MAX_EVENTS=100`, `WS_BROADCAST_WORKERS=10`, `WS_BROADCAST_QUEUE_SIZE=5000`, `WS_STREAM_CRITICAL=events:critical`, `WS_STREAM_GROUP=ws_gateway_group`, `WS_STREAM_DLQ=events:dlq`, `WS_ALLOWED_ORIGINS` con defaults de localhost).
  - `.env.example` — agregar las mismas variables.
- **Infraestructura**:
  - **Redis** gana nuevos usos: Streams (`events:critical`, `events:dlq`), sorted sets (`catchup:branch:{id}`, `catchup:session:{id}`), rate-limiter per-connection sliding window, connection metrics. La instancia Redis del proyecto (puerto 6380) es la misma que ya usaba C-03.
  - **PostgreSQL**: cero cambios. Sin nuevos modelos ni migraciones.
- **API surface**:
  - 4 endpoints WS nuevos.
  - 2 endpoints HTTP nuevos (catchup staff + catchup diner).
  - 3 endpoints de operación (health, health/detailed, ws/metrics).
- **Breaking changes**: **ninguno** (el sistema todavía no exponía WebSocket). Pero los endpoints HTTP `/ws/catchup*` quedan reservados en el Gateway (puerto 8001), no en el backend REST — los clientes frontend deben apuntar a `VITE_WS_URL` para ambos (WS y catchup HTTP).
- **Downstream**: desbloquea C-10 (rounds — emite `ROUND_*` via outbox + direct Redis), C-11 (kitchen — recibe `ROUND_SUBMITTED`/`_IN_KITCHEN`/`_READY`), C-12 (billing — `CHECK_*`, `PAYMENT_*` por outbox), C-13 (staff — `SERVICE_CALL_CREATED` por outbox), C-17/18/19 (pwaMenu — conecta a `/ws/diner`), C-20/21 (pwaWaiter — conecta a `/ws/waiter`), C-14/15/16 (Dashboard — conecta a `/ws/admin`). En todos esos changes se añadirán los handlers de eventos específicos; C-09 entrega la plataforma de routing.
- **Governance**: **ALTO** — afecta seguridad (auth duale, origin, rate limit), resiliencia (circuit breaker, DLQ) y es la única vía del sistema para comunicación en tiempo real. Apply debe ejecutarse **después de revisión manual del design.md y tasks.md**; cualquier desviación del patrón documentado requiere explicación explícita en la PR.
