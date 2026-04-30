# Flujos de Usuario y Casos de Uso

Este documento describe los flujos de usuario y casos de uso formales del sistema **Integrador / Buen Sabor**, organizados por actor.

---

## Flujos del Comensal

### Flujo Principal: Pedido via QR (UC-01 + UC-02)

#### Precondiciones
1. La mesa existe y tiene un codigo QR valido.
2. La sucursal esta activa.
3. El WebSocket Gateway esta operativo en el puerto 8001.
4. El menu de la sucursal esta disponible.

#### Flujo Paso a Paso

```
 1. El cliente escanea el codigo QR en la mesa del restaurante.
 2. El navegador abre la PWA -> se muestra la pagina JoinTable.
 3. El cliente ingresa:
    - Numero de mesa (alfanumerico, ej: "INT-01").
    - Nombre (opcional, para identificarse en el carrito compartido).
 4. joinTable() se ejecuta:
    -> GET /api/tables/code/{code}/session (con branch_slug)
    -> Si existe sesion activa, se une a ella.
    -> Si no existe, se crea una nueva sesion.
    -> Se almacena el table_token en localStorage.
 5. POST /api/diner/register
    - Se envia device_id para tracking de fidelizacion (Fase 1).
    - Se registra al comensal en la sesion con nombre y color asignado.
 6. Conexion WebSocket establecida:
    -> ws://host:8001/ws/diner?table_token=X
    -> Heartbeat cada 30 segundos.
 7. Se renderiza la pagina Home:
    -> GET /api/public/menu/{branch_slug} (cacheado 5 minutos).
    -> Se muestran categorias, subcategorias y productos.
 8. El cliente navega el menu:
    -> Categorias -> Subcategorias -> Lista de productos.
    -> Cada producto muestra imagen, precio, descripcion y badges.
 9. Opcionalmente, el cliente aplica filtros:
    -> Alergenos (modo estricto o muy estricto).
    -> Opciones dieteticas (vegetariano, vegano, sin gluten, keto).
    -> Metodo de coccion (parrilla, horno, frito).
10. El cliente toca un producto -> se abre ProductDetailModal:
    -> Selecciona cantidad.
    -> Toca "Agregar".
11. UI optimista: el item aparece inmediatamente en el SharedCart.
    -> Evento CART_ITEM_ADDED enviado por WebSocket a todos los comensales.
    -> El item muestra nombre y color del comensal que lo agrego.
12. Cuando el cliente decide ordenar, toca "Proponer enviar pedido".
13. Se muestra RoundConfirmationPanel a todos los comensales de la mesa.
    -> Cada comensal ve la lista completa de items del carrito.
    -> Se inicia timer de 5 minutos.
14. Cada comensal toca "Estoy listo" para confirmar.
15. Cuando TODOS los comensales confirman:
    -> Delay de 1,5 segundos (para permitir cancelacion de ultimo momento).
    -> Submit automatico.
16. POST /api/diner/rounds/submit ejecutado:
    -> Se crea la ronda con estado ROUND_PENDING.
    -> El carrito se limpia.
17. El mozo ve notificacion (pulso amarillo en grilla de mesas):
    -> Confirma el pedido -> estado cambia a ROUND_CONFIRMED.
18. El administrador/gerente envia a cocina:
    -> Estado cambia a ROUND_SUBMITTED.
    -> Cocina recibe el ticket.
19. La cocina comienza preparacion:
    -> Estado cambia a ROUND_IN_KITCHEN.
    -> Evento WebSocket llega al comensal -> UI se actualiza.
20. La cocina finaliza:
    -> Estado cambia a ROUND_READY.
    -> Evento WebSocket al mozo (parpadeo naranja) y al comensal.
21. El mozo entrega el pedido:
    -> Estado cambia a ROUND_SERVED.
    -> Evento WebSocket al comensal -> pedido marcado como servido.
22. El cliente puede repetir los pasos 8-21 para nuevas rondas.
```

#### Postcondiciones
1. El comensal esta registrado como diner en la sesion de la mesa.
2. Se emitio un `table_token` valido almacenado en localStorage.
3. La conexion WebSocket esta activa y recibiendo eventos.
4. El `device_id` esta asociado al customer para fidelizacion.
5. La ronda se creo con estado `ROUND_PENDING` en el backend.
6. Todos los items del carrito estan asociados a la ronda.
7. El mozo del sector recibio notificacion de nuevo pedido.

