# Arquitectura General del Sistema

---

## Vista General

Integrador / Buen Sabor es un sistema distribuido compuesto por **4 aplicaciones frontend**, **2 servicios backend** y **2 bases de datos**. Todos los componentes se orquestan mediante Docker Compose para desarrollo y despliegue.

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENTES                              │
├──────────────┬──────────────┬──────────────┬────────────────┤
│  Dashboard   │   pwaMenu    │  pwaWaiter   │  Kitchen       │
│  :5177       │   :5176      │   :5178      │  Display       │
│  React 19    │   React 19   │   React 19   │  React 19      │
│  Zustand     │   Zustand    │   Zustand    │  Zustand       │
│  JWT Auth    │  TableToken  │   JWT Auth   │  JWT Auth      │
└──────┬───────┴──────┬───────┴──────┬───────┴──────┬─────────┘
       │ HTTP          │ HTTP          │ HTTP         │ HTTP
       │ WS            │ WS            │ WS           │ WS
┌──────┴───────────────┴───────────────┴─────────────┴────────┐
│                   SERVICIOS BACKEND                          │
├────────────────────────────┬────────────────────────────────┤
│   REST API (FastAPI)       │   WebSocket Gateway (FastAPI)  │
│   Puerto 8000              │   Puerto 8001                  │
│                            │                                │
│   Routers (delgados)       │   4 Endpoints:                 │
│   → Domain Services        │   /ws/waiter (JWT)             │
│   → Repositories           │   /ws/kitchen (JWT)            │
│   → Models                 │   /ws/admin (JWT)              │
│                            │   /ws/diner (TableToken)       │
│   Clean Architecture       │                                │
│   Sistema de Permisos      │   Composition Pattern          │
│   Rate Limiting            │   Strategy Auth                │
│   Outbox Pattern           │   Sharded Locks                │
│                            │   Worker Pool (10 workers)     │
│                            │   Circuit Breaker              │
└──────────┬─────────────────┴──────────┬─────────────────────┘
           │                            │
    ┌──────┴──────┐             ┌───────┴───────┐
    │ PostgreSQL  │             │    Redis 7    │
    │ 16+pgvector │             │   Puerto 6380 │
    │ Puerto 5432 │             │               │
    │             │             │  Pub/Sub      │
    │  18 modelos │             │  Blacklist    │
    │  Tabla Outbox│            │  Rate limits  │
    │  Audit log  │             │  Sesión cache │
    └─────────────┘             │  Menu cache   │
                                │  Cola eventos │
                                └───────────────┘
```

---

## Capas del Backend (Clean Architecture)

El backend sigue los principios de **Clean Architecture**, separando responsabilidades en capas bien definidas:

```
ROUTERS (controladores HTTP delgados)
    → DOMAIN SERVICES (lógica de negocio en rest_api/services/domain/)
        → REPOSITORIES (acceso a datos via TenantRepository, BranchRepository)
            → MODELS (SQLAlchemy 2.0 en rest_api/models/)
```

### Routers (Controladores Delgados)

Los routers **nunca** contienen lógica de negocio. Su responsabilidad se limita a:

1. Recibir la request HTTP
2. Extraer el contexto del usuario (JWT)
3. Delegar al Domain Service correspondiente
4. Retornar la respuesta

```python
# Ejemplo correcto: Router delgado
@router.get("/categories")
def list_categories(db: Session = Depends(get_db), user: dict = Depends(current_user)):
    ctx = PermissionContext(user)
    service = CategoryService(db)
    return service.list_by_branch(ctx.tenant_id, branch_id)
