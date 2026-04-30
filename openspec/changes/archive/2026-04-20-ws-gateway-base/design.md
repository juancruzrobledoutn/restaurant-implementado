## Context

El proyecto arranca desde cero: hasta aquí existe un backend REST (C-01 a C-08) con modelos, auth JWT, Table Token HMAC, sesiones de mesa, menú y demás, pero **no hay comunicación en tiempo real**. El único canal entre servicios y clientes es HTTP. En los changes inmediatamente siguientes (C-10 rounds, C-11 kitchen, C-12 billing) aparecen flujos que exigen latencia de segundos o menos: un `ROUND_SUBMITTED` en el comedor debe aparecer en la pantalla de cocina al instante; un `CART_ITEM_ADDED` en un celular debe replicarse en el resto de los comensales de la mesa; un `CHECK_REQUESTED` debe avisar al mozo y al comensal al mismo tiempo.

La decisión arquitectónica de separar `ws_gateway` del `backend` REST es **anterior a este change** — está documentada en `knowledge-base/02-arquitectura/01_arquitectura_general.md` y vive en el repo como directorio aparte en el puerto 8001. El gateway **no tiene acceso directo a PostgreSQL**: todo lo que necesita saber fluye por Redis (Pub/Sub para baja latencia, Streams para eventos críticos del outbox). El `backend/` escribe; el `ws_gateway/` lee y hace fan-out.

C-09 construye la infraestructura del canal. Todavía no llegan eventos de `ROUND_*` (aparecen en C-10), ni de `CHECK_*` (C-12), ni de `SERVICE_CALL_*` (C-13). Pero la plataforma debe estar completa: endpoints, auth, routing, worker pool, circuit breaker, streams, catch-up, rate limiting. A partir de C-10 el único trabajo de los changes siguientes es publicar eventos con el payload correcto y sumar categorías al `EventRouter`.

**Stakeholders técnicos afectados**:
- Todos los changes backend desde C-10 en adelante — publican a Redis esperando que este Gateway los consuma.
- Todos los frontends (C-14 a C-21) — consumen los 4 endpoints WS y los 2 endpoints HTTP de catch-up.
- Observabilidad de producción (C-23) — usa `GET /health/detailed` y `GET /ws/metrics`.

**Restricciones heredadas**:
- JWT y Table Token ya están definidos (C-03 y C-08). El Gateway no emite tokens, sólo verifica.
- Redis ya corre en puerto 6380 (C-01). Sin infraestructura nueva.
- `safe_commit`, `get_logger`, `PermissionContext` y demás utilidades de `backend/shared/` son reutilizables desde el Gateway — el nuevo servicio importa de `shared/` pero **no** de `rest_api/`. Esta separación mantiene al Gateway independiente de la base de datos.

## Goals / Non-Goals

**Goals:**
- Levantar `ws_gateway/` como servicio FastAPI independiente en el puerto 8001, con su propio `main.py`, `Dockerfile`, entry en `docker-compose.yml` y tests aislados.
- Servir los 4 endpoints WebSocket (`/ws/waiter`, `/ws/kitchen`, `/ws/admin`, `/ws/diner`) con autenticación dual (JWT + Table Token HMAC) implementada con Strategy Pattern y revalidación periódica.
- Implementar la infraestructura de `ConnectionManager` como Composition Pattern (facade + 5 submódulos: Lifecycle, Broadcaster, Cleanup, Index, Stats).
- Desplegar el Worker Pool de broadcast (10 workers paralelos, cola de 5.000 mensajes) con fallback a `asyncio.gather()` por lotes.
- Proteger todas las operaciones Redis con un `CircuitBreaker` thread-safe (5 fallos → OPEN → 30 s → HALF_OPEN → CLOSED).
- Consumir eventos críticos de Redis Streams (`events:critical`) con consumer group `ws_gateway_group`, recuperación de pendientes con `XAUTOCLAIM` y Dead Letter Queue `events:dlq`.
- Implementar `EventRouter` con las 5 categorías (`KITCHEN_EVENTS`, `SESSION_EVENTS`, `ADMIN_ONLY_EVENTS`, `BRANCH_WIDE_WAITER_EVENTS`, `SECTOR_EVENTS`) y filtrado por sector para mozos.
- Exponer 2 endpoints HTTP de catch-up (staff por `branch_id`, diner por `session_id`) con sorted sets en Redis, TTL 5 min, máx. 100 eventos por key.
- Implementar rate limiting WS (30 mensajes / ventana / conexión) con persistencia del contador en Redis para evitar evasión por reconexión.
- Validar `Origin` en el handshake y mantener una lista de CORS específica del Gateway.
- Enforcement de close codes canónicos: `1000`, `4001`, `4003`, `4029`.
- Health endpoints operativos (`/health`, `/health/detailed`) y endpoint de métricas (`/ws/metrics`) protegido.
- Cobertura de tests ≥ 85% para los componentes de auth, conexión, broadcasting, circuit breaker, rate limiter, stream consumer y catchup.