#### Flujos Alternativos

**FA-1: La mesa ya tiene sesion activa**
- El comensal se une a la sesion existente como nuevo diner.
- Los demas comensales reciben notificacion del nuevo integrante.
- El carrito compartido se sincroniza con los items ya existentes.

**FA-2: La sesion expiro por inactividad (8 horas)**
- Se crea una nueva sesion automaticamente.
- Los datos de la sesion anterior se archivan.

**FA-3: Codigo de mesa invalido**
- El backend retorna error.
- Mensaje: "Mesa no encontrada. Verifica el codigo e intenta de nuevo."
- El comensal puede reintentar con otro codigo.

**FA-4: Sucursal inactiva**
- Se muestra un error informativo. No se permite iniciar sesion.

**FA-5: No todos los comensales confirman dentro de 5 minutos**
- La propuesta caduca. Se notifica a todos. El carrito permanece intacto.
- Cualquier comensal puede volver a proponer.

**FA-6: El proponente cancela la propuesta**
- Se notifica a todos. El `RoundConfirmationPanel` se cierra. El carrito permanece intacto.

**FA-7: Error de red al enviar el pedido**
- Rollback optimista: el carrito se restaura al estado previo.
- Mensaje de error con opcion de reintentar.

**FA-8: Un comensal modifica el carrito durante la confirmacion**
- Los items se bloquean durante la fase de confirmacion.
- Para modificar, se debe cancelar la propuesta primero.

#### Reglas de Negocio
- Los codigos de mesa NO son unicos globalmente; se requiere `branch_slug` para desambiguar.
- El `table_token` usa HMAC para autenticacion, diferente del JWT del staff.
- El TTL de la sesion es de 8 horas basado en ultima actividad, no en creacion.
- Solo un comensal puede proponer enviar a la vez.
- La confirmacion requiere unanimidad de todos los comensales activos.
- El delay de 1,5 segundos permite cancelaciones de ultimo momento.
- Los items muestran a que comensal pertenecen (nombre + color asignado).

---

### Flujo: Filtrado por Alergenos (UC-09)

#### Precondiciones
1. El menu de la sucursal esta cargado.
2. Los productos tienen alergenos configurados con tipo de presencia.

#### Flujo Paso a Paso

1. El comensal abre los filtros avanzados del menu.
2. Selecciona los alergenos que debe evitar (ej: gluten, lactosa, mani).
3. Elige el modo de filtrado:
   - **Modo Estricto**: oculta productos con `contains`. Muestra `may_contain` con advertencia visual. Muestra `free_from`.
   - **Modo Muy Estricto**: oculta `contains` Y `may_contain`. Solo muestra `free_from` o sin relacion con el alergeno.
4. El menu se filtra y muestra solo productos seguros.
5. Los productos filtrados desaparecen de todas las vistas.

#### Flujos Alternativos

**FA-1: Reacciones cruzadas**
- Al seleccionar un alergeno, el sistema advierte sobre alergenos con reaccion cruzada.
- Ejemplo: seleccionar "Latex" advierte automaticamente sobre kiwi y banana.
- El comensal puede optar por incluir o excluir los alergenos cruzados.

**FA-2: Filtros combinados**
- Alergenos + opciones dieteticas (vegetariano, vegano, sin gluten, keto).
- Alergenos + metodo de coccion.
- Los filtros se aplican de forma acumulativa (AND logico).

**FA-3: Ningun producto cumple los filtros**
- Se muestra mensaje informativo.
- Se sugiere reducir la cantidad de filtros activos.

#### Postcondiciones
1. El menu muestra solo productos que cumplen con los criterios de seguridad.
2. Los filtros persisten durante la sesion del comensal.

#### Reglas de Negocio
- Cumplimiento normativa EU 1169/2011 para declaracion de alergenos.
- Tres niveles de presencia: `contains`, `may_contain`, `free_from`.
- Cuatro niveles de severidad: `mild`, `moderate`, `severe`, `life_threatening`.
- El sistema de reacciones cruzadas es informativo (advertencia, no bloqueo automatico).

---

