# Catalogo de Funcionalidades

Este documento describe de forma exhaustiva todas las funcionalidades del sistema **Integrador / Buen Sabor**, organizadas por componente. Cada funcionalidad incluye su estado de madurez.

**Estados de madurez**:
- **COMPLETA**: Funcionalidad implementada, testeada y estable
- **FUNCIONAL**: Implementada y operativa, puede faltar pulido o tests completos
- **SCAFFOLD**: Estructura creada, UI basica, logica parcial o placeholder
- **PLANIFICADA**: Disenada pero no implementada aun

---

## 1. Dashboard (Panel de Administracion - Puerto 5177)

El Dashboard es la interfaz de gestion centralizada para administradores y gerentes. Permite controlar todos los aspectos operativos del restaurante de forma multi-sucursal.

### 1.1 Gestion de Restaurante — FUNCIONAL

- Configuracion global del tenant: nombre, logo, banner, color tematico (naranja `#f97316` por defecto).
- Cada tenant puede administrar multiples sucursales desde un unico panel.
- Importacion y exportacion de configuracion en formato JSON.

### 1.2 Gestion de Sucursales (Branches) — COMPLETA

- CRUD completo de sucursales con horarios de apertura y cierre.
- Direccion fisica con datos de localizacion.
- Cada sucursal opera de forma independiente con sus propias categorias, precios, mesas y personal.
- Slug unico por sucursal para acceso publico al menu (`/api/public/menu/{slug}`).

### 1.3 Gestion de Categorias — COMPLETA

- Las categorias estan acotadas por sucursal (branch-scoped).
- Soporte de ordenamiento personalizado para controlar la presentacion en el menu.
- Operaciones CRUD completas con validacion de unicidad dentro de la sucursal.

### 1.4 Gestion de Subcategorias — COMPLETA

- Anidadas dentro de categorias.
- Herencia del alcance de sucursal desde la categoria padre.
- Ordenamiento independiente dentro de cada categoria.

### 1.5 Gestion de Productos — COMPLETA

Editor completo de productos con las siguientes capacidades:

- **Informacion basica**: nombre, descripcion, imagen (URL validada contra SSRF).
- **Alergenos**: sistema de tres niveles por producto:
  - `contains` (contiene): el producto contiene el alergeno.
  - `may_contain` (puede contener): riesgo de contaminacion cruzada.
  - `free_from` (libre de): certificado libre del alergeno.
- **Precios por sucursal**: cuando `use_branch_prices=true`, cada sucursal define su precio en centavos mediante registros `BranchProduct`. Cuando es `false`, se usa un precio base unico.
- **Imagenes**: URL de imagen con validacion de seguridad (bloqueo de IPs internas y metadata de cloud).
- **Flags especiales**:
  - `is_featured`: producto destacado.
  - `is_popular`: producto popular.
- **Badges y sellos**: etiquetas visuales asociadas al producto.
- **Receta asociada**: vinculo con el sistema de recetas para la cocina.

### 1.6 Gestion de Precios — COMPLETA

- Precio almacenado en centavos (ej: $125,50 = 12550).
- Pricing masivo con capacidad de importacion y exportacion.
- Precios diferenciados por sucursal a traves de `BranchProduct`.
- Activacion/desactivacion de productos por sucursal (`is_active` en `BranchProduct`).

### 1.7 Gestion de Alergenos — COMPLETA

- Catalogo global de alergenos con cumplimiento de la normativa **EU 1169/2011**.
- Niveles de severidad: `mild` (leve), `moderate` (moderado), `severe` (severo), `life_threatening` (potencialmente mortal).
- Sistema de reacciones cruzadas (ej: latex advierte sobre kiwi y banana).
- Asociacion M:N entre productos y alergenos con tipo de presencia y nivel de riesgo.

### 1.8 Gestion de Badges y Sellos — FUNCIONAL

- Badges: etiquetas visuales para destacar productos (ej: "Nuevo", "Mas vendido").
- Sellos: certificaciones o marcas de calidad asociadas a productos.
- Asignacion flexible a multiples productos.

### 1.9 Gestion de Promociones — FUNCIONAL

- Combos y promociones basadas en tiempo con programacion de fecha y hora.
- Soporte multi-sucursal: una promocion puede aplicar a varias sucursales simultaneamente.
- Tipos de promocion configurables.
- Validacion de vigencia temporal (fecha de inicio y fin, horarios activos).

