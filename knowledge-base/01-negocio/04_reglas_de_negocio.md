# Reglas de Negocio y Maquinas de Estado

Este documento describe todas las reglas de negocio y maquinas de estado del sistema Integrador / Buen Sabor. Cada regla tiene impacto directo en la implementacion y debe ser respetada tanto en backend como en frontend.

---

## 1. Aislamiento Multi-Tenant

El sistema opera bajo un modelo **multi-tenant estricto**, donde cada restaurante (tenant) tiene sus datos completamente aislados.

### Principio fundamental

> Ninguna consulta, ningun evento, ninguna operacion puede cruzar la frontera de un tenant. Si un dato no pertenece al tenant del usuario autenticado, no existe.

### Alcance de los datos por tenant

| Nivel | Entidades | Descripcion |
|-------|-----------|-------------|
| **Tenant** | CookingMethod, FlavorProfile, TextureProfile, CuisineType, IngredientGroup, Ingredient, SubIngredient, Allergen, Recipe | Catalogos compartidos entre todas las sucursales del restaurante |
| **Branch** | Category, Subcategory, Product, BranchProduct, BranchSector, Table, TableSession, Diner, Round, RoundItem, KitchenTicket, Check, Charge, Payment, Allocation, ServiceCall, Promotion (via junction) | Datos operativos de cada sucursal |

### Reglas de aislamiento

1. **Toda entidad posee un `tenant_id`** que se valida en cada operacion CRUD.
2. **Los usuarios tienen un array `branch_ids` en el JWT**. Solo pueden acceder a las sucursales asignadas.
3. **Los eventos WebSocket se filtran por `tenant_id`** en cada punto de broadcast. Un evento de la sucursal A jamas llega a la sucursal B de otro tenant.
4. **Las consultas de repositorio** (`TenantRepository`, `BranchRepository`) filtran automaticamente por `tenant_id`. Las consultas raw deben incluir el filtro manualmente.
5. **Las URLs publicas** (menu, branches) usan el `slug` de la sucursal, no el ID numerico, para evitar enumeracion.

### Ejemplo de validacion en servicio

```python
ctx = PermissionContext(user)
ctx.require_branch_access(branch_id)  # Verifica que branch_id este en user["branch_ids"]
# Si no pertenece, lanza ForbiddenError
```

---

## 2. Ciclo de Vida de las Rondas (Round Lifecycle)

Las rondas son la unidad central del flujo de pedidos. Cada ronda agrupa items pedidos por los comensales de una mesa.

### Maquina de estados

```
                                    +----------+
                                    | CANCELED |
                                    +----------+
                                         ^
                                         | (desde cualquier estado)
                                         |
+--------+    +-----------+    +-----------+    +------------+    +-------+    +--------+
| PENDING | -> | CONFIRMED | -> | SUBMITTED | -> | IN_KITCHEN | -> | READY | -> | SERVED |
+--------+    +-----------+    +-----------+    +------------+    +-------+    +--------+
```

### Descripcion de cada estado

| Estado | Descripcion | Visible para |
|--------|-------------|-------------|
| **PENDING** | El comensal envio el pedido desde pwaMenu. Esperando confirmacion del mozo. | Mozos, Admin |
| **CONFIRMED** | El mozo verifico el pedido en la mesa. Aun no enviado a cocina. | Mozos, Admin |
| **SUBMITTED** | Administrador o gerente envio el pedido a cocina. Primer estado visible para cocina. | Cocina, Mozos, Admin |
| **IN_KITCHEN** | La cocina acuso recibo y comenzo la preparacion. | Cocina, Mozos, Admin, Comensales |
| **READY** | La cocina termino la preparacion. Listo para servir. | Cocina, Mozos, Admin, Comensales |
| **SERVED** | El mozo entrego los platos en la mesa. Estado final. | Todos |
| **CANCELED** | Pedido cancelado. Puede ocurrir desde cualquier estado. | Todos |

### Restricciones por rol en cada transicion

