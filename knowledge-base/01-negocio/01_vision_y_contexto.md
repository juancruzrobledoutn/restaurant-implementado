# Vision, Contexto y Propuesta de Valor

## Identidad

- **Nombre**: Integrador / Buen Sabor
- **Tipo**: Plataforma SaaS multi-tenant de gestion de restaurantes (monorepo)
- **Proposito**: Gestion integral de operaciones de restaurante de punta a punta: administracion, pedidos de clientes via QR, gestion de mesas en tiempo real para mozos, visualizacion de cocina

---

## Contexto del Problema

La industria gastronomica, especialmente en cadenas de restaurantes, opera con herramientas fragmentadas y procesos manuales que generan friccion en cada punto de la experiencia: desde que el cliente se sienta hasta que paga. Integrador / Buen Sabor nace para unificar toda esta cadena en una sola plataforma.

### Los 10 problemas que resuelve

#### 1. Operaciones fragmentadas

**Situacion actual**: Los restaurantes usan un sistema para el menu, otro para los pedidos, otro para la facturacion, planillas para el personal, y WhatsApp para coordinar con cocina. Cada sistema tiene su propia base de datos, su propia interfaz, y su propia logica.

**Solucion**: Una plataforma unica que integra menu, pedidos, cocina, facturacion, personal y gestion de mesas. Todo comparte la misma base de datos, los mismos eventos en tiempo real, y la misma autenticacion.

#### 2. Pedidos en papel

**Situacion actual**: El cliente espera al mozo, el mozo anota en papel (o memoriza), camina hasta la cocina, y entrega la comanda. Errores de transcripcion, demoras, y clientes frustrados esperando.

**Solucion**: El cliente escanea un codigo QR en la mesa, navega el menu desde su telefono, agrega items al carrito, y envia el pedido directamente. No necesita descargar una app (es una PWA). No necesita crear una cuenta (autenticacion por token de mesa).

#### 3. Demoras en la comunicacion con cocina

**Situacion actual**: La cadena es: comensal dicta -> mozo anota -> mozo camina -> cocina lee papel. Cada eslabon introduce latencia y posibilidad de error.

**Solucion**: Flujo digital con confirmacion en cada etapa:

```
Comensal propone (PENDING)
  -> Mozo confirma (CONFIRMED)
    -> Manager/Admin envia (SUBMITTED)
      -> Cocina recibe al instante via WebSocket (IN_KITCHEN)
        -> Cocina marca listo (READY)
          -> Staff marca servido (SERVED)
```

La cocina solo ve pedidos en estado SUBMITTED o posterior. No ve pedidos pendientes ni sin confirmar, lo que elimina el ruido.

#### 4. Complejidad multi-branch

**Situacion actual**: Las cadenas de restaurantes necesitan manejar precios distintos por sucursal, personal asignado a branches especificos, sectores diferentes por local, y menus que varian por ubicacion. Esto se suele resolver con planillas Excel o copias separadas del sistema.

**Solucion**: Arquitectura multi-tenant nativa:

- **Tenant** = Restaurante (ej: "Buen Sabor")
- **Branch** = Sucursal (ej: "Buen Sabor Mendoza Centro", "Buen Sabor Godoy Cruz")
- **BranchProduct** = Precio especifico por sucursal (en centavos)
- **UserBranchRole** = Relacion M:N entre usuario y branch con rol especifico
- **WaiterSectorAssignment** = Asignacion diaria de mozo a sector

Cada query filtra por `tenant_id` automaticamente. Un admin puede gestionar todas las sucursales; un mozo solo ve su sector asignado del dia.

#### 5. Friccion en el pago

**Situacion actual**: Pedir la cuenta es un proceso tedioso. El mozo trae la cuenta, el grupo debate como dividir, alguien tiene que sumar, pedir cambio, esperar. En grupos grandes es un caos.

**Solucion**: Tres modos de division de cuenta:

1. **Partes iguales**: El total se divide entre todos los comensales
2. **Por consumo**: Cada comensal paga exactamente lo que pidio
3. **Personalizada**: Asignacion manual de items a personas