**Non-Goals:**
- **No se publican eventos desde C-09.** Los productores (outbox processor, `publish_event()` desde el backend REST) viven en C-10 y C-11. El Gateway se entrega con tests de routing usando payloads sintéticos.
- **No se implementan los handlers de eventos de dominio** (`ROUND_*`, `CHECK_*`, `CART_*`, etc.). El `EventRouter` define las 5 categorías y su mecánica de fan-out; la tabla completa de mapeo `event_type → categoría` se llena incrementalmente a partir de C-10.
- **No se toca ningún frontend.** Los 3 clientes WS (Dashboard, pwaMenu, pwaWaiter) se conectan al Gateway en sus respectivos changes (C-14/17/20+).
- **No se crea infraestructura nueva.** Redis y PostgreSQL existentes; sin Kafka, sin RabbitMQ, sin nuevo servicio de colas.
- **No se hace el scaffolding del frontend client** (`shared/websocket-client.ts`). Ese código vive en cada frontend, no en el Gateway.
- **No se implementa autoscaling horizontal del Gateway.** El límite de 1.000 conexiones es por instancia. Multi-instancia queda para C-23 (producción).
- **No se implementan push notifications.** Los suscriptores VAPID viven en backend REST (C-13).
- **No se migra la base de datos.** Cero cambios en Alembic.

## Decisions

### Decision 1: Servicio separado vs endpoint dentro del backend REST

**Elegido**: `ws_gateway/` como **servicio FastAPI independiente** en puerto 8001, con su propio lifespan, `Dockerfile` y entry en `docker-compose.yml`.

**Alternativas consideradas**:
- (A) Montar los endpoints `/ws/*` dentro del backend REST de puerto 8000. Más simple operativamente.
- (B) Servicio totalmente desacoplado, otro lenguaje (Go / Node con `ws`). Máximo rendimiento WS.
- (C) Servicio FastAPI separado en puerto 8001, compartiendo `shared/` por import. **← elegido**.

**Por qué (C)**:
- **Aislamiento de fallos**: una fuga de memoria en el WS o un bug en el broadcaster no tira el REST. Restart del Gateway no corta la API de pagos.
- **Escala independiente**: el perfil de carga es distinto — el Gateway sostiene miles de conexiones idle; el REST hace picos de CPU por request. Poder escalar cada uno por separado es crítico a futuro.
- **Reuso de `shared/`**: usar `shared.security.auth.verify_jwt_claims`, `shared.security.table_token.verify_table_token` y `shared.config.settings.Settings` evita duplicar la lógica de tokens. Se paga el costo de que ambos servicios compartan Python, pero **no comparten la sesión de SQLAlchemy** (el Gateway no necesita DB).
- (A) acopla ciclos de vida: cada deploy del REST cierra todos los WS. Inaceptable.
- (B) multiplica el stack (otro lenguaje, otras dependencias, otro CI). Se revisa si alguna vez superamos las 10k conexiones por instancia; hasta entonces Python+FastAPI es suficiente y homogéneo con el resto.

**Implicación operativa**: el Gateway se arranca con `uvicorn ws_gateway.main:app --host 0.0.0.0 --port 8001`, tiene su propio healthcheck en `docker-compose.yml` y el `backend` REST **no depende de él** — si el Gateway cae, el REST sigue respondiendo.

---

### Decision 2: Strategy Pattern para autenticación (JWT + Table Token + Composite)

**Elegido**: una jerarquía de estrategias donde cada endpoint WS sabe qué estrategia usar.

