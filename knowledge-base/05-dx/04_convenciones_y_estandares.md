> Creado: 2026-04-05 | Actualizado: 2026-04-05 | Estado: vigente

# Convenciones y Estandares

Referencia canonica de todas las convenciones del proyecto. Aplica a backend, frontends y operaciones.

---

## 1. Convenciones de Nombres

| Contexto | Convencion | Ejemplo |
|----------|------------|---------|
| Frontend variables/funciones | camelCase | `branchId`, `handleSubmit()` |
| Backend variables/funciones | snake_case | `branch_id`, `handle_submit()` |
| Modelos SQLAlchemy | PascalCase | `BranchSector`, `RoundItem` |
| Componentes React | PascalCase | `ProductCard.tsx`, `SharedCart.tsx` |
| Stores Zustand | camelCase + "Store" | `authStore.ts`, `tableStore.ts` |
| Servicios de dominio | PascalCase + "Service" | `CategoryService`, `BillingService` |
| Routers FastAPI | snake_case | `auth.py`, `billing.py` |
| Tests backend | test_ prefix | `test_auth.py`, `test_billing.py` |
| Tests frontend | .test.ts suffix | `branchStore.test.ts` |
| Variables de entorno | UPPER_SNAKE_CASE | `JWT_SECRET`, `VITE_API_URL` |

---

## 2. Convenciones de Base de Datos

### IDs

| Capa | Tipo | Ejemplo |
|------|------|---------|
| Backend (BD, API) | `int` / `BigInteger` | `42` |
| Frontend (stores, UI) | `string` | `"42"` |
| Frontend (IDs locales) | `string` (UUID via `crypto.randomUUID()`) | `"a1b2c3d4-..."` |

```typescript
// Conversiones
const frontendId = String(backendId)      // 42 → "42"
const backendId = parseInt(frontendId, 10) // "42" → 42
```

### Precios en centavos

Todos los precios se almacenan como **enteros en centavos** para evitar errores de punto flotante.

| Concepto | Ejemplo |
|----------|---------|
| Precio en pesos | $125.50 |
| Valor en base de datos | 12550 (centavos) |

| Direccion | Conversion |
|-----------|-----------|
| Backend → Frontend | `backendCents / 100` |
| Frontend → Backend | `Math.round(price * 100)` |

### Soft Delete

> Nada se borra fisicamente. Todo se desactiva.

1. **Todas las entidades** usan soft delete: `is_active = False`.
2. **Hard delete solo** para registros efimeros: items del carrito (`cart_item`), sesiones expiradas.
3. **Toda consulta** debe filtrar por `is_active.is_(True)`:
   - Los repositorios (`TenantRepository`, `BranchRepository`) lo hacen automaticamente.
   - Las consultas raw **deben incluirlo manualmente**.
4. **Cascade soft delete**: `cascade_soft_delete(db, entity, user_id, user_email)` desactiva la entidad y todos sus dependientes recursivamente.
5. **Auditoria**: cada soft delete registra `deleted_at`, `deleted_by_id` y `deleted_by_email`.
6. **Evento WebSocket**: cada cascade soft delete emite un evento `CASCADE_DELETE` con el conteo de entidades afectadas.

### Palabras reservadas SQL

Usar prefijo `app_` para evitar conflictos con palabras reservadas de SQL:

```python
class Check(Base):
    __tablename__ = "app_check"  # No "check" — es palabra reservada
```

### Multi-Tenant

Toda entidad posee un `tenant_id` que se valida en cada operacion CRUD. Los repositorios (`TenantRepository`, `BranchRepository`) filtran automaticamente. Las consultas raw deben incluir el filtro manualmente.

---

## 3. Convenciones Frontend

### Zustand — Selectores obligatorios

```typescript
// CORRECTO: Siempre usar selectores
const items = useStore(selectItems)
const addItem = useStore((s) => s.addItem)

// INCORRECTO: Nunca destructurar (causa re-renders infinitos)
// const { items } = useStore()
```

### useShallow para arrays computados