### 1.10 Gestion de Mesas — COMPLETA

- Interfaz de grilla (grid) visual para administrar mesas.
- Workflow de 5 estados visuales:
  1. **Libre** (verde): mesa disponible.
  2. **Ocupada** (rojo): mesa con comensales activos.
  3. **Solicito pedido** (amarillo): mesa con pedido pendiente de confirmacion.
  4. **Pedido cumplido** (naranja): pedido listo y entregado.
  5. **Cuenta solicitada** (violeta): comensales pidieron la cuenta.
- Codigos alfanumericos de mesa (ej: "INT-01"). Los codigos NO son unicos entre sucursales; se requiere el `branch_slug` para desambiguar.
- Asociacion mesa-sector para organizacion espacial.

### 1.11 Gestion de Personal (Staff) — COMPLETA

- CRUD de usuarios con asignacion de roles por sucursal.
- Roles predefinidos: `ADMIN`, `MANAGER`, `KITCHEN`, `WAITER`.
- Relacion M:N entre usuarios y sucursales a traves de `UserBranchRole`.
- Un usuario puede tener diferentes roles en diferentes sucursales.

### 1.12 Gestion de Roles — COMPLETA

- Roles predefinidos con permisos diferenciados segun RBAC:
  - **ADMIN**: acceso total (crear, editar, eliminar todo).
  - **MANAGER**: gestion de personal, mesas, alergenos y promociones en sus sucursales asignadas.
  - **KITCHEN**: solo lectura/actualizacion de estados de cocina.
  - **WAITER**: solo operaciones de servicio en sala.

### 1.13 Gestion de Sectores — COMPLETA

- Sectores dentro de cada sucursal (ej: Interior, Terraza, Barra, VIP).
- Asignacion diaria de mozos a sectores (`WaiterSectorAssignment`).
- Los eventos WebSocket con `sector_id` se enrutan solo a los mozos asignados a ese sector.

### 1.14 Gestion de Recetas e Ingredientes — FUNCIONAL

- Recetas de cocina asociadas a productos.
- Grupos de ingredientes (`IngredientGroup`) para organizacion.
- Ingredientes con sub-ingredientes (`SubIngredient`).
- Todos los catalogos de cocina estan acotados por tenant: `CookingMethod`, `FlavorProfile`, `TextureProfile`, `CuisineType`.

### 1.15 Historial de Pedidos — FUNCIONAL

- Pedidos archivados por sucursal.
- Historial por cliente (asociado al sistema de fidelizacion).
- Consulta de sesiones cerradas con detalle de rondas, items y pagos.

### 1.16 Vista de Cocina (Kitchen Display) — FUNCIONAL

- Layout de 3 columnas: En Espera / En Preparacion / Listos.
- Codificacion de urgencia por color (amarillo <10min, naranja 10-20min, rojo >20min).
- Botones de accion y timers auto-actualizables.
- Recibe tickets en tiempo real via WebSocket.

### 1.17 Estadisticas — FUNCIONAL

- Ingresos diarios, cantidad de pedidos, ticket promedio, productos mas vendidos.
- Grafico de pedidos por hora.
- Pagina `Sales.tsx` + endpoint `admin/reports.py`.

### 1.18 Configuracion — FUNCIONAL

- Configuracion general de la aplicacion.
- Importacion y exportacion de datos en formato JSON.

### 1.19 Actualizaciones en Tiempo Real — COMPLETA

- Conexion WebSocket al endpoint `/ws/admin`.
- Eventos de sincronizacion CRUD: `ENTITY_CREATED`, `ENTITY_UPDATED`, `ENTITY_DELETED`.
- Notificaciones de eliminacion en cascada (`CASCADE_DELETE`) con preview de entidades afectadas.
- Sincronizacion multi-pestana via `BroadcastChannel`.
- Event Catch-up: eventos perdidos durante desconexion se replayan al reconectar via `/ws/catchup`. Estado: FUNCIONAL.

### 1.20 Modo Claro/Oscuro — COMPLETA

- Toggle en Sidebar.
- Variables CSS `[data-theme="light"]` en los 3 frontends.
- Persiste en localStorage.

### 1.21 Internacionalizacion (Dashboard) — SCAFFOLD

- Estructura i18next con locales es/en.
- Requiere `npm install i18next react-i18next`.

### 1.22 Inventario y Costos — SCAFFOLD