```

### PermissionContext

**Ubicación:** `rest_api/services/permissions.py`

Centraliza la verificación de permisos en una única abstracción reutilizable usando el patrón Strategy.

**Responsabilidades:**
- Extraer contexto del usuario desde claims JWT (`sub`, `tenant_id`, `branch_ids`, `roles`)
- Verificar roles requeridos para cada operación
- Validar acceso a sucursales específicas
- Lanzar excepciones estandarizadas cuando se viola un permiso

| Método | Descripción | Excepción si falla |
|--------|-------------|-------------------|
| `require_management()` | Exige rol ADMIN o MANAGER | `ForbiddenError` |
| `require_branch_access(branch_id)` | Verifica que el usuario tiene acceso a esa sucursal | `ForbiddenError` |
| `require_role(role)` | Exige un rol específico | `ForbiddenError` |
| `require_any_role(roles)` | Exige al menos uno de los roles listados | `ForbiddenError` |

```python
@router.post("/categories")
def create_category(data: CategoryInput, db: Session = Depends(get_db), user: dict = Depends(current_user)):
    ctx = PermissionContext(user)
    ctx.require_management()  # Solo ADMIN o MANAGER
    ctx.require_branch_access(data.branch_id)  # Debe tener acceso a la sucursal
    service = CategoryService(db)
    return service.create(data.dict(), ctx.tenant_id)
```

**Dependencias:** `shared/security/auth.py` (JWT claims), `shared/utils/exceptions.py`

### Domain Services

Son el corazón de la lógica de negocio. Cada servicio encapsula las operaciones de un dominio específico. Patrón Template Method: las clases base definen el flujo, las subclases implementan hooks específicos.

**Clases base:**

#### BaseCRUDService[Model, Output]

Provee operaciones CRUD genéricas con validación y hooks:

```python
class BaseCRUDService(Generic[Model, Output]):
    def create(self, data: dict, tenant_id: int) -> Output
    def update(self, entity_id: int, data: dict, tenant_id: int) -> Output
    def delete(self, entity_id: int, tenant_id: int, user_id: int, user_email: str) -> dict
    def get_by_id(self, entity_id: int, tenant_id: int) -> Output
    def list_all(self, tenant_id: int, limit: int = 50, offset: int = 0) -> list[Output]

    # Hooks para override
    def _validate_create(self, data: dict, tenant_id: int) -> None: ...
    def _validate_update(self, data: dict, entity: Model, tenant_id: int) -> None: ...
    def _after_create(self, entity: Model, user_id: int, user_email: str) -> None: ...
    def _after_update(self, entity: Model, user_id: int, user_email: str) -> None: ...
    def _after_delete(self, entity_info: dict, user_id: int, user_email: str) -> None: ...
```

#### BranchScopedService[Model, Output]

Extiende BaseCRUD con filtrado automático por sucursal:

```python
class BranchScopedService(BaseCRUDService[Model, Output]):
    def list_by_branch(self, tenant_id: int, branch_id: int, ...) -> list[Output]
    def get_by_branch(self, entity_id: int, tenant_id: int, branch_id: int) -> Output
```

**Ejemplo de creación de un nuevo servicio:**

```python
# rest_api/services/domain/my_entity_service.py
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
        if not data.get("name"):
            raise ValidationError("El nombre es obligatorio")

    def _after_delete(self, entity_info: dict, user_id: int, user_email: str) -> None:
        pass  # Acciones post-eliminación (ej: emitir evento WS)
