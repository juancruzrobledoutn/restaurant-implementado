> Creado: 2026-03-11 | Actualizado: 2026-04-06 | Estado: vigente

# Backlog Completo de Historias de Usuario — Buen Sabor

## Índice

1. [Visión General](#visión-general)
2. [Épicas del Producto](#épicas-del-producto)
3. [Historias de Usuario por Épica](#historias-de-usuario-por-épica)
4. [Backlog Priorizado](#backlog-priorizado)
5. [Plan de Implementación por Sprints](#plan-de-implementación-por-sprints)
6. [Diagrama de Dependencias](#diagrama-de-dependencias)

---

## Visión General

Este documento contiene **todas** las historias de usuario del sistema Buen Sabor, cubriendo las cinco componentes del monorepo: backend (API REST + modelos), ws_gateway (WebSocket), Dashboard (panel administrativo), pwaMenu (menú digital para comensales) y pwaWaiter (aplicación para mozos). Cada historia representa una unidad funcional completa, con criterios de aceptación verificables y dependencias explícitas.

Las historias están organizadas en **15 épicas** que abarcan desde la infraestructura fundacional hasta las funcionalidades avanzadas de fidelización de clientes.

---

## Épicas del Producto

| ID | Épica | Descripción | Componentes |
|----|-------|-------------|-------------|
| E01 | Infraestructura y DevOps | Base de datos, Docker, CI/CD, configuración de entornos | backend, devOps |
| E02 | Autenticación y Seguridad | Login, JWT, refresh tokens, RBAC, table tokens, middlewares | backend, Dashboard, pwaWaiter |
| E03 | Gestión de Tenants y Sucursales | Multi-tenancy, CRUD de sucursales, configuración por sucursal | backend, Dashboard |
| E04 | Gestión de Staff | Usuarios, roles, asignaciones de mozos a sectores | backend, Dashboard |
| E05 | Estructura del Menú | Categorías, subcategorías, productos, precios por sucursal | backend, Dashboard |
| E06 | Alérgenos y Perfiles Alimentarios | Alérgenos, reacciones cruzadas, filtros dietarios y de cocción | backend, Dashboard, pwaMenu |
| E07 | Gestión de Mesas y Sectores | Sectores, mesas, códigos QR, estados de mesa | backend, Dashboard, pwaWaiter |
| E08 | Sesión de Mesa y Comensales | Escaneo QR, unirse a mesa, sesión compartida, tokens de mesa | backend, pwaMenu |
| E09 | Menú Digital (pwaMenu) | Exploración de menú, detalle de producto, filtros, búsqueda, i18n | pwaMenu |
| E10 | Carrito Compartido y Pedidos | Carrito multi-dispositivo, sincronización en tiempo real, confirmación grupal | pwaMenu, backend, ws_gateway |
| E11 | Ciclo de Vida de Rondas | PENDING→CONFIRMED→SUBMITTED→IN_KITCHEN→READY→SERVED | backend, ws_gateway, Dashboard, pwaWaiter, pwaMenu |
| E12 | Operaciones del Mozo | Vista de mesas, comanda rápida, llamados de servicio, autogestión | pwaWaiter, backend |
| E13 | Cocina | Vista de tickets, cambios de estado, notificaciones | backend, Dashboard, ws_gateway |
| E14 | Facturación y Pagos | Cuenta, división de gastos, pagos (efectivo, MP), propinas | backend, Dashboard, pwaMenu, pwaWaiter |
| E15 | WebSocket Gateway | Conexiones, broadcasting, heartbeat, circuit breaker, rate limiting | ws_gateway |
| E16 | Promociones | CRUD de promociones, aplicación en pedidos, visualización | backend, Dashboard, pwaMenu |
| E17 | Recetas e Ingredientes | Gestión de recetas, ingredientes, sub-ingredientes, grupos | backend, Dashboard |
| E18 | Fidelización de Clientes | Device tracking, preferencias implícitas, perfil de cliente, GDPR | backend, pwaMenu |
| E19 | Reportes y Analíticas | Métricas operativas, dashboards, exportación | backend, Dashboard |
| E20 | PWA y Experiencia Offline | Service workers, notificaciones push, cola de reintentos, instalación | pwaMenu, pwaWaiter |

---

## Historias de Usuario por Épica

---

### E01 — Infraestructura y DevOps

#### HU-0101: Configuración de Base de Datos PostgreSQL

**Como** equipo de desarrollo
**Quiero** una base de datos PostgreSQL configurada con todas las tablas del modelo de dominio
**Para** persistir la información del sistema de forma relacional y confiable

**Criterios de aceptación:**
- La base de datos contiene las 52+ tablas del modelo (Tenant, Branch, User, Product, Category, Subcategory, Table, TableSession, Diner, Round, RoundItem, Check, Payment, etc.)
- Las migraciones se ejecutan automáticamente al iniciar el contenedor
- Las relaciones foreign key están correctamente definidas con cascadas apropiadas
- Los índices están creados para queries frecuentes (tenant_id, branch_id, is_active)
- Existe un script de seed con datos de demostración

**Gobernanza:** CRITICO

---

#### HU-0102: Configuración de Redis

**Como** equipo de desarrollo
**Quiero** un servidor Redis configurado para caché, pub/sub y blacklist de tokens
**Para** soportar comunicación en tiempo real y gestión de sesiones

**Criterios de aceptación:**
- Redis disponible en puerto 6380
- Pool de conexiones asíncronas configurado como singleton
- Canales de pub/sub definidos por branch (`branch:{id}:events`)
- Redis Streams configurados para eventos críticos con consumer groups
- Blacklist de tokens JWT funcional con TTL automático

**Gobernanza:** CRITICO

---

#### HU-0103: Docker Compose para Desarrollo

**Como** desarrollador
**Quiero** levantar todo el entorno con un solo comando
**Para** comenzar a desarrollar sin configuración manual

**Criterios de aceptación:**
- `docker compose up -d --build` levanta DB, Redis, backend API, WS Gateway
- Variables de entorno configurables via `.env`
- Volúmenes persistentes para datos de PostgreSQL
- pgAdmin disponible en puerto 5050
- Hot reload funcional para backend

**Gobernanza:** BAJO

---

#### HU-0104: Configuración de Entornos (.env)

**Como** desarrollador
**Quiero** archivos `.env.example` en cada componente
**Para** configurar rápidamente mi entorno local

**Criterios de aceptación:**
- Cada componente (backend, Dashboard, pwaMenu, pwaWaiter) tiene `.env.example`
- Variables documentadas con comentarios explicativos
- Valores por defecto funcionales para desarrollo local
- Variables sensibles marcadas como requeridas (JWT_SECRET, TABLE_TOKEN_SECRET)

**Gobernanza:** BAJO

---

### E02 — Autenticación y Seguridad

#### HU-0201: Login con JWT

**Como** usuario del sistema (admin, manager, mozo, cocina)
**Quiero** autenticarme con email y contraseña
**Para** acceder a las funcionalidades correspondientes a mi rol

**Criterios de aceptación:**
- Endpoint `POST /api/auth/login` acepta email y password
- Retorna access token (15 min) y refresh token (7 días en cookie HttpOnly)
- Access token contiene: sub (user_id), tenant_id, branch_ids, roles
- Contraseñas hasheadas con bcrypt
- Credenciales inválidas retornan 401 con mensaje genérico

**Gobernanza:** CRITICO

---

#### HU-0202: Refresh de Token

**Como** usuario autenticado
**Quiero** que mi sesión se renueve automáticamente
**Para** no tener que re-autenticarme cada 15 minutos

**Criterios de aceptación:**
- Endpoint `POST /api/auth/refresh` acepta refresh token desde cookie
- Retorna nuevo access token y rota el refresh token
- Refresh token anterior se invalida en Redis blacklist
- Frontend hace refresh proactivo cada 14 minutos
- Si el refresh falla, redirige a login

**Gobernanza:** CRITICO

---

#### HU-0203: Logout

**Como** usuario autenticado
**Quiero** cerrar mi sesión de forma segura
**Para** que nadie más pueda usar mi sesión

**Criterios de aceptación:**
- Endpoint `POST /api/auth/logout` invalida el access token actual
- Token añadido a blacklist en Redis con TTL del tiempo restante
- Cookie de refresh token eliminada
- Logout no produce loop infinito (retry deshabilitado en 401 durante logout)

**Gobernanza:** CRITICO

---

#### HU-0204: Obtener Perfil del Usuario

**Como** usuario autenticado
**Quiero** consultar mi información de perfil
**Para** ver mis datos y roles asignados

**Criterios de aceptación:**
- Endpoint `GET /api/auth/me` retorna datos del usuario actual
- Incluye: id, email, nombre, tenant_id, branch_ids, roles
- Requiere access token válido
- 401 si token expirado o blacklisted

**Gobernanza:** CRITICO

---

#### HU-0205: Table Token para Comensales

**Como** comensal que escanea un QR
**Quiero** recibir un token de acceso temporal
**Para** interactuar con el menú y pedidos sin registrarme

**Criterios de aceptación:**
- Al unirse a una mesa se genera un HMAC table token
- Token contiene: table_id, session_id, diner_id, branch_id
- Validez de 3 horas
- Se envía en header `X-Table-Token` en cada request
- Token inválido retorna 401

**Gobernanza:** CRITICO

---

#### HU-0206: Middlewares de Seguridad

**Como** equipo de seguridad
**Quiero** middlewares de protección en la API
**Para** prevenir ataques comunes

**Criterios de aceptación:**
- CORS configurado con orígenes permitidos (dev: localhost, prod: ALLOWED_ORIGINS)
- Headers de seguridad: CSP, HSTS (prod), X-Frame-Options: DENY, nosniff
- Validación de Content-Type en POST/PUT/PATCH
- Protección SSRF en URLs de imágenes (bloquea IPs internas, metadata cloud)
- Validación de origen en conexiones WebSocket

**Gobernanza:** CRITICO

---

#### HU-0207: Control de Acceso por Roles (RBAC)

**Como** administrador del sistema
**Quiero** que cada rol tenga permisos específicos
**Para** garantizar que solo usuarios autorizados realicen operaciones sensibles

**Criterios de aceptación:**
- ADMIN: acceso total a crear, editar y eliminar
- MANAGER: puede gestionar staff, mesas, alérgenos, promociones en sus sucursales
- KITCHEN: solo puede ver y cambiar estado de tickets de cocina
- WAITER: solo puede operar sus mesas asignadas y tomar pedidos
- PermissionContext verifica roles antes de cada operación
- Acceso denegado retorna 403 con mensaje descriptivo

**Gobernanza:** CRITICO

---

#### HU-0208: Rate Limiting en Endpoints Críticos

**Como** equipo de seguridad
**Quiero** limitar la tasa de requests en endpoints de facturación
**Para** prevenir abuso y ataques de fuerza bruta

**Criterios de aceptación:**
- Endpoints de billing limitados a 5-20 requests por minuto según endpoint
- Login limitado para prevenir fuerza bruta
- Respuesta 429 con header Retry-After cuando se excede el límite
- Rate limit por IP y por usuario

**Gobernanza:** CRITICO

---

### E03 — Gestión de Tenants y Sucursales

#### HU-0301: Multi-Tenancy

**Como** operador de la plataforma
**Quiero** que múltiples restaurantes operen de forma aislada
**Para** ofrecer el servicio a diferentes clientes

**Criterios de aceptación:**
- Cada entidad principal tiene campo tenant_id
- Queries filtran automáticamente por tenant_id del usuario autenticado
- No es posible acceder a datos de otro tenant
- Catálogos (CookingMethod, FlavorProfile, TextureProfile, CuisineType) son por tenant

**Gobernanza:** CRITICO

---

#### HU-0302: CRUD de Sucursales

**Como** administrador
**Quiero** gestionar las sucursales de mi restaurante
**Para** configurar la operación de cada local

**Criterios de aceptación:**
- Crear sucursal con nombre, dirección, slug único, configuración
- Editar datos de sucursal existente
- Soft delete de sucursal (is_active = false)
- Listar sucursales con paginación (?limit=&offset=)
- Slug se usa para acceso público al menú (`/api/public/menu/{slug}`)
- Endpoint público `GET /api/public/branches` lista sucursales activas (sin auth)

**Gobernanza:** ALTO

---

#### HU-0303: Selector de Sucursal en Dashboard

**Como** administrador o manager
**Quiero** seleccionar la sucursal activa en el Dashboard
**Para** gestionar una sucursal específica

**Criterios de aceptación:**
- Dropdown en header muestra sucursales del usuario
- Al cambiar de sucursal se recargan todos los datos
- La selección persiste en localStorage
- Si el usuario tiene una sola sucursal, se selecciona automáticamente

**Gobernanza:** MEDIO

---

### E04 — Gestión de Staff

#### HU-0401: CRUD de Usuarios

**Como** administrador
**Quiero** gestionar los usuarios del sistema
**Para** controlar quién accede a la plataforma

**Criterios de aceptación:**
- Crear usuario con email, nombre, contraseña
- Asignar roles por sucursal (UserBranchRole M:N)
- Un usuario puede tener diferentes roles en diferentes sucursales
- Editar datos y roles de usuario existente
- Desactivar usuario (soft delete)
- Listar usuarios con filtro por sucursal y rol

**Gobernanza:** CRITICO

---

#### HU-0402: Asignación Diaria de Mozos a Sectores

**Como** manager
**Quiero** asignar mozos a sectores cada día
**Para** distribuir la carga de trabajo en el salón

**Criterios de aceptación:**
- Endpoint `POST /api/admin/waiter-assignments` asigna mozo a sector para una fecha
- Validar que el mozo tiene rol WAITER en la sucursal
- Un mozo puede estar asignado a múltiples sectores
- Las asignaciones son por día (WaiterSectorAssignment)
- Dashboard muestra interfaz de drag-and-drop o selector para asignaciones

**Gobernanza:** MEDIO

---

#### HU-0403: Verificación de Asignación del Mozo

**Como** mozo
**Quiero** que se verifique mi asignación al iniciar sesión
**Para** asegurar que estoy autorizado a trabajar hoy en esta sucursal

**Criterios de aceptación:**
- Endpoint `GET /api/waiter/verify-branch-assignment?branch_id={id}`
- Verifica que el mozo está asignado HOY a la sucursal seleccionada
- Si no está asignado: retorna error → pantalla "Acceso Denegado"
- Si está asignado: retorna sectores asignados y confirma acceso
- Botón "Elegir otra sucursal" permite cambiar

**Gobernanza:** MEDIO

---

#### HU-0404: Gestión de Staff desde Dashboard

**Como** administrador
**Quiero** una vista completa de gestión de personal
**Para** administrar todos los empleados del restaurante

**Criterios de aceptación:**
- Tabla con lista de empleados, roles y sucursales
- Formulario de creación/edición con validación
- Filtros por sucursal, rol y estado (activo/inactivo)
- Indicador visual de estado de asignación actual
- StaffService maneja la lógica de negocio

**Gobernanza:** CRITICO

---

### E05 — Estructura del Menú

#### HU-0501: CRUD de Categorías

**Como** administrador
**Quiero** gestionar las categorías del menú
**Para** organizar los productos de forma lógica

**Criterios de aceptación:**
- Crear categoría con nombre, descripción, imagen, orden de visualización
- Categorías son por sucursal (branch_id)
- Editar y soft delete de categorías
- Reordenar categorías arrastrando (orden de visualización)
- Cascade soft delete: al desactivar categoría se desactivan subcategorías y productos

**Gobernanza:** BAJO

---

#### HU-0502: CRUD de Subcategorías

**Como** administrador
**Quiero** gestionar subcategorías dentro de cada categoría
**Para** crear una jerarquía de menú de tres niveles

**Criterios de aceptación:**
- Crear subcategoría vinculada a una categoría
- Nombre, descripción, imagen, orden de visualización
- Editar y soft delete
- Cascade: al desactivar subcategoría se desactivan productos asociados

**Gobernanza:** BAJO

---

#### HU-0503: CRUD de Productos

**Como** administrador
**Quiero** gestionar los productos del menú
**Para** definir qué puede pedir un cliente

**Criterios de aceptación:**
- Crear producto con nombre, descripción, imagen, subcategoría
- Precio por sucursal via BranchProduct (en centavos)
- Campos opcionales: tiempo estimado de preparación, destacado
- Editar datos del producto
- Soft delete de producto
- Listar con filtros por categoría, subcategoría, estado
- Validación de URL de imagen (SSRF protection)

**Gobernanza:** ALTO

---

#### HU-0504: Precios por Sucursal

**Como** administrador
**Quiero** definir precios diferentes para cada sucursal
**Para** adaptar los precios según la ubicación

**Criterios de aceptación:**
- Relación BranchProduct vincula producto con sucursal y precio
- Precio almacenado en centavos (integer)
- Un producto puede tener precios diferentes en cada sucursal
- Si no tiene precio en una sucursal, no se muestra en esa sucursal
- Dashboard permite editar precios por sucursal

**Gobernanza:** ALTO

---

#### HU-0505: Menú Público por Slug

**Como** cliente del restaurante
**Quiero** acceder al menú digital sin autenticación
**Para** explorar los productos antes o durante mi visita

**Criterios de aceptación:**
- Endpoint `GET /api/public/menu/{slug}` retorna menú completo
- Incluye categorías, subcategorías y productos con precios
- Solo retorna items activos (is_active = true)
- No requiere autenticación
- Respuesta optimizada (sin datos internos)

**Gobernanza:** ALTO

---

### E06 — Alérgenos y Perfiles Alimentarios

#### HU-0601: CRUD de Alérgenos

**Como** administrador
**Quiero** gestionar el catálogo de alérgenos
**Para** informar a los clientes sobre posibles riesgos

**Criterios de aceptación:**
- Crear alérgeno con nombre, descripción, ícono
- Alérgenos son por tenant
- Editar y soft delete
- Los 14 alérgenos principales pre-cargados en seed

**Gobernanza:** CRITICO

---

#### HU-0602: Asociación Producto-Alérgeno

**Como** administrador
**Quiero** asociar alérgenos a cada producto
**Para** que los clientes identifiquen riesgos alimentarios

**Criterios de aceptación:**
- Relación M:N via ProductAllergen
- Incluye tipo de presencia (CONTAINS, MAY_CONTAIN, TRACES)
- Incluye nivel de riesgo
- Dashboard muestra selector de alérgenos en formulario de producto
- API retorna alérgenos con cada producto

**Gobernanza:** CRITICO

---

#### HU-0603: Filtros Dietarios en pwaMenu

**Como** comensal con restricciones dietarias
**Quiero** filtrar el menú por alérgenos y preferencias
**Para** encontrar productos seguros para mi consumo

**Criterios de aceptación:**
- Filtro por alérgenos: excluir productos que contengan ciertos alérgenos
- Sistema de reacciones cruzadas advierte sobre riesgos indirectos
- Filtros de perfil de cocción (CookingMethod)
- Filtros de perfil de sabor (FlavorProfile)
- Filtros de textura (TextureProfile)
- Productos filtrados muestran badge de seguridad

**Gobernanza:** CRITICO

---

### E07 — Gestión de Mesas y Sectores

#### HU-0701: CRUD de Sectores

**Como** administrador
**Quiero** definir sectores dentro de una sucursal
**Para** organizar el salón en zonas (Interior, Terraza, etc.)

**Criterios de aceptación:**
- Crear sector con nombre y sucursal
- Editar nombre y estado de sector
- Soft delete de sector
- Cascade: al desactivar sector se desactivan mesas asociadas
- SectorService maneja la lógica

**Gobernanza:** BAJO

---

#### HU-0702: CRUD de Mesas

**Como** administrador
**Quiero** gestionar las mesas de cada sector
**Para** definir la capacidad y disposición del salón

**Criterios de aceptación:**
- Crear mesa con número, código alfanumérico (ej: "INT-01"), capacidad, sector
- Código NO es único globalmente — es único por sucursal
- Editar datos de mesa
- Cambiar estado: FREE, ACTIVE, PAYING, OUT_OF_SERVICE
- Soft delete de mesa
- TableService maneja la lógica

**Gobernanza:** BAJO

---

#### HU-0703: Vista de Mesas en Dashboard

**Como** administrador o manager
**Quiero** ver el estado de todas las mesas en tiempo real
**Para** supervisar la operación del salón

**Criterios de aceptación:**
- Grilla de mesas agrupadas por sector
- Colores por estado: verde (FREE), rojo (ACTIVE), púrpura (PAYING), gris (OUT_OF_SERVICE)
- Actualización en tiempo real via WebSocket
- Click en mesa muestra detalle (sesión activa, pedidos, comensales)
- Filtros por estado

**Gobernanza:** MEDIO

---

### E08 — Sesión de Mesa y Comensales

#### HU-0801: Iniciar Sesión de Mesa (Escaneo QR)

**Como** comensal
**Quiero** escanear el código QR de la mesa
**Para** unirme a la sesión digital y poder hacer pedidos

**Criterios de aceptación:**
- URL del QR contiene branch_slug y table_code
- Endpoint `POST /api/tables/code/{code}/session` crea o retorna sesión activa
- Si la mesa está FREE, se crea nueva sesión (estado OPEN)
- Si la mesa está ACTIVE, se une a la sesión existente
- Retorna table token para el nuevo comensal
- Evento TABLE_SESSION_STARTED emitido via WebSocket

**Gobernanza:** ALTO

---

#### HU-0802: Registro de Comensal

**Como** comensal que se une a una mesa
**Quiero** registrar mi nombre y color
**Para** que los demás identifiquen mis ítems en el carrito compartido

**Criterios de aceptación:**
- Formulario solicita nombre del comensal
- Se asigna color único dentro de la sesión
- Se crea registro Diner vinculado a la sesión
- Si existe customer_id (device tracking), se vincula
- Table token incluye diner_id

**Gobernanza:** MEDIO

---

#### HU-0803: Pantalla de Unirse a Mesa (pwaMenu)

**Como** comensal
**Quiero** ver una pantalla de bienvenida al escanear el QR
**Para** elegir un nombre y unirme a la mesa

**Criterios de aceptación:**
- Pantalla muestra nombre del restaurante y número de mesa
- Campo para ingresar nombre del comensal
- Botón "Unirse a la mesa"
- Si ya hay comensales, muestra lista de nombres existentes
- Transición fluida al menú después de unirse

**Gobernanza:** MEDIO

---

### E09 — Menú Digital (pwaMenu)

#### HU-0901: Exploración de Menú por Categorías

**Como** comensal
**Quiero** navegar el menú por categorías y subcategorías
**Para** encontrar lo que deseo pedir

**Criterios de aceptación:**
- Vista de categorías con imágenes y nombres
- Al seleccionar categoría, muestra subcategorías
- Al seleccionar subcategoría, muestra productos
- Jerarquía de tres niveles: Categoría → Subcategoría → Producto
- Navegación fluida con animaciones
- Solo muestra items activos con precio en la sucursal actual

**Gobernanza:** MEDIO

---

#### HU-0902: Detalle de Producto

**Como** comensal
**Quiero** ver el detalle completo de un producto
**Para** decidir si quiero pedirlo

**Criterios de aceptación:**
- Imagen del producto a tamaño completo
- Nombre, descripción, precio
- Lista de alérgenos con tipo de presencia e ícono
- Tiempo estimado de preparación (si disponible)
- Botón "Agregar al carrito" con selector de cantidad
- Campo para notas/comentarios del producto

**Gobernanza:** MEDIO

---

#### HU-0903: Búsqueda de Productos

**Como** comensal
**Quiero** buscar productos por nombre
**Para** encontrar rápidamente lo que quiero pedir

**Criterios de aceptación:**
- Barra de búsqueda accesible desde cualquier pantalla del menú
- Búsqueda en tiempo real (debounce de 300ms)
- Resultados muestran nombre, categoría, precio e imagen miniatura
- Sin resultados muestra mensaje apropiado
- Click en resultado navega al detalle del producto

**Gobernanza:** BAJO

---

#### HU-0904: Internacionalización (i18n)

**Como** comensal extranjero
**Quiero** ver el menú en mi idioma
**Para** entender la oferta del restaurante

**Criterios de aceptación:**
- Soporte para español (es), inglés (en) y portugués (pt)
- Selector de idioma accesible en la interfaz
- TODOS los textos de la UI usan función `t()` — cero strings hardcodeados
- Nombres de productos y descripciones traducibles
- El idioma seleccionado persiste en localStorage
- Textos del sistema (botones, labels, mensajes) completamente traducidos

**Gobernanza:** MEDIO

---

### E10 — Carrito Compartido y Pedidos

#### HU-1001: Agregar Producto al Carrito

**Como** comensal
**Quiero** agregar productos a mi carrito
**Para** preparar mi pedido antes de enviarlo

**Criterios de aceptación:**
- Botón "Agregar" en detalle de producto
- Selector de cantidad (1-99)
- Campo de notas opcional por ítem
- Cada ítem identificado con nombre y color del comensal
- Actualización optimista del UI
- Evento CART_ITEM_ADDED emitido via WebSocket

**Gobernanza:** MEDIO

---

#### HU-1002: Sincronización Multi-Dispositivo del Carrito

**Como** comensal en una mesa compartida
**Quiero** ver en tiempo real lo que agregan los demás
**Para** coordinar el pedido grupal

**Criterios de aceptación:**
- Todos los comensales de la mesa ven el mismo carrito
- Eventos WebSocket: CART_ITEM_ADDED, CART_ITEM_UPDATED, CART_ITEM_REMOVED, CART_CLEARED
- Cada ítem muestra quién lo agregó (nombre y color)
- Actualización instantánea sin necesidad de refrescar
- Conflictos resueltos por orden de llegada al servidor

**Gobernanza:** ALTO

---

#### HU-1003: Modificar y Eliminar Ítems del Carrito

**Como** comensal
**Quiero** cambiar la cantidad o eliminar ítems de mi carrito
**Para** ajustar mi pedido antes de enviarlo

**Criterios de aceptación:**
- Botones +/- para cambiar cantidad
- Botón eliminar con confirmación
- Solo el comensal que agregó el ítem puede modificarlo/eliminarlo
- Actualización optimista con rollback en caso de error
- Eventos CART_ITEM_UPDATED y CART_ITEM_REMOVED emitidos

**Gobernanza:** MEDIO

---

#### HU-1004: Confirmación Grupal del Pedido

**Como** grupo de comensales
**Queremos** votar para confirmar el envío del pedido
**Para** asegurar que todos están de acuerdo antes de enviarlo

**Criterios de aceptación:**
- Botón "Enviar Pedido" inicia votación
- Cada comensal ve notificación para confirmar
- Indicador visual de quién ha confirmado
- Cuando todos confirman, el pedido se envía automáticamente
- Un comensal puede cancelar su confirmación
- Timeout configurable para la votación
- Al enviar, se crea una Round con estado PENDING

**Gobernanza:** MEDIO

---

#### HU-1005: Envío de Ronda (Pedido)

**Como** mesa de comensales
**Quiero** que nuestro pedido confirmado se envíe al sistema
**Para** que el mozo lo revise y lo envíe a cocina

**Criterios de aceptación:**
- Los ítems de todos los comensales se combinan en una sola Round
- Cada ítem registra el diner_id de quien lo pidió
- Estado inicial: PENDING
- Evento ROUND_PENDING emitido a admin y mozos
- El carrito se limpia después del envío exitoso
- Si falla, se muestra error y se mantiene el carrito

**Gobernanza:** ALTO

---

### E11 — Ciclo de Vida de Rondas

#### HU-1101: Mozo Confirma Pedido (PENDING → CONFIRMED)

**Como** mozo
**Quiero** confirmar un pedido pendiente después de verificarlo en la mesa
**Para** asegurar que el pedido es correcto antes de enviarlo a cocina

**Criterios de aceptación:**
- Rondas PENDING muestran botón "Confirmar Pedido" en pwaWaiter
- Mozo revisa ítems y confirma
- Estado cambia a CONFIRMED
- Evento ROUND_CONFIRMED emitido a admin y mozos
- Cocina NO ve rondas PENDING ni CONFIRMED

**Gobernanza:** MEDIO

---

#### HU-1102: Admin/Manager Envía a Cocina (CONFIRMED → SUBMITTED)

**Como** administrador o manager
**Quiero** enviar pedidos confirmados a cocina
**Para** iniciar la preparación de los platos

**Criterios de aceptación:**
- Dashboard muestra rondas CONFIRMED con botón "Enviar a Cocina"
- Solo ADMIN y MANAGER pueden realizar esta acción
- Estado cambia a SUBMITTED
- Evento ROUND_SUBMITTED emitido a todos (admin, cocina, mozos)
- Se genera KitchenTicket asociado a la ronda
- Usa Outbox pattern para garantizar entrega

**Gobernanza:** MEDIO

---

#### HU-1103: Cocina Inicia Preparación (SUBMITTED → IN_KITCHEN)

**Como** personal de cocina
**Quiero** marcar que comencé a preparar un pedido
**Para** informar al equipo que el pedido está en proceso

**Criterios de aceptación:**
- Vista de cocina muestra tickets SUBMITTED
- Botón "Iniciar Preparación" cambia estado a IN_KITCHEN
- Evento ROUND_IN_KITCHEN emitido a todos incluyendo comensales
- Timestamp de inicio registrado

**Gobernanza:** MEDIO

---

#### HU-1104: Cocina Marca como Listo (IN_KITCHEN → READY)

**Como** personal de cocina
**Quiero** marcar que un pedido está listo para servir
**Para** que el mozo venga a recogerlo

**Criterios de aceptación:**
- Botón "Listo" en ticket de cocina
- Estado cambia a READY
- Evento ROUND_READY emitido via Outbox pattern (garantizado)
- Mozo recibe notificación con alerta visual (verde pulsante)
- pwaWaiter muestra "¡Pedido listo! Recoger en cocina"
- Card de mesa muestra animación naranja (ready_with_kitchen)

**Gobernanza:** MEDIO

---

#### HU-1105: Staff Marca como Servido (READY → SERVED)

**Como** mozo o personal
**Quiero** marcar que un pedido fue entregado a la mesa
**Para** completar el ciclo del pedido

**Criterios de aceptación:**
- Botón "Marcar como Servido" en detalle de mesa
- Estado cambia a SERVED
- Evento ROUND_SERVED emitido
- Badge de estado cambia a gris "Servido"
- Animación de alerta se detiene

**Gobernanza:** MEDIO

---

#### HU-1106: Cancelar Ronda

**Como** mozo o administrador
**Quiero** cancelar una ronda pendiente o confirmada
**Para** anular un pedido incorrecto

**Criterios de aceptación:**
- Solo rondas en estado PENDING o CONFIRMED pueden cancelarse
- Confirmación requerida antes de cancelar
- Estado cambia a CANCELED
- Evento ROUND_CANCELED emitido
- Ítems no se cobran en la cuenta

**Gobernanza:** MEDIO

---

#### HU-1107: Eliminar Ítem de Ronda

**Como** mozo
**Quiero** eliminar un ítem específico de una ronda pendiente
**Para** corregir el pedido sin cancelar toda la ronda

**Criterios de aceptación:**
- Solo en rondas PENDING o CONFIRMED
- Ícono de papelera por cada ítem
- Diálogo de confirmación antes de eliminar
- Si la ronda queda vacía, se elimina automáticamente
- Evento ROUND_ITEM_DELETED emitido
- Endpoint: DELETE del ítem específico

**Gobernanza:** MEDIO

---

#### HU-1108: Vista de Rondas con Filtros

**Como** mozo
**Quiero** filtrar las rondas de una mesa por estado
**Para** encontrar rápidamente la información que necesito

**Criterios de aceptación:**
- Tabs de filtro en detalle de mesa: "Todos", "Pendientes", "Listos", "Servidos"
- "Pendientes" incluye: PENDING, CONFIRMED, SUBMITTED, IN_KITCHEN
- "Listos" muestra solo READY
- "Servidos" muestra solo SERVED
- Contador en cada tab con cantidad de rondas

**Gobernanza:** BAJO

---

### E12 — Operaciones del Mozo

#### HU-1201: Selección de Sucursal Pre-Login

**Como** mozo
**Quiero** seleccionar la sucursal antes de iniciar sesión
**Para** indicar en qué local estoy trabajando hoy

**Criterios de aceptación:**
- Pantalla PreLoginBranchSelect es la primera vista
- Lista de sucursales obtenida de `GET /api/public/branches` (sin auth)
- Al seleccionar sucursal, se almacena preLoginBranchId en authStore
- Botón continuar lleva a pantalla de login
- Nombre de sucursal visible durante login

**Gobernanza:** MEDIO

---

#### HU-1202: Login del Mozo

**Como** mozo
**Quiero** iniciar sesión con mis credenciales
**Para** acceder a mis mesas asignadas

**Criterios de aceptación:**
- Formulario de login con email y contraseña
- Muestra la sucursal seleccionada con botón "Cambiar"
- Tras login exitoso, verifica asignación a la sucursal
- Si no está asignado hoy → pantalla "Acceso Denegado"
- Si está asignado → navega a MainPage
- Token se refresca proactivamente cada 14 minutos

**Gobernanza:** MEDIO

---

#### HU-1203: Grilla de Mesas por Sector

**Como** mozo
**Quiero** ver todas mis mesas agrupadas por sector
**Para** tener una visión general del salón

**Criterios de aceptación:**
- Mesas agrupadas por sector (ej: "Interior", "Terraza")
- Header de sector con nombre, badge con cantidad de mesas
- Indicador rojo pulsante si sector tiene mesas urgentes
- Cards de mesa con colores por estado (verde/rojo/púrpura/gris)
- Filtros: Urgentes, Activas, Libres, Fuera de servicio
- Actualización en tiempo real via WebSocket

**Gobernanza:** MEDIO

---

#### HU-1204: Card de Mesa con Animaciones

**Como** mozo
**Quiero** ver indicadores visuales en cada mesa
**Para** identificar rápidamente las que requieren atención

**Criterios de aceptación:**
- Prioridad de animaciones:
  1. Llamado de servicio: parpadeo rojo (3s)
  2. Pedido listo en cocina: parpadeo naranja (5s)
  3. Cambio de estado: parpadeo azul (1.5s)
  4. Nuevo pedido: pulso amarillo (2s)
  5. Cuenta solicitada: pulso púrpura
- Badge de estado del pedido: Pendiente (amarillo), Confirmado (azul), En Cocina (azul), Listo + Cocina (naranja), Listo (verde), Servido (gris)
- Número de mesa, cantidad de comensales

**Gobernanza:** BAJO

---

#### HU-1205: Detalle de Mesa

**Como** mozo
**Quiero** ver el detalle completo de una mesa
**Para** gestionar pedidos, llamados y pagos

**Criterios de aceptación:**
- Modal o pantalla con información completa de la mesa
- Lista de rondas con estado y detalle de ítems
- Filtros por estado de ronda (tabs)
- Botón "Confirmar Pedido" para rondas PENDING
- Botón "Marcar como Servido" para rondas READY
- Lista de llamados de servicio activos con botón resolver
- Información de cuenta si está en estado PAYING

**Gobernanza:** MEDIO

---

#### HU-1206: Comanda Rápida

**Como** mozo
**Quiero** tomar pedidos directamente desde mi dispositivo
**Para** atender clientes que no tienen teléfono o prefieren dictar su pedido

**Criterios de aceptación:**
- Tab "Comanda" en detalle de mesa (ComandaTab)
- Menú compacto sin imágenes (`GET /api/waiter/branches/{id}/menu`)
- Búsqueda rápida de productos
- Carrito local con controles de cantidad
- Envío via `waiterTableAPI.submitRound()`
- Crea ronda con estado PENDING

**Gobernanza:** MEDIO

---

#### HU-1207: Gestión de Llamados de Servicio

**Como** mozo
**Quiero** ver y resolver llamados de servicio de mis mesas
**Para** atender las necesidades de los clientes

**Criterios de aceptación:**
- Llamado activo muestra animación roja pulsante en la card
- Sonido de alerta al recibir nuevo llamado
- Detalle de mesa muestra lista de llamados con IDs
- Botón "Resolver" por cada llamado activo
- Endpoint `POST /waiter/service-calls/{id}/resolve`
- Evento SERVICE_CALL_CLOSED remueve el ID de activeServiceCallIds
- Evento SERVICE_CALL_CREATED emitido via Outbox pattern

**Gobernanza:** MEDIO

---

#### HU-1208: Autogestión de Mesas

**Como** mozo
**Quiero** activar mesas y tomar pedidos completos sin que el cliente use su celular
**Para** gestionar mesas de forma tradicional cuando sea necesario

**Criterios de aceptación:**
- Tab "Autogestión" en MainPage abre AutogestionModal
- Lista de mesas FREE y ACTIVE
- Para mesas FREE: ingresa cantidad de comensales → `waiterTableAPI.activateTable()` crea sesión
- Para mesas ACTIVE: usa sesión existente
- Vista dividida: panel izquierdo (menú con búsqueda/categorías), panel derecho (carrito)
- Agregar productos con controles de cantidad
- Total visible en tiempo real
- Enviar ronda: `waiterTableAPI.submitRound()`
- Solicitar cuenta: `waiterTableAPI.requestCheck()`
- Registrar pago manual: `waiterTableAPI.registerManualPayment()`
- Cerrar mesa: `waiterTableAPI.closeTable()`

**Gobernanza:** MEDIO

---

### E13 — Cocina

#### HU-1301: Vista de Tickets de Cocina

**Como** personal de cocina
**Quiero** ver los pedidos que debo preparar
**Para** organizar mi trabajo eficientemente

**Criterios de aceptación:**
- Dashboard muestra vista de cocina para usuarios con rol KITCHEN
- Solo muestra rondas SUBMITTED, IN_KITCHEN y READY (no PENDING ni CONFIRMED)
- Tickets ordenados por antigüedad (FIFO)
- Cada ticket muestra: mesa, ítems con cantidades, notas, tiempo transcurrido
- Actualización en tiempo real via WebSocket
- Endpoint: `/api/kitchen/*` con auth JWT + rol KITCHEN

**Gobernanza:** MEDIO

---

#### HU-1302: Cambio de Estado en Cocina

**Como** personal de cocina
**Quiero** cambiar el estado de los pedidos a medida que los preparo
**Para** comunicar el progreso al equipo de sala

**Criterios de aceptación:**
- SUBMITTED → IN_KITCHEN: "Iniciar Preparación"
- IN_KITCHEN → READY: "Listo para Servir"
- Eventos emitidos en cada transición
- No puede saltear estados
- Interfaz touch-friendly para uso en cocina

**Gobernanza:** MEDIO

---

#### HU-1303: Kitchen Tickets (KitchenTicket)

**Como** sistema
**Quiero** generar tickets de cocina al enviar rondas
**Para** mantener un registro ordenado de preparación

**Criterios de aceptación:**
- Se crea KitchenTicket al hacer SUBMITTED
- Vinculado a Round y Branch
- Incluye timestamp de creación y de cada cambio de estado
- Historial de estado completo para métricas
- Agrupación por tipo de preparación (si aplica)

**Gobernanza:** MEDIO

---

### E14 — Facturación y Pagos

#### HU-1401: Solicitar Cuenta

**Como** comensal
**Quiero** solicitar la cuenta de mi mesa
**Para** preparar el pago y poder irme

**Criterios de aceptación:**
- Botón "Pedir la Cuenta" en pwaMenu
- Endpoint crea o retorna Check existente (tabla `app_check`)
- Estado de mesa cambia a PAYING
- Evento CHECK_REQUESTED emitido via Outbox pattern
- Mozo recibe notificación (pulso púrpura en card de mesa)
- Los comensales pueden seguir pidiendo durante PAYING

**Gobernanza:** CRITICO

---

#### HU-1402: Generación de Cuenta con Cargos

**Como** sistema
**Quiero** calcular los cargos de la mesa automáticamente
**Para** presentar una cuenta detallada

**Criterios de aceptación:**
- Check contiene lista de Charges (uno por ítem consumido)
- Charge incluye: producto, cantidad, precio unitario (en centavos), subtotal
- Solo se cobran ítems de rondas no canceladas (SERVED, READY, IN_KITCHEN, SUBMITTED, CONFIRMED, PENDING)
- Total de la cuenta calculado como suma de charges
- Posibilidad de agregar propina

**Gobernanza:** CRITICO

---

#### HU-1403: División de Cuenta

**Como** grupo de comensales
**Queremos** dividir la cuenta entre nosotros
**Para** que cada uno pague lo que consumió

**Criterios de aceptación:**
- Opciones: partes iguales, por comensal, monto personalizado
- Allocation (FIFO) vincula pagos con cargos
- Cada comensal ve su monto a pagar
- Se permite pago parcial
- El sistema trackea cuánto falta por pagar
- Visualización clara del estado de pago de cada comensal

**Gobernanza:** CRITICO

---

#### HU-1404: Pago con Mercado Pago

**Como** comensal
**Quiero** pagar con Mercado Pago desde mi celular
**Para** realizar un pago digital sin contacto

**Criterios de aceptación:**
- Integración con API de Mercado Pago
- Generación de link/QR de pago con monto correcto
- Webhook recibe confirmación de pago
- Evento PAYMENT_APPROVED emitido
- Se registra Payment vinculado al Check
- Si el pago cubre el total, Check pasa a PAID

**Gobernanza:** CRITICO

---

#### HU-1405: Pago en Efectivo/Manual

**Como** mozo
**Quiero** registrar pagos en efectivo, tarjeta o transferencia
**Para** cerrar cuentas de clientes que no pagan por app

**Criterios de aceptación:**
- Endpoint `POST /api/waiter/payments/manual`
- Acepta: check_id, amount_cents, manual_method (cash/card/transfer)
- Registra Payment con método manual
- Evento PAYMENT_APPROVED emitido
- Si cubre el total, marca Check como PAID
- Disponible en pwaWaiter (autogestión) y Dashboard

**Gobernanza:** CRITICO

---

#### HU-1406: Confirmar Pago y Cerrar Mesa

**Como** mozo o administrador
**Quiero** confirmar el pago y liberar la mesa
**Para** prepararla para nuevos clientes

**Criterios de aceptación:**
- Verificar que el total está cubierto
- Check pasa a estado PAID → Evento CHECK_PAID
- Mozo puede limpiar mesa: `billingAPI.clearTable()` o `waiterTableAPI.closeTable()`
- Sesión se cierra, mesa vuelve a FREE
- Evento TABLE_CLEARED emitido
- Todos los datos de sesión se resetean en la card

**Gobernanza:** CRITICO

---

### E15 — WebSocket Gateway

#### HU-1501: Conexión WebSocket para Mozos

**Como** mozo
**Quiero** mantener una conexión WebSocket persistente
**Para** recibir actualizaciones en tiempo real de mis mesas

**Criterios de aceptación:**
- Endpoint: `/ws/waiter?token=JWT`
- Autenticación via JWTAuthStrategy
- Solo recibe eventos de sectores asignados (sector-based filtering)
- ADMIN/MANAGER reciben todos los eventos de la sucursal
- Auto-reconexión con backoff exponencial
- Heartbeat: ping cada 30s, timeout 60s

**Gobernanza:** ALTO

---

#### HU-1502: Conexión WebSocket para Cocina

**Como** personal de cocina
**Quiero** recibir notificaciones de nuevos pedidos
**Para** preparar los platos inmediatamente

**Criterios de aceptación:**
- Endpoint: `/ws/kitchen?token=JWT`
- Solo recibe eventos SUBMITTED+ (no PENDING ni CONFIRMED)
- Eventos: ROUND_SUBMITTED, ROUND_IN_KITCHEN, ROUND_READY, ROUND_SERVED
- Autenticación JWT con rol KITCHEN

**Gobernanza:** ALTO

---

#### HU-1503: Conexión WebSocket para Comensales

**Como** comensal
**Quiero** recibir actualizaciones de mi pedido
**Para** saber cuándo está listo

**Criterios de aceptación:**
- Endpoint: `/ws/diner?table_token=`
- Autenticación via TableTokenAuthStrategy
- Eventos de carrito: CART_ITEM_ADDED/UPDATED/REMOVED/CLEARED
- Eventos de ronda: ROUND_IN_KITCHEN, ROUND_READY, ROUND_SERVED
- Eventos de billing: CHECK_REQUESTED, CHECK_PAID, PAYMENT_*

**Gobernanza:** ALTO

---

#### HU-1504: Conexión WebSocket para Admin

**Como** administrador
**Quiero** recibir todas las notificaciones de la sucursal
**Para** supervisar la operación completa

**Criterios de aceptación:**
- Endpoint: `/ws/admin?token=JWT`
- Recibe TODOS los eventos de las sucursales del usuario
- Incluye eventos de entidades: ENTITY_CREATED/UPDATED/DELETED, CASCADE_DELETE
- Autenticación JWT con roles ADMIN o MANAGER

**Gobernanza:** ALTO

---

#### HU-1505: Broadcasting Eficiente

**Como** sistema
**Quiero** distribuir eventos a cientos de conexiones simultáneas
**Para** mantener la experiencia en tiempo real bajo carga

**Criterios de aceptación:**
- Worker pool de 10 workers para broadcast paralelo
- Sharded locks por branch para alta concurrencia (400+ usuarios)
- Rendimiento: ~160ms para broadcast a 400 usuarios
- Fallback a batch legacy (50 por batch) si falla worker pool
- BroadcastRouter dirige eventos al conjunto correcto de conexiones

**Gobernanza:** ALTO

---

#### HU-1506: Circuit Breaker

**Como** sistema
**Quiero** protección contra fallos en cascada
**Para** mantener el servicio estable bajo condiciones adversas

**Criterios de aceptación:**
- Circuit breaker en conexiones Redis
- Estados: CLOSED (normal), OPEN (fallo), HALF-OPEN (recuperación)
- Umbral configurable de fallos para abrir circuito
- Timeout configurable para intentar recovery
- Logging de transiciones de estado

**Gobernanza:** ALTO

---

#### HU-1507: Rate Limiting en WebSocket

**Como** sistema
**Quiero** limitar la tasa de mensajes por conexión
**Para** prevenir abuso y proteger los recursos

**Criterios de aceptación:**
- Límite de mensajes por segundo por conexión
- Close code 4029 cuando se excede el límite
- Mensaje de error descriptivo antes de cerrar
- Configuración flexible por tipo de endpoint

**Gobernanza:** ALTO

---

#### HU-1508: Eventos Críticos con Redis Streams

**Como** sistema
**Quiero** garantizar la entrega de eventos financieros y de servicio
**Para** evitar pérdida de información crítica

**Criterios de aceptación:**
- Consumer groups para procesamiento at-least-once
- Dead Letter Queue (DLQ) para mensajes fallidos
- Reintentos automáticos con backoff
- Eventos: CHECK_REQUESTED/PAID, PAYMENT_*, ROUND_SUBMITTED/READY, SERVICE_CALL_CREATED
- Monitoreo de lag en consumer groups

**Gobernanza:** CRITICO

---

### E16 — Promociones

#### HU-1601: CRUD de Promociones

**Como** administrador
**Quiero** crear y gestionar promociones
**Para** incentivar las ventas en momentos específicos

**Criterios de aceptación:**
- Crear promoción con nombre, descripción, tipo de descuento, valor
- Vincular a productos o categorías específicas
- Definir periodo de vigencia (fecha inicio/fin)
- Condiciones: monto mínimo, cantidad mínima
- Activar/desactivar promoción
- PromotionService maneja la lógica

**Gobernanza:** BAJO

---

#### HU-1602: Visualización de Promociones en pwaMenu

**Como** comensal
**Quiero** ver las promociones disponibles
**Para** aprovechar descuentos y ofertas

**Criterios de aceptación:**
- Sección de promociones visible en el menú
- Badge de "Promoción" en productos con descuento activo
- Precio original tachado y precio con descuento
- Condiciones de la promoción claramente visibles
- Solo muestra promociones vigentes y activas

**Gobernanza:** BAJO

---

### E17 — Recetas e Ingredientes

#### HU-1701: Gestión de Ingredientes

**Como** administrador o chef
**Quiero** gestionar el catálogo de ingredientes
**Para** documentar la composición de cada plato

**Criterios de aceptación:**
- CRUD de IngredientGroup (agrupaciones de ingredientes)
- CRUD de Ingredient dentro de cada grupo
- CRUD de SubIngredient para ingredientes compuestos
- Todos son por tenant (tenant_id)
- Vinculación con alérgenos para trazabilidad

**Gobernanza:** BAJO

---

#### HU-1702: Gestión de Recetas

**Como** chef o administrador
**Quiero** documentar las recetas de cada producto
**Para** estandarizar la preparación y calcular costos

**Criterios de aceptación:**
- Crear receta vinculada a un producto
- Lista de ingredientes con cantidades y unidades
- Instrucciones de preparación paso a paso
- Acceso: roles KITCHEN, MANAGER y ADMIN
- Endpoints bajo `/api/recipes/*`

**Gobernanza:** BAJO

---

### E18 — Fidelización de Clientes

#### HU-1801: Device Tracking (Fase 1)

**Como** sistema
**Quiero** identificar dispositivos recurrentes
**Para** reconocer clientes habituales sin registro

**Criterios de aceptación:**
- Generar fingerprint de dispositivo al primer escaneo QR
- Vincular Diner con customer_id basado en device
- Modelo Customer almacena datos del dispositivo
- No requiere registro ni consentimiento en esta fase
- Tracking transparente para el usuario

**Gobernanza:** CRITICO

---

#### HU-1802: Preferencias Implícitas (Fase 2)

**Como** sistema
**Quiero** aprender las preferencias del cliente por su historial
**Para** personalizar su experiencia en futuras visitas

**Criterios de aceptación:**
- Registrar historial de pedidos por customer_id
- Calcular productos más pedidos
- Identificar alérgenos evitados consistentemente
- Detectar preferencias de cocción y sabor
- Customer ←→ Diner relación 1:N para tracking

**Gobernanza:** CRITICO

---

#### HU-1803: Perfil de Cliente Opt-In (Fase 4)

**Como** cliente frecuente
**Quiero** crear un perfil voluntario
**Para** recibir recomendaciones personalizadas y beneficios

**Criterios de aceptación:**
- Registro opcional con email o teléfono
- Consentimiento GDPR explícito y revocable
- Visualización de historial de pedidos
- Preferencias dietarias configurables
- Vinculación con historial previo (device tracking)
- Endpoints bajo `/api/customer/*`

**Gobernanza:** CRITICO

---

### E19 — Reportes y Analíticas

#### HU-1901: Dashboard de Métricas Operativas

**Como** administrador
**Quiero** ver métricas clave de la operación
**Para** tomar decisiones informadas sobre el negocio

**Criterios de aceptación:**
- Mesas activas vs totales por sucursal
- Tiempo promedio de sesión
- Pedidos por hora/día
- Productos más vendidos
- Ingresos del día/semana/mes
- Gráficos interactivos con filtros de fecha

**Gobernanza:** MEDIO

---

#### HU-1902: Reportes de Cocina

**Como** chef o manager
**Quiero** ver tiempos de preparación por plato
**Para** optimizar la eficiencia de la cocina

**Criterios de aceptación:**
- Tiempo promedio por producto/categoría
- Tickets completados vs pendientes
- Picos de demanda por hora
- Comparación entre sucursales
- Exportación a CSV/PDF

**Gobernanza:** MEDIO

---

#### HU-1903: Reportes de Ventas

**Como** administrador
**Quiero** informes detallados de ventas
**Para** analizar el rendimiento financiero

**Criterios de aceptación:**
- Ventas por período (día, semana, mes)
- Desglose por categoría y producto
- Métodos de pago utilizados
- Propinas totales
- Ticket promedio por mesa
- Comparación entre sucursales y períodos

**Gobernanza:** MEDIO

---

### E20 — PWA y Experiencia Offline

#### HU-2001: Instalación como PWA (pwaMenu)

**Como** comensal
**Quiero** instalar la app del menú en mi celular
**Para** tener acceso rápido sin descargar desde la tienda

**Criterios de aceptación:**
- Manifest.json configurado con ícono, nombre y colores
- Service worker registrado para cache de assets
- Prompt de instalación "Agregar a pantalla de inicio"
- La app funciona en modo standalone (sin barra de navegador)
- Splash screen durante la carga

**Gobernanza:** BAJO

---

#### HU-2002: Instalación como PWA (pwaWaiter)

**Como** mozo
**Quiero** instalar la app del mozo en mi celular
**Para** usarla como aplicación nativa durante el turno

**Criterios de aceptación:**
- Manifest.json con tema naranja (#f97316)
- Instalable en dispositivos Android e iOS
- Funciona offline con datos cacheados
- Íconos optimizados para cada plataforma

**Gobernanza:** BAJO

---

#### HU-2003: Cola de Reintentos Offline (pwaWaiter)

**Como** mozo con conectividad inestable
**Quiero** que mis acciones se guarden cuando no hay internet
**Para** no perder operaciones realizadas sin conexión

**Criterios de aceptación:**
- RetryQueueStore encola operaciones fallidas
- Al recuperar conexión, reintenta automáticamente
- Indicador visual de operaciones pendientes
- Orden FIFO de reintentos
- Notificación al completar reintentos exitosos

**Gobernanza:** MEDIO

---

#### HU-2004: Notificaciones Push (pwaWaiter)

**Como** mozo
**Quiero** recibir notificaciones sonoras y visuales
**Para** enterarme inmediatamente de eventos importantes

**Criterios de aceptación:**
- Browser push notifications habilitadas
- Sonido de alerta para llamados de servicio
- Sonido para solicitud de cuenta
- Notificación visual cuando la app está en segundo plano
- Configuración de permisos de notificación al primer uso

**Gobernanza:** BAJO

---

#### HU-2005: Auto-Reconexión WebSocket

**Como** usuario de cualquier PWA
**Quiero** que la conexión WebSocket se reconecte automáticamente
**Para** no perder actualizaciones en tiempo real

**Criterios de aceptación:**
- Detección automática de desconexión
- Reconexión con backoff exponencial
- Indicador visual de estado de conexión
- Re-sincronización de datos al reconectar
- Máximo de intentos configurable

**Gobernanza:** MEDIO

---

## Backlog Priorizado

### Bloque 1 — Fundación (Sprints 1-2)

| Prioridad | Historia | Épica | Dependencia |
|-----------|----------|-------|-------------|
| 1 | HU-0101 | Infraestructura | — |
| 2 | HU-0102 | Infraestructura | HU-0101 |
| 3 | HU-0103 | Infraestructura | HU-0101, HU-0102 |
| 4 | HU-0104 | Infraestructura | — |
| 5 | HU-0201 | Autenticación | HU-0101, HU-0102 |
| 6 | HU-0202 | Autenticación | HU-0201 |
| 7 | HU-0203 | Autenticación | HU-0201 |
| 8 | HU-0204 | Autenticación | HU-0201 |
| 9 | HU-0206 | Seguridad | HU-0201 |
| 10 | HU-0207 | RBAC | HU-0201 |
| 11 | HU-0208 | Rate Limiting | HU-0201 |
| 12 | HU-0301 | Multi-Tenancy | HU-0101 |

### Bloque 2 — Estructura del Negocio (Sprints 3-4)

| Prioridad | Historia | Épica | Dependencia |
|-----------|----------|-------|-------------|
| 13 | HU-0302 | Sucursales | HU-0301 |
| 14 | HU-0401 | Staff | HU-0207, HU-0302 |
| 15 | HU-0701 | Sectores | HU-0302 |
| 16 | HU-0702 | Mesas | HU-0701 |
| 17 | HU-0402 | Asignaciones | HU-0401, HU-0701 |
| 18 | HU-0501 | Categorías | HU-0302 |
| 19 | HU-0502 | Subcategorías | HU-0501 |
| 20 | HU-0503 | Productos | HU-0502 |
| 21 | HU-0504 | Precios | HU-0503, HU-0302 |
| 22 | HU-0601 | Alérgenos | HU-0301 |
| 23 | HU-0602 | Prod-Alérgenos | HU-0503, HU-0601 |

### Bloque 3 — WebSocket y Tiempo Real (Sprint 5)

| Prioridad | Historia | Épica | Dependencia |
|-----------|----------|-------|-------------|
| 24 | HU-1501 | WS Mozo | HU-0102, HU-0201 |
| 25 | HU-1502 | WS Cocina | HU-0102, HU-0201 |
| 26 | HU-1503 | WS Comensal | HU-0102, HU-0205 |
| 27 | HU-1504 | WS Admin | HU-0102, HU-0201 |
| 28 | HU-1505 | Broadcasting | HU-1501 |
| 29 | HU-1506 | Circuit Breaker | HU-1501 |
| 30 | HU-1507 | WS Rate Limit | HU-1501 |
| 31 | HU-1508 | Redis Streams | HU-0102 |

### Bloque 4 — Dashboard Admin (Sprints 6-7)

| Prioridad | Historia | Épica | Dependencia |
|-----------|----------|-------|-------------|
| 32 | HU-0303 | Selector Sucursal | HU-0302, HU-0201 |
| 33 | HU-0404 | Gestión Staff UI | HU-0401 |
| 34 | HU-0703 | Vista Mesas | HU-0702, HU-1504 |
| 35 | HU-0505 | Menú Público | HU-0503 |
| 36 | HU-1301 | Vista Cocina | HU-1502 |
| 37 | HU-1302 | Estado Cocina | HU-1301 |
| 38 | HU-1303 | Kitchen Tickets | HU-1102 |

### Bloque 5 — Flujo del Comensal (Sprints 8-9)

| Prioridad | Historia | Épica | Dependencia |
|-----------|----------|-------|-------------|
| 39 | HU-0801 | Sesión QR | HU-0702, HU-0205 |
| 40 | HU-0802 | Registro Comensal | HU-0801 |
| 41 | HU-0803 | Pantalla Unirse | HU-0802 |
| 42 | HU-0901 | Menú Categorías | HU-0505 |
| 43 | HU-0902 | Detalle Producto | HU-0901 |
| 44 | HU-0903 | Búsqueda | HU-0901 |
| 45 | HU-0904 | i18n | HU-0901 |
| 46 | HU-0603 | Filtros Dietarios | HU-0602, HU-0901 |
| 47 | HU-1001 | Agregar Carrito | HU-0902, HU-1503 |
| 48 | HU-1002 | Sync Carrito | HU-1001 |
| 49 | HU-1003 | Modificar Carrito | HU-1001 |
| 50 | HU-1004 | Confirmación Grupal | HU-1002 |
| 51 | HU-1005 | Envío Ronda | HU-1004 |

### Bloque 6 — Ciclo de Pedidos (Sprint 10)

| Prioridad | Historia | Épica | Dependencia |
|-----------|----------|-------|-------------|
| 52 | HU-1101 | Confirmar Pedido | HU-1005, HU-1501 |
| 53 | HU-1102 | Enviar a Cocina | HU-1101, HU-1504 |
| 54 | HU-1103 | Iniciar Preparación | HU-1102, HU-1502 |
| 55 | HU-1104 | Listo para Servir | HU-1103 |
| 56 | HU-1105 | Marcar Servido | HU-1104 |
| 57 | HU-1106 | Cancelar Ronda | HU-1101 |
| 58 | HU-1107 | Eliminar Ítem | HU-1101 |
| 59 | HU-1108 | Filtros Rondas | HU-1101 |

### Bloque 7 — Operaciones del Mozo (Sprint 11)

| Prioridad | Historia | Épica | Dependencia |
|-----------|----------|-------|-------------|
| 60 | HU-1201 | Pre-Login Branch | HU-0302 |
| 61 | HU-1202 | Login Mozo | HU-0201, HU-0403 |
| 62 | HU-0403 | Verificar Asignación | HU-0402 |
| 63 | HU-1203 | Grilla Mesas | HU-0702, HU-1501 |
| 64 | HU-1204 | Cards Animación | HU-1203 |
| 65 | HU-1205 | Detalle Mesa | HU-1204 |
| 66 | HU-1206 | Comanda Rápida | HU-1205, HU-0505 |
| 67 | HU-1207 | Llamados Servicio | HU-1205, HU-1501 |
| 68 | HU-1208 | Autogestión | HU-1206 |

### Bloque 8 — Facturación (Sprint 12)

| Prioridad | Historia | Épica | Dependencia |
|-----------|----------|-------|-------------|
| 69 | HU-1401 | Solicitar Cuenta | HU-1105, HU-1508 |
| 70 | HU-1402 | Cargos | HU-1401 |
| 71 | HU-1403 | División Cuenta | HU-1402 |
| 72 | HU-1404 | Mercado Pago | HU-1402 |
| 73 | HU-1405 | Pago Manual | HU-1402 |
| 74 | HU-1406 | Cerrar Mesa | HU-1404, HU-1405 |

### Bloque 9 — Funcionalidades Complementarias (Sprints 13-14)

| Prioridad | Historia | Épica | Dependencia |
|-----------|----------|-------|-------------|
| 75 | HU-1601 | CRUD Promociones | HU-0503 |
| 76 | HU-1602 | Promo en pwaMenu | HU-1601, HU-0901 |
| 77 | HU-1701 | Ingredientes | HU-0301 |
| 78 | HU-1702 | Recetas | HU-1701, HU-0503 |
| 79 | HU-2001 | PWA pwaMenu | HU-0901 |
| 80 | HU-2002 | PWA pwaWaiter | HU-1203 |
| 81 | HU-2003 | Cola Offline | HU-1203 |
| 82 | HU-2004 | Push Notif. | HU-1501 |
| 83 | HU-2005 | Auto-Reconexión | HU-1501 |

### Bloque 10 — Fidelización y Analíticas (Sprints 15-16)

| Prioridad | Historia | Épica | Dependencia |
|-----------|----------|-------|-------------|
| 84 | HU-1801 | Device Tracking | HU-0801 |
| 85 | HU-1802 | Pref. Implícitas | HU-1801 |
| 86 | HU-1803 | Perfil Opt-In | HU-1802 |
| 87 | HU-1901 | Dashboard Métricas | HU-1406 |
| 88 | HU-1902 | Reportes Cocina | HU-1303 |
| 89 | HU-1903 | Reportes Ventas | HU-1406 |

---

## Plan de Implementación por Sprints

### Sprint 1: Infraestructura Base
- HU-0101: Base de datos PostgreSQL
- HU-0102: Redis
- HU-0103: Docker Compose
- HU-0104: Configuración de entornos

### Sprint 2: Autenticación y Seguridad
- HU-0201: Login JWT
- HU-0202: Refresh token
- HU-0203: Logout
- HU-0204: Perfil de usuario
- HU-0205: Table tokens
- HU-0206: Middlewares de seguridad
- HU-0207: RBAC
- HU-0208: Rate limiting

### Sprint 3: Estructura del Negocio I
- HU-0301: Multi-tenancy
- HU-0302: CRUD sucursales
- HU-0401: CRUD usuarios
- HU-0701: CRUD sectores
- HU-0702: CRUD mesas

### Sprint 4: Estructura del Negocio II
- HU-0402: Asignaciones de mozos
- HU-0501: Categorías
- HU-0502: Subcategorías
- HU-0503: Productos
- HU-0504: Precios por sucursal
- HU-0601: Alérgenos
- HU-0602: Producto-Alérgeno

### Sprint 5: WebSocket Gateway
- HU-1501: WS Mozos
- HU-1502: WS Cocina
- HU-1503: WS Comensales
- HU-1504: WS Admin
- HU-1505: Broadcasting eficiente
- HU-1506: Circuit breaker
- HU-1507: Rate limiting WS
- HU-1508: Redis Streams

### Sprint 6: Dashboard I
- HU-0303: Selector de sucursal
- HU-0404: Gestión de staff UI
- HU-0505: Menú público
- HU-0703: Vista de mesas en tiempo real

### Sprint 7: Dashboard II — Cocina
- HU-1301: Vista de tickets de cocina
- HU-1302: Cambio de estado en cocina
- HU-1303: Kitchen tickets

### Sprint 8: Flujo del Comensal I
- HU-0801: Sesión por QR
- HU-0802: Registro de comensal
- HU-0803: Pantalla de unirse
- HU-0901: Menú por categorías
- HU-0902: Detalle de producto
- HU-0903: Búsqueda
- HU-0904: i18n

### Sprint 9: Flujo del Comensal II — Carrito
- HU-0603: Filtros dietarios
- HU-1001: Agregar al carrito
- HU-1002: Sync multi-dispositivo
- HU-1003: Modificar carrito
- HU-1004: Confirmación grupal
- HU-1005: Envío de ronda

### Sprint 10: Ciclo de Pedidos Completo
- HU-1101: Confirmar pedido (mozo)
- HU-1102: Enviar a cocina (admin)
- HU-1103: Iniciar preparación (cocina)
- HU-1104: Listo para servir (cocina)
- HU-1105: Marcar servido (staff)
- HU-1106: Cancelar ronda
- HU-1107: Eliminar ítem de ronda
- HU-1108: Filtros de rondas

### Sprint 11: Operaciones del Mozo
- HU-1201: Pre-login branch select
- HU-1202: Login del mozo
- HU-0403: Verificación de asignación
- HU-1203: Grilla de mesas por sector
- HU-1204: Cards con animaciones
- HU-1205: Detalle de mesa
- HU-1206: Comanda rápida
- HU-1207: Llamados de servicio
- HU-1208: Autogestión

### Sprint 12: Facturación y Pagos
- HU-1401: Solicitar cuenta
- HU-1402: Generación de cargos
- HU-1403: División de cuenta
- HU-1404: Mercado Pago
- HU-1405: Pago manual
- HU-1406: Cerrar mesa

### Sprint 13: Funcionalidades Complementarias I
- HU-1601: CRUD promociones
- HU-1602: Promociones en pwaMenu
- HU-1701: Ingredientes
- HU-1702: Recetas

### Sprint 14: Funcionalidades Complementarias II — PWA
- HU-2001: PWA pwaMenu
- HU-2002: PWA pwaWaiter
- HU-2003: Cola de reintentos offline
- HU-2004: Notificaciones push
- HU-2005: Auto-reconexión WS

### Sprint 15: Fidelización de Clientes
- HU-1801: Device tracking
- HU-1802: Preferencias implícitas
- HU-1803: Perfil opt-in

### Sprint 16: Reportes y Analíticas
- HU-1901: Dashboard de métricas operativas
- HU-1902: Reportes de cocina
- HU-1903: Reportes de ventas

---

## Diagrama de Dependencias

```
                    HU-0101 (PostgreSQL)
                    /        \
              HU-0102 (Redis)  HU-0104 (.env)
              /    |    \
        HU-0103   HU-0201 (Login JWT)    HU-0301 (Multi-Tenant)
       (Docker)    /    |    \    \           |
              HU-0202  HU-0203  HU-0204   HU-0302 (Sucursales)
              (Refresh) (Logout) (Me)      /     |      \
                    |                HU-0401   HU-0701   HU-0501
              HU-0205 (Table Token) (Users)  (Sectores) (Categorías)
                    |                  |        |           |
              HU-0206 (Security)   HU-0402   HU-0702    HU-0502
              HU-0207 (RBAC)     (Asignac.)  (Mesas)   (Subcat.)
              HU-0208 (Rate Limit)    |        |           |
                                  HU-0403   HU-0801    HU-0503 (Productos)
                                  (Verif.)  (Sesión QR)   |     \
                                      |        |       HU-0504  HU-0601
                                  HU-1201   HU-0802  (Precios) (Alérgenos)
                                  (PreLogin) (Comensal)   |        |
                                      |        |       HU-0505  HU-0602
                                  HU-1202   HU-0803  (Menú Pub) (Prod-Alérg)
                                  (Login)   (Unirse)     |
                                      |        |     HU-0901──HU-0903
                                  HU-1203   HU-0901  (Menú)   (Búsqueda)
                                  (Grilla)  (Categorías) |
                                      |        |     HU-0904 (i18n)
                                  HU-1204   HU-0902     |
                                  (Cards)   (Detalle) HU-0603 (Filtros)
                                      |        |
                                  HU-1205   HU-1001──HU-1002──HU-1004──HU-1005
                                  (Detalle) (Carrito) (Sync)  (Conf.Grupal)(Envío)
                                    / | \                              |
                              HU-1206 HU-1207 HU-1208          HU-1101 (Confirmar)
                              (Comanda)(Servicio)(Autogest.)       |
                                                              HU-1102 (→Cocina)
                                                                  |
                                                              HU-1103 (In Kitchen)
                                                                  |
                                                              HU-1104 (Ready)
                                                                  |
                                                              HU-1105 (Served)
                                                                  |
                                                              HU-1401 (Cuenta)
                                                                  |
                                                              HU-1402 (Cargos)
                                                              /   |   \
                                                        HU-1403 HU-1404 HU-1405
                                                        (División)(MP)  (Manual)
                                                              \   |   /
                                                              HU-1406 (Cerrar)
                                                                  |
                                                         HU-1901/1902/1903
                                                           (Reportes)
```

```
WebSocket (paralelo):
    HU-0102 → HU-1501 (WS Mozo)
            → HU-1502 (WS Cocina)
            → HU-1503 (WS Comensal)
            → HU-1504 (WS Admin)
                → HU-1505 (Broadcasting)
                → HU-1506 (Circuit Breaker)
                → HU-1507 (Rate Limit WS)
            → HU-1508 (Redis Streams)

PWA (paralelo tras funcionalidades core):
    HU-2001 (PWA Menu) ← HU-0901
    HU-2002 (PWA Waiter) ← HU-1203
    HU-2003 (Offline Queue) ← HU-1203
    HU-2004 (Push Notif.) ← HU-1501
    HU-2005 (Auto-Reconexión) ← HU-1501

Fidelización (secuencial):
    HU-0801 → HU-1801 (Device) → HU-1802 (Implícitas) → HU-1803 (Opt-In)

Complementarias (independientes):
    HU-0503 → HU-1601 (Promociones) → HU-1602 (Promo UI)
    HU-0301 → HU-1701 (Ingredientes) → HU-1702 (Recetas)
```

---

## Resumen Estadístico

| Métrica | Valor |
|---------|-------|
| Total de Épicas | 20 |
| Total de Historias de Usuario | 89 |
| Sprints estimados | 16 |
| Bloques de implementación | 10 |
| Historias CRITICO | 22 |
| Historias ALTO | 14 |
| Historias MEDIO | 38 |
| Historias BAJO | 15 |

---

*Documento generado como guía de implementación integral. El orden de los sprints refleja las dependencias técnicas y el valor de negocio, priorizando la infraestructura fundacional, luego los flujos core del restaurante, y finalmente las funcionalidades complementarias de fidelización y analíticas.*
