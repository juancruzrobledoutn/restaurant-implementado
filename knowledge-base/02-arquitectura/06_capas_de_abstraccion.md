# Capas de Abstracción

Todas las capas de abstracción diseñadas para extensibilidad, con su estado actual y puntos de extensión.

---

## 1. PaymentGateway (ABC)

**Propósito:** Abstraer el proveedor de pagos para soportar múltiples gateways sin cambiar lógica de negocio.

| Aspecto | Detalle |
|---------|---------|
| Interface | `backend/rest_api/services/payments/gateway.py` |
| Clases | `PaymentGateway` (ABC), `PaymentResult`, `PaymentPreference` |
| Implementación actual | `MercadoPagoGateway` (`mercadopago_gateway.py`) |
| Extensión prevista | Stripe, PayPal, transferencia bancaria directa |
| Estado | **FUNCIONAL pero no wired** |

**Métodos de la interface:**

```python
class PaymentGateway(ABC):
    def create_preference(self, preference: PaymentPreference) -> PaymentResult: ...
    def verify_payment(self, payment_id: str) -> PaymentResult: ...
    def verify_webhook_signature(self, signature: str, request_id: str, data_id: str) -> bool: ...
    def handle_webhook(self, payload: dict) -> PaymentResult: ...
```

**Nota importante:** La abstracción existe, pero el router de billing todavía usa código inline de MercadoPago. Falta el wiring: el router debería instanciar el gateway via factory pattern en vez de importar MercadoPago directamente.

**Para agregar un nuevo gateway:**
1. Crear clase que herede de `PaymentGateway`
2. Implementar los 4 métodos
3. Registrar en factory (pendiente de crear)
4. Configurar via variable de entorno (`PAYMENT_GATEWAY=stripe`)

---

## 2. WebSocket Auth Strategy

**Propósito:** Autenticar conexiones WebSocket con diferentes mecanismos según el tipo de cliente.

| Aspecto | Detalle |
|---------|---------|
| Interface | `ws_gateway/components/auth/strategies.py` |
| Clases | `AuthStrategy` (ABC), `AuthResult` |
| Estado | **COMPLETA — en uso activo** |

**Implementaciones:**

| Strategy | Uso | Cómo autentica |
|----------|-----|----------------|
| `JWTAuthStrategy` | Staff (waiter, kitchen, admin) | JWT Bearer token |
| `TableTokenAuthStrategy` | Diners (pwaMenu) | HMAC table token |
| `CompositeAuthStrategy` | Endpoints mixtos | Cadena de strategies (prueba cada una hasta que una tenga éxito) |
| `NullAuthStrategy` | Testing | Siempre succeed o siempre fail (configurable) |

**Extensión prevista:** `OAuth2Strategy`, `APIKeyStrategy`

**Para agregar una nueva strategy:**
1. Crear clase que herede de `AuthStrategy`
2. Implementar `authenticate(request) -> AuthResult`
3. Agregar al `CompositeAuthStrategy` o usarla directamente en el endpoint

---

## 3. Domain Service Base Classes

**Propósito:** Proveer CRUD genérico con hooks para lógica de negocio específica por entidad.

| Aspecto | Detalle |
|---------|---------|
| Interface | `backend/rest_api/services/base_service.py` |
| Clases | `BaseService[Model]`, `BaseCRUDService[Model, Output]`, `BranchScopedService[Model, Output]` |
| Estado | **COMPLETA — 14+ servicios heredan de estas bases** |

**Jerarquía:**

```
BaseService[Model]
  └── BaseCRUDService[Model, Output]
        └── BranchScopedService[Model, Output]
```

**Template Methods (hooks):**

| Hook | Cuándo se ejecuta | Uso típico |
|------|-------------------|-----------|
| `_validate_create(data, tenant_id)` | Antes de crear | Validar unicidad, reglas de negocio |
| `_validate_update(entity, data)` | Antes de actualizar | Validar transiciones de estado |
| `_validate_delete(entity)` | Antes de borrar | Verificar dependencias |
| `_after_create(entity, user_id, user_email)` | Después de crear | Emitir eventos WebSocket, logging |
| `_after_update(entity, user_id, user_email)` | Después de actualizar | Invalidar cache, notificar |
| `_after_delete(entity_info, user_id, user_email)` | Después de borrar | Cascade delete, limpiar cache |

**Para crear un nuevo servicio:**

```python
# 1. Crear en rest_api/services/domain/my_entity_service.py
from rest_api.services.base_service import BranchScopedService
from shared.utils.admin_schemas import MyEntityOutput

class MyEntityService(BranchScopedService[MyEntity, MyEntityOutput]):
    def __init__(self, db: Session):
        super().__init__(
            db=db,
            model=MyEntity,
            output_schema=MyEntityOutput,
            entity_name="Mi Entidad"
        )

    def _validate_create(self, data: dict, tenant_id: int) -> None:
        # Validaciones custom
        ...

    def _after_delete(self, entity_info: dict, user_id: int, user_email: str) -> None:
        # Side effects post-borrado
        ...

# 2. Exportar en rest_api/services/domain/__init__.py
# 3. Usar en router (mantener router thin!)
```