```

**Servicios disponibles (14+):**

| Servicio | Modelo principal | Base | Responsabilidades clave |
|----------|-----------------|------|------------------------|
| `CategoryService` | Category | BranchScoped | CRUD categorías, validar unicidad por sucursal |
| `SubcategoryService` | Subcategory | BranchScoped | CRUD subcategorías, validar categoría padre |
| `BranchService` | Branch | BaseCRUD | CRUD sucursales, generar slugs únicos |
| `SectorService` | BranchSector | BranchScoped | CRUD sectores, validar sin mesas huérfanas |
| `TableService` | Table | BranchScoped | CRUD mesas, generación de códigos, creación masiva |
| `ProductService` | Product | BranchScoped | CRUD productos, precios en centavos, imágenes |
| `AllergenService` | Allergen | BaseCRUD | CRUD alérgenos, reacciones cruzadas |
| `StaffService` | User | BaseCRUD | Gestión de personal, asignación de roles por sucursal |
| `PromotionService` | Promotion | BranchScoped | CRUD promociones, vigencia, descuentos |
| `RoundService` | Round | Específico | Ciclo de vida de rondas, validación de transiciones |
| `BillingService` | Check | Específico | Facturación, cargos, pagos, FIFO allocation |
| `DinerService` | Diner | Específico | Registro de comensales, tracking por dispositivo |
| `ServiceCallService` | ServiceCall | BranchScoped | Llamadas mozo, ACK, cierre |
| `TicketService` | KitchenTicket | Específico | Tickets de cocina, agrupación por producto |

> **IMPORTANTE:** `CRUDFactory` está **DEPRECADO**. Toda funcionalidad nueva debe implementarse usando Domain Services.

### Repositories

Abstracción sobre SQLAlchemy que provee acceso a datos con filtrado automático:

- `TenantRepository`: Filtra automáticamente por `tenant_id` e `is_active`
- `BranchRepository`: Filtra por `branch_id`, `tenant_id` e `is_active`

### Outbox Service

**Ubicación:** `rest_api/services/events/outbox_service.py`

Garantiza la entrega de eventos críticos (financieros, operativos) mediante el patrón Transactional Outbox. El evento se persiste en la misma transacción que los datos de negocio, y un procesador asíncrono lo publica después.

**Por qué existe:** En un sistema distribuido, publicar directamente a Redis después de un commit puede fallar (crash entre commit y publish), perdiendo el evento. Con outbox, la atomicidad está garantizada por la transacción de BD.

```python
write_billing_outbox_event(
    db=db,
    tenant_id=tenant_id,
    event_type="CHECK_REQUESTED",
    payload={...},
    branch_id=branch_id
)
db.commit()  # Evento + datos de negocio en UNA transacción
```

**Flujo completo:**

1. El Domain Service llama a `write_billing_outbox_event()`
2. Se inserta un registro en la tabla `outbox_events` con status `PENDING`
3. `db.commit()` persiste datos + evento atómicamente
4. Un procesador background lee eventos PENDING
5. Publica a Redis Pub/Sub
6. Marca el evento como `PUBLISHED`
7. El WS Gateway recibe y distribuye

**Eventos que usan outbox:** `CHECK_REQUESTED`, `CHECK_PAID`, `PAYMENT_APPROVED`, `PAYMENT_REJECTED`, `ROUND_SUBMITTED`, `ROUND_READY`, `SERVICE_CALL_CREATED`

### Safe Commit

**Ubicación:** `shared/infrastructure/db.py`

Previene pérdida silenciosa de datos por transacciones no comiteadas.

```python
def safe_commit(db: Session) -> None:
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
```

Sin `safe_commit`, una excepción durante `db.commit()` puede dejar la sesión en estado inconsistente. El rollback automático garantiza que la conexión vuelve a un estado limpio.

### Cascade Soft Delete

**Ubicación:** `rest_api/services/crud/soft_delete.py`

Implementa eliminación lógica en cascada, manteniendo integridad referencial sin borrar datos.

**Convención del sistema:** Todas las entidades usan soft delete (`is_active = False`). Hard delete solo para registros efímeros (items de carrito, sesiones expiradas).

```python
affected = cascade_soft_delete(db, product, user_id, user_email)
# affected = {"Product": 1, "BranchProduct": 3, "ProductAllergen": 2}
```

**Comportamiento:**
1. Marca la entidad principal como `is_active = False`
2. Busca todas las entidades dependientes (relaciones definidas en el modelo)
3. Las marca como `is_active = False` recursivamente
4. Registra quién y cuándo realizó la eliminación
5. Retorna un diccionario con conteos de entidades afectadas
6. Emite evento `CASCADE_DELETE` vía WebSocket para que los clientes actualicen su UI

**Advertencia:** Las queries raw (sin usar Repository) DEBEN incluir `.where(Model.is_active.is_(True))` manualmente. Los repositories lo hacen automáticamente.

### Módulo Compartido (backend/shared/)

El módulo `shared/` contiene código transversal utilizado tanto por la REST API como por el WebSocket Gateway:

| Submódulo | Contenido | Responsabilidad |
|-----------|-----------|-----------------|
| `config/settings.py` | Pydantic Settings | Configuración centralizada desde `.env` |
| `config/constants.py` | Roles, RoundStatus, etc. | Constantes del dominio |
| `config/logging.py` | Logging config | Logger centralizado |
| `infrastructure/db.py` | get_db, safe_commit, SessionLocal | Conexión y transacciones de BD |
| `infrastructure/events.py` | Redis pool, publish_event | Bus de eventos Redis |
| `infrastructure/cache/menu_cache.py` | Menu cache | Cache de menú público por branch slug |
| `security/auth.py` | JWT, table token verification | Autenticación y tokens |
| `utils/exceptions.py` | NotFoundError, ForbiddenError, etc. | Excepciones centralizadas con auto-logging |
| `utils/admin_schemas.py` | Pydantic output schemas | Serialización de respuestas |
| `utils/validators.py` | validate_image_url, etc. | Validación de entrada |

### Redis Menu Cache

**Ubicación:** `shared/infrastructure/cache/menu_cache.py`

Las respuestas del menú público se cachean en Redis por branch slug con key `cache:menu:{slug}` y TTL de 5 minutos. El cache se invalida automáticamente ante operaciones CRUD de productos/categorías y toggles de disponibilidad. Usa cliente Redis sincrónico con patrón **fail-open**: si Redis no está disponible, la request va directo a la base de datos sin error.

---

## Arquitectura del WebSocket Gateway

El Gateway WebSocket es un servicio independiente que maneja todas las conexiones en tiempo real. Está diseñado con **Composition Pattern**: componentes pequeños y especializados orquestados por un manager central.

### ConnectionManager (Fachada Orquestadora)

**Ubicación:** `ws_gateway/connection_manager.py`

Patrón Facade + Composition: delega a 5 módulos internos en lugar de implementar todo en una clase monolítica.

| Módulo | Clase | Responsabilidad |
|--------|-------|-----------------|
| Lifecycle | `ConnectionLifecycle` | Accept/disconnect con lock ordering para prevenir deadlocks |
| Broadcaster | `ConnectionBroadcaster` | Worker pool de 10 workers para broadcast eficiente |
| Cleanup | `ConnectionCleanup` | Limpieza periódica de conexiones stale (60s), muertas y locks |
| Index | `ConnectionIndex` | Índices multidimensionales: por usuario, sucursal, sector, sesión |
| Stats | `ConnectionStats` | Agregación de métricas (conexiones activas, mensajes/seg, latencia) |

**Límites de conexión:**
- 3 conexiones máximo por usuario (multi-tab)
- 1000 conexiones totales por instancia del gateway
- Exceder el límite retorna close code 4029

### ConnectionBroadcaster

**Ubicación:** `ws_gateway/core/connection/broadcaster.py`

Envía mensajes eficientemente a múltiples conexiones WebSocket en paralelo usando patrón Worker Pool con fallback a batch processing.

**Modo principal - Worker Pool:**
- 10 workers paralelos procesan una cola de 5000 mensajes
- Cada worker toma un mensaje y lo envía a la conexión destino
- Performance: 400 usuarios en aproximadamente 160ms

**Modo fallback - Batch Processing:**
- Se activa si el worker pool falla o se satura
- Agrupa conexiones en lotes de 50
- Usa `asyncio.gather()` para envío paralelo dentro del lote

**Manejo de errores:**
- Conexiones que fallan al recibir se marcan para limpieza
- No bloquea el broadcast de otros usuarios
- Métricas de mensajes enviados, fallidos y descartados

### RedisSubscriber

Suscriptor Pub/Sub con protecciones:

- **Circuit Breaker**: Protege operaciones Redis (CLOSED → OPEN tras 5 fallos → HALF_OPEN a 30s → CLOSED)
- **Validación de eventos**: Schema validation antes de procesar
- **Procesamiento por lotes**: Agrupa mensajes para eficiencia

### EventRouter

**Ubicación:** `ws_gateway/components/events/router.py`

Determina qué conexiones deben recibir cada evento basándose en el tipo de evento y el rol del usuario.

**Categorías de eventos:**

| Categoría | Destino | Eventos |
|-----------|---------|---------|
| `KITCHEN_EVENTS` | Solo conexiones `/ws/kitchen` | ROUND_SUBMITTED, ROUND_IN_KITCHEN, ROUND_READY |
| `SESSION_EVENTS` | Comensales de la sesión específica | CART_*, ROUND_IN_KITCHEN+, CHECK_* |
| `ADMIN_ONLY_EVENTS` | Solo conexiones `/ws/admin` | ENTITY_CREATED, ENTITY_UPDATED, ENTITY_DELETED |
| `BRANCH_WIDE_WAITER_EVENTS` | Todos los mozos de la sucursal | ROUND_PENDING, TABLE_SESSION_STARTED |
| `SECTOR_EVENTS` | Mozos del sector específico | SERVICE_CALL_CREATED, TABLE_STATUS_CHANGED |

**Filtrado por sector:** Los eventos con `sector_id` se envían solo a mozos asignados a ese sector. ADMIN y MANAGER siempre reciben todos los eventos de su sucursal, independientemente del sector.

**Tabla de routing de rondas:**

| Evento | Admin | Cocina | Mozos | Comensales |
|--------|-------|--------|-------|------------|
| `ROUND_PENDING` | Si | No | Si (toda la sucursal) | No |
| `ROUND_CONFIRMED` | Si | No | Si | No |
| `ROUND_SUBMITTED` | Si | Si | Si | No |
| `ROUND_IN_KITCHEN` | Si | Si | Si | Si |
| `ROUND_READY` | Si | Si | Si | Si |
| `ROUND_SERVED` | Si | Si | Si | Si |
| `ROUND_CANCELED` | Si | No | Si | Si |

### CircuitBreaker

**Ubicación:** `ws_gateway/components/resilience/circuit_breaker.py`

Protege el sistema contra fallos en cascada cuando Redis deja de responder.

```
CLOSED (normal)
  │ 5 fallos consecutivos
  ▼