| Desde | Hacia | Roles permitidos | Contexto |
|-------|-------|-------------------|----------|
| (nuevo) | PENDING | Comensal (pwaMenu) | El comensal confirma su carrito |
| PENDING | CONFIRMED | WAITER, MANAGER, ADMIN | El mozo verifica el pedido en la mesa |
| CONFIRMED | SUBMITTED | MANAGER, ADMIN | Gestion envia a cocina |
| SUBMITTED | IN_KITCHEN | KITCHEN, MANAGER, ADMIN | La cocina acusa recibo |
| IN_KITCHEN | READY | KITCHEN, MANAGER, ADMIN | La cocina termina la preparacion |
| READY | SERVED | WAITER, KITCHEN, MANAGER, ADMIN | Se sirve en la mesa |
| Cualquiera | CANCELED | MANAGER, ADMIN | Cancelacion por gestion |

> **Regla critica**: Un WAITER no puede enviar pedidos a cocina (CONFIRMED -> SUBMITTED). Esto requiere nivel MANAGER o ADMIN.

> **Regla critica**: La cocina nunca ve estados PENDING ni CONFIRMED. Solo a partir de SUBMITTED el pedido aparece en la pantalla de cocina.

### Eventos WebSocket por transicion

| Transicion | Evento | Destinatarios | Patron de entrega |
|------------|--------|---------------|-------------------|
| -> PENDING | `ROUND_PENDING` | Admin, Mozos (de la sucursal) | Direct Redis |
| -> CONFIRMED | `ROUND_CONFIRMED` | Admin, Mozos | Direct Redis |
| -> SUBMITTED | `ROUND_SUBMITTED` | Admin, Cocina, Mozos | **Outbox** |
| -> IN_KITCHEN | `ROUND_IN_KITCHEN` | Admin, Cocina, Mozos, Comensales | Direct Redis |
| -> READY | `ROUND_READY` | Admin, Cocina, Mozos, Comensales | **Outbox** |
| -> SERVED | `ROUND_SERVED` | Admin, Cocina, Mozos, Comensales | Direct Redis |
| -> CANCELED | `ROUND_CANCELED` | Todos los suscriptores | Direct Redis |

### Filtrado por sector

Los eventos que incluyen `sector_id` se envian unicamente a los mozos asignados a ese sector. Los roles ADMIN y MANAGER siempre reciben todos los eventos de la sucursal, independientemente del sector.

---

## 3. Ciclo de Vida de la Sesion de Mesa (Table Session)

### Maquina de estados

```
(sin sesion) ----> OPEN ----> PAYING ----> CLOSED
                    ^                        |
                    |                        |
                    +--- mesa liberada <-----+
```

### Descripcion de cada estado

| Estado | Descripcion | Comensales pueden pedir? | Acciones disponibles |
|--------|-------------|--------------------------|---------------------|
| **(sin sesion)** | La mesa no tiene sesion activa. Esta libre. | No | Activar mesa (QR scan o mozo) |
| **OPEN** | Sesion activa. Comensales pueden unirse y ordenar. | **Si** | Agregar comensales, crear rondas, pedir servicio |
| **PAYING** | Cuenta solicitada. Proceso de pago en curso. | **No** | Registrar pagos unicamente |
| **CLOSED** | Sesion finalizada. Mesa liberada para nuevos comensales. | No | Ninguna (historico) |

> **Regla de negocio**: Una vez solicitada la cuenta (estado PAYING), los comensales **NO pueden crear nuevas rondas**. El backend debe rechazar la creacion de rondas cuando `table_session.status == PAYING`. Los frontends deben deshabilitar la opcion de agregar al carrito y enviar pedidos.

### Transiciones

| Desde | Hacia | Disparador |
|-------|-------|------------|
| (sin sesion) | OPEN | QR scan por comensal o activacion manual por mozo |
| OPEN | PAYING | Solicitud de cuenta (comensal o mozo) |
| PAYING | CLOSED | Todos los cargos cubiertos por pagos |
| CLOSED | (sin sesion) | Mozo cierra la mesa, limpieza automatica |

### Eventos WebSocket

| Transicion | Evento |
|------------|--------|
| -> OPEN | `TABLE_SESSION_STARTED` |
| -> PAYING | `CHECK_REQUESTED` |
| -> CLOSED | `CHECK_PAID`, `TABLE_CLEARED` |
| Cambio de estado | `TABLE_STATUS_CHANGED` |

### Codigos de mesa

- Los codigos son alfanumericos (ejemplo: `INT-01`, `BAR-03`).
- Los codigos **NO son unicos** entre sucursales. Dos sucursales pueden tener una mesa `INT-01`.
- Por lo tanto, siempre se requiere el `branch_slug` para identificar una mesa de forma unica.

