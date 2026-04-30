## Context

El sistema tiene un flujo completo desde la creación de rondas hasta la preparación en cocina (C-10/C-11). El eslabón faltante es el cobro: sin `BillingService`, no existe forma de transicionar `TableSession` de `PAYING` a `CLOSED`. Este change introduce el dominio contable completo — cuatro modelos, un servicio de dominio, una abstracción de pasarela de pagos y cuatro eventos Outbox financieros.

Estado actual: `table_sessions` tiene el estado `PAYING` pero nada lo dispara ni lo resuelve. `BillingService.request_check()` disparará `OPEN → PAYING`; `BillingService._resolve_check()` disparará `PAYING → CLOSED` cuando la suma de allocations cubra el total.

## Goals / Non-Goals

**Goals:**
- Implementar el algoritmo FIFO de asignación de pagos a cargos con cobertura total de tests.
- Abstracción `PaymentGateway` ABC + `MercadoPagoGateway` (no inline en router).
- Endpoints `/api/billing/` y extensión de `/api/waiter/` para pagos manuales.
- Outbox atómico para los cuatro eventos financieros.
- Rate limiting Redis por endpoint.
- Migración 009 con rollback seguro.

**Non-Goals:**
- UI en Dashboard/pwaMenu/pwaWaiter (gates posteriores: C-16, C-18, C-19, C-21).
- Refunds / devoluciones (backlog futuro).
- Otras pasarelas de pago además de MercadoPago (la ABC lo habilita sin trabajo extra aquí).
- Loyalty/Customer tracking (C-19).

## Decisions

### 1. BillingService como único orquestador de transiciones de TableSession

**Decisión**: `BillingService` es el único lugar que llama a `session.status = PAYING` y `session.status = CLOSED`. Los routers nunca tocan el estado de la sesión directamente.

**Alternativa descartada**: router llama `table_session_service.set_paying()` + `billing_service.create_check()` como dos operaciones separadas. Riesgo: si la segunda falla, la sesión queda en PAYING sin check.

**Por qué**: atomicidad en una sola transacción. `request_check()` hace `session.status = PAYING`, crea el `app_check` y escribe el evento Outbox en el mismo `safe_commit()`.

### 2. Algoritmo FIFO via tabla `allocation`

**Decisión**: la asignación FIFO se implementa como una tabla junction `allocation(charge_id, payment_id, amount_cents)`. Cada vez que llega un pago, se consultan los charges con `remaining_cents > 0` ordenados por `created_at ASC`, y se crean allocations hasta agotar el pago.

`remaining_cents` es un campo calculado = `charge.amount_cents - SUM(allocation.amount_cents WHERE charge_id = charge.id)`. No se desnormaliza — se calcula en la query para evitar inconsistencias.

**Alternativa descartada**: columna `paid_cents` en `charge`. Introduce doble source of truth y requiere actualización en cascada que puede desincronizarse.

### 3. PaymentGateway ABC inyectada por FastAPI DI

```python
class PaymentGateway(ABC):
    @abstractmethod
    async def create_preference(self, check: Check, items: list[ChargeOut]) -> PreferenceOut: ...

    @abstractmethod
    async def verify_webhook(self, payload: bytes, signature: str) -> WebhookEvent: ...
```

`MercadoPagoGateway` implementa la ABC. Se registra en el contenedor de FastAPI como dependencia. Los routers reciben `gateway: PaymentGateway = Depends(get_payment_gateway)`.

**Alternativa descartada**: instanciar `MercadoPagoGateway` directo en el router. Acopla el router a la implementación concreta e impide testear sin la API de MP.

### 4. Verificación de webhook MP con idempotency key

El webhook de MercadoPago puede llegar más de una vez. Se verifica la firma HMAC con `MERCADOPAGO_WEBHOOK_SECRET` y se usa `payment.external_id` (ID de MP) como idempotency key: si ya existe un `Payment` con ese `external_id`, se retorna 200 sin reprocesar.

### 5. Outbox atómico para eventos financieros

Los cuatro eventos (`CHECK_REQUESTED`, `CHECK_PAID`, `PAYMENT_APPROVED`, `PAYMENT_REJECTED`) usan el patrón Outbox establecido en C-10. Se escribe en `outbox_event` en la misma transacción que el cambio de estado. El procesador background lo levanta y publica a Redis Streams.

**Regla de negocio**: si `safe_commit()` falla, ni el estado de negocio ni el evento cambian. At-least-once garantizado.

### 6. Rate limiting Redis por endpoint

Se reutiliza el mismo mecanismo Redis+Lua de C-03 (auth rate limiting). Tres límites distintos:
- `billing:check_request:{ip}` → 5/min
- `billing:payment:{ip}` → 20/min
- `billing:critical:{ip}` → 5/min (webhook MP, preferencia)

### 7. `app_check` como nombre de tabla

`check` es palabra reservada SQL. El modelo SQLAlchemy usa `__tablename__ = "app_check"`. El modelo Python se llama `Check` (sin prefijo) ya que en Python no es reservada.

## Risks / Trade-offs

- **[Risk] MercadoPago IPN fuera de orden** → Mitigation: el webhook procesa solo estados terminales (`approved`, `rejected`). Si llega `approved` antes de que el `Payment` esté en DB, el webhook retorna 404 y MP reintentará.
- **[Risk] FIFO con concurrencia** → Mitigation: la query de allocation usa `SELECT FOR UPDATE` en los charges pendientes para serializar asignaciones concurrentes de pagos al mismo check.
- **[Risk] Centavos con redondeo en partes iguales** → Mitigation: `total // n` para los primeros `n-1` comensales, el último absorbe `total - sum(primeros)`. Esto es la convención del sistema (ver reglas de negocio §7).
- **[Risk] `MERCADOPAGO_WEBHOOK_SECRET` en producción** → Mitigation: variable de entorno, nunca hardcodeada. Fail-closed: si no está configurada, el webhook rechaza con 500 al iniciar.

## Migration Plan

**Migración 009** (forward):
1. `CREATE TABLE app_check (...)` — FK a `table_session`
2. `CREATE TABLE charge (...)` — FK a `app_check`, FK a `diner`
3. `CREATE TABLE payment (...)` — FK a `app_check`
4. `CREATE TABLE allocation (...)` — FK a `charge`, FK a `payment`

**Rollback**: `DROP TABLE allocation`, `DROP TABLE payment`, `DROP TABLE charge`, `DROP TABLE app_check` (en ese orden por FKs). No hay datos existentes a migrar.

**Deploy**: sin downtime — las tablas son nuevas, no modifica tablas existentes. La columna `table_session.status` ya existe con valor `OPEN`; ningún código existente toca `PAYING → CLOSED`.