Integracion con Mercado Pago para pagos digitales. El mozo tambien puede registrar pagos en efectivo, tarjeta o transferencia desde pwaWaiter.

El sistema usa el patron FIFO para asignar pagos a cargos: `Check -> Charge -> Allocation <- Payment`.

#### 6. Falta de visibilidad en tiempo real

**Situacion actual**: El mozo no sabe que la mesa 7 necesita atencion hasta que el cliente lo llama a gritos. No sabe que el plato de la mesa 3 esta listo hasta que va a cocina a preguntar.

**Solucion**: Grilla de mesas en pwaWaiter con animaciones en tiempo real via WebSocket:

| Color | Significado |
|-------|-------------|
| Rojo (pulsante) | Llamado de servicio - atencion inmediata |
| Amarillo | Pedido nuevo esperando confirmacion |
| Naranja | Pedido listo para servir |
| Morado | Cuenta solicitada |
| Verde | Mesa disponible |

Los eventos se enrutan por sector: el mozo solo recibe notificaciones de las mesas de su sector asignado. Los ADMIN y MANAGER reciben todo.

#### 7. Barreras idiomaticas

**Situacion actual**: Zonas turisticas (Mendoza, Buenos Aires, Patagonia) reciben visitantes que no hablan espanol. Menus en un solo idioma limitan la experiencia.

**Solucion**: pwaMenu soporta tres idiomas completos:

- **Espanol** (es) - idioma base
- **Ingles** (en) - para turistas de habla inglesa
- **Portugues** (pt) - para turistas brasilenos

Toda la interfaz usa `t()` via i18n. Cero strings hardcodeados. El idioma se detecta automaticamente o se selecciona manualmente.

#### 8. Coordinacion de personal

**Situacion actual**: "Quien atiende la mesa 12?" es una pregunta comun. Los mozos se pisan, las mesas quedan desatendidas, y no hay claridad sobre responsabilidades.

**Solucion**: Sistema de sectores con asignacion diaria:

1. El branch se divide en **BranchSectors** (ej: "Terraza", "Salon principal", "VIP")
2. Cada sector contiene N mesas
3. Cada dia se crea un **WaiterSectorAssignment** que asigna mozos a sectores
4. Los eventos de WebSocket se enrutan por `sector_id`: el mozo solo recibe eventos de sus mesas
5. El mozo debe verificar su asignacion al iniciar sesion (si no esta asignado hoy, ve "Acceso Denegado")

#### 9. Cumplimiento de alergenos

**Situacion actual**: La informacion de alergenos esta en un cuadernillo que nadie lee, o el mozo "cree que no tiene gluten". Error potencialmente fatal.

**Solucion**: Sistema completo de alergenos alineado con la regulacion EU 1169/2011:

- **14 alergenos obligatorios** registrados por producto
- **Tipo de presencia**: `CONTAINS` (contiene), `MAY_CONTAIN` (puede contener), `FREE_FROM` (libre de)
- **Nivel de riesgo**: Configurable por alergeno
- **Reacciones cruzadas**: Alertas automaticas cuando un ingrediente puede tener contaminacion cruzada
- **Filtros en pwaMenu**: El cliente puede filtrar el menu por sus alergias y ver claramente que puede comer

#### 10. Fidelizacion de clientes

**Situacion actual**: Los restaurantes no tienen idea de quien vuelve, que pide, ni como premiar la fidelidad. Los programas de puntos son costosos y requieren apps dedicadas.

**Solucion**: Enfoque progresivo en 4 fases:

| Fase | Descripcion | Estado |
|------|-------------|--------|
| 1 | Tracking por dispositivo (cookie/fingerprint) | Implementado |
| 2 | Preferencias implicitas sincronizadas (que pide, frecuencia) | En progreso |
| 3 | Reconocimiento ("Bienvenido de nuevo, tu usual es X") | Planificado |
| 4 | Opt-in del cliente con consentimiento GDPR | Planificado |

El modelo de datos ya soporta `Customer <-> Diner (1:N)` via `customer_id` con tracking por dispositivo.

### Mercado objetivo