### TTL de sesion (pwaMenu)

- La cache local de pwaMenu tiene un TTL de **8 horas** desde la ultima actividad, no desde la creacion.
- Al cargar la app, se verifica si los datos almacenados estan vencidos y se limpian automaticamente.
- Datos con TTL: menu cacheado, datos de sesion.

---

## 4. Estado Visual de Mesa en pwaWaiter

El frontend de mozos maneja un estado visual de la mesa que se deriva de la sesion y otros factores.

### Diagrama de estados

```
+------+        +--------+        +--------+
| FREE | -----> | ACTIVE | -----> | PAYING |
+------+        +--------+        +--------+
   ^               |                  |
   |               v                  |
   |        +--------------+          |
   |        | OUT_OF_SERVICE|         |
   |        +--------------+          |
   |                                  |
   +----------------------------------+
```

### Colores y significado visual

| Estado | Color | Significado |
|--------|-------|-------------|
| **FREE** | Verde | Mesa disponible, sin sesion activa |
| **ACTIVE** | Rojo | Mesa ocupada, sesion en curso |
| **PAYING** | Violeta | Cuenta solicitada, esperando pago |
| **OUT_OF_SERVICE** | Gris | Mesa fuera de servicio (reservada, mantenimiento) |

### Animaciones en tiempo real

| Animacion | Color | Significado | Prioridad |
|-----------|-------|-------------|-----------|
| Parpadeo | Rojo | Llamada de servicio | URGENTE |
| Pulso | Amarillo | Nuevo pedido pendiente de confirmacion | Alta |
| Parpadeo | Naranja | Pedido listo + otras rondas aun en cocina | Media |
| Parpadeo | Azul | Cambio de estado de mesa | Baja |
| Pulso | Violeta | Cuenta solicitada | Media |

### Agrupacion por sector

Las mesas se agrupan visualmente por sector (`BranchSector`). El mozo solo ve los sectores que tiene asignados para el dia actual.

---

## 5. Estado de Llamada de Servicio (Service Call)

### Maquina de estados

```
+---------+        +-------+        +--------+
| CREATED | -----> | ACKED | -----> | CLOSED |
+---------+        +-------+        +--------+
```

### Descripcion de cada estado

| Estado | Descripcion | Efecto visual en pwaWaiter |
|--------|-------------|---------------------------|
| **CREATED** | El comensal solicito atencion. | Parpadeo rojo en la mesa del mozo |
| **ACKED** | El mozo acuso recibo de la llamada. | El parpadeo se detiene |
| **CLOSED** | La atencion fue completada. | La llamada desaparece de la lista activa |

### Eventos WebSocket

| Transicion | Evento | Patron de entrega |
|------------|--------|-------------------|
| -> CREATED | `SERVICE_CALL_CREATED` | **Outbox** (critico) |
| -> ACKED | `SERVICE_CALL_ACKED` | Direct Redis |
| -> CLOSED | `SERVICE_CALL_CLOSED` | Direct Redis |

> La creacion de la llamada usa Outbox porque es critico que el mozo la reciba. Si se pierde, el comensal queda desatendido.

### Reglas adicionales

- Cada llamada de servicio se trackea individualmente.
- Si hay multiples llamadas de la misma mesa, se muestran todas en el modal.
- La animacion de parpadeo rojo persiste mientras haya al menos una llamada sin resolver.
- Los eventos incluyen `sector_id` -> solo llegan a mozos del sector. ADMIN y MANAGER siempre reciben todos.

---

## 6. Estado de Ticket de Cocina (Kitchen Ticket)

### Maquina de estados

```
+-----------+        +-------------+        +-------+        +-----------+
| (creado)  | -----> | IN_PROGRESS | -----> | READY | -----> | DELIVERED |
+-----------+        +-------------+        +-------+        +-----------+
```

### Descripcion

| Estado | Descripcion |
|--------|-------------|
| **(creado)** | Ticket generado cuando la ronda pasa a SUBMITTED |
| **IN_PROGRESS** | La cocina esta preparando los items del ticket |
| **READY** | Todos los items estan listos para servir |
| **DELIVERED** | Los items fueron entregados a la mesa |

> El ticket de cocina agrupa los items de una ronda para la vista de cocina. Es una representacion de trabajo, no una entidad de negocio independiente.

---

## 7. Reglas de Facturacion (Billing)