### Flujo: Llamada de Servicio (UC-07)

#### Precondiciones
1. El comensal tiene sesion activa y `table_token` valido.
2. Existe un mozo asignado al sector de la mesa.
3. Las conexiones WebSocket estan activas.

#### Flujo Paso a Paso

```
 1. El comensal necesita atencion:
    -> En pwaMenu, toca el boton de "Llamar mozo" / servicio.
 2. POST /api/diner/service-call creado:
    -> Evento SERVICE_CALL_CREATED emitido (Outbox Pattern).
 3. El mozo recibe la notificacion:
    -> La mesa muestra PARPADEO ROJO en la grilla (maxima prioridad visual).
    -> El evento incluye sector_id -> solo llega a mozos del sector.
    -> ADMIN y MANAGER siempre reciben todos los eventos.
 4. El mozo toca la mesa -> TableDetailModal:
    -> Ve la llamada de servicio con timestamp y descripcion.
 5. El mozo toca "Reconocer" (acknowledge):
    -> Evento SERVICE_CALL_ACKED.
    -> Se detiene la animacion de parpadeo rojo.
    -> El comensal ve que su llamada fue reconocida.
 6. El mozo atiende al cliente en la mesa.
 7. El mozo toca "Resolver":
    -> Evento SERVICE_CALL_CLOSED.
    -> La llamada desaparece del panel de la mesa.
    -> Se registra en el historial de la sesion.
```

#### Flujos Alternativos

**FA-1: Multiples llamadas de la misma mesa**
- Cada llamada se registra individualmente.
- El modal de la mesa muestra todas las llamadas activas.
- La animacion de parpadeo rojo persiste mientras haya al menos una sin resolver.

**FA-2: Ningun mozo asignado al sector**
- El evento llega a ADMIN y MANAGER (siempre reciben todos los eventos).
- Pueden reasignar o atender directamente.

**FA-3: Mozo reconoce pero no resuelve**
- La llamada queda en estado "reconocida" pero no cerrada.
- No genera nueva animacion, pero sigue visible en el modal de la mesa.

#### Postcondiciones
1. La llamada de servicio esta cerrada (`SERVICE_CALL_CLOSED`).
2. El historial de la llamada queda registrado en la sesion.
3. La animacion de la mesa se detiene (si no hay otras llamadas activas).

---

### Flujo: Solicitud de Cuenta, Division y Pago (UC-05)

#### Precondiciones
1. La sesion tiene al menos una ronda con items servidos.
2. No existe una cuenta activa previa sin pagar.

#### Flujo Paso a Paso

```
 1. El comensal o el mozo solicita la cuenta:
    -> Comensal: desde BottomNav -> "Cuenta" -> pagina CloseTable.
    -> Mozo: desde TableDetailModal -> "Solicitar cuenta".
 2. POST /api/billing/check/request ejecutado:
    -> Se crea un registro Check (tabla app_check) con todos los items agregados.
    -> Evento CHECK_REQUESTED emitido via Outbox Pattern.
    -> El mozo ve pulso violeta en la grilla de mesas.
    -> Estado de la sesion: OPEN -> PAYING.
 3. Se genera el detalle de la cuenta:
    -> Todos los items de todas las rondas servidas se agregan.
    -> Check -> Charge (cada item) -> Allocation (FIFO) <- Payment.
 4. Se calcula la division segun metodo elegido:
    a. Partes iguales: Total / cantidad de comensales.
    b. Por consumo: cada comensal paga los items que pidio.
    c. Personalizado: montos manuales ingresados por el mozo/comensal.

    === Pago con Mercado Pago ===
 5. Se crea preferencia de pago:
    -> POST /api/billing/mercadopago/preference.
    -> Se genera URL de pago con callback.
 6. El cliente es redirigido a Mercado Pago.
 7. El cliente completa el pago en la plataforma de MP.
 8. MP ejecuta callback al backend:
    -> Se registra el pago.
    -> Evento PAYMENT_APPROVED via Outbox Pattern.
    -> El pago parcial se registra como Payment -> Allocation (FIFO a Charges).

    === Pago manual (efectivo/tarjeta/transferencia) ===
 5b. El mozo registra el pago:
    -> POST /api/waiter/payments/manual.
    -> Indica: metodo (cash/card/transfer), monto.
    -> Se registra el pago.

 9. Cuando el total esta cubierto:
    -> Evento CHECK_PAID emitido via Outbox Pattern.
    -> La sesion se marca como completamente pagada.
10. El mozo cierra la mesa:
    -> POST /api/waiter/tables/{id}/close.
    -> Evento TABLE_CLEARED emitido.
    -> La sesion se archiva en el historial de pedidos.
    -> La mesa vuelve a estado LIBRE.
11. Opcionalmente: generacion de factura fiscal en PDF
    (pwaWaiter via html2canvas + jspdf).
```