OPEN (rechaza operaciones)
  │ 30 segundos
  ▼
HALF_OPEN (prueba con 1 operación)
  │ éxito → CLOSED
  │ fallo → OPEN
```

**Implementación:**
- Thread-safe mediante `threading.Lock`
- Configurable: umbral de fallos, timeout de recuperación
- Métricas: total de rechazos, transiciones de estado

```python
breaker = CircuitBreaker(failure_threshold=5, recovery_timeout=30)

async def redis_operation():
    if not breaker.can_execute():
        return None  # Circuito abierto, no intentar
    try:
        result = await redis.get(key)
        breaker.record_success()
        return result
    except Exception:
        breaker.record_failure()
        raise
```

### Estrategias de Autenticación

**Ubicación:** `ws_gateway/components/auth/strategies.py`

Patrón Strategy para autenticación flexible:

| Estrategia | Cliente | Token | Revalidación |
|------------|---------|-------|--------------|
| `JWTAuthStrategy` | Dashboard, pwaWaiter, Kitchen | JWT Bearer token | Cada 5 minutos |
| `TableTokenAuthStrategy` | pwaMenu (comensales) | HMAC table token | Cada 30 minutos |
| `CompositeAuthStrategy` | Endpoints mixtos | Cadena de strategies (prueba cada una) | Según tipo detectado |
| `NullAuthStrategy` | Testing | Ninguno | Sin validación |

**Flujo de autenticación WebSocket:**
1. Cliente conecta a `/ws/{role}?token=xxx`
2. El handler selecciona la estrategia según el endpoint
3. La estrategia valida el token y extrae claims
4. Si es válido, se crea la conexión
5. Periódicamente se revalida el token (en background)
6. Si la revalidación falla, se cierra con código 4001

**Extensión prevista:** `OAuth2Strategy`, `APIKeyStrategy`

### Límites de Conexión

- Máximo 3 conexiones por usuario
- Máximo 1000 conexiones totales
- Heartbeat: ping cada 30s, timeout pong 60s
- Códigos de cierre: 4001 (auth fallido), 4003 (prohibido), 4029 (rate limited)

---

## Arquitectura Frontend

Las tres aplicaciones frontend comparten una base tecnológica común.

### Stack Compartido

| Tecnología | Versión | Propósito |
|------------|---------|-----------|
| React | 19.2 | UI library |
| Vite | 7.2 | Bundler y dev server |
| TypeScript | 5.9 | Type safety |
| Zustand | Última | State management |
| Tailwind CSS | 4 | Estilos utilitarios |
| React Compiler | babel-plugin | Auto-memoización |

### Zustand Stores

**Ubicación:** `*/src/stores/` en cada frontend

Patrón obligatorio - Selectores (NUNCA destructurar):

```typescript
// CORRECTO: Selector individual
const items = useStore(selectItems)
const addItem = useStore((s) => s.addItem)

