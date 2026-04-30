# API y Endpoints

Este documento detalla todos los endpoints disponibles en la REST API (puerto 8000) y el WebSocket Gateway (puerto 8001).

---

## Convenciones Generales

### Autenticación

| Método | Header/Cookie | Usado por |
|--------|---------------|-----------|
| JWT Bearer | `Authorization: Bearer {access_token}` | Dashboard, pwaWaiter, Kitchen |
| Table Token | `X-Table-Token: {token}` | pwaMenu (comensales) |
| Cookie HttpOnly | `refresh_token` cookie | Refresh silencioso |

### Tokens y Tiempos de Vida

| Token | Duración | Almacenamiento |
|-------|----------|----------------|
| Access Token (JWT) | 15 minutos | Memoria (frontend) |
| Refresh Token | 7 días | Cookie HttpOnly |
| Table Token (HMAC) | 3 horas | localStorage (pwaMenu) |

### Formato de Respuesta

- Respuestas exitosas: JSON directo (sin wrapper)
- Errores: `{"detail": "mensaje"}` o `{"detail": [{"loc": [...], "msg": "...", "type": "..."}]}`
- Paginación: query params `?limit=50&offset=0` (valores por defecto)
- IDs: `BigInteger` (numéricos)
- Precios: enteros en centavos (ej: $125.50 = `12550`)

### Códigos de Estado HTTP

| Código | Significado |
|--------|-------------|
| 200 | Operación exitosa |
| 201 | Recurso creado |
| 204 | Eliminación exitosa |
| 400 | Request inválida / Error de validación de negocio |
| 401 | No autenticado / Token expirado |
| 403 | Sin permisos para la operación |
| 404 | Recurso no encontrado |
| 422 | Error de validación de datos (Pydantic) |
| 429 | Rate limit excedido |
| 500 | Error interno del servidor |

---

## Autenticación (/api/auth/)

| Método | Endpoint | Auth | Descripción | Body/Params |
|--------|----------|------|-------------|-------------|
| POST | `/api/auth/login` | Ninguna | Iniciar sesión | `{"email": "...", "password": "..."}` |
| POST | `/api/auth/refresh` | Cookie | Renovar access token | Cookie `refresh_token` (automático) |
| POST | `/api/auth/logout` | JWT | Cerrar sesión e invalidar tokens | - |
| GET | `/api/auth/me` | JWT | Obtener info del usuario actual | - |
| POST | `/api/auth/change-password` | JWT | Cambiar contraseña del usuario autenticado | `{"current_password": "...", "new_password": "..."}` |

**Respuesta de login:**
```json
{
  "access_token": "eyJ...",
  "token_type": "bearer",
  "user": {
    "id": 1,
    "email": "admin@demo.com",
    "full_name": "Admin",
    "tenant_id": 1,
    "branch_ids": [1, 2],
    "roles": ["ADMIN"]
  }
}
```

**Nota sobre refresh:** El refresh token se envía como cookie HttpOnly. El frontend debe usar `credentials: 'include'` en todas las requests. Dashboard y pwaWaiter refrescan proactivamente cada 14 minutos.

**Nota sobre change-password:**
- `400` → contraseña actual incorrecta (`{"detail": "Current password is incorrect"}`)
- `400` → nueva contraseña no cumple política (mínimo 8 chars, 1 mayúscula, 1 dígito)
- `400` → nueva contraseña igual a la actual
- Todos los roles pueden usar este endpoint (accesible desde la tab Perfil del `/settings`)

---

## Endpoints Públicos (/api/public/)

No requieren autenticación.

| Método | Endpoint | Auth | Descripción | Params |
|--------|----------|------|-------------|--------|
| GET | `/api/public/menu/{slug}` | Ninguna | Menú completo por slug de sucursal | `slug`: identificador de sucursal |
| GET | `/api/public/branches` | Ninguna | Listado de sucursales activas | - |

**Uso de `/api/public/branches`:** Lo utiliza pwaWaiter en el flujo pre-login para que el mozo seleccione su sucursal ANTES de autenticarse.

**Respuesta de menú público:** Incluye categorías, subcategorías, productos con precios, imágenes, alérgenos y disponibilidad.

---

## Sesión de Mesa (/api/tables/)

| Método | Endpoint | Auth | Descripción |
|--------|----------|------|-------------|
| GET | `/api/tables/{id}/session` | JWT o Token | Obtener sesión por ID numérico de mesa |
| GET | `/api/tables/code/{code}/session` | JWT o Token | Obtener sesión por código alfanumérico |

