# 🔍 Auditoría WebSocket - Proyecto Integrador

> **Estándar de Calidad Objetivo** — Este documento es el nivel de referencia que el nuevo desarrollo debe alcanzar o superar. Los scores y hallazgos corresponden al sistema de referencia (jr2 original). Al implementar cada change, usar estos criterios como benchmark.

---

**Fecha**: 2026-01-31  
**Componente**: `ws_gateway` + Clientes Frontend (Dashboard, pwaWaiter, pwaMenu)  
**Versión**: 0.2.0

---

## Resumen Ejecutivo

| Categoría | Estado | Críticos | Altos | Medios | Bajos |
|-----------|--------|----------|-------|--------|-------|
| **Arquitectura** | ✅ Excelente | 0 | 0 | 1 | 2 |
| **Seguridad** | ✅ Sólida | 0 | 1 | 2 | 0 |
| **Resiliencia** | ✅ Robusta | 0 | 0 | 2 | 1 |
| **Escalabilidad** | ⚠️ Mejorable | 0 | 2 | 1 | 0 |
| **Cliente-Side** | ✅ Consistente | 0 | 0 | 1 | 2 |

**Calificación General**: **8.5/10** - Sistema maduro con prácticas sólidas

---

## ✅ Correcciones Implementadas en Esta Auditoría

### Primera Ronda (Prioridad Alta)

| ID | Hallazgo | Archivo | Estado |
|----|----------|---------|--------|
| SEC-MED-02 | NON_RECOVERABLE_CLOSE_CODES incluye 4029 | Dashboard/websocket.ts | ✅ Implementado |
| SEC-MED-02 | NON_RECOVERABLE_CLOSE_CODES incluye 4029 | pwaMenu/websocket.ts | ✅ Implementado |
| SEC-MED-02 | NON_RECOVERABLE_CLOSE_CODES incluye 4029 | pwaWaiter/constants.ts | ✅ Implementado |
| RES-MED-01 | Callback `onMaxReconnectReached` | pwaMenu/websocket.ts | ✅ Implementado |
| RES-MED-01 | Callback `onMaxReconnectReached` | pwaWaiter/websocket.ts | ✅ Implementado |
| CLIENT-MED-01 | MAX_RECONNECT_ATTEMPTS = 50 | pwaMenu/websocket.ts | ✅ Implementado |
| CLIENT-MED-01 | MAX_RECONNECT_ATTEMPTS = 50 | pwaWaiter/constants.ts | ✅ Implementado |
| CLIENT-LOW-02 | Listener cleanup (Sets vacíos) | pwaMenu/websocket.ts | ✅ Implementado |

### Segunda Ronda (Prioridad Media y Baja)

| ID | Hallazgo | Archivo | Estado |
|----|----------|---------|--------|
| SEC-HIGH-01 | Revalidación periódica de table tokens | ws_gateway/components/endpoints/handlers.py | ✅ Implementado |
| SEC-HIGH-01 | Constante TABLE_TOKEN_REVALIDATION_INTERVAL | ws_gateway/components/core/constants.py | ✅ Implementado |
| SEC-MED-01 | Doble verificación environment | ws_gateway/components/core/constants.py | ✅ Implementado |
| RES-MED-02 | Backoff exponencial en stream consumer | ws_gateway/core/subscriber/stream_consumer.py | ✅ Implementado |
| RES-LOW-01 | DLQ físico con Redis XADD | ws_gateway/core/subscriber/stream_consumer.py | ✅ Implementado |
| SCALE-HIGH-01 | Worker pool para broadcasts grandes | ws_gateway/core/connection/broadcaster.py | ✅ Implementado |
| SCALE-HIGH-01 | Integración lifespan | ws_gateway/main.py, connection_manager.py | ✅ Implementado |
| SCALE-MED-01 | Lock sharding por tenant | ws_gateway/components/connection/locks.py | ✅ Implementado |
| CLIENT-LOW-01 | onThrottled para eventos de alta frecuencia | pwaWaiter/websocket.ts | ✅ Implementado |

### Tercera Ronda (Documentación y Redis Best Practices)