#### Flujos Alternativos

**FA-1: Pago parcial**
- Si un comensal paga su parte pero otros no, se registra como pago parcial.
- El registro Payment se asocia al Check via Allocation (FIFO).
- Se mantiene el saldo pendiente hasta completar.

**FA-2: Pago rechazado por Mercado Pago**
- `PAYMENT_REJECTED` via Outbox.
- Se notifica al comensal. Puede reintentar.

#### Postcondiciones
1. El Check tiene estado pagado.
2. Los pagos estan registrados con metodo y monto.
3. El modelo Allocation vincula cada pago con los cargos (FIFO).
4. La mesa vuelve a estado libre.

#### Reglas de Negocio
- Eventos de billing usan Outbox Pattern (garantia de entrega, no se pueden perder).
- Los precios se calculan en centavos para evitar errores de punto flotante.
- Rate limiting en endpoints de billing: 5-20 requests/minuto.
- Una vez en estado PAYING, no se pueden crear nuevas rondas.

---

### Flujo: Fidelizacion de Clientes

#### Fases del Sistema

```
=== FASE 1: Tracking por Dispositivo (Implementado) ===
 1. Al registrarse como comensal: POST /api/diner/register.
 2. Se envia device_id (generado en el dispositivo).
 3. Se crea relacion Customer <-> Diner (1:N via customer_id).
 4. El sistema asocia pedidos al dispositivo.
 5. Permite identificar clientes recurrentes sin pedir datos personales.

=== FASE 2: Preferencias Implicitas (Planificada) ===
 6. El sistema analiza pedidos historicos del dispositivo.
 7. Genera perfil de preferencias: categorias favoritas, alergenos, etc.
 8. Las preferencias se sincronizan entre sesiones.

=== FASE 3: Reconocimiento (Planificada) ===
 9. El sistema reconoce al cliente cuando vuelve.
10. Puede personalizar la experiencia: "Bienvenido de nuevo".
11. Sugerencias basadas en historial.

=== FASE 4: Opt-in con Consentimiento GDPR (Planificada) ===
12. El cliente puede optar por crear un perfil explicito.
13. Consentimiento GDPR para almacenamiento de datos personales.
14. Beneficios de fidelizacion: descuentos, promociones personalizadas.
```

---

## Flujos del Mozo

### Flujo Principal: Jornada Diaria (UC-10 + UC-03)

#### Precondiciones
1. El mozo tiene credenciales validas.
2. Existe asignacion de sector para el dia actual.
3. La sucursal esta activa.

#### Flujo Paso a Paso