---

## 4. Repository Pattern

**Propósito:** Abstraer el acceso a datos con filtrado automático por tenant/branch y soft delete.

| Aspecto | Detalle |
|---------|---------|
| Interface | `backend/rest_api/services/crud/repository.py` |
| Clases | `TenantRepository[Model]`, `BranchRepository[Model]` |
| Estado | **COMPLETA** |

**Métodos principales:**

| Método | Descripción |
|--------|-------------|
| `find_all(tenant_id, options=[])` | Listar con filtro automático de is_active |
| `find_by_id(id, tenant_id)` | Buscar por ID con validación de tenant |
| `create(data)` | Crear con validaciones |
| `update(id, data)` | Actualizar parcial |
| `delete(id)` | Soft delete (is_active = False) |

**Diferencia clave:**
- `TenantRepository` — filtra por `tenant_id` solamente
- `BranchRepository` — filtra por `tenant_id` + `branch_id`

---

## 5. Permission Strategy

**Propósito:** Centralizar la lógica de autorización basada en roles.

| Aspecto | Detalle |
|---------|---------|
| Interface | `backend/rest_api/services/permissions/` |
| Clase principal | `PermissionContext` |
| Estado | **COMPLETA** |

**Uso:**

```python
from rest_api.services.permissions import PermissionContext

ctx = PermissionContext(user)  # user viene del JWT decoded
ctx.require_management()        # Raises ForbiddenError si no es ADMIN/MANAGER
ctx.require_branch_access(branch_id)  # Verifica acceso al branch
ctx.can(action, entity)         # Check granular
```

**Para agregar un nuevo rol:** Agregar strategy correspondiente al directorio de permissions.

---

## 6. Event Publishing (Dual Pattern)

**Propósito:** Garantizar entrega de eventos críticos (outbox) mientras se mantiene baja latencia para eventos no críticos (direct).

| Patrón | Interface | Uso |
|--------|-----------|-----|
| Outbox | `backend/rest_api/services/events/outbox_service.py` | Eventos financieros/críticos |
| Direct Redis | `backend/shared/infrastructure/events/` | Eventos de baja criticidad |

**Cuándo usar cada patrón:**

| Patrón | Eventos | Garantía |
|--------|---------|----------|
| **Outbox** (must not lose) | CHECK_REQUESTED/PAID, PAYMENT_*, ROUND_SUBMITTED/READY, SERVICE_CALL_CREATED | At-least-once delivery, transaccional con BD |
| **Direct Redis** (lower latency) | ROUND_CONFIRMED/IN_KITCHEN/SERVED, CART_*, TABLE_*, ENTITY_* | Best-effort, ~0ms latencia extra |

**Para agregar un nuevo evento:**
1. Decidir patrón: outbox si es financiero o crítico, direct si tolera pérdida
2. Outbox: `write_billing_outbox_event(db, tenant_id, event_type, ...)` + `db.commit()`
3. Direct: `await publish_event(channel, event_data)`

---

## 7. Shared WebSocket Client

**Propósito:** Cliente WebSocket reutilizable para todos los frontends.

| Aspecto | Detalle |
|---------|---------|
| Interface | `shared/websocket-client.ts` |
| Función | `createWebSocketClient(config) → WSClient` |
| Estado | **SCAFFOLD — creado pero no adoptado** |

**Métodos:**

| Método | Descripción |
|--------|-------------|
| `connect()` | Establecer conexión |
| `disconnect()` | Cerrar conexión |
| `on(event, handler)` | Suscribirse a eventos |
| `onConnectionChange(handler)` | Escuchar cambios de estado de conexión |
| `updateToken(token)` | Actualizar token sin reconectar |

**Estado actual:** Cada frontend (Dashboard, pwaMenu, pwaWaiter) tiene su propio `websocket.ts` con lógica duplicada. El shared client está preparado para reemplazarlos pero la migración no se ha hecho.

---

## 8. Theme System

**Propósito:** Soporte para temas claro/oscuro via CSS variables.

| Aspecto | Detalle |
|---------|---------|
| Interface | `Dashboard/src/utils/theme.ts` |
| Funciones | `getTheme()`, `setTheme()`, `toggleTheme()`, `initTheme()` |
| Estado | **FUNCIONAL en Dashboard** |

**Implementación:**
- CSS variables definidas en `[data-theme="light"]` y `[data-theme="dark"]`
- Toggle disponible en Dashboard header
- pwaMenu y pwaWaiter: CSS variables preparadas pero **sin toggle UI**

**Para activar en otro frontend:**
1. Copiar `theme.ts` de Dashboard
2. Llamar `initTheme()` en el entry point
3. Agregar botón de toggle en la UI