### Estado de Cuenta (Check)

```
+------------+        +------+
| REQUESTED  | -----> | PAID |
+------------+        +------+
```

| Estado | Descripcion | Evento WebSocket |
|--------|-------------|-----------------|
| **REQUESTED** | El comensal o mozo solicito la cuenta | `CHECK_REQUESTED` (Outbox) |
| **PAID** | Todos los cargos cubiertos por pagos (FIFO allocation) | `CHECK_PAID` (Outbox) |

### Estado de Pago (Payment)

```
+---------+
| PENDING |
+---------+
     |
     +----> APPROVED
     |
     +----> REJECTED
     |
     +----> FAILED
```

| Estado | Descripcion | Evento WebSocket |
|--------|-------------|-----------------|
| **PENDING** | Pago registrado, esperando confirmacion | - |
| **APPROVED** | Pago confirmado exitosamente | `PAYMENT_APPROVED` (Outbox) |
| **REJECTED** | Pago rechazado (fondos insuficientes, etc.) | `PAYMENT_REJECTED` (Outbox) |
| **FAILED** | Error tecnico en el procesamiento | - |

### Sistema de asignacion FIFO

Los pagos se asignan a los cargos en orden cronologico a traves de la tabla `allocation`:

1. Se crea un `charge` por cada item/comensal.
2. Cuando se recibe un `payment`, se asigna a los cargos pendientes mas antiguos primero.
3. Un pago puede cubrir multiples cargos parcialmente.
4. Un cargo puede ser cubierto por multiples pagos.
5. Cuando la suma de `allocation.amount_cents` cubre todos los `charge.amount_cents`, el check pasa a PAID.

### Modelo de datos

```
Check (app_check)
  +-- Charge (un cargo por cada item)
        +-- Allocation (asignacion FIFO)
              <- Payment (pago parcial o total)
```

### Metodos de division de cuenta

| Metodo | Descripcion |
|--------|-------------|
| **Partes iguales** | Total / cantidad de comensales. Redondeo: el ultimo comensal absorbe la diferencia por centavos. |
| **Por consumo** | Se agrupan items por comensal (basado en quien agrego cada item). Items compartidos se dividen entre participantes. |
| **Personalizado** | Montos manuales por comensal. La suma debe cubrir el total. Permite que un comensal pague por otros. |

### Metodos de pago soportados

- Efectivo (registrado por mozo via `POST /api/waiter/payments/manual`)
- Tarjeta (registrado por mozo)
- Transferencia bancaria (registrado por mozo)
- Mercado Pago (gestionado por el comensal desde pwaMenu)

### Rate limiting en billing

| Endpoint | Limite |
|----------|--------|
| Solicitud de cuenta | 10/minuto |
| Operaciones de pago | 20/minuto |
| Operaciones criticas | 5/minuto |

---

## 8. Reglas de Precios

### Almacenamiento en centavos

Todos los precios se almacenan como **enteros en centavos** para evitar errores de punto flotante.

| Concepto | Ejemplo |
|----------|---------|
| Precio en pesos | $125.50 |
| Valor en base de datos | 12550 (centavos) |
| Conversion frontend | `displayPrice = backendCents / 100` |
| Conversion backend | `backendCents = Math.round(price * 100)` |

### Precio base vs. precio por sucursal

Cada producto puede tener:

- **Precio base** (`product.price`): precio por defecto aplicado a todas las sucursales.
- **Precio por sucursal** (`branch_product.price_cents`): precio especifico para una sucursal, habilitado por el flag `use_branch_prices`.

| Flag `use_branch_prices` | Comportamiento |
|--------------------------|----------------|
| `false` | Se usa `product.price` para todas las sucursales |
| `true` | Se usa `branch_product.price_cents` para cada sucursal |

### Visibilidad por sucursal

El registro `BranchProduct` tiene un campo `is_active`:

- `is_active = true`: el producto se vende en esa sucursal.
- `is_active = false`: el producto **no aparece** en el menu de esa sucursal.
- Sin registro `BranchProduct`: el producto tampoco aparece.

### Precios en promociones

Las promociones tienen su propio `price` en centavos. Este precio reemplaza la suma individual de los productos incluidos (`promotion_item`).

---

## 9. Convencion de Soft Delete

### Principio

> Nada se borra fisicamente. Todo se desactiva.

### Reglas