```
 1. El mozo abre la aplicacion -> PreLoginBranchSelectPage.
 2. GET /api/public/branches (sin autenticacion):
    -> Se muestra lista de sucursales disponibles.
    -> El mozo selecciona su sucursal de trabajo.
 3. Login con email y contrasena:
    -> POST /api/auth/login -> JWT (access + refresh tokens).
 4. verifyBranchAssignment() ejecutado:
    -> GET /api/waiter/verify-branch-assignment?branch_id={id}
    -> Verifica que el mozo este asignado a esa sucursal HOY.
    -> Si no esta asignado -> pantalla "Acceso Denegado".
 5. Si esta verificado -> MainPage con 2 pestanas principales.
 6. Pestana "Comensales": grilla de mesas agrupadas por sector.
    -> Las mesas se organizan visualmente por sector (Interior, Terraza, etc.).
    -> Cada mesa muestra su estado con color y codigo.
 7. Las mesas muestran animaciones en tiempo real segun eventos:
    - PARPADEO ROJO: llamada de servicio -> PRIORIDAD URGENTE.
    - PULSO AMARILLO: nuevo pedido pendiente de confirmacion.
    - PARPADEO NARANJA: pedido listo + otras rondas aun en cocina.
    - PARPADEO AZUL: cambio de estado de mesa.
    - PULSO VIOLETA: cuenta solicitada.
 8. El mozo toca una mesa -> se abre TableDetailModal:
    -> Informacion de la sesion (comensales, hora de inicio, duracion).
    -> Rondas filtradas por estado (pendientes / listas / servidas).
    -> Llamadas de servicio activas.
 9. Para pedidos pendientes (pulso amarillo):
    -> El mozo revisa los items del pedido.
    -> Toca "Confirmar" -> confirmRound(roundId).
    -> Estado: PENDING -> CONFIRMED.
    -> Puede eliminar items individuales si es necesario.
10. Cuando llega una llamada de servicio (parpadeo rojo):
    -> El mozo toca la mesa -> ve la llamada en el modal.
    -> Toca "Reconocer" (acknowledge) -> se detiene la animacion.
    -> Atiende al cliente.
    -> Toca "Resolver" -> SERVICE_CALL_CLOSED.
11. Cuando un pedido esta listo (parpadeo naranja):
    -> El mozo retira el pedido de cocina.
    -> Entrega al cliente.
    -> Marca como servido -> ROUND_SERVED.
12. Cuando el cliente pide la cuenta (pulso violeta):
    -> El mozo abre el detalle de la mesa.
    -> Revisa el total y los items consumidos.
    -> Procesa el pago segun metodo:
      a. Efectivo: registra pago manual con monto recibido y vuelto.
      b. Tarjeta: registra pago manual.
      c. Transferencia: registra pago manual.
      d. Mercado Pago: el cliente gestiona desde su celular.
13. Tras pago completo:
    -> El mozo cierra la mesa -> POST /api/waiter/tables/{id}/close.
    -> La sesion se archiva.
    -> La mesa vuelve a estado "libre" (verde).
    -> Evento TABLE_CLEARED enviado por WebSocket.
```

#### Flujos Alternativos

**FA-1: Mozo no asignado hoy a esa sucursal**
- Se muestra pantalla "Acceso Denegado".
- Puede seleccionar otra sucursal o contactar al administrador.

**FA-2: Asignacion cambia durante el turno**
- Se requiere re-verificacion. El mozo puede necesitar cerrar y reabrir la app.

**FA-3: Mozo asignado a multiples sectores**
- Recibira eventos WebSocket de todos sus sectores asignados.
- La grilla muestra todas las mesas de sus sectores.

**FA-4: Sin asignaciones configuradas para hoy**
- Ningun mozo puede acceder. Se muestra "Acceso Denegado" a todos.
- Requiere intervencion del administrador.

**FA-5: Mozo elimina todos los items de una ronda**
- La ronda se auto-elimina. Evento `ROUND_CANCELED` emitido.
- La mesa vuelve al estado previo.

**FA-6: Mozo no esta asignado al sector de un evento**
- Los eventos con `sector_id` solo llegan a mozos asignados.
- Un `ADMIN` o `MANAGER` siempre puede intervenir.

#### Postcondiciones
1. El mozo tiene acceso al `MainPage` de la sucursal verificada.
2. Los eventos WebSocket se filtran por los sectores asignados al mozo.
3. La verificacion es valida solo para el dia actual.

#### Reglas de Negocio
- La asignacion es diaria: se debe configurar cada dia de trabajo.
- Un mozo puede trabajar en diferentes sucursales en diferentes dias.
- Los roles `ADMIN` y `MANAGER` no requieren asignacion de sector (ven todo).
- Solo usuarios con rol `WAITER`, `ADMIN` o `MANAGER` pueden confirmar pedidos.
- La cocina NO ve pedidos hasta que alcancen el estado `SUBMITTED`.

#### Flujo de Refresh de Token
- Cada 14 minutos se ejecuta refresh proactivo del JWT.
- Si el refresh falla, se redirige al login.
- El refresh token esta en una HttpOnly cookie (7 dias de vigencia).

---

### Flujo: Comanda Rapida (UC-06)

#### Precondiciones
1. El mozo esta autenticado y asignado a la sucursal.
2. Existe al menos una mesa libre o activa.