- **Pais**: Argentina
- **Moneda**: Pesos argentinos (ARS), almacenados en centavos (ej: $125.50 = 12550)
- **Procesador de pago**: Mercado Pago
- **Idioma principal**: Espanol rioplatense
- **Perfil de restaurante**: Cadenas con multiples sucursales que necesitan gestion centralizada
- **Contexto tecnologico**: Redes moviles inestables (de ahi el diseno offline-first de pwaWaiter)

---

## Propuesta de Valor por Actor

### Para Duenos y Administradores

**Un solo dashboard para todo.**

El Dashboard centraliza la gestion de todas las sucursales en una interfaz con 24+ paginas lazy-loaded:

- **Gestion de menu**: Categorias, subcategorias, productos con imagenes, descripciones, y precios diferenciados por sucursal
- **Personal**: Alta de usuarios con roles (ADMIN, MANAGER, KITCHEN, WAITER), asignacion a branches, rotacion de sectores
- **Mesas y sectores**: Configuracion de la planta del local, codigos QR por mesa, sectores logicos para distribucion de mozos
- **Alergenos**: Carga por producto con tipo de presencia (contiene/puede contener/libre de) y nivel de riesgo
- **Promociones**: Creacion y gestion de ofertas por branch
- **Ingredientes y recetas**: Gestion jerarquica (grupo -> ingrediente -> sub-ingrediente) con metodos de coccion, perfiles de sabor y textura
- **Visibilidad en tiempo real**: Eventos WebSocket notifican creacion, actualizacion y eliminacion de entidades al instante. Sin necesidad de refrescar la pagina

**Propuesta**: Reemplazar 5+ herramientas fragmentadas por una sola plataforma. Un admin con acceso a internet gestiona todo, desde cualquier dispositivo.

### Para Clientes / Comensales

**Escanea, pedi, paga. Sin app, sin cuenta, sin esperar.**

El flujo completo del cliente en pwaMenu:

1. **Escanear QR** en la mesa -> se abre la PWA en el navegador (no requiere descarga)
2. **Unirse a la sesion** de mesa -> recibe un token HMAC de 3 horas (sin login ni registro)
3. **Navegar el menu** en su idioma (es/en/pt) -> filtrar por alergenos, dieta, o categoria
4. **Agregar al carrito compartido** -> todos en la mesa ven los items en tiempo real, con nombre y color de quien agrego cada item
5. **Confirmacion grupal** -> un comensal propone la ronda, el grupo confirma antes de enviar (previene pedidos accidentales)
6. **Seguimiento en tiempo real** -> ve cuando el pedido esta en cocina, cuando esta listo, cuando se sirve
7. **Solicitar la cuenta** -> el estado de la mesa pasa a PAYING
8. **Dividir la cuenta** -> partes iguales, por consumo, o personalizada
9. **Pagar con Mercado Pago** -> pago digital sin efectivo

**Propuesta**: Experiencia de pedido autonoma, social (carrito compartido), sin fricciones y sin barreras idiomaticas. El cliente tiene control total sin depender del mozo.

### Para Mozos

**Sabe exactamente que pasa en cada mesa, en todo momento.**

El flujo del mozo en pwaWaiter:

1. **Seleccion de branch** antes de loguearse (endpoint publico, sin auth)
2. **Login + verificacion de asignacion** -> debe estar asignado al branch HOY, sino ve "Acceso Denegado"
3. **Grilla de mesas por sector** -> solo ve las mesas de los sectores asignados
4. **Animaciones en tiempo real**:
   - Rojo pulsante = llamado de servicio (atencion inmediata)
   - Amarillo = pedido nuevo esperando confirmacion
   - Naranja = pedido listo para servir
   - Morado = cuenta solicitada
5. **Confirmar pedidos** -> cambia PENDING a CONFIRMED
6. **Comanda rapida** -> toma pedidos para clientes sin telefono via menu compacto (sin imagenes, carga rapida)
7. **Gestionar pagos** -> registra pagos en efectivo, tarjeta o transferencia
8. **Cerrar mesa** -> libera la mesa despues del pago

**Propuesta**: Eliminar las caminatas innecesarias. El mozo sabe que hacer y donde ir sin tener que recorrer todo el salon. La cola de reintentos offline garantiza que ninguna operacion se pierda por una red inestable.