1. **Todas las entidades** usan soft delete: `is_active = False`.
2. **Hard delete solo** para registros efimeros: items del carrito (`cart_item`), sesiones expiradas.
3. **Toda consulta** debe filtrar por `is_active.is_(True)`:
   - Los repositorios (`TenantRepository`, `BranchRepository`) lo hacen automaticamente.
   - Las consultas raw **deben incluirlo manualmente**.
4. **Cascade soft delete**: `cascade_soft_delete(db, entity, user_id, user_email)` desactiva la entidad y todos sus dependientes recursivamente.
5. **Auditoria**: cada soft delete registra `deleted_at`, `deleted_by_id` y `deleted_by_email`.
6. **Evento WebSocket**: cada cascade soft delete emite un evento `CASCADE_DELETE` con el conteo de entidades afectadas.

### Comparacion de booleanos en SQLAlchemy

```python
# CORRECTO
.where(Model.is_active.is_(True))

# INCORRECTO (comportamiento impredecible)
.where(Model.is_active == True)
```

---

## 10. Reglas de Alergenos

### Cumplimiento normativo

El sistema cumple con la **regulacion EU 1169/2011** sobre informacion alimentaria.

### Clasificacion

| Campo | Valores posibles | Descripcion |
|-------|------------------|-------------|
| `is_mandatory` | true/false | Indica si es un alergeno de declaracion obligatoria segun EU 1169/2011 |
| `presence_type` | `contains`, `may_contain`, `free_from` | Nivel de presencia en el producto |
| `risk_level` | `mild`, `moderate`, `severe`, `life_threatening` | Severidad de la reaccion |

### Reacciones cruzadas

El sistema rastrea reacciones cruzadas entre alergenos. Por ejemplo:
- Latex -> kiwi, banana, aguacate
- Marisco -> acaro del polvo

Esto permite alertar al comensal sobre riesgos indirectos.

### Modos de filtrado (pwaMenu)

| Modo | Comportamiento |
|------|----------------|
| **Estricto** | Oculta productos con `contains` |
| **Muy estricto** | Oculta productos con `contains` Y `may_contain` |

El comensal selecciona sus alergenos y el modo de filtrado. Los productos se filtran en tiempo real en el menu.

---

## 11. Control de Acceso Basado en Roles (RBAC)

### Matriz de permisos

| Rol | Crear | Editar | Eliminar |
|-----|-------|--------|----------|
| ADMIN | Todo | Todo | Todo |
| MANAGER | Staff, Mesas, Alergenos, Promociones (solo sus sucursales) | Igual | Nada |
| KITCHEN | Nada | Nada | Nada |
| WAITER | Nada | Nada | Nada |

### Relacion Usuario-Sucursal-Rol

- Un usuario puede tener **multiples roles en multiples sucursales** via `UserBranchRole`.
- El JWT contiene `branch_ids` (array) y `roles` (array).
- La validacion de permisos usa `PermissionContext`:

```python
ctx = PermissionContext(user)
ctx.require_management()           # Solo ADMIN o MANAGER
ctx.require_branch_access(branch_id)  # Verifica acceso a la sucursal
```

### Roles de gestion

Los roles `ADMIN` y `MANAGER` se agrupan bajo la constante `MANAGEMENT_ROLES`. Varias operaciones requieren pertenecer a este grupo.

---

## 12. Asignacion de Mozos

### Flujo pre-login (pwaWaiter)

1. El mozo selecciona la sucursal **antes de loguearse**: `GET /api/public/branches` (sin autenticacion).
2. Login con credenciales.
3. Verificacion: `GET /api/waiter/verify-branch-assignment?branch_id=X`.
4. Si no esta asignado **para el dia de hoy**: pantalla "Acceso Denegado".

### Asignacion por sector

- Los mozos se asignan a **sectores especificos** dentro de una sucursal via `WaiterSectorAssignment`.
- La asignacion es **diaria** (campo `date`).
- Cache de sectores con TTL de **5 minutos**, con refresco dinamico via comando WebSocket.

### Impacto en eventos

Los eventos WebSocket con `sector_id` solo se envian a los mozos asignados a ese sector. Esto evita que un mozo reciba notificaciones de mesas que no le corresponden.

---

## 13. Reglas de Tokens y Autenticacion

### Tipos de token