```typescript
import { useShallow } from 'zustand/react/shallow'
const activeItems = useStore(useShallow(state => state.items.filter(i => i.active)))
```

### EMPTY_ARRAY para fallbacks estables

```typescript
const EMPTY_ARRAY: number[] = []
export const selectBranchIds = (s: State) => s.user?.branch_ids ?? EMPTY_ARRAY
```

### Logger centralizado

Usar siempre `utils/logger.ts`. Nunca usar `console.*` directamente.

### React Compiler

Los 3 frontends usan `babel-plugin-react-compiler` para memoizacion automatica. `eslint-plugin-react-hooks` 7.x refuerza reglas mas estrictas — los hooks deben llamarse incondicionalmente, preferir estado derivado sobre `setState` en `useEffect`.

### WebSocket listener con useRef

```typescript
const handleEventRef = useRef(handleEvent)
useEffect(() => { handleEventRef.current = handleEvent })
useEffect(() => {
  const unsubscribe = ws.on('*', (e) => handleEventRef.current(e))
  return unsubscribe
}, [])  // Empty deps — subscribe UNA sola vez
```

### Hook mount guard para async

```typescript
useEffect(() => {
  let isMounted = true
  fetchData().then(data => {
    if (!isMounted) return
    setData(data)
  })
  return () => { isMounted = false }
}, [])
```

---

## 4. Convenciones Backend

### PermissionContext para validacion de roles

```python
from rest_api.services.permissions import PermissionContext
ctx = PermissionContext(user)
ctx.require_management()           # Solo ADMIN o MANAGER
ctx.require_branch_access(branch_id)  # Verifica acceso a la sucursal
```

### User context desde JWT

```python
user_id = int(user["sub"])       # "sub" contiene el user ID
tenant_id = user["tenant_id"]
branch_ids = user["branch_ids"]
roles = user["roles"]
```

### safe_commit para commits seguros

```python
from shared.infrastructure.db import safe_commit
safe_commit(db)  # Rollback automatico en caso de error
```

### selectinload para evitar N+1

```python
from sqlalchemy.orm import selectinload, joinedload
rounds = db.execute(select(Round).options(
    selectinload(Round.items).joinedload(RoundItem.product)
)).scalars().unique().all()
```

### .is_(True) para booleanos en SQLAlchemy

```python
# CORRECTO
.where(Model.is_active.is_(True))

# INCORRECTO (comportamiento impredecible)
.where(Model.is_active == True)
```

### with_for_update() para prevenir race conditions

```python
locked = db.scalar(select(Entity).where(...).with_for_update())
```

### Excepciones centralizadas con auto-logging

```python
from shared.utils.exceptions import NotFoundError, ForbiddenError, ValidationError
raise NotFoundError("Producto", product_id, tenant_id=tenant_id)
```

### Constantes centralizadas

```python
from shared.config.constants import Roles, RoundStatus, MANAGEMENT_ROLES
```

---

## 5. Convenciones de API

### Paginacion

Los endpoints admin usan parametros por defecto: `?limit=50&offset=0`.

### Precios

Siempre en centavos (enteros). Ver seccion 2 para conversiones.

### Status enums

Los estados se almacenan y transmiten en **UPPERCASE** en el backend:
- `OPEN`, `PAYING`, `CLOSED` (sesiones)
- `PENDING`, `CONFIRMED`, `SUBMITTED`, `IN_KITCHEN`, `READY`, `SERVED`, `CANCELED` (rondas)

> **Nota:** El frontend puede usar valores diferentes. Ejemplo: `OPEN` en backend = `active` en frontend.

### Codigos de mesa

Los codigos son alfanumericos (ejemplo: `INT-01`, `BAR-03`). No son unicos entre sucursales — siempre se requiere `branch_slug` para identificar una mesa.

### URLs publicas

Las URLs publicas usan `slug` en vez de ID numerico para evitar enumeracion:
- `/api/public/menu/{slug}`
- `/api/public/branches`

---

## 6. Convenciones de UI

### Idioma de la interfaz

| Contexto | Idioma |
|----------|--------|
| Interfaz de usuario (UI) | Espanol |
| Comentarios en codigo | Ingles |
| Nombres de variables y funciones | Ingles |