#### Flujo Paso a Paso

```
 1. El mozo toca la pestana "Autogestion" en MainPage.
 2. Se abre el modal de Comanda Rapida (dos pasos).

    === PASO 1: Seleccion de mesa ===
 3. Se muestra un dropdown con las mesas disponibles.
 4. El mozo selecciona una mesa:
    a. Si la mesa esta LIBRE:
       -> Ingresa cantidad de comensales.
       -> activateTable() -> POST /api/waiter/tables/{id}/activate.
       -> Se crea una nueva sesion con los comensales indicados.
       -> Estado de mesa: LIBRE -> OCUPADA.
    b. Si la mesa esta ACTIVA (ya tiene sesion):
       -> Se usa la sesion existente.
       -> Se pueden agregar items a rondas posteriores.

    === PASO 2: Menu compacto y armado del pedido ===
 5. Panel izquierdo: menu compacto sin imagenes.
    -> GET /api/waiter/branches/{id}/menu
    -> Solo muestra nombre, precio y categoria.
    -> Optimizado para velocidad de seleccion.
 6. El mozo navega: Categorias -> Productos.
 7. Toca un producto -> selecciona cantidad -> "Agregar al pedido".
 8. Panel derecho: carrito con los items seleccionados.
    -> Muestra nombre, cantidad, precio unitario y subtotal.
    -> Permite modificar cantidades o eliminar items.
 9. El mozo revisa el pedido completo.
10. Toca "Enviar pedido":
    -> submitRound() ejecutado.
    -> POST /api/waiter/sessions/{id}/rounds.
    -> Ronda creada con estado ROUND_PENDING.
11. El mozo confirma inmediatamente:
    -> PENDING -> CONFIRMED.
    -> El pedido queda listo para ser enviado a cocina.
```

#### Diferencias con Pedido por QR

| Aspecto | Pedido por QR | Comanda Rapida |
|---------|---------------|----------------|
| Requiere celular del cliente | Si | No |
| Menu | Completo con imagenes | Compacto sin imagenes |
| Confirmacion grupal | Si (unanimidad) | No (mozo decide solo) |
| Confirmacion de ronda | Espera mozo | Mozo confirma inmediatamente |

#### Postcondiciones
1. La sesion de mesa esta activa con los comensales registrados.
2. La ronda esta creada con estado `CONFIRMED` (confirmada por el mozo).

#### Reglas de Negocio
- El menu compacto no incluye imagenes para optimizar velocidad.
- El mozo puede confirmar su propio pedido inmediatamente.
- No se requiere confirmacion grupal (es responsabilidad del mozo).
- Endpoint especifico: `GET /api/waiter/branches/{id}/menu`.

---

## Flujos de Cocina

### Flujo Principal: Procesamiento de Pedidos (UC-04)

#### Precondiciones
1. El usuario tiene rol `KITCHEN`.
2. Esta conectado al WebSocket `/ws/kitchen`.
3. La ronda esta en estado `SUBMITTED` (enviada a cocina por admin/manager).

#### Flujo Paso a Paso

```
 1. El personal de cocina inicia sesion.
 2. Se establece conexion WebSocket: /ws/kitchen?token=JWT.
 3. IMPORTANTE: La cocina NO ve pedidos en estado PENDING o CONFIRMED.
    -> Solo recibe eventos a partir de SUBMITTED.

    === Ciclo de un pedido ===
 4. Un pedido es enviado a cocina (ROUND_SUBMITTED por admin/manager):
    -> Evento ROUND_SUBMITTED llega por WebSocket.
    -> Un nuevo ticket aparece en la pantalla de cocina.
    -> El ticket muestra: mesa, items, cantidades, notas especiales.
 5. La cocina comienza la preparacion:
    -> Marca el pedido como "en progreso".
    -> Estado: SUBMITTED -> IN_KITCHEN.
    -> Evento ROUND_IN_KITCHEN enviado a:
      - Admin (Dashboard).
      - Mozos asignados al sector.
      - Comensales de la mesa (pueden ver que su pedido esta en cocina).
 6. La cocina finaliza la preparacion:
    -> Marca el pedido como "listo".
    -> Estado: IN_KITCHEN -> READY.
    -> Evento ROUND_READY enviado a:
      - Mozo (parpadeo naranja en grilla de mesas).
      - Comensal (notificacion en la app).
      - Admin (Dashboard).
 7. El mozo retira el pedido y lo entrega:
    -> Marca como servido -> ROUND_SERVED.
    -> Evento ROUND_SERVED cierra el ciclo del pedido.
```