| Token | Duracion | Almacenamiento | Uso |
|-------|----------|----------------|-----|
| Access Token (JWT) | 15 minutos | Memoria (frontend) | Dashboard, pwaWaiter |
| Refresh Token | 7 dias | Cookie HttpOnly | Renovacion de access token |
| Table Token (HMAC) | 3 horas | Header `X-Table-Token` | pwaMenu (comensales) |

### Ciclo de vida del token

```
+---------+        +-------+     14 min     +------------+        +-------+
| (login) | -----> | VALID | ------------> | REFRESHING | -----> | VALID |
+---------+        +-------+               +------------+        | (new) |
                      |                         |                +-------+
                      | 15 min                  | fallo x3
                      v                         v
                  +---------+             +-------------+
                  | EXPIRED |             | AUTO_LOGOUT |
                  +---------+             +-------------+
```

### Estrategia de renovacion

- **Renovacion proactiva**: el frontend renueva el access token a los **14 minutos** (1 minuto antes de vencer).
- **Jitter**: se agrega un desfasaje aleatorio de +/- 2 minutos para evitar thundering herd.
- **Reintentos**: maximo 3 intentos de renovacion antes de auto-logout.
- **Sincronizacion multi-tab**: via `BroadcastChannel` para evitar multiples renovaciones simultaneas (solo una tab ejecuta la renovacion, las demas reciben el nuevo token via broadcast).

### Blacklist de tokens

- Los tokens revocados se almacenan en **Redis**.
- Patron **fail-closed**: si Redis esta caido, se rechazan **todos** los tokens por seguridad.
- La blacklist tiene TTL igual a la duracion maxima del token (evita crecimiento indefinido).

### Prevencion del loop infinito de logout

```
Token vencido -> 401 -> onTokenExpired -> logout() -> 401 -> onTokenExpired -> ...
```

Para prevenirlo, `authAPI.logout()` deshabilita el retry en 401 pasando `false` como tercer argumento a `fetchAPI`. Esto corta el ciclo: si el logout devuelve 401, simplemente se completa el logout local sin reintentar.

---

## 14. Reglas de Entrega de Eventos

### Dos patrones de entrega

| Patron | Uso | Garantia |
|--------|-----|----------|
| **Transactional Outbox** | Eventos criticos (financieros, pedidos a cocina) | At-least-once delivery |
| **Direct Redis Pub/Sub** | Eventos no criticos (carrito, estado de mesa, CRUD admin) | Best-effort |

### Eventos via Outbox (no se pueden perder)

| Evento | Maquina de estado |
|--------|-------------------|
| `ROUND_SUBMITTED` | Round Status |
| `ROUND_READY` | Round Status |
| `CHECK_REQUESTED` | Check Status |
| `CHECK_PAID` | Check Status |
| `PAYMENT_APPROVED` | Payment Status |
| `PAYMENT_REJECTED` | Payment Status |
| `SERVICE_CALL_CREATED` | Service Call Status |

El evento se escribe en la tabla `outbox_event` **atomicamente** en la misma transaccion que la operacion de negocio:

```python
write_billing_outbox_event(db=db, tenant_id=t, event_type=CHECK_REQUESTED, ...)
db.commit()  # Atomico con los datos de negocio
```

Un procesador en background lee los eventos pendientes y los publica a Redis Streams.

### Eventos via Direct Redis (menor latencia)

| Evento | Maquina de estado |
|--------|-------------------|
| `ROUND_CONFIRMED`, `ROUND_IN_KITCHEN`, `ROUND_SERVED`, `ROUND_CANCELED` | Round Status |
| `CART_ITEM_ADDED`, `CART_ITEM_UPDATED`, `CART_ITEM_REMOVED`, `CART_CLEARED` | Cart Lifecycle |
| `TABLE_SESSION_STARTED`, `TABLE_CLEARED`, `TABLE_STATUS_CHANGED` | Table Session Status |
| `ENTITY_CREATED`, `ENTITY_UPDATED`, `ENTITY_DELETED`, `CASCADE_DELETE` | Admin CRUD / Soft Delete |
| `SERVICE_CALL_ACKED`, `SERVICE_CALL_CLOSED` | Service Call Status |

---

## 15. Ciclo de Vida del Carrito (pwaMenu)

### Comportamiento

- El carrito es **local** (almacenado en el dispositivo del comensal).
- La sincronizacion via WebSocket es para el **estado de la ronda**, no del carrito individual.
- Al confirmar el carrito, los items se combinan en una ronda con los items de otros comensales.