```
AuthStrategy (ABC)
├── JWTAuthStrategy        # /ws/waiter, /ws/kitchen, /ws/admin
├── TableTokenAuthStrategy # /ws/diner
├── CompositeAuthStrategy  # chain of responsibility (para endpoints mixtos, si aparecen)
└── NullAuthStrategy       # testing
```

**Alternativas consideradas**:
- (A) `if-else` en cada endpoint según el tipo de query param. Cada endpoint revalida, cada endpoint duplica el parseo de close codes.
- (B) Middleware global que revise `Authorization` header y `X-Table-Token` header. No aplica porque los WS llegan con auth en query string, no header.
- (C) Strategy ABC + subclases concretas. **← elegido**.

**Por qué (C)**:
- Abre la puerta a extender auth sin tocar endpoints: si mañana hace falta `OAuth2Strategy` o `APIKeyStrategy`, se suma una subclase.
- Permite `NullAuthStrategy` en tests sin mocks.
- Permite `CompositeAuthStrategy` como chain of responsibility donde la primera estrategia que valide exitosamente gana — útil para endpoints que acepten los dos tipos de token (no es el caso de ninguno en C-09, pero el patrón queda preparado).
- La revalidación periódica vive en la estrategia (`JWTAuthStrategy.revalidate()` checa expiración y blacklist cada 5 min; `TableTokenAuthStrategy.revalidate()` cada 30 min). Mantener la responsabilidad por estrategia evita if-else en el ciclo de vida.

**Detalle**: la estrategia retorna un `AuthResult` (pydantic) con `tenant_id`, `branch_id`, `user_id` (o `diner_id`), `roles`, `session_id` (diner), `sector_ids` (waiters), `expires_at`. El `ConnectionManager` usa este resultado como contexto durante toda la vida de la conexión.

---

### Decision 3: Composition Pattern para `ConnectionManager` (facade + submódulos)

**Elegido**: `ConnectionManager` es **fachada delgada** que delega en 5 submódulos cohesivos.

```
ConnectionManager  (facade, 1 método público por acción: connect/disconnect/broadcast/...)
├── ConnectionLifecycle  (accept/close, lock ordering)
├── ConnectionIndex      (dicts por user_id, branch_id, sector_id, session_id)
├── ConnectionBroadcaster (worker pool + fallback batch)
├── ConnectionCleanup    (barrido de stale/dead)
└── ConnectionStats      (métricas agregadas)
```

**Alternativas consideradas**:
- (A) Clase monolítica `ConnectionManager` de 800+ líneas con todo adentro. Imposible de testear en aislamiento.
- (B) 5 singletons globales sin fachada. Los endpoints llaman a cada uno directamente. Rompe encapsulamiento.
- (C) Facade + 5 componentes inyectados. **← elegido**.

**Por qué (C)**:
- Cada submódulo es testeable con mocks de los otros.
- La fachada impone invariantes: el orden `broadcaster.enqueue → cleanup.mark_stale` es siempre el mismo, los endpoints no pueden saltárselo.
- `ConnectionManagerDependencies` (inyección por constructor) permite pasar fakes en tests y cambiar implementación sin tocar endpoints.
- La implementación del referente (auditoría 07_estandar_calidad_gateway.md) usa exactamente este patrón; nos alineamos con el estándar ya validado.

**Lock ordering** (crítico): `ConnectionLifecycle.connect/disconnect` toma locks en orden estable `tenant_branch_lock → user_lock → connection_lock` para prevenir deadlocks. Documentado en docstring del método.

---

### Decision 4: Sharded Locks por `(tenant_id, branch_id)` vs un lock global

**Elegido**: una función `get_tenant_branch_lock(tenant_id: int, branch_id: int) -> asyncio.Lock` que retorna/crea un lock por tupla `(tenant, branch)`.

**Alternativas consideradas**:
- (A) Un único `asyncio.Lock()` global sobre todas las operaciones de connect/disconnect. Simple, correcto, pero **serializa todo** — un evento de branch A bloquea a branch B.
- (B) Locks por conexión individual. Demasiada granularidad; el estado compartido (índices) sigue necesitando sincronización más gruesa.
- (C) Locks por `(tenant, branch)`. **← elegido**.