**Importante sobre códigos de mesa:**
- Los códigos son alfanuméricos (ej: "INT-01", "TER-05")
- Los códigos NO son únicos entre sucursales
- El `branch_slug` es necesario para desambiguar

---

## Operaciones del Comensal (/api/diner/)

Autenticación vía `X-Table-Token`.

| Método | Endpoint | Auth | Descripción | Body |
|--------|----------|------|-------------|------|
| POST | `/api/diner/register` | X-Table-Token | Registrar comensal en la sesión | `{"name": "...", "color": "#..."}` |
| GET | `/api/diner/session` | X-Table-Token | Obtener info de la sesión actual | - |
| POST | `/api/diner/rounds/submit` | X-Table-Token | Enviar ronda de pedidos | `{"items": [...]}` |
| GET | `/api/diner/rounds` | X-Table-Token | Obtener rondas de la sesión | - |
| POST | `/api/diner/cart/add` | X-Table-Token | Agregar item al carrito compartido | `{"product_id": ..., "quantity": ..., "notes": "..."}` |
| PUT | `/api/diner/cart/{item_id}` | X-Table-Token | Actualizar item del carrito | `{"quantity": ..., "notes": "..."}` |
| DELETE | `/api/diner/cart/{item_id}` | X-Table-Token | Eliminar item del carrito | - |
| POST | `/api/diner/service-call` | X-Table-Token | Llamar al mozo | `{"type": "waiter_call"}` |

---

## Fidelización de Cliente (/api/customer/)

Autenticación vía `X-Table-Token`.

| Método | Endpoint | Auth | Descripción |
|--------|----------|------|-------------|
| GET | `/api/customer/profile` | X-Table-Token | Perfil del cliente (si existe) |
| POST | `/api/customer/opt-in` | X-Table-Token | Registro voluntario con consentimiento GDPR |
| GET | `/api/customer/preferences` | X-Table-Token | Preferencias implícitas acumuladas |
| GET | `/api/customer/history` | X-Table-Token | Historial de visitas |

**Fases del sistema de fidelización:**
1. Device tracking (automático, sin datos personales)
2. Preferencias implícitas (basadas en pedidos anteriores)
3. (Futuro) Opt-in con consentimiento GDPR

---

## Operaciones de Cocina (/api/kitchen/)

Autenticación JWT con rol KITCHEN requerido.

| Método | Endpoint | Auth | Descripción |
|--------|----------|------|-------------|
| GET | `/api/kitchen/rounds` | JWT (KITCHEN) | Rondas pendientes para cocina (solo SUBMITTED+) |
| PUT | `/api/kitchen/rounds/{id}/status` | JWT (KITCHEN) | Actualizar estado de ronda |
| GET | `/api/kitchen/tickets` | JWT (KITCHEN) | Tickets de cocina activos |
| PUT | `/api/kitchen/tickets/{id}/status` | JWT (KITCHEN) | Actualizar estado de ticket |

**Importante:** La cocina NO ve pedidos en estado PENDING ni CONFIRMED. Solo los pedidos con estado SUBMITTED o superior aparecen en la vista de cocina.

**Flujo de estados visibles por cocina:**
```
SUBMITTED → IN_KITCHEN → READY → SERVED
```

---

## Recetas (/api/recipes/)

Autenticación JWT con rol KITCHEN, MANAGER o ADMIN.

| Método | Endpoint | Auth | Descripción |
|--------|----------|------|-------------|
| GET | `/api/recipes/` | JWT (K/M/A) | Listar recetas |
| GET | `/api/recipes/{id}` | JWT (K/M/A) | Detalle de receta con ingredientes |
| POST | `/api/recipes/` | JWT (K/M/A) | Crear receta |
| PUT | `/api/recipes/{id}` | JWT (K/M/A) | Actualizar receta |
| DELETE | `/api/recipes/{id}` | JWT (A) | Eliminar receta (soft delete) |

---

## Facturación (/api/billing/)

Endpoints protegidos con rate limiting (5-20 requests/minuto según endpoint).

| Método | Endpoint | Auth | Descripción | Rate Limit |
|--------|----------|------|-------------|------------|
| POST | `/api/billing/check/request` | JWT/Token | Solicitar la cuenta | 5/min |
| GET | `/api/billing/check/{session_id}` | JWT/Token | Obtener estado de la cuenta | 20/min |
| POST | `/api/billing/payment/preference` | JWT/Token | Crear preferencia Mercado Pago | 5/min |
| POST | `/api/billing/payment/webhook` | Ninguna | Webhook de Mercado Pago (IPN) | - |
| GET | `/api/billing/payment/{id}/status` | JWT/Token | Estado de un pago | 20/min |