// CORRECTO: Referencia estable para arrays vacíos
const EMPTY_ARRAY: number[] = []
export const selectBranchIds = (s: State) =>
  s.user?.branch_ids ?? EMPTY_ARRAY

// CORRECTO: useShallow para arrays filtrados
import { useShallow } from 'zustand/react/shallow'
const activeItems = useStore(
  useShallow(state => state.items.filter(i => i.active))
)

// INCORRECTO: Destructurar (causa loops infinitos)
// const { items, addItem } = useStore()
```

**Por qué NO destructurar:** Zustand retorna un nuevo objeto en cada render si se lee el store completo. Al destructurar, React detecta "nuevo objeto" en cada render, causando un loop infinito de re-renders.

**Stores por aplicación:**

| App | Stores principales | Total |
|-----|-------------------|-------|
| Dashboard | authStore, branchStore, categoryStore, productStore, tableStore, staffStore, orderStore, billingStore | 16+ |
| pwaMenu | tableStore (modular), menuStore, serviceCallStore | 3 |
| pwaWaiter | authStore, tablesStore, retryQueueStore | 3 |

### Table Store (pwaMenu) - Arquitectura Modular

**Ubicación:** `pwaMenu/src/stores/tableStore/`

Gestiona todo el estado de la sesión de mesa del comensal: sesión, carrito, rondas, pagos.

| Archivo | Contenido |
|---------|-----------|
| `store.ts` | Definición principal del store con 75+ acciones/getters |
| `types.ts` | Interfaces TypeScript (Session, Diner, CartItem, Round, etc.) |
| `selectors.ts` | Selectores optimizados para cada vista |
| `helpers.ts` | Funciones puras auxiliares (cálculos, transformaciones) |

**Responsabilidades:**
- Gestión de sesión de mesa (join, leave, status)
- Carrito compartido (add, update, remove items)
- Sincronización multi-dispositivo vía WebSocket (CART_ITEM_ADDED, etc.)
- Rondas de pedidos (submit, track status)
- Pagos del comensal (request check, payment status)
- Persistencia en localStorage con TTL de 8 horas

**Sincronización multi-tab:**
- Escucha eventos `storage` del navegador
- Cuando otra tab modifica el store, se sincroniza automáticamente
- Previene conflictos de estado entre tabs del mismo comensal

**Cache con expiración:**
```typescript
const CACHE_TTL_MS = 8 * 60 * 60 * 1000 // 8 horas

