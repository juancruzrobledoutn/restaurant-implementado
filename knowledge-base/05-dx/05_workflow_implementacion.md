> Creado: 2026-04-05 | Actualizado: 2026-04-05 | Estado: vigente

# Workflow de Implementacion

Guia paso a paso para implementar una nueva feature end-to-end en el sistema Integrador. Cada paso incluye el archivo/directorio afectado y un ejemplo concreto.

---

## Resumen de pasos

```
1. Modelo → 2. Migracion → 3. Schema → 4. Servicio → 5. Router
→ 6. Frontend Store → 7. Frontend Page → 8. Tests → 9. WebSocket (opcional)
```

---

## Paso 1: Modelo SQLAlchemy

**Donde:** `backend/rest_api/models/`

Crear o modificar el modelo en el archivo de dominio correspondiente. Usar `BigInteger` para IDs, `is_active` para soft delete, y `tenant_id` para aislamiento multi-tenant.

```python
# backend/rest_api/models/mi_entidad.py
from sqlalchemy import BigInteger, Column, String, Boolean, ForeignKey, Integer
from rest_api.models.base import Base

class DishTag(Base):
    __tablename__ = "dish_tag"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    color_hex = Column(String(7), nullable=False, default="#f97316")
    display_order = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
```

**Registrar en `__init__.py`:**

```python
# backend/rest_api/models/__init__.py
from .mi_entidad import DishTag  # Agregar al final
```

> **Importante:** Sin este import, Alembic no detecta el modelo para autogenerar la migracion.

---

## Paso 2: Migracion Alembic

**Donde:** `backend/alembic/versions/`

```bash
cd backend
alembic revision --autogenerate -m "create dish_tag table"
alembic upgrade head
```

Verificar la migracion generada antes de aplicarla. Alembic puede no detectar cambios en constraints o indices correctamente — revisar el archivo generado en `alembic/versions/`.

---

## Paso 3: Schema Pydantic

**Donde:** `backend/shared/utils/admin_schemas.py`

Crear el schema de salida (output). Los schemas de entrada (input) se definen inline en el router o en un archivo separado si son complejos.

```python
# backend/shared/utils/admin_schemas.py
class DishTagOutput(BaseModel):
    id: int
    tenant_id: int
    name: str
    color_hex: str
    display_order: int
    is_active: bool

    model_config = ConfigDict(from_attributes=True)
```

---

## Paso 4: Servicio de Dominio

**Donde:** `backend/rest_api/services/domain/`

Extender `BranchScopedService` (si es por sucursal) o `BaseCRUDService` (si es por tenant).

```python
# backend/rest_api/services/domain/dish_tag_service.py
from sqlalchemy.orm import Session
from rest_api.models.mi_entidad import DishTag
from rest_api.services.base_service import BaseCRUDService
from shared.utils.admin_schemas import DishTagOutput

class DishTagService(BaseCRUDService[DishTag, DishTagOutput]):
    def __init__(self, db: Session):
        super().__init__(
            db=db,
            model=DishTag,
            output_schema=DishTagOutput,
            entity_name="Etiqueta de plato"
        )

    def _validate_create(self, data: dict, tenant_id: int) -> None:
        """Validaciones custom antes de crear."""
        if not data.get("name"):
            from shared.utils.exceptions import ValidationError
            raise ValidationError("El nombre es obligatorio")

    def _validate_update(self, entity: DishTag, data: dict) -> None:
        """Validaciones custom antes de actualizar."""
        pass
```

**Registrar en `__init__.py`:**

```python
# backend/rest_api/services/domain/__init__.py
from .dish_tag_service import DishTagService
```

---

## Paso 5: Router (Controlador HTTP)

**Donde:** `backend/rest_api/routers/`

El router debe ser **delgado**: parsear request, llamar al servicio, devolver response. Cero logica de negocio.

```python
# backend/rest_api/routers/admin.py (agregar endpoints)
from rest_api.services.domain import DishTagService
from rest_api.services.permissions import PermissionContext

@router.get("/dish-tags", response_model=list[DishTagOutput])
def list_dish_tags(
    db: Session = Depends(get_db),
    user: dict = Depends(current_user),
    limit: int = 50,
    offset: int = 0
):
    ctx = PermissionContext(user)
    service = DishTagService(db)
    return service.list_all(ctx.tenant_id, limit=limit, offset=offset)

@router.post("/dish-tags", response_model=DishTagOutput, status_code=201)
def create_dish_tag(
    data: DishTagCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(current_user)
):
    ctx = PermissionContext(user)
    ctx.require_management()  # Solo ADMIN o MANAGER
    return service.create(ctx.tenant_id, data.model_dump())
```

> **Recordar:** Los endpoints admin usan paginacion por defecto `?limit=50&offset=0`.

---

## Paso 6: Frontend Store (Zustand)

**Donde:** `Dashboard/src/stores/`