| ID | Hallazgo | Archivo | Estado |
|----|----------|---------|--------|
| DOC-IMP-01 | Canales Redis extraídos a constantes | ws_gateway/components/core/constants.py | ✅ Implementado |
| DOC-IMP-01 | main.py usa WSConstants.REDIS_SUBSCRIPTION_CHANNELS | ws_gateway/main.py | ✅ Implementado |
| DOC-IMP-02 | Constantes de Redis Streams documentadas | ws_gateway/components/core/constants.py | ✅ Implementado |
| REDIS-01 | Pipeline helper para batch ACKs | ws_gateway/components/redis/lua_scripts.py | ✅ Implementado |
| REDIS-02 | Lua script para rate limiting atómico | ws_gateway/components/redis/lua_scripts.py | ✅ Implementado |
| DOC-FIX-01 | socketGat.md actualizado con implementación real | socketGat.md | ✅ Implementado |

---

## 1. Arquitectura del Gateway

### 1.1 Patrones Positivos Implementados ✅

| Patrón | Implementación | Beneficio |
|--------|----------------|-----------|
| **Composition over Inheritance** | `ConnectionManager` delega a componentes especializados | Alta cohesión, bajo acoplamiento |
| **Strategy Pattern** | `AuthStrategy` con `JWTAuthStrategy` y `TableTokenAuthStrategy` | Autenticación pluggable |
| **Circuit Breaker** | Implementado para Redis subscriber | Prevención de cascading failures |
| **Singleton (Lazy)** | `EventRouter` singleton en `main.py` | Reduce creación de objetos |
| **Lock Ordering** | Documentado y aplicado: User → Branch → Sector/Session | Prevención de deadlocks |
| **Consumer Groups** | Redis Streams con `XREADGROUP` + `XAUTOCLAIM` | Entrega confiable + catch-up |

### 1.2 Estructura Modular

```
ws_gateway/
├── main.py                    # Orquestador principal + lifespan
├── connection_manager.py      # Fachada que compone componentes
├── redis_subscriber.py        # Pub/Sub legacy (ephemeral)
├── components/
│   ├── auth/strategies.py     # Auth pluggable (JWT, Table Token)
│   ├── connection/            # Heartbeat, Rate Limiter, Index, Locks
│   ├── endpoints/             # Base classes + handlers específicos
│   ├── events/router.py       # Routing de eventos a conexiones
│   ├── metrics/               # Prometheus + collector
│   └── resilience/            # Circuit Breaker, Retry configs
└── core/
    ├── connection/            # Lifecycle, Broadcaster, Cleanup
    └── subscriber/            # Stream Consumer + Drop Tracker
```

**Observación**: La estructura es excelente y sigue Single Responsibility Principle. Cada componente tiene una responsabilidad clara.

---

## 2. Hallazgos de Seguridad

### 🟡 **SEC-HIGH-01**: Token Expiration No Verificado en Tabla Token Diner

**Archivo**: `ws_gateway/components/auth/strategies.py` líneas 317-358

```python
class TableTokenAuthStrategy(AuthStrategy, OriginValidationMixin):
    async def revalidate(self, token: str) -> bool:
        """
        Revalidate table token.
        Table tokens don't typically need revalidation during a session
        as they represent physical presence at a table.
        """
        # ❌ No verifica expiración del token durante sesión larga
        try:
            verify_table_token(token)
            return True
```

**Problema**: El comentario indica que no hay revalidación periódica. Si un token de mesa expira durante una sesión larga (ej: 2+ horas de cena), el cliente mantiene la conexión indefinidamente.

**Impacto**: Bajo-Medio. Los table tokens son de vida corta y solo permiten operaciones limitadas.

**Recomendación**: Agregar verificación periódica (cada 30 min) para tokens de mesa largos:
```python
async def _pre_message_hook(self) -> bool:
    if self._should_check_token_expiry():
        if not await self.validate_table_token():
            await self.websocket.close(code=4001, reason="Token expired")
            return False
    return True
```

---

### 🟡 **SEC-MED-01**: Origin Header Bypass en Development

**Archivo**: `ws_gateway/components/core/constants.py` líneas 300-308

```python
if not origin:
    is_dev = getattr(settings, "environment", "production") == "development"
    if is_dev:
        _logger.warning(
            "WebSocket connection with missing Origin header (allowed in dev mode only)",
        )
        return True  # ← BYPASS
```