function isExpired(timestamp: number): boolean {
  return Date.now() - timestamp > CACHE_TTL_MS
}
```

### useFormModal Hook (Dashboard)

**Ubicación:** `Dashboard/src/hooks/useFormModal.ts`

Unifica el estado de modal + formulario en un solo hook reutilizable, eliminando código repetitivo en páginas CRUD.

```typescript
// ANTES: Repetitivo en cada página
const [isModalOpen, setIsModalOpen] = useState(false)
const [editingItem, setEditingItem] = useState(null)
const [formData, setFormData] = useState({})

// DESPUÉS: Un solo hook
const { isOpen, editingItem, formData, openCreate, openEdit, close, setField } = useFormModal()
```

Elimina duplicación en las 24 páginas del Dashboard con manejo consistente de estado open/close/editing y reseteo automático de formData al cerrar.

### API Layer

**Ubicación:** `*/src/services/api.ts` en cada frontend

Cliente HTTP centralizado con manejo de autenticación, reintentos y errores.

```typescript
async function fetchAPI<T>(
  endpoint: string,
  options?: RequestInit,
  retryOn401?: boolean  // default: true
): Promise<T>
```

**Características:**
- Timeout configurable (default 30s)
- `credentials: 'include'` para enviar cookies HttpOnly (refresh token)
- Auto-retry en 401: refresca el token y reintenta la request original
- Headers automáticos: `Content-Type: application/json`, `Authorization: Bearer {token}`

**Prevención de loop infinito en logout:**

```typescript
// CRITICO: logout DEBE deshabilitar retry en 401
authAPI.logout = () => fetchAPI('/auth/logout', { method: 'POST' }, false)
// Sin esto: token expirado → 401 → onTokenExpired → logout() → 401 → loop infinito
```

**Request deduplication (solo pwaMenu):**

```typescript
const pendingRequests = new Map<string, Promise<any>>()

