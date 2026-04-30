# Actores y Roles

## Sistema de Roles (RBAC)

El sistema implementa Role-Based Access Control con 4 roles definidos en `shared/config/constants.py` como `Roles`. La relacion entre usuarios y branches es M:N a traves de `UserBranchRole`, lo que permite que un mismo usuario tenga diferentes roles en diferentes sucursales.

### Matriz de Permisos

| Permiso | ADMIN | MANAGER | KITCHEN | WAITER |
|---------|-------|---------|---------|--------|
| **Crear entidades** | Todas | Staff, Mesas, Alergenos, Promociones (branches propios) | Ninguna | Ninguna |
| **Editar entidades** | Todas | Staff, Mesas, Alergenos, Promociones (branches propios) | Ninguna | Ninguna |
| **Eliminar entidades** | Todas | Ninguna | Ninguna | Ninguna |
| **Acceso a branches** | Todos | Solo los asignados | Solo los asignados | Solo los asignados |
| **Recepcion de eventos WS** | Todos los del branch | Todos los del branch | Solo SUBMITTED+ | Solo los de su sector |
| **Gestion de personal** | Si | Si (en sus branches) | No | No |
| **Gestion de menu** | Si | No | No | No |
| **Gestion de mesas** | Si | Si (en sus branches) | No | No |

### Verificacion de Permisos en Codigo

```python
from rest_api.services.permissions import PermissionContext

ctx = PermissionContext(user)
ctx.require_management()           # Solo ADMIN o MANAGER, sino ForbiddenError
ctx.require_branch_access(branch_id)  # Verifica acceso al branch
```

Los roles `ADMIN` y `MANAGER` se agrupan como `MANAGEMENT_ROLES` en las constantes del sistema.

---

## Los 6 Actores

### 1. Administrador (ADMIN)

**Interfaz**: Dashboard (puerto 5177)

**Responsabilidades**:
- Gestion completa del tenant: crear branches, configurar sectores, definir mesas
- Gestion de menu: categorias -> subcategorias -> productos con precios por branch
- Gestion de personal: alta de usuarios, asignacion de roles y branches
- Gestion de alergenos: configuracion por producto con tipo de presencia y riesgo
- Gestion de ingredientes y recetas: jerarquia grupo -> ingrediente -> sub-ingrediente
- Gestion de promociones: ofertas por branch
- Supervision en tiempo real: recibe TODOS los eventos WebSocket de TODOS los branches

**Autenticacion**: JWT (access token 15 min, refresh token 7 dias en cookie HttpOnly)

**Eventos WebSocket que recibe** (canal `/ws/admin?token=JWT`):
- `ENTITY_CREATED`, `ENTITY_UPDATED`, `ENTITY_DELETED`, `CASCADE_DELETE`
- Todos los eventos de rondas: `ROUND_PENDING` a `ROUND_SERVED`
- Eventos de facturacion: `CHECK_REQUESTED`, `CHECK_PAID`, `PAYMENT_*`
- Eventos de mesa: `TABLE_SESSION_STARTED`, `TABLE_CLEARED`, `TABLE_STATUS_CHANGED`
- Eventos de servicio: `SERVICE_CALL_CREATED`, `SERVICE_CALL_ACKED`, `SERVICE_CALL_CLOSED`

**Capacidad especial**: Puede enviar rondas CONFIRMED al estado SUBMITTED (accion que dispara la visibilidad en cocina).

---

### 2. Gerente (MANAGER)

**Interfaz**: Dashboard (puerto 5177)

**Responsabilidades**:
- Gestion limitada: staff, mesas, alergenos y promociones en sus branches asignados
- No puede eliminar entidades (solo crear y editar las permitidas)
- No puede gestionar menu ni categorias (eso es exclusivo de ADMIN)
- Supervision de sus branches: recibe todos los eventos WebSocket de los branches asignados

**Autenticacion**: JWT (mismo esquema que ADMIN)

**Eventos WebSocket**: Mismos que ADMIN, pero filtrados a sus branches asignados.

**Capacidad especial**: Junto con ADMIN, puede enviar rondas a SUBMITTED. Cocina NO ve pedidos hasta que un ADMIN o MANAGER los envie.

---

### 3. Personal de Cocina (KITCHEN)

**Interfaz**: Dashboard (vista de cocina) o display de cocina dedicado

**Responsabilidades**:
- Recibir pedidos enviados (estado SUBMITTED o posterior)
- Actualizar estado de tickets de cocina: `IN_KITCHEN` -> `READY`
- No tiene permisos de creacion, edicion ni eliminacion de ninguna entidad

**Autenticacion**: JWT con rol KITCHEN