**Problema**: En modo desarrollo, conexiones sin Origin header son permitidas. Un misconfiguration de `environment` podría exponer esto en producción.

**Recomendación**: Agregar doble verificación:
```python
if is_dev and not os.environ.get("PRODUCTION_CHECK"):
```

---

### 🟡 **SEC-MED-02**: Non-Recoverable Codes No Incluye Rate Limited

**Archivo**: `Dashboard/src/services/websocket.ts` líneas 154-157

```typescript
const NON_RECOVERABLE_CLOSE_CODES = new Set([
  4001, // AUTH_FAILED
  4003, // FORBIDDEN
  // ❌ 4029 (RATE_LIMITED) no está aquí
])
```

**Problema**: El código 4029 (rate limited) no está en la lista. Un cliente que hace flood de mensajes será desconectado pero intentará reconectar infinitamente.

**Recomendación**: Agregar `4029` a la lista o implementar backoff específico:
```typescript
const NON_RECOVERABLE_CLOSE_CODES = new Set([
  4001, // AUTH_FAILED
  4003, // FORBIDDEN
  4029, // RATE_LIMITED - don't retry, user is spamming
])
```

---

## 3. Hallazgos de Resiliencia

### ✅ **Patrones Robustos Implementados**

| Mecanismo | Estado | Detalles |
|-----------|--------|----------|
| **Circuit Breaker** | ✅ | 5 failures → OPEN, 30s recovery, 3 test calls |
| **Exponential Backoff** | ✅ | 1s-30s con 30% jitter en todos los clientes |
| **Heartbeat Bidireccional** | ✅ | 30s ping, 10s timeout |
| **PEL Recovery** | ✅ | XAUTOCLAIM cada 30 ciclos para mensajes perdidos |
| **NOGROUP Handling** | ✅ | Recreación automática del consumer group |
| **Dead Connection Cleanup** | ✅ | Cada 30s con límite de 500 conexiones muertas |
| **Visibility Change Listener** | ✅ | Reconexión tras sleep/tab switch |

### 🟡 **RES-MED-01**: No Hay Backoff Específico para Errores de Red

**Archivo**: `pwaMenu/src/services/websocket.ts` líneas 268-291

```typescript
private scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      wsLogger.error(' Max reconnect attempts reached')
      return  // ← Se rinde silenciosamente
    }
```

**Problema**: Cuando se alcanza el máximo de intentos, el cliente se rinde sin notificar al usuario.

**Recomendación**: Agregar callback `onMaxReconnectReached` como en Dashboard:
```typescript
private onMaxReconnectReached: MaxReconnectCallback | null = null

if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    this.onMaxReconnectReached?.()
    return
}
```

---

### 🟡 **RES-MED-02**: Stream Consumer Sin Retry Exponencial

**Archivo**: `ws_gateway/core/subscriber/stream_consumer.py` líneas 156-159

```python
except Exception as e:
    logger.error("Error in stream consumer loop", error=str(e))
    await asyncio.sleep(1)  # ← Delay fijo
```

**Problema**: Errores genéricos usan delay fijo de 1s. Bajo carga alta, esto podría causar tight loop.

**Recomendación**: Aplicar backoff progresivo:
```python
error_count = 0
# En el loop:
except Exception as e:
    error_count += 1
    delay = min(1 * (2 ** error_count), 30)
    await asyncio.sleep(delay)
```

---

### 🟢 **RES-LOW-01**: DLQ Solo es Logging

**Archivo**: `ws_gateway/core/subscriber/stream_consumer.py` líneas 206-219

```python
if retry_count >= PEL_MAX_RETRIES:
    logger.error(
        "Message exceeded max retries, moving to DLQ",
        msg_id=message_id,
    )
    await redis_pool.xack(...)
    # TODO: In production, store in actual DLQ for manual review
```

**Problema**: Los mensajes que fallan 3 veces solo se loguean. No hay DLQ real.

**Recomendación para Producción**: Implementar DLQ físico:
```python
await redis_pool.xadd(
    "events:dlq",
    {"original_id": message_id, "data": data_str, "error": str(last_error)}
)
```

---

## 4. Hallazgos de Escalabilidad

### 🟡 **SCALE-HIGH-01**: Broadcasting Sin Pipelining