- 8 modelos: StockItem, StockMovement, StockAlert, Supplier, PurchaseOrder, PurchaseOrderItem, WasteLog, RecipeCost.
- Servicio `inventory_service.py` con `deduct_for_round()`, `calculate_recipe_cost()`, `get_food_cost_report()`.
- Paginas Dashboard: `Inventory.tsx` + `Suppliers.tsx`.
- Migracion: 005.

### 1.23 Cierre de Caja (Cash Register) — SCAFFOLD

- Modelos: CashRegister, CashSession, CashMovement.
- Flujo: abrir sesion (monto inicial) -> registrar movimientos -> cerrar sesion (arqueo, diferencia).
- Pagina Dashboard: `CashRegister.tsx`.
- Migracion: 006.

### 1.24 Propinas (Tips) — SCAFFOLD

- Modelos: Tip, TipDistribution, TipPool.
- Pools de distribucion configurables (% mozo, % cocina, % otros).
- Pagina Dashboard: `Tips.tsx` con 4 tabs (propinas, distribucion, pools, reportes).
- Migracion: 007.

### 1.25 Facturacion Fiscal AFIP — SCAFFOLD

- Modelos: FiscalPoint, FiscalInvoice, CreditNote.
- Tipos A/B/C, tracking CAE, calculo IVA.
- **STUB**: `_call_afip_wsfe()` retorna CAE simulado (necesita `pyafipws` + certificados AFIP para produccion).
- Pagina Dashboard: `Fiscal.tsx`.
- Migracion: 008.

### 1.26 Turnos y Horarios (Scheduling) — SCAFFOLD

- Modelos: Shift, ShiftTemplate, ShiftTemplateItem, AttendanceLog.
- Generacion de turnos basada en templates, clock-in/out con calculo de horas extra (>8h).
- Pagina Dashboard: `Scheduling.tsx` con grilla semanal.
- Migracion: 009.

### 1.27 CRM de Clientes — SCAFFOLD

- Modelos: CustomerProfile, CustomerVisit, LoyaltyTransaction, LoyaltyRule.
- Tiers de lealtad (BRONZE -> SILVER -> GOLD -> PLATINUM), acumulacion/canje de puntos, consentimiento GDPR.
- Pagina Dashboard: `CRM.tsx` con busqueda de clientes + badges de tier.
- Migracion: 010.

### 1.28 Plan de Piso Visual (Floor Plan) — SCAFFOLD

- Modelos: FloorPlan, FloorPlanTable.
- Layout visual de mesas con drag-to-reposition, colores de estado en tiempo real, auto-generacion de grilla.
- Pagina Dashboard: `FloorPlan.tsx`.
- Migracion: 011.

---

## 2. pwaMenu (PWA del Cliente - Puerto 5176)

Aplicacion PWA orientada al comensal. Permite explorar el menu, realizar pedidos colaborativos y gestionar el pago desde el celular.

### 2.1 Ingreso por QR — COMPLETA

- El cliente escanea un codigo QR ubicado en la mesa.
- Ingresa el numero de mesa (alfanumerico, ej: "INT-01") y opcionalmente su nombre.
- Se une a la sesion activa de la mesa o se crea una nueva si no existe.
- Se emite un `table_token` (HMAC) con vigencia de 3 horas para autenticar al comensal.

### 2.2 Navegacion del Menu — COMPLETA

- Estructura jerarquica: Categorias > Subcategorias > Productos.
- Cada producto muestra imagen, precio (convertido de centavos a pesos), descripcion y badges.
- Menu cacheado por 5 minutos para reducir llamadas al backend.
- Datos en localStorage con TTL de 8 horas basado en ultima actividad.

### 2.3 Filtrado Avanzado — COMPLETA

- **Filtros de alergenos**:
  - Modo estricto: oculta productos que "contienen" el alergeno.
  - Modo muy estricto: oculta productos que "contienen" o "pueden contener" el alergeno.
  - Reacciones cruzadas: seleccionar latex advierte automaticamente sobre kiwi/banana.
- **Opciones dieteticas**: vegetariano, vegano, sin gluten, keto, entre otros.
- **Filtros por metodo de coccion**: a la parrilla, al horno, frito, etc.

### 2.4 Busqueda — COMPLETA

- Barra de busqueda con debounce de 300ms para evitar llamadas excesivas.
- Busqueda sobre nombre y descripcion de productos.

### 2.5 Carrito Compartido (Shared Cart) — COMPLETA