### Tema visual

- Color acento: Orange `#f97316`
- Soporte light/dark mode via CSS variables `[data-theme="light"]`
- Persistencia del tema en localStorage

### Mobile viewport (pwaMenu)

Los contenedores deben incluir `overflow-x-hidden w-full max-w-full` para prevenir scroll horizontal en dispositivos moviles.

### localStorage expiry (pwaMenu)

TTL de 8 horas para datos cacheados (menu, sesion). Al cargar la app se verifica si los datos estan vencidos y se limpian automaticamente. Otros frontends usan storage con scope de sesion.

---

## 7. Convencion de i18n

### pwaMenu: Internacionalizacion completa

- **TODO** texto visible al usuario DEBE usar la funcion `t()`.
- Zero strings hardcodeados.
- Idiomas soportados: **es** (base), **en**, **pt**.
- Fallback chain: en → es, pt → es.
- Incluye: labels, placeholders, tooltips, mensajes de error, textos de botones, banners y notificaciones.

### Dashboard y pwaWaiter

Actualmente solo en espanol con strings hardcodeados. Dashboard tiene setup basico de i18next pero sin adopcion generalizada.

---

## 8. Convenciones de Organizacion de Archivos

### Estructura del monorepo

```
jr2/
├── backend/                # Backend Python (REST API)
├── ws_gateway/             # WebSocket Gateway (en raiz, NO dentro de backend/)
├── Dashboard/              # Panel de Administracion (React 19)
├── pwaMenu/                # PWA del Cliente/Comensal (React 19)
├── pwaWaiter/              # PWA del Mozo (React 19)
├── devOps/                 # Infraestructura Docker
├── e2e/                    # Tests end-to-end Playwright
├── shared/                 # Modulo compartido (websocket-client, UI scaffold)
├── openspec/               # Changes SDD (proposals, designs, tasks)
└── knowledge-base/         # Documentacion del sistema
```

### Backend: Clean Architecture

```
backend/
├── rest_api/
│   ├── models/             # Modelos SQLAlchemy 2.0
│   ├── routers/            # Controladores HTTP (delgados, delegan a servicios)
│   ├── services/
│   │   ├── domain/         # Servicios de dominio (logica de negocio)
│   │   ├── crud/           # Patron Repository (TenantRepository, BranchRepository)
│   │   ├── events/         # Servicios de eventos (outbox)
│   │   ├── permissions.py  # PermissionContext
│   │   └── base_service.py # BaseCRUDService, BranchScopedService
│   └── seeds/              # Datos semilla modulares
├── shared/                 # Modulo compartido (config, infra, security, utils)
└── tests/                  # Tests pytest
```

### Frontend: Estructura comun

```
src/
├── pages/                  # Paginas/vistas
├── components/             # Componentes React
│   ├── ui/                 # Componentes base reutilizables
│   └── layout/             # Layout, Sidebar, Header
├── stores/                 # Stores Zustand
├── hooks/                  # Custom hooks
├── services/               # Clientes API y WebSocket
│   ├── api.ts              # Cliente REST
│   └── websocket.ts        # Servicio WebSocket
├── types/                  # Interfaces TypeScript
├── utils/                  # Utilidades (logger, validacion, formateo)
└── config/                 # Configuracion de entorno
```

### Modelos: un archivo por dominio

Cada archivo de modelo agrupa entidades relacionadas:
- `tenant.py` — Tenant, Branch
- `menu.py` — Category, Subcategory, Product
- `table.py` — Table, TableSession, Diner
- `billing.py` — Check (app_check), Charge, Allocation, Payment
- `round.py` — Round, RoundItem

Todos los modelos se re-exportan en `rest_api/models/__init__.py`.

### Servicios de dominio: un archivo por entidad principal

Cada servicio se crea en `rest_api/services/domain/` y se re-exporta en `rest_api/services/domain/__init__.py`.

### Routers: delgados

Los routers solo manejan HTTP (parsear request, llamar servicio, devolver response). La logica de negocio vive en los servicios de dominio.
