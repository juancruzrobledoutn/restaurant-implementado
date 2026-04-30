> Creado: 2026-04-07 | Actualizado: 2026-04-07 | Estado: vigente

# Arquitectura de Delivery y Takeout

## Resumen

Este documento describe la arquitectura propuesta para incorporar pedidos de **takeout** (retiro en local) y **delivery** (envio a domicilio) al sistema Integrador. Actualmente el sistema opera exclusivamente con mesas fisicas (dine-in), donde el flujo depende de sesiones de mesa, QR codes, y carrito compartido. Delivery/takeout requiere un flujo paralelo que comparte la cocina pero omite toda la logica de mesa.

> **Estado en el roadmap**: Fase 4 — Mejoras de Producto. Los modelos existen como scaffold. Falta router + service + frontend. Ver change `C-?? delivery-takeout` cuando llegue el momento.

---

## Diferencias con Dine-In

| Aspecto | Dine-In | Delivery/Takeout |
|---------|---------|------------------|
| Punto de entrada | QR en mesa fisica | Telefono, web, o mostrador |
| Sesion | `TableSession` con diners | `DeliveryOrder` con datos de cliente |
| Carrito | Compartido en tiempo real (WebSocket) | No aplica, el pedido se arma de una vez |
| Identificacion | `X-Table-Token` (HMAC) | JWT de staff o token de cliente (futuro) |
| Rondas | Multiples rondas por sesion | Un solo pedido con N items |
| Pago | Check con split entre diners | Pago unico al momento del pedido o entrega |
| Estado de mesa | OPEN, PAYING, CLOSED | No aplica |

---

## Modelo de Datos

Se crean dos tablas nuevas:

### `delivery_order`
- Datos del cliente (nombre, telefono, email)
- Tipo de orden: `TAKEOUT` o `DELIVERY`
- Direccion de entrega (solo para DELIVERY)
- Coordenadas GPS opcionales
- Tiempos estimados de preparacion y entrega
- Estado del pedido
- Total y metodo de pago

### `delivery_order_item`
- Producto, cantidad, precio unitario (snapshot)
- Nombre del producto (snapshot para historial)
- Notas por item

Ambas tablas heredan `AuditMixin` (soft delete, timestamps, tracking de usuario).

---

## Flujo de Estados

```
RECEIVED → PREPARING → READY → PICKED_UP        (Takeout)
RECEIVED → PREPARING → READY → OUT_FOR_DELIVERY → DELIVERED  (Delivery)

Cualquier estado → CANCELED (con motivo)
```

### Transiciones por Rol

| Transicion | Quien la ejecuta |
|------------|------------------|
| (nuevo) → RECEIVED | Staff (mostrador/telefono) o sistema (web) |
| RECEIVED → PREPARING | Cocina (acepta el pedido) |
| PREPARING → READY | Cocina (pedido listo) |
| READY → PICKED_UP | Staff (cliente retiro en mostrador) |
| READY → OUT_FOR_DELIVERY | Staff (repartidor salio) |
| OUT_FOR_DELIVERY → DELIVERED | Staff/repartidor (confirma entrega) |
| * → CANCELED | ADMIN/MANAGER (con motivo obligatorio) |

---

## Integracion con Kitchen Tickets

Los pedidos de delivery/takeout se integran al sistema de cocina existente:

1. Al crear un `DeliveryOrder` con status RECEIVED, se genera un `KitchenTicket` asociado
2. El ticket de cocina lleva una marca `source_type = "DELIVERY"` (vs `"DINE_IN"` para rondas normales)
3. La cocina ve TODOS los tickets en la misma cola, con indicador visual de tipo
4. Al marcar el ticket como READY en cocina, se actualiza automaticamente el `DeliveryOrder.status`

**Cambios necesarios en `KitchenTicket`:**
- Agregar campo `delivery_order_id` (FK nullable a `delivery_order`)
- Agregar campo `source_type` (TEXT: `DINE_IN` | `DELIVERY` | `TAKEOUT`)
- Actualmente el ticket se vincula a `Round` — delivery usa `DeliveryOrder` como origen

---

## Endpoints Nuevos

### API REST (`/api/delivery/`)