```typescript
// Dashboard/src/stores/dishTagStore.ts
import { create } from 'zustand'
import { adminAPI } from '../services/api'

interface DishTag {
  id: string
  name: string
  colorHex: string
  displayOrder: number
  isActive: boolean
}

interface DishTagState {
  tags: DishTag[]
  isLoading: boolean
  error: string | null
  fetchTags: () => Promise<void>
}

export const useDishTagStore = create<DishTagState>((set) => ({
  tags: [],
  isLoading: false,
  error: null,

  fetchTags: async () => {
    set({ isLoading: true, error: null })
    try {
      const data = await adminAPI.get('/dish-tags')
      set({ tags: data.map(adaptFromBackend), isLoading: false })
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false })
    }
  },
}))

// Selectores (OBLIGATORIO — nunca destructurar el store)
export const selectTags = (s: DishTagState) => s.tags
export const selectIsLoading = (s: DishTagState) => s.isLoading
```

> **Critico:** IDs del backend (`number`) se convierten a `string` en el frontend. Precios en centavos se dividen por 100 para mostrar.

---

## Paso 7: Frontend Page (React)

**Donde:** `Dashboard/src/pages/`

Crear la pagina y registrar la ruta en `App.tsx`.

```typescript
// Dashboard/src/pages/DishTagsPage.tsx
import { useEffect } from 'react'
import { useDishTagStore, selectTags, selectIsLoading } from '../stores/dishTagStore'

export default function DishTagsPage() {
  const tags = useDishTagStore(selectTags)
  const isLoading = useDishTagStore(selectIsLoading)
  const fetchTags = useDishTagStore((s) => s.fetchTags)

  useEffect(() => {
    fetchTags()
  }, [fetchTags])

  if (isLoading) return <LoadingSpinner />

  return (
    <div>
      <h1>Etiquetas de Plato</h1>
      <DataTable data={tags} columns={columns} />
    </div>
  )
}
```

**Registrar ruta:**

```typescript
// Dashboard/src/App.tsx
const DishTagsPage = lazy(() => import('./pages/DishTagsPage'))
// Dentro del router:
<Route path="/dish-tags" element={<DishTagsPage />} />
```

**Agregar al Sidebar** en `Dashboard/src/components/layout/Sidebar.tsx`.

---

## Paso 8: Tests

### Backend (pytest)

**Donde:** `backend/tests/`

```python
# backend/tests/test_dish_tags.py
import pytest

def test_create_dish_tag(client, admin_token):
    response = client.post(
        "/api/admin/dish-tags",
        json={"name": "Vegano", "color_hex": "#22c55e"},
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Vegano"

def test_list_dish_tags(client, admin_token):
    response = client.get(
        "/api/admin/dish-tags",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert response.status_code == 200
    assert isinstance(response.json(), list)
```

### Frontend (Vitest)

**Donde:** `Dashboard/src/stores/__tests__/` o junto al archivo

```typescript
// Dashboard/src/stores/dishTagStore.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useDishTagStore } from './dishTagStore'

describe('dishTagStore', () => {
  beforeEach(() => {
    useDishTagStore.setState({ tags: [], isLoading: false, error: null })
  })

  it('debe setear isLoading al hacer fetch', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(/* ... */)
    const store = useDishTagStore.getState()
    const promise = store.fetchTags()
    expect(useDishTagStore.getState().isLoading).toBe(true)
    await promise
    expect(useDishTagStore.getState().isLoading).toBe(false)
  })
})
```

**Comandos:**

```bash
# Backend
cd backend && python -m pytest tests/test_dish_tags.py -v

# Frontend
cd Dashboard && npm test -- src/stores/dishTagStore.test.ts
```

---

## Paso 9: WebSocket (opcional)

Si la feature necesita actualizaciones en tiempo real, elegir el patron de entrega:

| Patron | Cuando usar | Ejemplo |
|--------|-------------|---------|
| **Transactional Outbox** | Eventos criticos que no se pueden perder | Pagos, pedidos a cocina |
| **Direct Redis Pub/Sub** | Eventos no criticos, baja latencia | CRUD admin, carrito, estado de mesa |

### Outbox (eventos criticos)

```python
from rest_api.services.events.outbox_service import write_billing_outbox_event
write_billing_outbox_event(db=db, tenant_id=t, event_type="DISH_TAG_CRITICAL", ...)
db.commit()  # Atomico con los datos de negocio
```

### Direct Redis (eventos no criticos)

```python
from shared.infrastructure.events import publish_event
await publish_event(
    channel=f"branch:{branch_id}",
    event_type="ENTITY_CREATED",
    data={"entity": "dish_tag", "id": tag.id}
)
```

### Frontend: suscripcion

```typescript
const handleEventRef = useRef(handleEvent)
useEffect(() => { handleEventRef.current = handleEvent })
useEffect(() => {
  const unsubscribe = ws.on('ENTITY_CREATED', (e) => handleEventRef.current(e))
  return unsubscribe
}, [])
```

---

## Checklist rapido

- [ ] Modelo creado y registrado en `__init__.py`
- [ ] Migracion generada y aplicada
- [ ] Schema Pydantic de salida creado
- [ ] Servicio de dominio implementado y registrado en `__init__.py`
- [ ] Router con endpoints (GET list, GET detail, POST, PUT, DELETE)
- [ ] PermissionContext para validar roles
- [ ] Store Zustand con selectores (sin destructuracion)
- [ ] Pagina React registrada en `App.tsx` y Sidebar
- [ ] Tests backend (pytest) y frontend (Vitest)
- [ ] Conversiones de tipos: IDs (`string` ↔ `int`), precios (centavos ↔ pesos)
- [ ] Soft delete (`is_active`) en vez de hard delete
- [ ] Logger centralizado (no `console.*`)