#### Flujo Completo de Estados

```
PENDING ------> CONFIRMED ------> SUBMITTED ------> IN_KITCHEN ------> READY ------> SERVED
(Comensal)      (Mozo)            (Admin/Manager)   (Cocina)          (Cocina)      (Staff)
                                  ^
                                  | Cocina recibe
                                  | el pedido aqui
```

#### Flujos Alternativos

**FA-1: Item no disponible**
- Cocina puede marcar productos como no disponibles via `PATCH /api/kitchen/products/{id}/availability`.
- Emite `PRODUCT_AVAILABILITY_CHANGED`. El menu filtra automaticamente.

**FA-2: Pedido cancelado antes de preparacion**
- Si la ronda es cancelada mientras esta en `SUBMITTED`, la cocina recibe `ROUND_CANCELED`.
- El ticket desaparece de la pantalla.

#### Postcondiciones
1. La ronda esta en estado `READY`.
2. El mozo fue notificado (parpadeo naranja en su grilla).
3. El comensal fue notificado en la app (UI actualizada).
4. El ticket de cocina (`KitchenTicket`) queda registrado.

#### Reglas de Negocio
- La cocina solo ve pedidos a partir del estado `SUBMITTED`.
- Los estados `PENDING` y `CONFIRMED` son invisibles para la cocina.
- El flujo de estados es estrictamente secuencial: `SUBMITTED` -> `IN_KITCHEN` -> `READY`.

---

## Flujos del Admin/Manager

### Flujo Principal: Gestion del Restaurante (Dashboard)

#### Precondiciones
- El usuario tiene rol `ADMIN` o `MANAGER`.
- Credenciales validas.

#### Flujo Paso a Paso

```
 1. Login con email y contrasena -> JWT emitido.
    -> Access token: 15 minutos.
    -> Refresh token: 7 dias (HttpOnly cookie).
 2. Dashboard carga -> conexion WebSocket al endpoint /ws/admin.
 3. El admin selecciona la sucursal de trabajo.
 4. Sidebar de navegacion muestra las secciones disponibles:
    -> Categorias, Subcategorias, Productos, Personal, Mesas,
       Sectores, Alergenos, Promociones, Recetas, etc.

    === Ejemplo: Crear producto ===
 5. Navega a "Productos" -> lista con paginacion (?limit=50&offset=0).
 6. Toca "Nuevo producto" -> se abre modal de formulario (useFormModal).
 7. Completa el formulario:
    -> Nombre, descripcion, imagen URL.
    -> Categoria y subcategoria.
    -> Alergenos (contains / may_contain / free_from).
    -> Precio base o precios por sucursal.
    -> Flags: destacado, popular.
    -> Badges y sellos.
    -> Receta asociada.
 8. Guarda -> POST /api/admin/products.
 9. Evento ENTITY_CREATED emitido por WebSocket.
10. La lista se actualiza en tiempo real en todas las pestanas
    y sesiones conectadas.

    === Ejemplo: Eliminar categoria ===
11. Selecciona una categoria con subcategorias y productos.
12. Toca "Eliminar" -> se muestra preview de cascada:
    -> "Se desactivaran: 3 subcategorias, 15 productos".
13. Confirma -> cascade_soft_delete() ejecutado.
14. Evento CASCADE_DELETE emitido con detalle de afectados.
15. Todas las entidades dependientes marcadas is_active=false.

    === Sincronizacion ===
16. Si otro admin crea/edita/elimina una entidad:
    -> Evento WebSocket recibido automaticamente.
    -> La UI se actualiza sin recargar la pagina.
17. Sincronizacion multi-pestana via BroadcastChannel.
18. Token se refresca proactivamente cada 14 minutos.
```

#### Permisos por Rol

| Accion | ADMIN | MANAGER |
|--------|-------|---------|
| Crear entidades | Todas | Staff, Mesas, Alergenos, Promociones (sus sucursales) |
| Editar entidades | Todas | Mismas que crear |
| Eliminar entidades | Todas | Ninguna |