| Metodo | Ruta | Descripcion | Rol |
|--------|------|-------------|-----|
| POST | `/api/delivery/orders` | Crear pedido takeout/delivery | ADMIN, MANAGER, WAITER |
| GET | `/api/delivery/orders` | Listar pedidos por branch + filtros | ADMIN, MANAGER, WAITER |
| GET | `/api/delivery/orders/{id}` | Detalle de un pedido | ADMIN, MANAGER, WAITER |
| PATCH | `/api/delivery/orders/{id}/status` | Cambiar estado | Segun transicion |
| PATCH | `/api/delivery/orders/{id}` | Editar pedido (solo si RECEIVED) | ADMIN, MANAGER |
| DELETE | `/api/delivery/orders/{id}` | Cancelar (soft delete) | ADMIN, MANAGER |
| POST | `/api/delivery/orders/{id}/pay` | Registrar pago | ADMIN, MANAGER, WAITER |

### Endpoints de Cocina (cambios)

| Metodo | Ruta | Cambio |
|--------|------|--------|
| GET | `/api/kitchen/tickets` | Incluir tickets de delivery con `source_type` |
| PATCH | `/api/kitchen/tickets/{id}/status` | Al marcar READY, actualizar delivery_order si aplica |

---

## Eventos WebSocket Nuevos

| Evento | Canal | Descripcion |
|--------|-------|-------------|
| `DELIVERY_ORDER_CREATED` | admin, kitchen, waiter | Nuevo pedido recibido |
| `DELIVERY_ORDER_STATUS_CHANGED` | admin, kitchen, waiter | Cambio de estado |
| `DELIVERY_ORDER_CANCELED` | admin, kitchen, waiter | Pedido cancelado |
| `DELIVERY_ORDER_PAID` | admin | Pago registrado |

Se usa el **Outbox Pattern** para eventos criticos (creacion, pago, cancelacion) y Redis directo para cambios de estado intermedios.

---

## Frontend: Paginas y Componentes Nuevos

### Dashboard (admin)

1. **Vista de pedidos delivery/takeout** — tabla con filtros por estado, tipo, fecha, branch
2. **Formulario de nuevo pedido** — seleccion de productos del menu, datos del cliente, tipo de orden
3. **Panel de seguimiento** — kanban o timeline de estados
4. **Integracion en reportes** — ventas delivery vs dine-in

### pwaWaiter

1. **Boton "Nuevo pedido takeout"** — flujo simplificado para pedido de mostrador
2. **Lista de pedidos activos** — ver estado de pedidos takeout/delivery asignados

### Cocina (vista existente)

1. **Indicador visual** — badge o color diferenciado para tickets delivery vs dine-in
2. **Info de delivery** — nombre del cliente, tipo de pedido, hora estimada

### pwaMenu (futuro, no MVP)

- Portal de pedidos online para clientes (requiere autenticacion de cliente)
- Tracking de pedido en tiempo real

---

## Estimacion de Esfuerzo

| Componente | Estimacion |
|------------|------------|
| Modelo de datos + migracion | 1 dia (scaffold ya existe) |
| Domain Service + endpoints REST | 3-4 dias |
| Integracion con KitchenTicket | 2 dias |
| Eventos WebSocket | 1-2 dias |
| Dashboard: vista de pedidos | 3-4 dias |
| Dashboard: formulario de pedido | 2-3 dias |
| pwaWaiter: pedido takeout | 2 dias |
| Cocina: indicador visual | 1 dia |
| Tests (backend + frontend) | 3-4 dias |
| **Total estimado** | **~2-3 semanas** |

---

## Consideraciones Adicionales

### Seguridad
- Los endpoints de delivery siguen el mismo RBAC existente
- No se exponen datos de clientes en endpoints publicos
- Validacion de direcciones para prevenir SSRF en coordenadas

### Performance
- Indice compuesto `(branch_id, status)` para queries frecuentes
- Paginacion estandar con `limit/offset`
- Los pedidos completados se archivan via soft delete despues de X dias

### Futuras Extensiones
- Integracion con plataformas externas (PedidosYa, Rappi)
- Estimacion automatica de tiempos basada en historial
- Notificaciones push al cliente (SMS/WhatsApp)
- Zona de cobertura por branch (geofencing)
- Portal web de pedidos para clientes (pwaMenu)