**Archivo**: `ws_gateway/core/connection/broadcaster.py` líneas 161-180

```python
for i in range(0, len(connections), self._batch_size):
    batch = connections[i : i + self._batch_size]
    results = await asyncio.gather(
        *[self._send_to_connection(ws, payload) for ws in batch],
        return_exceptions=True,
    )
```

**Problema**: Cada `send_json()` es una operación individual. Con 1000 conexiones × 50 batches = 20 serial gather calls.

**Impacto**: Latencia O(n/batch_size) para broadcasts grandes.

**Recomendación**: Considerar `asyncio.Queue` + worker pool:
```python
async def _broadcast_worker(self, queue: asyncio.Queue):
    while True:
        ws, payload = await queue.get()
        await self._send_to_connection(ws, payload)
        queue.task_done()
```

---

### 🟡 **SCALE-HIGH-02**: EventRouter Crea Objeto Por Evento

**Archivo**: `ws_gateway/main.py` líneas 152-161

```python
_event_router: EventRouter | None = None

def _get_event_router() -> EventRouter:
    global _event_router
    if _event_router is None:
        _event_router = EventRouter(manager)
    return _event_router
```

**Observación**: ✅ Ya está optimizado como singleton lazy.

Sin embargo:

**Archivo**: `ws_gateway/components/events/router.py` líneas 196-199

```python
tenant_id = safe_int(event.get("tenant_id"), "tenant_id")
branch_id = safe_int(event.get("branch_id"), "branch_id")
session_id = safe_int(event.get("session_id"), "session_id")
sector_id = safe_int(event.get("sector_id"), "sector_id")
```

**Problema Potencial**: `safe_int()` hace 4 llamadas a logger si hay valores inválidos. En alto throughput (1000 eventos/s con malformed data), esto genera log spam.

**Recomendación**: Agregar rate limiting al logging de validación:
```python
_last_safe_int_warning = 0

def safe_int(value, field_name: str) -> int | None:
    global _last_safe_int_warning
    # ... existing logic ...
    if time.time() - _last_safe_int_warning > 60:
        logger.warning(...)
        _last_safe_int_warning = time.time()
```

---

### 🟡 **SCALE-MED-01**: Lock Manager Sin Sharding Dinámico

**Archivo**: `ws_gateway/components/connection/locks.py`

**Observación**: El sistema usa locks por branch/user, lo cual es bueno. Sin embargo:

- MAX_CACHED_LOCKS = 500
- LOCK_CLEANUP_THRESHOLD = 400

**Problema**: Con 500+ branches simultáneos, se activa cleanup frecuente.

**Recomendación para Multi-Tenant Masivo**: Considerar sharding por tenant_id:
```python
def get_branch_lock(self, branch_id: int, tenant_id: int) -> asyncio.Lock:
    shard_key = f"{tenant_id}:{branch_id}"
    # ...
```

---

## 5. Hallazgos Cliente-Side

### ✅ **Consistencia Entre Clientes**

| Feature | Dashboard | pwaWaiter | pwaMenu |
|---------|-----------|-----------|---------|
| Exponential Backoff | ✅ | ✅ | ✅ |
| Jitter (30%) | ✅ | ✅ | ✅ |
| Heartbeat Timeout | ✅ 10s | ✅ 10s | ✅ 10s |
| Visibility Handler | ✅ | ✅ | ✅ |
| Listener Cleanup | ✅ | ✅ | ✅ |
| Max Reconnect (50) | ✅ | ❌ (10) | ❌ (10) |
| Max Reconnect Callback | ✅ | ❌ | ❌ |
| Throttled Subscriptions | ✅ | ❌ | ❌ |

### 🟡 **CLIENT-MED-01**: Inconsistencia en MAX_RECONNECT_ATTEMPTS

- Dashboard: 50 intentos
- pwaWaiter: 10 intentos
- pwaMenu: 10 intentos

**Recomendación**: Unificar a 50 o crear constante compartida.

---

### 🟢 **CLIENT-LOW-01**: pwaWaiter No Tiene onThrottled

**Archivo**: `pwaWaiter/src/services/websocket.ts`

El servicio no implementa `onThrottled()` para eventos de alta frecuencia.

**Impacto**: Si un waiter recibe muchos eventos rápidos (ej: múltiples pedidos simultáneos), podría causar re-renders excesivos.