- Carrito sincronizado en tiempo real entre todos los comensales de la mesa.
- Cada item muestra quien lo agrego mediante color y nombre del comensal.
- Eventos WebSocket: `CART_ITEM_ADDED`, `CART_ITEM_UPDATED`, `CART_ITEM_REMOVED`, `CART_CLEARED`.
- Sincronizacion multi-pestana mediante eventos de `localStorage`.

### 2.6 Confirmacion Grupal de Pedido — COMPLETA

1. Un comensal propone enviar el pedido ("Proponer enviar pedido").
2. Se muestra el `RoundConfirmationPanel` a todos los comensales de la mesa.
3. Cada comensal confirma tocando "Estoy listo".
4. Cuando todos confirman, se espera 1,5 segundos y se envia automaticamente.
5. Si no todos confirman en 5 minutos, la propuesta expira.
6. El proponente puede cancelar la propuesta en cualquier momento.

### 2.7 Seguimiento de Pedidos — COMPLETA

- Seguimiento en tiempo real del estado de cada ronda via WebSocket.
- Estados visibles para el comensal: `IN_KITCHEN` (en cocina), `READY` (listo), `SERVED` (servido).
- Los estados `PENDING`, `CONFIRMED` y `SUBMITTED` son internos (el comensal no los ve directamente).

### 2.8 Llamadas de Servicio (Service Calls) — COMPLETA

- El comensal puede llamar al mozo desde la app.
- Solicitar servicios especificos (ej: mas servilletas, consulta).
- El mozo recibe notificacion en tiempo real con animacion de parpadeo rojo.

### 2.9 Solicitud de Cuenta — COMPLETA

- Acceso desde el `BottomNav` > "Cuenta" > pagina `CloseTable`.
- Metodos de division:
  - **Partes iguales**: total dividido por cantidad de comensales.
  - **Por consumo**: cada comensal paga lo que pidio.
  - **Personalizado**: montos manuales.
- Seleccion de metodo de pago antes de procesar.

### 2.10 Integracion con Mercado Pago — FUNCIONAL

- Soporte para entornos sandbox y produccion.
- Flujo: crear preferencia de pago > redirigir a Mercado Pago > procesar > callback a `/payment/result`.
- Eventos `PAYMENT_APPROVED` / `PAYMENT_REJECTED` via Outbox Pattern para garantia de entrega.

### 2.11 Chat con IA — SCAFFOLD

- Recomendaciones impulsadas por inteligencia artificial.
- Carga diferida (lazy loaded) para no impactar el rendimiento inicial.
- Componente `AIChat/` con strategy pattern para manejo de respuestas (`responseHandlers.ts`).
- Requiere Ollama en el backend (opcional, la app funciona sin el).

### 2.12 Capacidades PWA — COMPLETA

- Soporte offline mediante Service Worker (Workbox).
- Prompt de instalacion para agregar al home screen.
- Estrategias de caching:
  - **CacheFirst**: Imagenes (30d TTL), fonts (1y TTL).
  - **NetworkFirst**: API calls con timeout fallback para soporte offline.
  - **SPA fallback**: Navega a `index.html` offline.
- Imagenes fallback offline (`fallback-product.svg`, `default-avatar.svg`).

### 2.13 Internacionalizacion (i18n) — COMPLETA

- Idiomas soportados: Espanol (base), Ingles, Portugues.
- Cadena de fallback: idioma seleccionado > espanol > clave literal.
- TODA cadena visible al usuario debe usar `t()` — cero strings hardcodeados.

### 2.14 Fidelizacion de Clientes (Customer Loyalty) — PARCIAL

Sistema en 4 fases:

| Fase | Descripcion | Estado |
|------|-------------|--------|
| 1 | Tracking por dispositivo (`device_id`) | FUNCIONAL |
| 2 | Sincronizacion de preferencias implicitas | PLANIFICADA |
| 3 | Reconocimiento del cliente recurrente | PLANIFICADA |
| 4 | Opt-in del cliente con consentimiento GDPR | PLANIFICADA |

### 2.15 Sincronizacion Multi-Pestana — COMPLETA

- Eventos de `localStorage` sincronizan el carrito entre pestanas del mismo navegador.
- Cambios en una pestana se reflejan inmediatamente en las demas.

### 2.16 TTL de Sesion de 8 Horas — COMPLETA

- La sesion expira tras 8 horas de inactividad (basado en ultima actividad, no en creacion).
- Al expirar, se limpian datos del `localStorage` y se redirige al ingreso.