**Por qué (C)**:
- Balance correcto: operaciones dentro de una branch se serializan; operaciones de branches distintas corren en paralelo.
- El hash key `{tenant}:{branch}` es Redis-compatible (hash tag) — si mañana el Gateway corre en cluster, el sharding sigue funcionando.
- Los locks se guardan en un `WeakValueDictionary` para GC automático de branches inactivas.

**Riesgo**: un tenant con una sola branch enorme no gana nada con este sharding. Mitigación: en C-23 se evalúa sumar sharding por `(tenant, branch, sector)` si la observabilidad muestra contención.

---

### Decision 5: Worker Pool de broadcast vs `asyncio.gather` por lote

**Elegido**: **Worker Pool de 10 workers permanentes** consumiendo de `asyncio.Queue(maxsize=5000)`, con **fallback** a `asyncio.gather(chunk=50)` si la cola se llena o si los workers no están activos.

**Alternativas consideradas**:
- (A) `asyncio.gather()` sobre todos los destinos de cada evento. Para 400 conexiones por evento, crea 400 coros — memory spikes.
- (B) Un único worker secuencial que reparte. Serializa el broadcast, latencia lineal en número de destinos.
- (C) Worker pool con cola acotada + fallback batch. **← elegido**.

**Por qué (C)**:
- 10 workers es el sweet-spot según la auditoría del sistema de referencia: 400 usuarios en ~160 ms, con buffer para picos.
- La cola acotada actúa de backpressure: si el productor va más rápido que los consumers, eventualmente bloquea en `put()`. Mejor que un `deque` sin límite que consuma toda la memoria.
- El fallback batch es la red de seguridad: si un worker muere o los 10 están stuck, el broadcast no se pierde, sólo se degrada.
- Tunable vía settings (`WS_BROADCAST_WORKERS`, `WS_BROADCAST_QUEUE_SIZE`).

**Observabilidad**: `BroadcastObserver` emite métricas por worker (mensajes procesados, errores, tiempo medio) a `ConnectionStats`, consumibles en `/ws/metrics`.

---

### Decision 6: Redis Streams con Consumer Group + DLQ para eventos críticos; Pub/Sub para eventos best-effort

**Elegido**: **dos canales paralelos** en el mismo Redis:
- **Streams** `events:critical` con consumer group `ws_gateway_group` (`XREADGROUP` + `XAUTOCLAIM`) + DLQ `events:dlq`.
- **Pub/Sub** `branch:*:waiters`, `branch:*:kitchen`, `branch:*:admin`, `sector:*:waiters`, `session:*` para eventos best-effort.

**Alternativas consideradas**:
- (A) Sólo Pub/Sub (como jr2 original tenía al inicio). Simple, pero los eventos outbox pueden perderse si el Gateway está caído en el momento del publish.
- (B) Sólo Streams con consumer group. Más durabilidad, pero **todo** evento paga el costo de ACK / redelivery — innecesario para `ROUND_CONFIRMED` o `CART_ITEM_ADDED`.
- (C) Ambos, clasificando por criticidad. **← elegido**.

**Por qué (C)**:
- La clasificación ya está definida en `knowledge-base/02-arquitectura/04_eventos_y_websocket.md`: outbox → critical; direct Redis → best-effort.
- Pub/Sub entrega en orden del productor, sin retries; ideal para eventos que se actualizan constantemente (`CART_*`, `TABLE_*`).
- Streams con consumer group asegura que aunque el Gateway reinicie, los eventos pendientes se entregan (`XAUTOCLAIM` los reclama). Los que fallan N veces van al DLQ para inspección manual.
- `N=3` reintentos antes de DLQ (configurable via `WS_STREAM_MAX_DELIVERIES`).

**Operación del consumer**:
1. Cada 100 ms: `XREADGROUP GROUP ws_gateway_group consumer-{uuid} COUNT 50 BLOCK 100 STREAMS events:critical >`.
2. Por cada mensaje: validar schema → `EventRouter.route` → `ConnectionBroadcaster.broadcast` → si éxito `XACK` + `XDEL`.
3. Cada 30 s: `XAUTOCLAIM events:critical ws_gateway_group consumer-{uuid} 60000 0-0 COUNT 100` para reclamar pendientes de otros consumers que se colgaron.
4. Si `delivery_count > 3` → `XDEL` del stream + `XADD events:dlq * payload "{...}" reason "{...}"`.

---

### Decision 7: Event catch-up con sorted sets de Redis