### Para Cocina

**Solo lo que necesitas, cuando lo necesitas.**

La cocina solo ve pedidos en estado SUBMITTED o posterior. No ve rondas pendientes (PENDING) ni confirmadas (CONFIRMED) — eso es ruido que no le compete.

- **Kitchen tickets**: Cada ronda genera tickets de cocina con detalle de items, cantidades y observaciones
- **Flujo de estados**: `IN_KITCHEN` -> `READY` -> `SERVED`
- **Notificaciones WebSocket**: Nuevos pedidos llegan en tiempo real sin polling
- **Sin distracciones**: Eventos de carrito, llamados de servicio y gestion de mesas no llegan al canal de cocina

**Propuesta**: Interfaz limpia y enfocada. La cocina se concentra en cocinar, no en descifrar comandas ilegibles ni en filtrar pedidos que todavia no estan confirmados.

---

## Diferenciadores Tecnicos

### 1. Carrito compartido con confirmacion grupal

No es simplemente "cada uno pide lo suyo". Los items de todos los comensales se combinan en una sola ronda. Antes de enviar, el grupo debe confirmar. Esto previene:
- Pedidos duplicados accidentales
- Un comensal enviando sin que los demas esten listos
- Confusion sobre quien pidio que

La sincronizacion es via WebSocket en tiempo real: eventos `CART_ITEM_ADDED`, `CART_ITEM_UPDATED`, `CART_ITEM_REMOVED`, `CART_CLEARED`.

### 2. Enrutamiento de eventos por sector

Los eventos WebSocket no se transmiten a todos los mozos del branch. Se filtran por `sector_id`:

- Un mozo asignado al sector "Terraza" solo recibe eventos de mesas en la terraza
- ADMIN y MANAGER siempre reciben todos los eventos del branch
- Esto reduce el ruido y mejora el rendimiento con muchos mozos conectados

### 3. Transactional Outbox para eventos criticos

| Patron | Eventos | Garantia |
|--------|---------|----------|
| **Outbox** (no se puede perder) | CHECK_REQUESTED/PAID, PAYMENT_*, ROUND_SUBMITTED/READY, SERVICE_CALL_CREATED | El evento se escribe atomicamente con los datos de negocio en la BD, luego se publica |
| **Redis directo** (baja latencia) | ROUND_CONFIRMED/IN_KITCHEN/SERVED, CART_*, TABLE_*, ENTITY_* | Publicacion directa, menor latencia |

Si Redis falla momentaneamente, los eventos Outbox se reprocesaran. Los eventos directos pueden perderse pero son menos criticos.

### 4. Multi-tenant desde el diseno

No es un sistema single-tenant al que se le "agrego" multi-tenancy. Desde el modelo de datos hasta los repositorios, todo filtra por `tenant_id`. Los `TenantRepository` y `BranchRepository` aplican este filtro automaticamente. Un tenant nunca puede ver datos de otro tenant.

### 5. Progressive Web Apps (sin app stores)

Los tres frontends son PWAs:
- No requieren descarga desde Play Store o App Store
- Se instalan desde el navegador con un tap
- Funcionan offline (especialmente pwaWaiter con su cola de reintentos)
- Se actualizan automaticamente sin que el usuario haga nada

### 6. Diseno offline-first

pwaWaiter esta disenado para redes moviles inestables (contexto argentino):
- Cola de reintentos para operaciones fallidas
- Cache local de datos criticos
- Reconciliacion automatica cuando se recupera la conexion

---

## Matriz de Valor vs. Soluciones Tradicionales

| Aspecto | Sistema Tradicional | Integrador / Buen Sabor |
|---------|-------------------|------------------------|
| Pedidos | Papel o verbal | Digital desde el celular del cliente |
| Menu | Impreso, un idioma | Digital, 3 idiomas, filtros de alergenos |
| Comunicacion con cocina | Caminar con la comanda | WebSocket en tiempo real |
| Visibilidad de mesas | Caminar y mirar | Grilla animada con estados por color |
| Pago | Esperar cuenta, calcular division | Division automatica + Mercado Pago |
| Gestion multi-branch | Sistemas separados por local | Dashboard centralizado multi-tenant |
| Fidelizacion | Tarjeta de sellos | Tracking automatico progresivo |
| Instalacion de app | App store | PWA, sin descarga |
| Red inestable | Operacion interrumpida | Offline-first con reintentos |