**Eventos WebSocket** (canal `/ws/kitchen?token=JWT`):
- `ROUND_SUBMITTED` — nuevo pedido para preparar
- `ROUND_IN_KITCHEN` — confirmacion de que esta en preparacion
- `ROUND_READY` — plato listo (emitido por cocina misma)
- `ROUND_SERVED` — confirmacion de servido
- `ROUND_CANCELED` — pedido cancelado

**Lo que NO recibe**:
- `ROUND_PENDING` — pedidos sin confirmar por el mozo
- `ROUND_CONFIRMED` — pedidos confirmados pero no enviados
- Eventos de carrito (`CART_*`)
- Eventos de mesa (`TABLE_*`)
- Eventos de servicio (`SERVICE_CALL_*`)
- Eventos de facturacion

**Razon**: La cocina solo necesita saber que cocinar. Todo lo anterior (confirmaciones, carrito, servicio) es ruido que no le compete.

---

### 4. Mozo (WAITER)

**Interfaz**: pwaWaiter (puerto 5178)

**Responsabilidades**:
- Confirmar pedidos pendientes (PENDING -> CONFIRMED)
- Tomar pedidos via "comanda rapida" para clientes sin telefono
- Atender llamados de servicio
- Gestionar el ciclo de vida de la mesa: activar sesion, procesar pago, cerrar mesa
- Registrar pagos manuales (efectivo, tarjeta, transferencia)

**Autenticacion**: JWT con rol WAITER

**Flujo de acceso (pre-login)**:

```
1. GET /api/public/branches           (sin autenticacion)
   -> El mozo selecciona su branch de trabajo

2. POST /api/auth/login               (credenciales)
   -> Recibe JWT

3. GET /api/waiter/verify-branch-assignment?branch_id=X   (JWT)
   -> Verifica que este asignado al branch HOY
   -> Si NO esta asignado: pantalla "Acceso Denegado"
   -> Si esta asignado: accede a la grilla de mesas
```

Este flujo existe porque un mozo puede estar asignado a diferentes branches en diferentes dias. La asignacion es diaria via `WaiterSectorAssignment`.

**Eventos WebSocket** (canal `/ws/waiter?token=JWT`):
- Eventos de ronda: `ROUND_PENDING` a `ROUND_SERVED` (filtrados por sector)
- `SERVICE_CALL_CREATED`, `SERVICE_CALL_ACKED`, `SERVICE_CALL_CLOSED`
- `CHECK_REQUESTED`
- `TABLE_SESSION_STARTED`, `TABLE_CLEARED`, `TABLE_STATUS_CHANGED`

**Filtrado por sector**: Los eventos que incluyen `sector_id` solo llegan al mozo asignado a ese sector. Si un evento no tiene `sector_id`, llega a todos los mozos del branch. ADMIN y MANAGER siempre reciben todo.

**Endpoints principales**:
- `POST /api/waiter/tables/{id}/activate` — activar sesion de mesa
- `POST /api/waiter/sessions/{id}/rounds` — enviar ronda (comanda rapida)
- `POST /api/waiter/sessions/{id}/check` — solicitar cuenta
- `POST /api/waiter/payments/manual` — registrar pago manual
- `POST /api/waiter/tables/{id}/close` — cerrar mesa despues del pago
- `GET /api/waiter/branches/{id}/menu` — menu compacto para comanda rapida (sin imagenes)

**Capacidad offline**: Cola de reintentos para operaciones cuando la red es inestable. Las operaciones se encolan localmente y se envian cuando se recupera la conexion.

---

### 5. Cliente / Comensal (DINER)

**Interfaz**: pwaMenu (puerto 5176)

**Responsabilidades**:
- Unirse a la sesion de mesa (escaneando QR o ingresando codigo)
- Navegar el menu, filtrar por alergenos/dieta/idioma
- Agregar items al carrito compartido
- Proponer rondas para confirmacion grupal
- Solicitar llamados de servicio
- Solicitar la cuenta
- Elegir metodo de division de cuenta
- Pagar via Mercado Pago

**Autenticacion**: Token HMAC de mesa (X-Table-Token header)

El token se genera cuando el comensal se une a la sesion de mesa. Dura 3 horas. No requiere login, registro, ni datos personales. Se transmite via header `X-Table-Token` en las requests HTTP y como query param `?token=` en WebSocket.

**Eventos WebSocket** (canal `/ws/diner?table_token=TOKEN`):
- Sincronizacion de carrito: `CART_ITEM_ADDED`, `CART_ITEM_UPDATED`, `CART_ITEM_REMOVED`, `CART_CLEARED`
- Estado de rondas: `ROUND_IN_KITCHEN`, `ROUND_READY`, `ROUND_SERVED` (solo desde IN_KITCHEN en adelante)
- Facturacion: `CHECK_REQUESTED`, `CHECK_PAID`, `PAYMENT_APPROVED`, `PAYMENT_REJECTED`
- Mesa: `TABLE_SESSION_STARTED`, `TABLE_CLEARED`