**Elegido**: al procesar cada evento, el Gateway también hace `ZADD catchup:branch:{branch_id} {timestamp_ms} "{event_json}"` (y `catchup:session:{session_id}` para eventos con session), luego `ZREMRANGEBYRANK` para limitar a 100 y `EXPIRE 300`.

**Alternativas consideradas**:
- (A) Tabla SQL en el backend REST con polling desde el Gateway. Agrega I/O extra + acopla servicios.
- (B) Kafka/Redpanda con replay. Overkill para 100 eventos de 5 min.
- (C) Sorted set Redis con TTL y bound. **← elegido**.

**Por qué (C)**:
- Operación O(log N) para insert + O(log N + K) para range query. Ambas instantáneas con 100 elementos.
- TTL se resetea en cada `ZADD` via `EXPIRE`; si una branch no recibe eventos por 5 min, la key desaparece sola.
- El cliente pasa `since` (timestamp ms); el Gateway hace `ZRANGEBYSCORE catchup:... {since} +inf` y devuelve. Si `since < min_score` del set → 410 Gone, el cliente debe hacer un refetch completo.
- La whitelist para diners se aplica **en el Gateway** antes de devolver: `ROUND_*`, `CART_*`, `CHECK_*`, `PAYMENT_*`, `TABLE_STATUS_CHANGED`, `PRODUCT_AVAILABILITY_CHANGED`. No exponemos eventos staff al pwaMenu.

**Autenticación de los endpoints HTTP**:
- `/ws/catchup` verifica JWT via `verify_jwt_claims` y `branch_id ∈ user.branch_ids`.
- `/ws/catchup/session` verifica Table Token y `session_id == token.session_id`. **Cross-session queries bloqueadas**.

---

### Decision 8: Rate limiting WS persistido en Redis

**Elegido**: sliding window por conexión con contador en Redis. Key: `ws:ratelimit:{connection_id}`. Al reconectar con el mismo `(user_id | diner_id, device_id)` el contador continúa (no se resetea).

**Alternativas consideradas**:
- (A) Contador en memoria del Gateway. Se pierde al reconectar → el atacante simplemente reconecta cada 30 mensajes.
- (B) Bucket de tokens por usuario. Más complejo, necesita clock sync en multi-instancia.
- (C) Sliding window Redis + clave derivada del usuario. **← elegido**.

**Por qué (C)**:
- La penalidad acumulativa es lo que cierra la puerta a la evasión por reconexión.
- 30 msg / ventana / conexión es suficiente para uso legítimo (un comensal típico manda ~1-2 msg/s; un mozo confirma ~5 rondas/min).
- Exceder → close `4029` y `user_id` marked "abusive" por 60 s en `ws:abusive:{user_id}` (bloquea nuevas conexiones durante ese tiempo). Configurable.

**Atomicidad**: se usa Lua script para incrementar el contador + expirar la ventana en una sola operación (best practice Redis).

---

### Decision 9: Endpoints HTTP de catch-up dentro del Gateway (no del backend REST)

**Elegido**: `/ws/catchup` y `/ws/catchup/session` viven en el servicio `ws_gateway` en el puerto 8001.

**Alternativas consideradas**:
- (A) Implementar los endpoints en el backend REST (puerto 8000). Keyspace Redis accesible desde ambos.
- (B) Implementar en el Gateway. **← elegido**.

**Por qué (B)**:
- El Gateway ya es dueño del keyspace `catchup:*` — escribe al procesar cada evento. Mantener la lectura del lado del dueño reduce acoplamiento.
- El cliente frontend ya conoce `VITE_WS_URL`; agregar un solo host para ambos flujos (WS + catchup) simplifica CORS y firewall rules.
- Evita que el backend REST tenga conocimiento de la mecánica de sorted sets del catch-up.

**Implicación frontend**: en los changes C-15/18/20 los clientes llaman a `GET ${VITE_WS_URL.replace('ws', 'http')}/ws/catchup?...`.

---

### Decision 10: Circuit Breaker genérico compartido vs por recurso

**Elegido**: una sola clase `CircuitBreaker` genérica, **instanciada por recurso crítico** (uno para Redis Pub/Sub, otro para Streams, otro para comandos Redis del catchup).