### Eventos WebSocket del carrito compartido

| Evento | Descripcion |
|--------|-------------|
| `CART_ITEM_ADDED` | Un comensal agrego un item al carrito compartido |
| `CART_ITEM_UPDATED` | Un comensal modifico cantidad/notas |
| `CART_ITEM_REMOVED` | Un comensal elimino un item |
| `CART_CLEARED` | Se limpio todo el carrito |

> Estos eventos se envian via Direct Redis (no Outbox) porque la perdida de un evento de carrito no tiene impacto financiero.

---

## 16. Estado de Conexion WebSocket

### Maquina de estados

```
+---------------+        +------------+        +-----------+
| DISCONNECTED  | -----> | CONNECTING | -----> | CONNECTED |
+---------------+        +------------+        +-----------+
       ^                      |                      |
       |                      v                      v
       |              +-------------+        +----------------+
       |              | AUTH_FAILED |        | DISCONNECTING  |
       |              +-------------+        +----------------+
       |                      |                      |
       |                      v                      v
       |             +-----------------+     +---------------+
       |             | NON_RECOVERABLE |     | RECONNECTING  |
       |             +-----------------+     +---------------+
       |                                           |
       +-------------------------------------------+
              (tras agotar intentos o exito)
```

### Estrategia de reconexion

| Parametro | Valor |
|-----------|-------|
| Backoff inicial | 1 segundo |
| Multiplicador | x2 (exponencial) |
| Maximo backoff | 30 segundos |
| Intentos maximos | 50 |
| Jitter | +/- 30% |

### Formula de backoff

```
delay = min(initial * 2^attempt, max_delay) * (1 + random(-0.3, 0.3))
```

Ejemplo de secuencia: 1s, 2s, 4s, 8s, 16s, 30s, 30s, 30s...

### Codigos de cierre no recuperables

| Codigo | Nombre | Significado |
|--------|--------|-------------|
| 4001 | AUTH_FAILED | Token invalido o expirado. Requiere re-login. |
| 4003 | FORBIDDEN | Sin permisos para el endpoint. |
| 4029 | RATE_LIMITED | Demasiadas conexiones/mensajes. |

Cuando se recibe un codigo no recuperable, el cliente **no intenta reconectarse**. Se muestra un mensaje al usuario y se redirige al login si corresponde.

### Heartbeat

| Parametro | Valor |
|-----------|-------|
| Intervalo de ping | 30 segundos |
| Timeout del servidor | 60 segundos |
| Formato | `{"type": "ping"}` -> `{"type": "pong"}` |

Si el servidor no recibe un ping en 60 segundos, cierra la conexion. El cliente detecta la desconexion y entra en el flujo de reconexion.

---

## 17. Circuit Breaker (WS Gateway)

El Gateway WebSocket implementa un Circuit Breaker para protegerse contra fallos en cascada cuando Redis u otros servicios externos fallan.

### Maquina de estados

```
+--------+     5 fallos     +------+     30 seg     +-----------+
| CLOSED | --------------> | OPEN | -------------> | HALF_OPEN |
+--------+                 +------+                +-----------+
    ^                                                   |
    |                                                   |
    +-------------- exito ------------------------------|
    |                                                   |
    |                          fallo                    |
    |                            |                      |
    |                            v                      |
    |                         +------+                  |
    |                         | OPEN | <----------------+
    |                         +------+
    +--- (reinicio de contadores) ---+
```

### Parametros

| Parametro | Valor | Descripcion |
|-----------|-------|-------------|
| Umbral de fallos | 5 | Cantidad de fallos consecutivos para abrir el circuito |
| Tiempo de espera | 30 segundos | Tiempo en estado OPEN antes de probar HALF_OPEN |
| Exitos para cerrar | 1 | Cantidad de exitos en HALF_OPEN para volver a CLOSED |

### Comportamiento por estado

| Estado | Comportamiento |
|--------|----------------|
| **CLOSED** | Operacion normal. Se cuentan fallos consecutivos. |
| **OPEN** | Todas las operaciones fallan inmediatamente (fail fast). No se contacta el servicio externo. |
| **HALF_OPEN** | Se permite una operacion de prueba. Si tiene exito, vuelve a CLOSED. Si falla, vuelve a OPEN. |