**Modelo de facturación:**
```
Check (cuenta)
  └── Charge (cargo por item/ronda)
        └── Allocation (asignación FIFO)
              └── Payment (pago parcial o total)
```

**Métodos de pago soportados:**
- Mercado Pago (online via preferencia de pago)
- Efectivo (registro manual por mozo)
- Tarjeta (registro manual por mozo)
- Transferencia (registro manual por mozo)

---

## Operaciones del Mozo (/api/waiter/)

Autenticación JWT con rol WAITER requerido.

| Método | Endpoint | Auth | Descripción |
|--------|----------|------|-------------|
| GET | `/api/waiter/verify-branch-assignment` | JWT (WAITER) | Verificar asignación diaria |
| GET | `/api/waiter/tables` | JWT (WAITER) | Mesas del sector asignado |
| POST | `/api/waiter/tables/{id}/activate` | JWT (WAITER) | Activar mesa (crear sesión) |
| POST | `/api/waiter/tables/{id}/close` | JWT (WAITER) | Cerrar mesa (post-pago) |
| POST | `/api/waiter/sessions/{id}/rounds` | JWT (WAITER) | Enviar ronda (comanda rápida) |
| POST | `/api/waiter/sessions/{id}/check` | JWT (WAITER) | Solicitar la cuenta |
| POST | `/api/waiter/payments/manual` | JWT (WAITER) | Registrar pago manual |
| GET | `/api/waiter/branches/{id}/menu` | JWT (WAITER) | Menú compacto (sin imágenes) |
| GET | `/api/waiter/service-calls` | JWT (WAITER) | Llamadas de servicio pendientes |
| PUT | `/api/waiter/service-calls/{id}/ack` | JWT (WAITER) | Acusar recibo de llamada |
| PUT | `/api/waiter/service-calls/{id}/close` | JWT (WAITER) | Cerrar llamada de servicio |

**Flujo pre-login del mozo:**
1. `GET /api/public/branches` → seleccionar sucursal (SIN autenticación)
2. Login con credenciales
3. `GET /api/waiter/verify-branch-assignment?branch_id={id}` → verificar asignación HOY
4. Si no está asignado → pantalla "Acceso Denegado"
5. Si está asignado → acceso a la aplicación

**Comanda rápida:** El endpoint `GET /api/waiter/branches/{id}/menu` retorna un menú compacto sin imágenes, optimizado para que el mozo tome pedidos de clientes sin teléfono.

**Pago manual:**
```json
POST /api/waiter/payments/manual
{
  "session_id": 123,
  "amount_cents": 15000,
  "method": "cash",
  "reference": "opcional"
}
```

---

## Administración (/api/admin/)

Autenticación JWT con roles según la operación (ver tabla RBAC).

### CRUD Genérico

Todos los endpoints admin siguen el mismo patrón:

| Método | Endpoint | Auth | Descripción |
|--------|----------|------|-------------|
| GET | `/api/admin/{entity}` | JWT (según rol) | Listar con paginación (`?limit=50&offset=0`) |
| GET | `/api/admin/{entity}/{id}` | JWT (según rol) | Obtener por ID |
| POST | `/api/admin/{entity}` | JWT (ADMIN/MANAGER) | Crear entidad |
| PUT | `/api/admin/{entity}/{id}` | JWT (ADMIN/MANAGER) | Actualizar entidad |
| DELETE | `/api/admin/{entity}/{id}` | JWT (ADMIN) | Soft delete con preview de cascada |

### Entidades Administrables

| Entidad | Endpoint | Roles que pueden crear | Roles que pueden eliminar |
|---------|----------|----------------------|--------------------------|
| Categories | `/api/admin/categories` | ADMIN, MANAGER | ADMIN |
| Subcategories | `/api/admin/subcategories` | ADMIN, MANAGER | ADMIN |
| Products | `/api/admin/products` | ADMIN, MANAGER | ADMIN |
| Branches | `/api/admin/branches` | ADMIN | ADMIN |
| Sectors | `/api/admin/sectors` | ADMIN, MANAGER | ADMIN |
| Tables | `/api/admin/tables` | ADMIN, MANAGER | ADMIN |
| Staff | `/api/admin/staff` | ADMIN, MANAGER | ADMIN |
| Allergens | `/api/admin/allergens` | ADMIN, MANAGER | ADMIN |
| Promotions | `/api/admin/promotions` | ADMIN, MANAGER | ADMIN |
| Ingredients | `/api/admin/ingredients` | ADMIN | ADMIN |
| Customizations | `/api/admin/customizations` | ADMIN, MANAGER | ADMIN |