### 2.17 Badge Agotado — COMPLETA

- Productos con `is_available=false` se muestran en gris con badge rojo "Agotado".
- El boton de agregar al carrito queda bloqueado para productos agotados.
- El estado se actualiza en tiempo real via evento `PRODUCT_AVAILABILITY_CHANGED`.

### 2.18 Modo Claro/Oscuro — COMPLETA

- Toggle en menu hamburguesa.
- Persiste en localStorage.
- Variables CSS `[data-theme="light"]`.

### 2.19 Event Catch-up — FUNCIONAL

- Eventos perdidos durante desconexion WS se replayan al reconectar via `/ws/catchup/session`.
- Garantiza sincronizacion del estado de rondas y carrito tras reconexion.

### 2.20 Llamar al Mozo — COMPLETA

- Boton en `ProductDetailModal` para crear un llamado de servicio (`SERVICE_CALL`).
- Usa `dinerAPI.createServiceCall({ type: 'WAITER_CALL' })`.
- Feedback visual: spinner durante llamada, checkmark al confirmar.
- Trackeo en `serviceCallStore`.

---

## 3. pwaWaiter (PWA del Mozo - Puerto 5178)

Aplicacion PWA disenada para mozos. Ofrece gestion de mesas en tiempo real con agrupacion por sector y toma de pedidos.

### 3.1 Seleccion de Sucursal Pre-Login — COMPLETA

- Antes de autenticarse, el mozo selecciona la sucursal donde trabajara.
- Se consulta `GET /api/public/branches` (sin autenticacion).
- Esta seleccion determina el contexto de trabajo para toda la sesion.

### 3.2 Verificacion de Asignacion — COMPLETA

- Tras el login, se verifica que el mozo este asignado a la sucursal seleccionada para el dia de HOY.
- `GET /api/waiter/verify-branch-assignment?branch_id={id}`.
- Si no esta asignado, se muestra "Acceso Denegado" y debe seleccionar otra sucursal.

### 3.3 Grilla de Mesas — COMPLETA

- Mesas agrupadas por sector (Interior, Terraza, etc.).
- Estados visuales con colores:
  - **Verde**: libre.
  - **Rojo**: ocupada.
  - **Violeta**: cuenta solicitada.
  - **Gris**: fuera de servicio.
- **Animaciones en tiempo real**:
  - Parpadeo rojo: llamada de servicio (URGENTE).
  - Pulso amarillo: nuevo pedido pendiente de confirmacion.
  - Parpadeo naranja: pedido listo + otras rondas aun en cocina.
  - Parpadeo azul: cambio de estado de mesa.
  - Pulso violeta: cuenta solicitada.

### 3.4 Modal de Detalle de Mesa — COMPLETA

- Informacion completa de la sesion activa.
- Rondas filtradas por estado: pendientes, listas, servidas.
- Resolucion de llamadas de servicio.
- Acciones contextuales segun estado de la mesa.

### 3.5 Comanda Rapida (Autogestion) — COMPLETA

Modal de dos pasos para que el mozo tome pedidos de clientes sin celular:

**Paso 1: Seleccion de mesa**
- Mesa LIBRE: ingresa cantidad de comensales > `activateTable()` crea la sesion.
- Mesa ACTIVA: usa la sesion existente.

**Paso 2: Menu compacto**
- Menu sin imagenes via `GET /api/waiter/branches/{id}/menu`.
- Panel izquierdo: navegacion por categorias y productos.
- Agregar items al carrito con cantidad.
- Panel derecho: revision del carrito, modificacion de cantidades.
- Enviar > `submitRound()` > ronda en estado `PENDING`.

### 3.6 Gestion de Rondas — COMPLETA

- Confirmar pedidos pendientes (`PENDING` > `CONFIRMED`).
- Marcar rondas como servidas (`READY` > `SERVED`).
- Eliminar items individuales de una ronda.
- Si se eliminan todos los items, la ronda se auto-elimina.

### 3.7 Manejo de Llamadas de Servicio — COMPLETA

- Workflow de dos pasos: Reconocer (acknowledge) > Resolver (close).
- Notificacion visual con parpadeo rojo en la grilla de mesas.
- Cada llamada se trackea individualmente.

### 3.8 Facturacion y Pagos — COMPLETA

- Solicitar cuenta para una mesa.
- Registrar pagos manuales:
  - Efectivo.
  - Tarjeta.
  - Transferencia.