**Recomendación**: Agregar `onThrottled()` similar a Dashboard.

---

### 🟢 **CLIENT-LOW-02**: pwaMenu Listeners No Se Limpian al Vaciar

**Archivo**: `pwaMenu/src/services/websocket.ts` líneas 228-237

```typescript
on(eventType: WSEventType | '*', callback: EventCallback): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set())
    }
    this.listeners.get(eventType)!.add(callback)
    return () => {
      this.listeners.get(eventType)?.delete(callback)
      // ❌ No limpia el Set vacío
    }
  }
```

**Problema**: A diferencia de Dashboard, los Sets vacíos no se eliminan del Map.

**Recomendación**: Agregar cleanup:
```typescript
return () => {
    const listeners = this.listeners.get(eventType)
    listeners?.delete(callback)
    if (listeners?.size === 0) {
        this.listeners.delete(eventType)
    }
}
```

---

## 6. Recomendaciones de Implementación

### Prioridad Alta 🔴

| ID | Hallazgo | Esfuerzo | Impacto |
|----|----------|----------|---------|
| SEC-MED-02 | Agregar 4029 a NON_RECOVERABLE_CLOSE_CODES | 5 min | Previene spam reconnect |
| RES-MED-01 | Agregar onMaxReconnectReached a pwaMenu/pwaWaiter | 15 min | UX en error de conexión |
| CLIENT-MED-01 | Unificar MAX_RECONNECT_ATTEMPTS | 5 min | Consistencia |

### Prioridad Media 🟡

| ID | Hallazgo | Esfuerzo | Impacto |
|----|----------|----------|---------|
| SEC-HIGH-01 | Revalidación periódica de table tokens | 1h | Seguridad de sesiones largas |
| RES-MED-02 | Backoff exponencial en stream consumer errors | 30 min | Estabilidad bajo carga |
| SCALE-HIGH-01 | Worker pool para broadcasting | 2-3h | Performance 1000+ conexiones |
| CLIENT-LOW-01 | Agregar onThrottled a pwaWaiter | 30 min | Performance UI |
| CLIENT-LOW-02 | Cleanup de Sets vacíos en pwaMenu | 5 min | Memory leak menor |

### Prioridad Baja 🟢

| ID | Hallazgo | Esfuerzo | Impacto |
|----|----------|----------|---------|
| SEC-MED-01 | Doble verificación de environment | 15 min | Seguridad edge case |
| RES-LOW-01 | Implementar DLQ físico | 2h | Recuperación manual |
| SCALE-MED-01 | Sharding de locks por tenant | 3-4h | Multi-tenant masivo |

---

## 7. Métricas de Observabilidad Existentes ✅

El sistema ya expone métricas relevantes:

| Endpoint | Datos |
|----------|-------|
| `/ws/health` | Conexiones totales, estado básico |
| `/ws/health/detailed` | Redis health, subscriber metrics |
| `/ws/metrics` | Prometheus format: broadcast count, failures, rate limits |

**Métricas de Circuit Breaker**:
- `state`, `failure_count`, `total_calls`, `rejected_calls`, `state_changes`

**Métricas de Rate Limiter**:
- `tracked_connections`, `total_allowed`, `total_rejected`, `evictions`

---

## 8. Conclusión

El sistema WebSocket del proyecto Integrador es **maduro y bien diseñado**:

- ✅ **Arquitectura modular** con composición de componentes
- ✅ **Autenticación robusta** con estrategias pluggables
- ✅ **Resiliencia probada** con circuit breaker, exponential backoff, y PEL recovery
- ✅ **Multi-tenant** con filtrado por tenant_id en todos los broadcasts
- ✅ **Observabilidad** con métricas Prometheus y health checks

**Áreas de Mejora**:
- Consistencia entre clientes (MAX_RECONNECT, throttling)
- Escalabilidad horizontal (worker pools, lock sharding)
- Seguridad edge cases (table token long sessions)

**Próximos Pasos Recomendados**:
1. Implementar fixes de Prioridad Alta (30 min total)
2. Agregar tests de stress para validar comportamiento con 1000+ conexiones
3. Considerar implementación de worker pool si se observan latencias en broadcasts

---

*Auditoría generada por Antigravity Assistant*