### Customizaciones de Producto

| Método | Endpoint | Auth | Descripción |
|--------|----------|------|-------------|
| GET | `/api/admin/customizations` | JWT (ADMIN/MANAGER) | Listar opciones de personalización |
| POST | `/api/admin/customizations` | JWT (ADMIN/MANAGER) | Crear opción de personalización |
| GET | `/api/admin/customizations/{id}` | JWT (ADMIN/MANAGER) | Obtener opción por ID |
| PUT | `/api/admin/customizations/{id}` | JWT (ADMIN/MANAGER) | Actualizar opción |
| DELETE | `/api/admin/customizations/{id}` | JWT (ADMIN) | Eliminar opción (soft delete) |
| POST | `/api/admin/customizations/{id}/products/{pid}` | JWT (ADMIN/MANAGER) | Vincular producto a opción |
| DELETE | `/api/admin/customizations/{id}/products/{pid}` | JWT (ADMIN/MANAGER) | Desvincular producto de opción |
| PUT | `/api/admin/customizations/{id}/products` | JWT (ADMIN/MANAGER) | Establecer vínculos de producto en lote |

**Eventos WebSocket:** Toda operación CRUD emite eventos `ENTITY_CREATED`, `ENTITY_UPDATED` o `ENTITY_DELETED` para que los clientes conectados actualicen su UI en tiempo real.

**Preview de cascada en DELETE:** Antes de eliminar, se puede consultar qué entidades dependientes serán afectadas:
```json
{
  "message": "Categoría eliminada",
  "affected": {
    "Subcategory": 3,
    "Product": 12,
    "BranchProduct": 24
  }
}
```

### Tabla RBAC Completa

| Rol | Crear | Editar | Eliminar |
|-----|-------|--------|----------|
| ADMIN | Todo | Todo | Todo |
| MANAGER | Staff, Mesas, Alérgenos, Promociones (sus sucursales) | Lo mismo | Nada |
| KITCHEN | Nada | Nada | Nada |
| WAITER | Nada | Nada | Nada |

### Configuración de Sucursal (C-28)

| Método | Endpoint | Auth | Descripción |
|--------|----------|------|-------------|
| GET | `/api/admin/branches/{id}/settings` | JWT (ADMIN/MANAGER) | Obtener configuración operacional de una sucursal |
| PATCH | `/api/admin/branches/{id}` | JWT (ADMIN/MANAGER) | Actualizar configuración operacional de una sucursal |

**Body PATCH `/api/admin/branches/{id}/settings`:**
```json
{
  "slug": "mi-sucursal",
  "timezone": "America/Argentina/Buenos_Aires",
  "opening_hours": {
    "monday":    [{"open": "09:00", "close": "23:00"}],
    "tuesday":   [{"open": "09:00", "close": "23:00"}],
    "wednesday": [{"open": "09:00", "close": "23:00"}],
    "thursday":  [{"open": "09:00", "close": "23:00"}],
    "friday":    [{"open": "09:00", "close": "24:00"}],
    "saturday":  [{"open": "10:00", "close": "24:00"}],
    "sunday":    null
  }
}
```

**Notas:**
- `409` → el slug ya está en uso por otra sucursal del mismo tenant
- El slug solo acepta caracteres `[a-z0-9-]` (validado en frontend y backend)
- `opening_hours` es un objeto con 7 claves de día (monday–sunday); `null` significa cerrado ese día
- Los intervalos con `close: "24:00"` representan cierre a medianoche
- MANAGER solo puede editar sucursales en las que tiene `UserBranchRole`

### Configuración de Tenant (C-28)

| Método | Endpoint | Auth | Descripción |
|--------|----------|------|-------------|
| GET | `/api/admin/tenants/me` | JWT (ADMIN) | Obtener configuración del tenant del usuario autenticado |
| PATCH | `/api/admin/tenants/me` | JWT (ADMIN) | Actualizar nombre del tenant |

**Body PATCH `/api/admin/tenants/me`:**
```json
{
  "name": "Mi Restaurante"
}
```

**Notas:**
- Solo accesible por ADMIN (los demás roles reciben 403)
- `name` es requerido, máximo 200 caracteres
- El `tenant_id` se infiere del usuario autenticado (no hay riesgo de cross-tenant)

---