---

## Los 5 Componentes del Sistema

### 1. Backend (FastAPI) - Puerto 8000

API REST construida con Clean Architecture y Domain Services. Capa de datos con SQLAlchemy 2.0 sobre PostgreSQL 16, cache y mensajeria con Redis 7.

- **Autenticacion dual**: JWT para staff (access 15 min, refresh 7 dias), tokens HMAC de mesa para comensales (3 horas de expiracion)
- **Patron de repositorios**: `TenantRepository` y `BranchRepository` con soft delete automatico y filtrado por tenant
- **Servicios de dominio**: `CategoryService`, `ProductService`, `RoundService`, `BillingService`, entre otros. Cada router delega la logica de negocio al servicio correspondiente
- **Seguridad**: CORS configurable, headers de seguridad (CSP, HSTS), validacion de Content-Type, rate limiting en endpoints de facturacion, proteccion SSRF en URLs de imagenes
- **Transactional Outbox**: Eventos criticos (pagos, facturas, rondas enviadas) se escriben atomicamente en la base de datos y se publican via procesador en segundo plano

### 2. WebSocket Gateway (FastAPI) - Puerto 8001

Sistema de eventos en tiempo real, separado del backend REST por diseno.

- **Patron de composicion**: `connection_manager.py` y `redis_subscriber.py` son orquestadores delgados que componen modulos de `core/` y `components/`
- **Canales**: `/ws/waiter`, `/ws/kitchen`, `/ws/diner`, `/ws/admin` - cada uno con su estrategia de autenticacion
- **Broadcast con Worker Pool**: 10 workers paralelos, ~160ms para 400 usuarios. Fallback a batch legacy (50 por lote)
- **Locks fragmentados por branch**: Concurrencia para 400+ usuarios simultaneos por branch
- **Circuit Breaker y Rate Limiting**: Proteccion contra fallas en cascada de Redis y abuso de conexiones
- **Redis Streams**: Consumer para eventos criticos con entrega at-least-once y DLQ (Dead Letter Queue) para mensajes fallidos
- **Heartbeat**: Ping cada 30s, timeout del servidor a los 60s. Codigos de cierre: 4001 (auth fallida), 4003 (prohibido), 4029 (rate limited)

### 3. Dashboard (React 19) - Puerto 5177

Panel de administracion para gestion multi-branch.

- **24+ paginas lazy-loaded**: Carga diferida para mantener el bundle inicial liviano
- **16+ stores Zustand**: Cada entidad tiene su propio store con selectores estables y `useShallow` para listas filtradas
- **React Compiler**: `babel-plugin-react-compiler` para auto-memorizacion; no se necesita `useMemo`/`useCallback` manual
- **CRUD completo**: Categorias, subcategorias, productos, precios por branch, personal, sectores, mesas, alergenos, promociones, ingredientes, recetas
- **WebSocket en tiempo real**: Recibe eventos `ENTITY_CREATED`, `ENTITY_UPDATED`, `ENTITY_DELETED`, `CASCADE_DELETE` para mantener la UI sincronizada
- **Capacidad PWA**: Instalable como aplicacion de escritorio

### 4. pwaMenu (React 19) - Puerto 5176

PWA orientada al cliente. El flujo completo: escanear QR, unirse a la mesa, navegar el menu, carrito compartido, confirmacion grupal, pedido, division de cuenta, pago con Mercado Pago.

- **52 componentes, 24 hooks**: Arquitectura modular con separacion clara entre presentacion y logica
- **Trilingue (es/en/pt)**: Todo texto visible al usuario usa `t()` via i18n. Cero strings hardcodeados
- **Carrito compartido**: Sincronizacion multi-dispositivo via WebSocket. Los items muestran quien los agrego (nombre/color del comensal)
- **Rondas con confirmacion grupal**: Un comensal propone, el grupo confirma, se envia la orden
- **Division de cuenta**: Partes iguales, por consumo, o personalizada
- **Filtros de alergenos**: Cumplimiento EU 1169/2011 con tipos de presencia y niveles de riesgo
- **Cache con TTL de 8 horas**: localStorage con expiracion para menu y sesion. Se limpia automaticamente al detectar datos obsoletos