- Cerrar mesa tras el pago completo.

### 3.9 Factura Fiscal (PDF) — FUNCIONAL

- Generacion de PDF de factura mediante `html2canvas` + `jspdf`.
- Formato de comprobante con detalle de items, subtotales y total.

### 3.10 Cola Offline — COMPLETA

- Las acciones fallidas se encolan para reintento automatico cuando se recupera la conectividad.
- Almacenamiento en `IndexedDB` y `localStorage` (`RetryQueueStore`).
- Banner de estado de conexion visible en la interfaz.

### 3.11 Notificaciones Push — FUNCIONAL

- Service worker `sw-push.js` para eventos push en background.
- `pushNotifications.ts` gestiona suscripcion via `POST /api/waiter/notifications/subscribe`.
- Requiere claves VAPID en la configuracion del backend.
- Alertas sonoras para llamadas de servicio y solicitudes de cuenta.

### 3.12 Capacidades PWA — COMPLETA

- Prompt de instalacion.
- Banner offline cuando se pierde conectividad.
- Banner de estado de conexion en tiempo real.

### 3.13 Modo Claro/Oscuro — COMPLETA

- Toggle en barra de header.
- Persiste en localStorage.
- Variables CSS `[data-theme="light"]`.

---

## 4. Backend (API REST - Puerto 8000)

API REST construida con FastAPI, PostgreSQL y Redis. Implementa Clean Architecture con Domain Services.

### 4.1 Autenticacion — COMPLETA

- Login con email y contrasena > JWT (access token 15min + refresh token 7 dias en HttpOnly cookie).
- Refresh proactivo cada 14 minutos desde los frontends.
- Logout con blacklist del token en Redis.
- Patron fail-closed: si Redis no esta disponible, se rechaza el token.

### 4.2 API Publica (Sin Autenticacion) — COMPLETA

- `GET /api/public/menu/{slug}`: menu completo de una sucursal.
- `GET /api/public/branches`: listado de sucursales (usado por pwaWaiter pre-login).

### 4.3 API de Administracion — COMPLETA

- CRUD para todas las entidades con paginacion (`?limit=50&offset=0` por defecto).
- Protegido por JWT + validacion de roles segun RBAC.
- Eventos WebSocket emitidos tras cada operacion CRUD.

### 4.4 API del Mozo — COMPLETA

- `POST /api/waiter/tables/{id}/activate`: activar mesa (crear sesion).
- `POST /api/waiter/sessions/{id}/rounds`: enviar ronda para clientes sin celular.
- `POST /api/waiter/sessions/{id}/check`: solicitar cuenta.
- `POST /api/waiter/payments/manual`: registrar pago manual.
- `POST /api/waiter/tables/{id}/close`: cerrar mesa.
- `GET /api/waiter/branches/{id}/menu`: menu compacto sin imagenes.
- `GET /api/waiter/verify-branch-assignment`: verificar asignacion diaria.

### 4.5 API del Comensal — COMPLETA

- `POST /api/diner/register`: registrar comensal con `device_id`.
- `POST /api/diner/rounds/submit`: enviar ronda.
- Autenticacion via header `X-Table-Token`.

### 4.6 API de Cocina — COMPLETA

- Actualizacion de estados de rondas.
- Gestion de tickets de cocina (`KitchenTicket`).
- `PATCH /api/kitchen/products/{id}/availability`: marcar disponibilidad de productos.
- Protegido por JWT + rol `KITCHEN`.

### 4.7 API de Facturacion (Billing) — COMPLETA

- Solicitud de cuenta.
- Creacion de preferencia de Mercado Pago.
- Registro de pagos.
- Rate limiting: 5-20 requests/minuto segun endpoint.
- Eventos criticos via Outbox Pattern.

### 4.8 API de Recetas — FUNCIONAL

- CRUD de recetas.
- Protegido por JWT + roles `KITCHEN`, `MANAGER` o `ADMIN`.

### 4.9 Soft Delete — COMPLETA

- Todas las entidades usan `is_active=false` en lugar de eliminacion fisica.
- Hard delete solo para registros efimeros (items de carrito, sesiones expiradas).
- `cascade_soft_delete()` desactiva la entidad y todos sus dependientes.
- Evento `CASCADE_DELETE` via WebSocket con detalle de entidades afectadas.

### 4.10 Sistema de Permisos — COMPLETA