async function deduplicatedFetch<T>(endpoint: string): Promise<T> {
  if (pendingRequests.has(endpoint)) {
    return pendingRequests.get(endpoint)!
  }
  const promise = fetchAPI<T>(endpoint)
  pendingRequests.set(endpoint, promise)
  promise.finally(() => pendingRequests.delete(endpoint))
  return promise
}
```

**Clases de error:** `ApiError` (genérico), `AuthError` (401/403), `ValidationError` (422)

### WebSocket Services

**Ubicación:** `*/src/services/websocket.ts` en cada frontend

Singleton por aplicación (una instancia global).

| App | Instancia | Endpoint |
|-----|-----------|----------|
| Dashboard | `dashboardWS` | `/ws/admin?token=JWT` |
| pwaMenu | `dinerWS` | `/ws/diner?table_token=TOKEN` |
| pwaWaiter | `wsService` | `/ws/waiter?token=JWT` |

**Reconexión automática:**
- Backoff exponencial: 1s → 2s → 4s → 8s → 16s → 30s (máximo)
- Jitter: variación aleatoria de +/-30% para evitar thundering herd
- Máximo 50 intentos antes de desistir
- Códigos no recuperables (NO reconecta): 4001 (auth failed), 4003 (forbidden), 4029 (rate limited)

### Shared WebSocket Client (`shared/websocket-client.ts`)

Clase base abstracta `BaseWebSocketClient` (~300 líneas) que unifica la lógica común de WebSocket entre los 3 frontends:

**Core:** heartbeat automático, reconexión con backoff exponencial, registro de listeners, handler de visibilidad (pausa/reanuda al cambiar de tab), tracking de `lastEventTimestamp` para catch-up.

**Subclases:**

| Clase | App | Características específicas |
|-------|-----|---------------------------|
| `DashboardWebSocket` | Dashboard | Filtrado por branch, throttling de eventos de alta frecuencia |
| `DinerWebSocket` | pwaMenu | Autenticación por table token, catch-up de sesión al reconectar |
| `WebSocketService` | pwaWaiter | Refresh de token JWT (PWAW-A001), catch-up de branch al reconectar |

**Heartbeat:**
- Cliente envía `{"type":"ping"}` cada 30 segundos
- Servidor responde `{"type":"pong"}`
- Si no hay pong en 10 segundos, se considera la conexión muerta
- Se inicia reconexión automática

**Patrón de suscripción (useRef para evitar acumulación):**

```typescript
// CORRECTO: Suscribirse una vez con ref
const handleEventRef = useRef(handleEvent)
useEffect(() => { handleEventRef.current = handleEvent })
useEffect(() => {
  const unsubscribe = ws.on('*', (e) => handleEventRef.current(e))
  return unsubscribe
}, [])  // Deps vacías - suscribirse UNA vez
```

### Características Comunes de Frontend

- **Lazy loading**: Páginas cargadas con `React.lazy()` + `Suspense`
- **Tema**: Acento naranja (#f97316), soporte dark mode
- **PWA**: Service workers con Workbox (CacheFirst para assets, NetworkFirst para APIs)

---

## Patrones de Entrega de Eventos

El sistema utiliza dos patrones de entrega según la criticidad del evento:

### Outbox Pattern (Entrega Garantizada)

Para eventos financieros y críticos donde la pérdida de un evento es inaceptable:

```python
from rest_api.services.events.outbox_service import write_billing_outbox_event