### 5. pwaWaiter (React 19) - Puerto 5178

PWA para mozos con gestion de mesas en tiempo real.

- **Flujo pre-login**: Seleccion de branch antes de autenticarse -> verificacion de asignacion diaria -> grilla de mesas agrupadas por sector
- **Animaciones en tiempo real**: Rojo = llamado de servicio, amarillo = pedido nuevo, naranja = pedido listo, morado = cuenta solicitada
- **Comanda rapida**: Toma de pedidos para clientes sin telefono via endpoint compacto de menu (sin imagenes)
- **Offline-first**: Cola de reintentos para operaciones cuando la conexion es inestable
- **Gestion de pagos**: Registro de pagos en efectivo, tarjeta o transferencia

---

## Stack Tecnologico

### Frontend

| Tecnologia | Version | Uso |
|------------|---------|-----|
| React | 19.2 | Framework UI (los 3 frontends) |
| Vite | 7.2 | Bundler y dev server |
| TypeScript | 5.9 | Tipado estatico |
| Zustand | 5 | Estado global (selectores, nunca destructuring) |
| Tailwind CSS | 4 | Estilos utilitarios |
| Vitest | 4.0 (pwaWaiter: 3.2) | Testing |
| React Compiler | - | Auto-memorizacion via babel plugin |

### Backend

| Tecnologia | Version | Uso |
|------------|---------|-----|
| FastAPI | 0.115 | Framework web (REST + WebSocket) |
| SQLAlchemy | 2.0 | ORM con soporte async |
| PostgreSQL | 16 | Base de datos relacional |
| Redis | 7 | Cache, pub/sub, rate limiting, token blacklist |
| Pydantic | 2.x | Validacion de schemas |

### Infraestructura

| Tecnologia | Uso |
|------------|-----|
| Docker Compose | Orquestacion de servicios (db, redis, backend, ws_gateway, pgadmin) |
| DevContainer | Soporte para desarrollo en contenedores |

---

## Arquitectura Multi-Tenant

```
Tenant (Restaurante)
  +-- Catalogos a nivel tenant: CookingMethod, FlavorProfile, TextureProfile, CuisineType
  +-- IngredientGroup -> Ingredient -> SubIngredient
  +-- Branch (N)
        +-- Category (N) -> Subcategory (N) -> Product (N)
        +-- BranchSector (N) -> Table (N) -> TableSession -> Diner (N)
        +-- WaiterSectorAssignment (diaria)
        +-- Round -> RoundItem -> KitchenTicket
        +-- Check -> Charge -> Allocation (FIFO) <- Payment
        +-- ServiceCall
```

Cada query de datos esta filtrada por `tenant_id`. Los repositorios aplican este filtro automaticamente. Los precios son por branch (`BranchProduct` con precio en centavos).

---

## Metricas del Proyecto

| Metrica | Valor |
|---------|-------|
| Total de archivos | 866+ |
| Archivos Python | 237 |
| Archivos TypeScript | 152 |
| Archivos TSX | 142 |
| Componentes React (pwaMenu) | 52 |
| Custom Hooks (pwaMenu) | 24 |
| Paginas Dashboard | 24+ |
| Stores Zustand (Dashboard) | 16+ |
| Puertos en uso | 5 (8000, 8001, 5176, 5177, 5178) |

---

## Madurez

El sistema se encuentra en estado **pre-produccion**. La arquitectura esta bien definida y los patrones son solidos. Elementos implementados y pendientes:

| Area | Estado |
|------|--------|
| Arquitectura core | Solida, patrones definidos |
| CI/CD | Implementado (GitHub Actions) |
| Escalado horizontal | Disenado (docker-compose.prod.yml con replicas) |
| Backups automatizados | Implementado (backup.sh con rotacion) |
| Monitoreo/Observabilidad | Pendiente (metricas, alertas, tracing) |
| Tests E2E | Scaffold basico (Playwright) |