---

## 18. Reglas de Promociones

### Estructura

| Campo | Descripcion |
|-------|-------------|
| `name` | Nombre de la promocion |
| `price` | Precio en centavos (reemplaza suma individual) |
| `start_date` / `start_time` | Inicio de vigencia |
| `end_date` / `end_time` | Fin de vigencia |
| `promotion_type_id` | Tipo de promocion (catalogo tenant-scoped) |

### Alcance

- Una promocion puede aplicar a **multiples sucursales** via la tabla `promotion_branch`.
- Contiene **items de promocion** (`promotion_item`) que referencian productos individuales.

### Vigencia temporal

La promocion solo es valida dentro del rango `[start_date + start_time, end_date + end_time]`. Fuera de ese rango no aparece en el menu.

---

## 19. Reglas de Idioma e Internacionalizacion

| Contexto | Idioma |
|----------|--------|
| Interfaz de usuario (UI) | Espanol |
| Comentarios en codigo | Ingles |
| Nombres de variables y funciones | Ingles (camelCase frontend, snake_case backend) |

### pwaMenu: Internacionalizacion completa

- **Todos** los textos visibles al usuario deben usar la funcion `t()`.
- Cero strings hardcodeados.
- Idiomas soportados: **es** (base), **en**, **pt**.
- Fallback: si falta una traduccion en `en` o `pt`, se muestra en `es`.

### Dashboard y pwaWaiter

Actualmente solo en espanol. Dashboard tiene scaffold i18n (es/en) pero no esta completamente implementado.

---

## 20. Rate Limiting General

| Endpoint | Limite | Notas |
|----------|--------|-------|
| `POST /api/auth/login` | 5/minuto | Per-IP + per-email (Redis-backed con Lua scripts) |
| `POST /api/auth/refresh` | 5/minuto | Limite estricto para token refresh |
| Billing: solicitud de cuenta | 10/minuto | Outbox pattern para entrega garantizada |
| Billing: operaciones de pago | 20/minuto | — |
| Billing: operaciones criticas | 5/minuto | Mas restrictivo |
| WebSocket mensajes | 30/ventana/conexion | Configurable via `WS_MESSAGE_RATE_LIMIT` |
| Login intentos | 5 por ventana de 60s | Configurable via `LOGIN_RATE_LIMIT` / `LOGIN_RATE_WINDOW` |

---

## 21. Gobernanza (IA-Native)

El proyecto usa gobernanza con Policy Tickets que definen niveles de autonomia para modificaciones:

| Nivel | Dominios | Que puede hacer la IA |
|-------|----------|----------------------|
| **CRITICO** | Auth, Billing, Alergenos, Staff | Solo analisis, sin cambios en codigo de produccion |
| **ALTO** | Productos, WebSocket, Rate Limiting | Proponer cambios, esperar revision humana |
| **MEDIO** | Ordenes, Cocina, Mozo, Mesas, Customer | Implementar con checkpoints |
| **BAJO** | Categorias, Sectores, Recetas, Ingredientes, Promociones | Autonomia total si los tests pasan |

---

## Tabla de Referencia Rapida de Maquinas de Estado

| Entidad | Estados | Estado final | Cancelable? |
|---------|---------|-------------|-------------|
| Round | PENDING, CONFIRMED, SUBMITTED, IN_KITCHEN, READY, SERVED, CANCELED | SERVED o CANCELED | Si (MANAGER+) |
| Table Session | OPEN, PAYING, CLOSED | CLOSED | No (se cierra) |
| Service Call | CREATED, ACKED, CLOSED | CLOSED | No |
| Kitchen Ticket | (creado), IN_PROGRESS, READY, DELIVERED | DELIVERED | No |
| Payment | PENDING, APPROVED, REJECTED, FAILED | APPROVED, REJECTED o FAILED | No |
| Check | REQUESTED, PAID | PAID | No |
| WebSocket | DISCONNECTED, CONNECTING, CONNECTED, DISCONNECTING, RECONNECTING, AUTH_FAILED, NON_RECOVERABLE | DISCONNECTED o NON_RECOVERABLE | No |
| Circuit Breaker | CLOSED, OPEN, HALF_OPEN | CLOSED (recuperado) | No |
| Token | VALID, REFRESHING, EXPIRED, AUTO_LOGOUT | EXPIRED o AUTO_LOGOUT | No |