---

### Flujo: Configuracion Multi-Sucursal de Precios (UC-08)

#### Precondiciones
1. El producto existe en el sistema.
2. Existen multiples sucursales configuradas.
3. El usuario tiene rol `ADMIN`.

#### Flujo Paso a Paso

```
 1. Admin navega a gestion de productos.
 2. Selecciona un producto existente o crea uno nuevo.
 3. En el editor de producto:
    a. use_branch_prices = false (por defecto):
       -> Precio base unico para todas las sucursales.
       -> Se establece un solo precio en centavos.
    b. use_branch_prices = true:
       -> Se habilita la tabla de precios por sucursal.
       -> Cada sucursal puede tener un precio diferente.
       -> Cada BranchProduct tiene su propio is_active:
         - true: el producto se vende en esa sucursal.
         - false: el producto NO esta disponible en esa sucursal.
 4. Para pricing masivo:
    -> Exportar precios actuales.
    -> Modificar en bulk.
    -> Importar los cambios.
 5. Los precios se almacenan en centavos (ej: $125,50 = 12550).
 6. Los frontends convierten: backendCents / 100 = displayPrice.
```

#### Flujos Alternativos

**FA-1: Precio base unico (use_branch_prices = false)**
- El producto usa un solo precio base para todas las sucursales.
- No se crean registros `BranchProduct` individuales.

**FA-2: Producto desactivado en una sucursal**
- Si `BranchProduct.is_active = false`, el producto no aparece en el menu de esa sucursal.
- El producto sigue activo en las demas sucursales.

**FA-3: Pricing masivo (bulk)**
- Exportar, modificar en lote, importar. Validacion masiva de centavos y estados.

#### Postcondiciones
1. Los registros `BranchProduct` reflejan los precios por sucursal.
2. El menu publico de cada sucursal muestra el precio correcto.
3. Los precios estan almacenados en centavos.

#### Reglas de Negocio
- Los precios SIEMPRE se almacenan en centavos enteros.
- La conversion a pesos se hace solo en el frontend: `cents / 100`.
- La conversion inversa usa `Math.round(price * 100)` para evitar errores.

---

## Matriz de Trazabilidad

| Caso de Uso | Actor | Componente | Endpoints Involucrados | Eventos WebSocket |
|-------------|-------|-----------|----------------------|-------------------|
| UC-01: Unirse a mesa | Comensal | pwaMenu | `/api/tables/code/{code}/session`, `/api/diner/register` | — |
| UC-02: Pedido compartido | Comensal | pwaMenu | `/api/diner/rounds/submit` | `CART_*`, `ROUND_PENDING` |
| UC-03: Confirmar pedido | Mozo | pwaWaiter | `/api/waiter/rounds/{id}/confirm` | `ROUND_CONFIRMED` |
| UC-04: Procesar pedido | Cocina | Dashboard/Kitchen | — | `ROUND_SUBMITTED`, `ROUND_IN_KITCHEN`, `ROUND_READY` |
| UC-05: Division y pago | Comensal/Mozo | pwaMenu, pwaWaiter | `/api/billing/*`, `/api/waiter/payments/manual` | `CHECK_REQUESTED`, `CHECK_PAID`, `PAYMENT_*` |
| UC-06: Comanda rapida | Mozo | pwaWaiter | `/api/waiter/tables/{id}/activate`, `/api/waiter/sessions/{id}/rounds` | `ROUND_PENDING`, `TABLE_SESSION_STARTED` |
| UC-07: Llamada de servicio | Comensal/Mozo | pwaMenu, pwaWaiter | `/api/diner/service-call` | `SERVICE_CALL_CREATED`, `SERVICE_CALL_ACKED`, `SERVICE_CALL_CLOSED` |
| UC-08: Precios multi-sucursal | Admin | Dashboard | `/api/admin/products`, `/api/admin/branch-products` | `ENTITY_UPDATED` |
| UC-09: Filtrado alergenos | Comensal | pwaMenu | `/api/public/menu/{slug}` | — |
| UC-10: Verificacion asignacion | Mozo | pwaWaiter | `/api/public/branches`, `/api/waiter/verify-branch-assignment` | — |