write_billing_outbox_event(db=db, tenant_id=t, event_type=CHECK_REQUESTED, ...)
db.commit()  # Atómico con los datos de negocio
```

Un procesador en background lee la tabla outbox y publica a Redis. Garantiza **at-least-once delivery**.

### Direct Redis (Baja Latencia)

Para eventos donde la velocidad importa más que la garantía absoluta:

```python
from shared.infrastructure.events import publish_event
await publish_event(channel, event_data)
```

Entrega **best-effort** con latencia mínima.

| Patrón | Eventos |
|--------|---------|
| **Outbox** (no debe perderse) | CHECK_REQUESTED, CHECK_PAID, PAYMENT_*, ROUND_SUBMITTED, ROUND_READY, SERVICE_CALL_CREATED |
| **Direct Redis** (baja latencia) | ROUND_CONFIRMED, ROUND_IN_KITCHEN, ROUND_SERVED, CART_*, TABLE_*, ENTITY_* |

---

## Flujo de Comunicación

### Request HTTP Típica

```
Cliente → REST API (8000) → Router → PermissionContext → Domain Service → Repository → PostgreSQL
                                                              ↓
                                                        publish_event → Redis Pub/Sub
                                                              ↓
                                                    WS Gateway (8001) → EventRouter → Clientes WS
```

### Evento Crítico (Outbox)

```
Cliente → REST API → Domain Service → [Datos + Outbox Event] → db.commit() (atómico)
                                                                      ↓
                                              Background Processor → Redis Pub/Sub
                                                                      ↓
                                                            WS Gateway → Clientes
```

### Conexión WebSocket

```
Cliente → WS Gateway (8001) → AuthStrategy (JWT/TableToken)
                                    ↓ (autenticado)
                              ConnectionManager.connect()
                                    ↓
                              ConnectionIndex (registrar por branch/sector/session)
                                    ↓
                              Heartbeat loop (ping cada 30s)
                                    ↓ (evento llega via Redis)
                              EventRouter → BroadcastRouter → WorkerPool → Cliente
```

---

## Infraestructura

### Docker Compose

El archivo `devOps/docker-compose.yml` orquesta todos los servicios:

| Servicio | Imagen/Build | Puerto |
|----------|-------------|--------|
| `db` | PostgreSQL 16 + pgvector | 5432 |
| `redis` | Redis 7 Alpine | 6380 |
| `backend` | Build desde `backend/` | 8000 |
| `ws_gateway` | Build desde raíz | 8001 |
| `pgadmin` | pgAdmin 4 | 5050 |

### Puertos del Sistema

| Puerto | Servicio | Protocolo |
|--------|----------|-----------|
| 5176 | pwaMenu | HTTP |
| 5177 | Dashboard | HTTP |
| 5178 | pwaWaiter | HTTP |
| 8000 | REST API | HTTP |
| 8001 | WebSocket Gateway | WS |
| 5432 | PostgreSQL | TCP |
| 6380 | Redis | TCP |
| 5050 | pgAdmin | HTTP |

---

## Diagrama de Dependencias entre Componentes

```
                    ┌─────────────────┐
                    │  PermissionCtx  │
                    └────────┬────────┘
                             │ usa
                    ┌────────▼────────┐
                    │ Domain Services │
                    └───┬────────┬────┘
                        │        │
              ┌─────────▼─┐  ┌──▼──────────┐
              │ Repository │  │ OutboxService│
              └─────┬──────┘  └──────┬───────┘
                    │                │
              ┌─────▼──────┐  ┌──────▼───────┐
              │ SQLAlchemy  │  │ Redis PubSub │
              │  Models     │  └──────┬───────┘
              └─────┬──────┘         │
                    │          ┌─────▼──────────┐
              ┌─────▼──────┐  │  WS Gateway    │
              │ PostgreSQL  │  │  EventRouter   │
              └────────────┘  │  Broadcaster   │
                              │  Auth Strategy │
                              └───────┬────────┘
                                      │
                              ┌───────▼────────┐
                              │ Frontend Stores│
                              │ WS Services    │
                              │ API Layer      │
                              └────────────────┘
```