- `PermissionContext`: extrae contexto del JWT (user_id, tenant_id, branch_ids, roles).
- Metodos de validacion: `require_management()`, `require_branch_access(branch_id)`.
- Errores centralizados: `ForbiddenError`, `NotFoundError`, `ValidationError` con logging automatico.

### 4.11 Rate Limiting — COMPLETA

- Login: 5 intentos por minuto (por IP + por email, Redis-backed con Lua scripts).
- Refresh: 5 por minuto.
- Endpoints de billing: 5-20 por minuto segun criticidad.
- WebSocket: 30 mensajes por ventana por conexion.
- Implementado con `slowapi` y Redis backend con `ThreadPoolExecutor` (2 workers).

### 4.12 Disponibilidad de Productos — FUNCIONAL

- `PATCH /api/kitchen/products/{id}/availability` permite a cocina marcar productos como no disponibles.
- `BranchProduct.is_available` (diferente de `is_active`).
- Emite evento `PRODUCT_AVAILABILITY_CHANGED` por WebSocket.
- El menu filtra automaticamente productos no disponibles.

### 4.13 Event Catch-up — FUNCIONAL

- `GET /ws/catchup?branch_id=&since=&token=` para obtener eventos perdidos tras reconexion WebSocket.
- Backend almacena ultimos 100 eventos por branch en Redis sorted set (TTL 5 min).
- pwaWaiter auto-replay al reconectar.

### 4.14 Seed Data Modular — COMPLETA

- `backend/rest_api/seeds/` con 5 modulos: tenants, users, allergens, menu, tables.
- CLI: `python cli.py db-seed --only=users`.

### 4.15 Migraciones Alembic — COMPLETA

- Cadena: `None -> 001 -> 002 -> 003 -> 004 -> 005 -> 006 -> 007 -> 008 -> 009 -> 010 -> 011 -> 012`.
- `env.py` importa todos los modelos desde `rest_api.models.Base`.
- `DATABASE_URL` cargado dinamicamente desde `shared.config.settings`.

### 4.16 Gateway de Pagos — SCAFFOLD

- `PaymentGateway` ABC en `backend/rest_api/services/payments/gateway.py`.
- Implementacion `MercadoPagoGateway`.
- Futuro: Stripe, PayPal.

### 4.17 Reservas — SCAFFOLD

- Modelo `Reservation` con flujo de estados: PENDING -> CONFIRMED -> SEATED -> COMPLETED/CANCELED/NO_SHOW.
- Migracion: 003.

### 4.18 Takeout/Delivery — SCAFFOLD

- Modelos: `DeliveryOrder` + `DeliveryOrderItem`.
- Migracion: 004.
- Arquitectura documentada en `knowledge-base/02-arquitectura/08_delivery_y_takeout.md`.

### 4.19 Personalizaciones de Producto (Product Customizations) — FUNCIONAL

- Modelos: `CustomizationOption` (nivel tenant) + `ProductCustomizationLink` (M:N entre producto y opcion).
- CRUD completo de opciones de personalizacion + gestion masiva de links por producto.
- Migracion: 012.

### 4.20 Cache Redis de Menu Publico — FUNCIONAL

- Menu publico cacheado en Redis por branch slug con TTL de 5 minutos.
- Auto-invalidacion al modificar productos, categorias o subcategorias de la sucursal.
- Reduce carga de queries en endpoints publicos de alto trafico.

---

## 5. WebSocket Gateway (Puerto 8001)

Gateway dedicado para comunicacion en tiempo real, independiente de la API REST.

### 5.1 Endpoints — COMPLETA

| Endpoint | Autenticacion | Descripcion |
|----------|---------------|-------------|
| `/ws/waiter?token=JWT` | JWT | Notificaciones para mozos (filtradas por sector) |
| `/ws/kitchen?token=JWT` | JWT | Notificaciones para cocina |
| `/ws/diner?table_token=X` | Table Token | Actualizaciones para comensales |
| `/ws/admin?token=JWT` | JWT | Notificaciones para administracion |

### 5.2 Tipos de Eventos — COMPLETA

Mas de 30 tipos de eventos organizados por dominio:

**Rondas (Round lifecycle)**:
`ROUND_PENDING`, `ROUND_CONFIRMED`, `ROUND_SUBMITTED`, `ROUND_IN_KITCHEN`, `ROUND_READY`, `ROUND_SERVED`, `ROUND_CANCELED`