**Lo que NO recibe**:
- `ROUND_PENDING`, `ROUND_CONFIRMED`, `ROUND_SUBMITTED` — el comensal no necesita ver la cadena de confirmaciones internas
- Eventos de servicio (solo el mozo necesita verlos)
- Eventos de entidades CRUD

**Modelo de datos**:

```
TableSession (sesion de mesa activa)
  +-- Diner (N comensales en la mesa)
        +-- nombre, color (para identificar items en carrito)
        +-- device_id (tracking de fidelizacion)
        +-- customer_id (opcional, para fidelizacion fase 4)
```

**Codigos de mesa**: Alfanumericos (ej: "INT-01"). NO son unicos globalmente — requieren `branch_slug` para resolver a que branch pertenecen.

---

### 6. Sistema (Procesos en Segundo Plano)

**Interfaz**: Ninguna (procesos automaticos)

**Responsabilidades**:

| Proceso | Descripcion | Frecuencia |
|---------|-------------|------------|
| Outbox Event Processor | Publica eventos criticos escritos atomicamente en la BD | Continuo |
| Heartbeat Cleanup | Limpia conexiones WebSocket sin actividad | Cada 30s |
| Stale Connection Cleanup | Desconecta sesiones expiradas | Periodico |
| Rate Limiter | Controla abuso en endpoints de facturacion (5-20/min) | Por request |
| Circuit Breaker | Corta comunicacion con Redis cuando falla repetidamente | Por fallo |
| Token Blacklist | Invalida refresh tokens en Redis con patron fail-closed | Por logout |
| Redis Streams Consumer | Procesa eventos criticos con at-least-once delivery | Continuo |
| Dead Letter Queue | Almacena eventos fallidos para reprocesamiento | Por fallo |

---

## Metodos de Autenticacion

### JWT (Staff: Admin, Manager, Kitchen, Waiter)

| Parametro | Valor |
|-----------|-------|
| Access Token | 15 minutos |
| Refresh Token | 7 dias, HttpOnly cookie |
| Refresh proactivo | Cada 14 minutos (Dashboard y pwaWaiter) |
| Almacenamiento | Cookie con `credentials: 'include'` en fetch |
| Blacklist | Redis con patron fail-closed |
| Header | `Authorization: Bearer {token}` |
| WebSocket | Query param `?token=JWT` |

**Datos en el JWT**:
```python
user["sub"]         # ID del usuario (string, se convierte a int)
user["tenant_id"]   # ID del tenant
user["branch_ids"]  # Lista de branches asignados
user["roles"]       # Lista de roles
```

### HMAC Table Token (Comensales)

| Parametro | Valor |
|-----------|-------|
| Duracion | 3 horas |
| Secreto | `TABLE_TOKEN_SECRET` (32+ caracteres) |
| Header HTTP | `X-Table-Token: {token}` |
| WebSocket | Query param `?token=TABLE_TOKEN` |
| Requiere login | No |
| Requiere registro | No |

---

## Flujo de Eventos por Rol (Matriz Completa)

### Ciclo de Vida de una Ronda

| Evento | Estado | Admin | Kitchen | Waiters | Diners |
|--------|--------|-------|---------|---------|--------|
| `ROUND_PENDING` | PENDING | Si | No | Si (todos del branch) | No |
| `ROUND_CONFIRMED` | CONFIRMED | Si | No | Si | No |
| `ROUND_SUBMITTED` | SUBMITTED | Si | Si | Si | No |
| `ROUND_IN_KITCHEN` | IN_KITCHEN | Si | Si | Si | Si |
| `ROUND_READY` | READY | Si | Si | Si | Si |
| `ROUND_SERVED` | SERVED | Si | Si | Si | Si |
| `ROUND_CANCELED` | CANCELED | Si | Si | Si | Si |

### Otros Eventos

| Evento | Admin | Kitchen | Waiters | Diners |
|--------|-------|---------|---------|--------|
| `CART_*` | No | No | No | Si |
| `SERVICE_CALL_*` | Si | No | Si (sector) | No |
| `CHECK_REQUESTED` | Si | No | Si (sector) | Si |
| `CHECK_PAID` | Si | No | Si | Si |
| `PAYMENT_*` | Si | No | Si | Si |
| `TABLE_*` | Si | No | Si | Si |
| `ENTITY_*` | Si | No | No | No |
| `CASCADE_DELETE` | Si | No | No | No |

---

## Usuarios de Prueba

| Email | Contrasena | Rol |
|-------|------------|-----|
| admin@demo.com | admin123 | ADMIN |
| waiter@demo.com | waiter123 | WAITER |
| kitchen@demo.com | kitchen123 | KITCHEN |
| ana@demo.com | ana123 | WAITER |
| alberto.cortez@demo.com | waiter123 | WAITER |