**Alternativas consideradas**:
- (A) Un circuit breaker global para "Redis" — si falla cualquier cosa, se cierra todo.
- (B) Un breaker por operación (uno para ZADD, otro para XADD, otro para PUBLISH). Micro-granularidad, difícil de observar.
- (C) Genérico + una instancia por "consumidor lógico". **← elegido**.

**Por qué (C)**:
- Instancias: `redis_pubsub_breaker`, `redis_stream_breaker`, `redis_catchup_breaker`.
- Cada uno puede estar `OPEN` mientras el otro sigue `CLOSED` — si el Pub/Sub falla, no bloqueamos el consumo de Streams críticos.
- Thread-safe con `threading.Lock` porque se toca tanto desde tareas async como desde workers (potencialmente en threadpool).
- Config compartida (5 failures / 30 s recovery) pero override por instancia si es necesario (más laxo para Streams, más estricto para Pub/Sub).

---

### Decision 11: Revalidación periódica de tokens en background vs validación sólo al conectar

**Elegido**: **revalidación periódica**. `JWTAuthStrategy` revalida cada 5 min; `TableTokenAuthStrategy` cada 30 min.

**Por qué**:
- Sin revalidación, un JWT expirado durante la sesión sigue enviando eventos hasta que el cliente se desconecte. Inaceptable para operaciones con impacto financiero.
- Sin revalidación, un Table Token blacklisted (sesión cerrada por el mozo) puede seguir recibiendo eventos de su sesión cerrada.
- El intervalo (5/30 min) equilibra carga vs frescura. JWT es más sensible porque los roles pueden cambiar; Table Token sólo se revoca al cerrar sesión.

**Trigger de desconexión**: si la revalidación falla, se cierra con `4001` (auth failed) y el cliente **no** debe reconectar.

---

### Decision 12: Origin validation estricta en el handshake

**Elegido**: verificar header `Origin` del handshake WS contra `WS_ALLOWED_ORIGINS` (configurable via env); rechazar con HTTP 403 si no matchea.

**Por qué**:
- Los WS no están protegidos por CORS del browser — sin origin validation, cualquier página web podría abrir un WS al Gateway y recibir eventos ajenos con un token robado.
- En dev se aceptan `localhost:5176`, `localhost:5177`, `localhost:5178`. En producción **no hay defaults** — si `WS_ALLOWED_ORIGINS` está vacío en producción, el Gateway no arranca.
- Las conexiones de herramientas server-to-server (raras para WS) no mandan `Origin` — se aceptan sólo si `WS_ALLOW_NO_ORIGIN=true` (off por default).

---

### Decision 13: Close codes y reconexión del cliente

**Elegido**: `4001` / `4003` / `4029` marcan al cliente como "no reconectar". El cliente base (`BaseWebSocketClient` en cada frontend) ya respeta esta convención.

| Código | Causa | Reconexión |
|--------|-------|------------|
| `1000` | Cierre normal (logout, shutdown del Gateway) | No |
| `4001` | Auth fallida o revalidación vencida | No |
| `4003` | Rol/branch/sector sin acceso | No |
| `4029` | Rate limit o connection limit excedido | No |
| `1001` / `1006` / `1011` | Transitorios | Sí, con backoff exponencial |

El servidor **nunca** usa `4001` para problemas transitorios — si Redis cae, se cierra con `1011` para permitir reconexión.

---

## Risks / Trade-offs

- **[Riesgo] Python GIL limita throughput por instancia.** Con 1.000 conexiones activas y bursts de eventos, una sola instancia puede saturar CPU en el broadcast. → **Mitigación**: el límite de 1.000 por instancia es duro (cuarta conexión → 4029). Multi-instancia detrás de un LB con sticky sessions es el camino natural para escalar — queda para C-23.

- **[Riesgo] `fakeredis` no implementa todas las primitivas de Streams (`XAUTOCLAIM` históricamente fue inestable).** → **Mitigación**: los tests de `StreamConsumer` usan una instancia real de Redis 7 levantada en `docker-compose.test.yml`; el resto de los tests usan `fakeredis`.

- **[Riesgo] Deadlocks por lock ordering incorrecto.** `ConnectionLifecycle` toma hasta 3 locks en cada connect/disconnect. → **Mitigación**: docstring con orden canónico, test con asyncio timeouts que falla si una conexión toma > 2 s, code review explícita en la PR.