**Carrito (Cart sync)**:
`CART_ITEM_ADDED`, `CART_ITEM_UPDATED`, `CART_ITEM_REMOVED`, `CART_CLEARED`

**Servicio**:
`SERVICE_CALL_CREATED`, `SERVICE_CALL_ACKED`, `SERVICE_CALL_CLOSED`

**Facturacion**:
`CHECK_REQUESTED`, `CHECK_PAID`, `PAYMENT_APPROVED`, `PAYMENT_REJECTED`

**Mesas**:
`TABLE_SESSION_STARTED`, `TABLE_CLEARED`, `TABLE_STATUS_CHANGED`

**Administracion**:
`ENTITY_CREATED`, `ENTITY_UPDATED`, `ENTITY_DELETED`, `CASCADE_DELETE`

**Productos**:
`PRODUCT_AVAILABILITY_CHANGED`

### 5.3 Enrutamiento por Sector — COMPLETA

- Los eventos con `sector_id` se envian solo a los mozos asignados a ese sector.
- Los roles `ADMIN` y `MANAGER` reciben TODOS los eventos de la sucursal.
- Este enrutamiento evita sobrecargar a mozos con informacion de sectores ajenos.

### 5.4 Garantia de Entrega (Outbox Pattern) — COMPLETA

| Patron | Eventos | Caracteristica |
|--------|---------|----------------|
| **Outbox** (no se puede perder) | `CHECK_REQUESTED/PAID`, `PAYMENT_*`, `ROUND_SUBMITTED/READY`, `SERVICE_CALL_CREATED` | Escritura atomica en DB, publicacion por procesador de fondo |
| **Redis directo** (baja latencia) | `ROUND_CONFIRMED/IN_KITCHEN/SERVED`, `CART_*`, `TABLE_*`, `ENTITY_*` | Publicacion inmediata, menor latencia |

### 5.5 Heartbeat — COMPLETA

- El cliente envia `{"type":"ping"}` cada 30 segundos.
- El servidor responde `{"type":"pong"}`.
- Timeout de 60 segundos para conexiones sin actividad.
- Codigos de cierre: `4001` (auth fallida), `4003` (prohibido), `4029` (rate limited).

### 5.6 Rate Limiting — COMPLETA

- 20 mensajes por segundo por conexion (configurable via `WS_MESSAGE_RATE_LIMIT`).
- Exceder el limite resulta en cierre con codigo `4029`.

### 5.7 Circuit Breaker — COMPLETA

- Se activa tras 5 fallos consecutivos.
- Estado abierto por 30 segundos antes de intentar recuperacion.
- Protege contra cascadas de errores en Redis u otros servicios externos.

### 5.8 Arquitectura Interna — COMPLETA

- Composicion y patrones de diseno (Strategy, Router).
- Autenticacion via Strategy Pattern: `JWTAuthStrategy` para staff, `TableTokenAuthStrategy` para comensales.
- Locks fragmentados por sucursal para alta concurrencia (400+ usuarios).
- Worker pool de broadcast: 10 workers paralelos (~160ms para 400 usuarios) con fallback legacy de batches de 50.
- Redis Streams consumer para eventos criticos (at-least-once delivery, DLQ para mensajes fallidos).

---

## 6. Modulos de Negocio Adicionales (Scaffolds)

Estos modulos tienen modelos, migraciones y paginas de Dashboard creadas, pero la logica de negocio es parcial o placeholder:

| Modulo | Migracion | Pagina Dashboard | Estado |
|--------|-----------|-----------------|--------|
| Inventario y Costos | 005 | `Inventory.tsx`, `Suppliers.tsx` | SCAFFOLD |
| Cierre de Caja | 006 | `CashRegister.tsx` | SCAFFOLD |
| Propinas | 007 | `Tips.tsx` | SCAFFOLD |
| Facturacion Fiscal AFIP | 008 | `Fiscal.tsx` | SCAFFOLD (stub AFIP) |
| Turnos y Horarios | 009 | `Scheduling.tsx` | SCAFFOLD |
| CRM de Clientes | 010 | `CRM.tsx` | SCAFFOLD |
| Plan de Piso Visual | 011 | `FloorPlan.tsx` | SCAFFOLD |
| Reservas | 003 | - | SCAFFOLD |
| Takeout/Delivery | 004 | - | SCAFFOLD |

**Total paginas Dashboard**: 34 (incluyendo los scaffolds de modulos adicionales).