## Health Checks

### REST API

| Método | Endpoint | Auth | Descripción |
|--------|----------|------|-------------|
| GET | `/api/health` | Ninguna | Health check básico |
| GET | `/api/health/detailed` | Ninguna | Health check con estado de dependencias |

**Respuesta detallada:**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "dependencies": {
    "database": "healthy",
    "redis": "healthy"
  }
}
```

### WebSocket Gateway

| Método | Endpoint | Auth | Descripción |
|--------|----------|------|-------------|
| GET | `/ws/health` | Ninguna | Health check básico del gateway |
| GET | `/ws/health/detailed` | Ninguna | Health check con estado de Redis y conexiones |
| GET | `/ws/metrics` | Ninguna | Métricas en formato Prometheus |

---

## WebSocket Endpoints (Puerto 8001)

### Conexiones

| Endpoint | Auth | Rol | Descripción |
|----------|------|-----|-------------|
| `/ws/waiter?token=JWT` | JWT | WAITER | Notificaciones del mozo |
| `/ws/kitchen?token=JWT` | JWT | KITCHEN | Notificaciones de cocina |
| `/ws/admin?token=JWT` | JWT | ADMIN/MANAGER | Notificaciones admin |
| `/ws/diner?table_token=TOKEN` | Table Token | Comensal | Actualizaciones en tiempo real |

### Event Catch-up (Recuperación post-reconexión)

| Método | Endpoint | Auth | Descripción | Params |
|--------|----------|------|-------------|--------|
| GET | `/ws/catchup` | JWT | Catch-up de eventos para staff | `branch_id`, `since` (timestamp) |
| GET | `/ws/catchup/session` | Table Token | Catch-up de eventos para comensales | `session_id`, `since` (timestamp) |

### Tipos de Eventos

#### Ciclo de Vida de Rondas
| Evento | Descripción |
|--------|-------------|
| `ROUND_PENDING` | Ronda creada por comensal |
| `ROUND_CONFIRMED` | Ronda confirmada por mozo |
| `ROUND_SUBMITTED` | Ronda enviada a cocina |
| `ROUND_IN_KITCHEN` | Ronda en preparación |
| `ROUND_READY` | Ronda lista para servir |
| `ROUND_SERVED` | Ronda servida |
| `ROUND_CANCELED` | Ronda cancelada |

#### Carrito Compartido
| Evento | Descripción |
|--------|-------------|
| `CART_ITEM_ADDED` | Item agregado al carrito |
| `CART_ITEM_UPDATED` | Item actualizado (cantidad, notas) |
| `CART_ITEM_REMOVED` | Item eliminado del carrito |
| `CART_CLEARED` | Carrito vaciado |

#### Servicio
| Evento | Descripción |
|--------|-------------|
| `SERVICE_CALL_CREATED` | Comensal llamó al mozo |
| `SERVICE_CALL_ACKED` | Mozo acusó recibo |
| `SERVICE_CALL_CLOSED` | Llamada cerrada |

#### Facturación
| Evento | Descripción |
|--------|-------------|
| `CHECK_REQUESTED` | Se solicitó la cuenta |
| `CHECK_PAID` | Cuenta pagada completamente |
| `PAYMENT_APPROVED` | Pago aprobado |
| `PAYMENT_REJECTED` | Pago rechazado |

#### Mesas
| Evento | Descripción |
|--------|-------------|
| `TABLE_SESSION_STARTED` | Nueva sesión de mesa iniciada |
| `TABLE_CLEARED` | Mesa cerrada y limpia |
| `TABLE_STATUS_CHANGED` | Cambio de estado de mesa |

#### Administración
| Evento | Descripción |
|--------|-------------|
| `ENTITY_CREATED` | Entidad creada via admin |
| `ENTITY_UPDATED` | Entidad actualizada via admin |
| `ENTITY_DELETED` | Entidad eliminada via admin |
| `CASCADE_DELETE` | Eliminación en cascada ejecutada |

### Protocolo de Heartbeat

```
Cliente: {"type": "ping"}     → cada 30 segundos
Servidor: {"type": "pong"}    → respuesta inmediata
Timeout: 60 segundos sin actividad → desconexión
```

### Códigos de Cierre WebSocket

| Código | Significado | Reconexión |
|--------|-------------|------------|
| 1000 | Cierre normal | No |
| 4001 | Autenticación fallida | No |
| 4003 | Prohibido (sin permisos) | No |
| 4029 | Rate limit excedido | No |
| Otros | Error transitorio | Sí (con backoff) |