- **[Riesgo] Starvation del worker pool si un worker queda colgado en un cliente con red lenta.** → **Mitigación**: timeout de 5 s por `websocket.send_text()`; si supera, se marca la conexión como muerta y se corta. El worker vuelve a disponible.

- **[Trade-off] Coexistencia de Pub/Sub + Streams duplica la lógica de consumo.** Dos handlers, dos circuit breakers, dos caminos de procesamiento. → **Justificado**: la separación crítico/best-effort es un requisito del dominio; unificar todo en Streams agregaría latencia ~50 ms por ACK en eventos de alta frecuencia.

- **[Trade-off] Redis es punto único de fallo.** Si Redis cae, el Gateway no funciona. → **Mitigación**: el circuit breaker evita tormentas de reintentos. En producción (C-23) se evalúa Redis Sentinel o réplica; por ahora la observabilidad avisa y el Gateway se degrada con gracia.

- **[Trade-off] No se hace persistencia del estado de conexiones.** Al reiniciar, todas las conexiones caen. → **Justificado**: los clientes reconectan con backoff exponencial; el event catch-up con `since` permite recuperar los últimos 5 min. Persistir estado WS no agrega valor real.

- **[Riesgo] Cold-start del consumer group: la primera vez que el Gateway arranca con el stream vacío, `XREADGROUP ... ID >` bloquea esperando.** → **Mitigación**: `BLOCK 100` timeout; el consumer loop itera continuamente.

- **[Riesgo] Tests flakey de concurrencia.** Los asyncio tests de connect/disconnect masivos pueden ser inestables. → **Mitigación**: usar `anyio` + fixtures deterministas con `trio` cuando hace falta; marcar tests sensibles con `@pytest.mark.flaky(reruns=3)` sólo como último recurso.

## Migration Plan

**Despliegue**:
1. Merge de la PR con todo el código del Gateway + tests verdes en CI.
2. `docker-compose up ws_gateway` — el servicio arranca aislado, los frontends todavía no lo usan (aún no entró C-14/17/20).
3. Verificar `curl http://localhost:8001/health/detailed` — Redis OK, consumer group creado (`XGROUP CREATE events:critical ws_gateway_group $ MKSTREAM`).
4. Publicar eventos sintéticos manuales con `redis-cli XADD` y `PUBLISH` para verificar que el router entrega correctamente.

**Rollback**:
- No hay datos migrados. `docker-compose down ws_gateway` restaura el estado previo.
- Si el consumer group deja mensajes pendientes, `redis-cli XGROUP DESTROY events:critical ws_gateway_group` los limpia (dev/staging); en producción se drena con otro consumer antes de tumbar.

**Operación en C-10+**: cuando los productores empiezan a publicar `ROUND_*` desde el backend REST, el Gateway ya está corriendo y los consumirá. Los tests E2E del flujo completo llegan en C-22.

## Open Questions

- **¿Dónde corre el `outbox_processor`?** La auditoría sugiere que vive en el backend REST (mismo proceso, background task). C-10 o C-11 debe implementarlo. **Decisión pendiente**: definir en C-10 si el processor es un background task del REST o un proceso separado (sidecar). **No afecta a C-09** — el Gateway sólo consume del stream, independiente del productor.

- **¿`heartbeat_interval` configurable por cliente o fijo servidor?** Dejamos fijo 30 s server-side en C-09; si algún cliente móvil necesita heartbeat más laxo (batería), se negocia en el handshake. **Decisión tentativa**: fijo por ahora, volver en C-17 cuando el pwaMenu maneje estados de `visibilitychange`.

- **¿Se agrega Sentry/OpenTelemetry en C-09 o en C-23?** Ponemos hooks de logging estructurado en C-09 (`get_logger()` con extra fields); la integración con tracing externa queda para C-23. El `health/detailed` ya expone los datos que alimentarían una alerta Prometheus básica.

- **Multi-instancia del Gateway**: cuando haya 2+ instancias, el consumer group Redis distribuye eventos automáticamente, pero las conexiones WS están pegadas a una instancia. Un evento para una conexión de instancia-B que lo consume instancia-A se descartaría silenciosamente salvo que ambas compartan el `ConnectionIndex`. **Out of scope C-09**: se diseña como monolítico; C-23 decide si es Redis-backed index o sticky session.
