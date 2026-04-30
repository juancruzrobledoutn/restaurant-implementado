# dashboard-promotions Design

> Technical design for **C-27 dashboard-promotions**.
> See `proposal.md` for motivation and `specs/*/spec.md` for normative requirements.

## Context

El Dashboard ya tiene — desde C-15 (dashboard-menu) y C-16 (dashboard-operations) — el **patron canonico de CRUD completamente establecido**: hook trio (`useFormModal` + `useConfirmDialog` + `usePagination`), `useActionState`, componentes UI base (`Modal`, `Table`, `TableSkeleton`, `Pagination`, `Badge`, `Card`, `PageContainer`, `HelpButton`, `Input`, `Toggle`, `Select`, `ConfirmDialog`, `CascadePreviewList`, `ImagePreview`, `ToastContainer`), `dashboardWS` con ref pattern, `useMenuWebSocketSync` montado en `MainLayout`, optimistic updates con rollback, `STORE_VERSIONS` + migrate con type guard, `cascadeService`, `helpContent.tsx`, `useAuthPermissions`, validacion centralizada en `validation.ts`, i18n es/en. Nada nuevo que inventar en patrones — solo aplicar.

El backend expone desde **C-13 promotions** (archivado):

- **Endpoints** (`Dashboard/backend/rest_api/routers/admin_promotions.py`):
  - `GET /api/admin/promotions?branch_id=&limit=&offset=` — list paginado, filtra por branch si se pasa
  - `GET /api/admin/promotions/{id}` — detail
  - `POST /api/admin/promotions` — crear con `PromotionCreate` (incluye `branch_ids[]` y `product_ids[]`)
  - `PATCH /api/admin/promotions/{id}` — update metadata (incluye toggle de `is_active` via `PromotionUpdate`)
  - `DELETE /api/admin/promotions/{id}` — ADMIN-only, soft delete
  - `POST/DELETE /api/admin/promotions/{id}/branches` — link/unlink branch
  - `POST/DELETE /api/admin/promotions/{id}/products` — link/unlink producto
- **Schema** (`backend/rest_api/schemas/promotion.py`):
  - `PromotionCreate`: `name`, `description?`, `price: int` (cents, `>= 0`), `start_date`, `start_time`, `end_date`, `end_time`, `promotion_type_id?`, `branch_ids: int[]`, `product_ids: int[]`. Validator temporal: `start_datetime <= end_datetime`.
  - `PromotionUpdate`: todos los campos opcionales, misma validacion de precio + nombre.
  - `PromotionOut`: include nested `branches: PromotionBranchOut[]` y `items: PromotionItemOut[]` (solo `product_id` y `product_name`).
- **RBAC**: ADMIN + MANAGER para crear/editar/linkear. ADMIN-only para delete (MANAGER recibe 403).
- **Eventos WS**: emite `ENTITY_CREATED`/`UPDATED`/`DELETED`/`CASCADE_DELETE` con `entity="promotion"`, filtrados por branch en el gateway.

**Lo que falta en el frontend hoy**:

- No hay pagina `/promotions` — ni ruta, ni sidebar entry, ni lazy import.
- No hay `promotionStore` — no hay forma de hidratar, cachear o mutar promociones desde React.
- No hay `DateRangePicker` reutilizable — todos los forms actuales son campos sueltos.
- No hay `MultiSelect` reutilizable — hoy los multi-selects se hacen ad-hoc con arrays de checkboxes.
- No hay `validatePromotion` en `validation.ts`.
- No hay `formatPromotionValidity` / `getPromotionStatus` en `formatters.ts`.
- No hay helpContent `promotions` en `helpContent.tsx`.
- No hay fetch de `promotion_types` en `catalogStore` (que ya existe con `allergens_catalog` y otros tenant catalogs).
- `useMenuWebSocketSync` no routea el entity `"promotion"` — hoy solo maneja categories/subcategories/products/allergens/ingredients/recipes.
- `cascadeService` no tiene `getPromotionPreview` ni `deletePromotionWithCascade`.

**Constraint clave**: este change aplica el patron canonico **sin desviarse**. Cualquier desviacion (destructuring de store, `useState` para modal/dialog, `onSubmit` + `preventDefault`, pagina sin `helpContent`, `console.log`, WS subscription sin ref pattern, migration con `any`, branches hardcodeadas en el form) se rechaza en code review.

**Stakeholders**:

- **ADMIN**: autonomia total. Crea/edita/activa/inactiva/elimina. Ve toggle inline + boton delete habilitado.
- **MANAGER**: CRUD + toggle inline en sus branches. Boton delete se muestra pero el backend devuelve 403 — el frontend lo **oculta** via `canDeletePromotion = isAdmin`.
- **KITCHEN / WAITER**: sin acceso. La ruta `/promotions` no se muestra en el sidebar ni se accede via URL (guard en `ProtectedRoute`).

## Goals / Non-Goals

**Goals**:

- Entregar la **pagina `/promotions`** operable desde el navegador, con listado paginado, filtros (estado/sucursal/vigencia), create/edit/delete + cascade preview + toggle inline + optimistic updates + WS sync + help content + i18n es/en + accesibilidad completa.
- Aplicar el **patron canonico de CRUD** sin inventar nada — reutilizar `useFormModal`, `useConfirmDialog`, `usePagination`, `useActionState`, `Modal`, `ConfirmDialog`, `PageContainer`, `HelpButton`, `Table`, `TableSkeleton`, `Pagination`, `Badge`, `dashboardWS`, `cascadeService`, `helpContent`, `useAuthPermissions`, `validation.ts`, `formatters.ts`, `STORE_VERSIONS`, `STORAGE_KEYS`.
- Introducir **dos componentes UI base nuevos y reutilizables**: `DateRangePicker` (para este change y futuros reportes de ventas, etc.) y `MultiSelect` (para este change y futuros staff roles, waiter assignments, etc.). Ambos con accesibilidad ARIA completa.
- Extender `promotionStore` con **optimistic updates + rollback + toggle inline + linkBranch + linkProduct + applyWS***. Apagar/prender promocion desde la tabla debe ser instantaneo en la UI.
- Extender `useMenuWebSocketSync` para ruteo de `entity="promotion"` — mantiene el ref pattern obligatorio.
- Tests Vitest que validan: store (CRUD + toggle + linkBranch/linkProduct + applyWS + rollback + migrate), pagina (render + filtros + create + edit + delete + toggle + validacion + cascade + WS), componentes nuevos (DateRangePicker + MultiSelect), validacion, formatters, i18n parity.

**Non-Goals**:

- Ningun cambio en backend o ws_gateway — capabilities `promotions` y `ws-gateway` no se tocan.
- Nuevos patrones de CRUD — solo aplicar los existentes.
- Nuevas skills, nuevas libs npm, nuevos patrones de Zustand.
- Promociones recurrentes / descuentos escalonados / condicionales — modelo actual es precio fijo + rango unico.
- UI de catalogos `promotion_type` (crear/editar tipos) — se consume read-only.
- Drag-and-drop en items — orden no es relevante en `promotion_item`.
- Bulk ops, import/export.
- Portugues (`pt`) — exclusivo de pwaMenu.

## Decisions

### D1. Un solo store `promotionStore`, tenant-scoped, branches como relacion embedded

**Decision**: El store guarda `Promotion[]` tenant-scoped (no branch-scoped como categories/products), con cada `Promotion` embebiendo `branches: PromotionBranch[]` y `items: PromotionItem[]` tal como viene del backend. Los filtros por branch/vigencia/estado se calculan **en selectores** con `useShallow` o `useMemo`.

**Alternativas**:

- *Store branch-scoped con filtrado en fetch*: requeriria re-fetchear cada vez que cambia `selectedBranchId`. Pero el backend ya soporta `?branch_id=` y el usuario puede ver promociones multi-sucursal. Rompe la UX de "ver todo el tenant" cuando el usuario tiene multi-branch.
- *Store tenant-scoped con branches embedded* (elegida): un solo fetch al mount, filtro client-side barato (decenas de items tipicamente). `PromotionOut` ya trae las branches embedded. Simple.
- *Store + endpoint separado para branches*: explota el numero de requests y complica el state management.

**Contrato del store**:

```typescript
interface Promotion {
  id: string
  tenant_id: string
  name: string
  description?: string
  price: number  // cents
  start_date: string  // ISO date
  start_time: string  // "HH:mm:ss"
  end_date: string
  end_time: string
  promotion_type_id?: string
  is_active: boolean
  created_at: string
  updated_at: string
  branches: PromotionBranch[]
  items: PromotionItem[]
}

interface PromotionFormData {
  name: string
  description: string
  price: number  // cents
  start_date: string
  start_time: string
  end_date: string
  end_time: string
  promotion_type_id: string | null
  branch_ids: string[]
  product_ids: string[]
  is_active: boolean
}

interface PromotionState {
  items: Promotion[]
  isLoading: boolean
  error: string | null
  pendingTempIds: Set<string>

  fetchAsync: () => Promise<void>
  createAsync: (data: PromotionFormData) => Promise<Promotion>
  updateAsync: (id: string, data: Partial<PromotionFormData>) => Promise<void>
  deleteAsync: (id: string) => Promise<void>
  toggleActiveAsync: (id: string) => Promise<void>
  linkBranchAsync: (promotionId: string, branchId: string) => Promise<void>
  unlinkBranchAsync: (promotionId: string, branchId: string) => Promise<void>
  linkProductAsync: (promotionId: string, productId: string) => Promise<void>
  unlinkProductAsync: (promotionId: string, productId: string) => Promise<void>

  applyWSCreated: (promotion: Promotion) => void
  applyWSUpdated: (promotion: Promotion) => void
  applyWSDeleted: (id: string) => void
}
```

**Selectores**:

```typescript
export const selectPromotions = (s: PromotionState) => s.items
export const selectIsLoading = (s: PromotionState) => s.isLoading
export const selectError = (s: PromotionState) => s.error
export const selectPromotionById = (id: string) => (s: PromotionState) =>
  s.items.find((p) => p.id === id) ?? null

// Filtered list — useShallow inside selector
export const useActivePromotions = () =>
  usePromotionStore(useShallow((s) => s.items.filter((p) => p.is_active)))

export const usePromotionsForBranch = (branchId: string | null) =>
  usePromotionStore(
    useShallow((s) =>
      branchId
        ? s.items.filter((p) => p.branches.some((b) => b.branch_id === branchId))
        : s.items
    )
  )

// Grouped actions — useShallow mandatory
export const usePromotionActions = () =>
  usePromotionStore(
    useShallow((s) => ({
      fetchAsync: s.fetchAsync,
      createAsync: s.createAsync,
      updateAsync: s.updateAsync,
      deleteAsync: s.deleteAsync,
      toggleActiveAsync: s.toggleActiveAsync,
    }))
  )
```

### D2. Optimistic updates con rollback automatico en TODAS las mutaciones

**Decision**: El patron de C-15 se aplica identico. Cada mutacion (`createAsync`, `updateAsync`, `deleteAsync`, `toggleActiveAsync`, `linkBranchAsync`, etc.) aplica el cambio localmente ANTES del request. En caso de error, restaura el snapshot previo y deja el error en `state.error`. Deduplicacion de eventos WS originados en la misma pestana via `pendingTempIds: Set<string>`.

**Ejemplo — toggleActiveAsync**:

```typescript
toggleActiveAsync: async (id) => {
  const previous = get().items
  const target = previous.find((p) => p.id === id)
  if (!target) return

  // Optimistic flip
  set({ items: previous.map((p) => (p.id === id ? { ...p, is_active: !p.is_active } : p)) })

  try {
    const updated = await fetchAPI<BackendPromotion>(
      `/api/admin/promotions/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !target.is_active }),
      }
    )
    // Merge server truth (updated_at, etc.) — no new toast if already shown
    set((state) => ({
      items: state.items.map((p) => (p.id === id ? toPromotion(updated) : p)),
    }))
  } catch (error) {
    // Rollback
    set({ items: previous, error: handleError(error, 'promotionStore.toggleActiveAsync') })
    toast.error('promotions.toggleFailed')
    throw error
  }
},
```

**Rollback para createAsync**: removemos el `tempId` del array; para `updateAsync` restauramos el item previo; para `deleteAsync` re-insertamos el item en su posicion original.

### D3. DateRangePicker como componente primitivo sin libs externas

**Decision**: Implementar `DateRangePicker` nativamente con `<input type="date">` + `<input type="time">` (4 inputs, 2 de cada) y validacion interna (`start_datetime <= end_datetime`). Emite error via prop `error`. Cero libs externas (no `react-datepicker`, no `react-day-picker`).

**Alternativas**:

- *`react-datepicker` o `react-day-picker`*: 30-50 KB + estilos custom + dificil de internacionalizar + problemas de a11y comunes. Para un rango fecha+hora simple es overkill.
- *Componente primitivo* (elegida): 4 inputs HTML nativos, cero overhead, native date picker del navegador (accesible por defecto en desktop y mobile), internacionalizacion via `lang` del html root (ya configurado por i18n). Validacion mano-a-mano con `<= 100 LOC`.

**API**:

```typescript
interface DateRangePickerProps {
  startDate: string    // "YYYY-MM-DD"
  startTime: string    // "HH:mm"
  endDate: string
  endTime: string
  onChange: (value: { startDate: string; startTime: string; endDate: string; endTime: string }) => void
  error?: string       // full-range error (ej. "end must be >= start")
  labelStart?: string  // default "Inicio"
  labelEnd?: string    // default "Fin"
  disabled?: boolean
}
```

**Render**:

```tsx
<div>
  <div className="grid grid-cols-2 gap-3">
    <label>
      <span>{labelStart}</span>
      <div className="flex gap-2">
        <input type="date" value={startDate} onChange={...} />
        <input type="time" value={startTime} onChange={...} />
      </div>
    </label>
    <label>
      <span>{labelEnd}</span>
      <div className="flex gap-2">
        <input type="date" value={endDate} onChange={...} />
        <input type="time" value={endTime} onChange={...} />
      </div>
    </label>
  </div>
  {error && (
    <p role="alert" className="text-[var(--danger-text)] text-sm mt-1">{error}</p>
  )}
</div>
```

### D4. MultiSelect accesible sin dependencias

**Decision**: Implementar `MultiSelect` como `<button>` trigger + `<ul role="listbox" aria-multiselectable="true">` con items `role="option" aria-selected`. Teclado completo: `Enter`/`Space` toggle, `Arrow up/down` nav, `Escape` cierra, `Home/End` primero/ultimo. Cero libs (no Radix, no Downshift).

**Alternativas**:

- *Radix `Select` con `multiple`*: Radix no soporta multi-select nativamente — habria que componer con `Checkbox` + `Popover`. ~5 KB + mismo esfuerzo que componente propio.
- *Downshift*: requiere hook + mucho boilerplate para multi-select, poco payoff para usos simples.
- *Componente propio* (elegida): 100-150 LOC con ARIA correcto, keyboard nav, click outside para cerrar, focus trap opcional. Suficiente para este caso y futuros (staff roles, waiter sectores).

**API**:

```typescript
interface MultiSelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface MultiSelectProps {
  label: string
  options: MultiSelectOption[]
  selected: string[]            // array of values
  onChange: (selected: string[]) => void
  placeholder?: string          // default "Selecciona opciones"
  error?: string
  disabled?: boolean
  name?: string                 // hidden input for form integration
}
```

**Integracion con FormData**: el componente renderiza un `<input type="hidden" name={name} value={selected.join(',')} />` cuando `name` esta presente. En la action, se extrae via `(formData.get('branch_ids') as string).split(',').filter(Boolean)`. Alternativamente, el state controlado vive en `modal.formData` y se lee directamente — preferimos esta via para evitar el split/join.

### D5. Toggle inline `is_active` sin modal

**Decision**: La columna "Estado" de la tabla renderiza un `<Toggle>` controlado. Click → `toggleActiveAsync(id)` → optimistic flip + toast. No abre modal. Si falla (403 del backend, network error, etc.), rollback automatico + toast de error.

**Alternativas**:

- *Abrir modal de edit para cambiar estado*: friccion innecesaria para una operacion binaria.
- *Menu kebab con "Activar / Desactivar"*: tres clicks para una accion simple.
- *Toggle inline* (elegida): un click, feedback instantaneo, pattern ya establecido en otras paginas (productStore `toggleAvailabilityAsync` de C-15).

**Accesibilidad**: el `Toggle` ya trae `aria-checked`, `aria-label` prop requerido. Usamos `aria-label={t('promotions.toggleActive', { name: p.name })}`. Estado pending visual: opacity reducida durante el request.

### D6. Filtros de vigencia calculados client-side con `now()` congelado en render

**Decision**: `getPromotionStatus(p)` retorna `'scheduled' | 'active' | 'expired'` comparando `start_datetime` y `end_datetime` con `now()`. El `now()` se captura UNA vez en el render (como constante local) — no con `useState` ni `setInterval` — para que el filtro sea consistente en toda la tabla y no tiemble.

**Alternativas**:

- *Backend endpoint con filtro por estado*: agrega complejidad, requiere coordinar con el backend.
- *Client-side con `useState` refrescando cada minuto*: over-engineered para un dato que cambia cada hora en el peor caso. Re-renders innecesarios.
- *Client-side con `now()` congelado* (elegida): simple, correcto. El usuario puede refrescar la pagina (F5 o navegar fuera+vuelve) para re-evaluar. La pagina ya se actualiza via WS cuando el backend cambia algo.

```typescript
// utils/formatters.ts
export function getPromotionStatus(
  p: Pick<Promotion, 'start_date' | 'start_time' | 'end_date' | 'end_time'>,
  now: Date = new Date()
): 'scheduled' | 'active' | 'expired' {
  const start = new Date(`${p.start_date}T${p.start_time}`)
  const end = new Date(`${p.end_date}T${p.end_time}`)
  if (now < start) return 'scheduled'
  if (now > end) return 'expired'
  return 'active'
}

export function isPromotionActiveNow(p: Promotion, now: Date = new Date()): boolean {
  return getPromotionStatus(p, now) === 'active'
}

export function formatPromotionValidity(
  p: Pick<Promotion, 'start_date' | 'start_time' | 'end_date' | 'end_time'>
): string {
  const startD = p.start_date.split('-').reverse().slice(0, 2).join('/')  // "15/06"
  const startT = p.start_time.slice(0, 5)                                  // "18:00"
  const endD = p.end_date.split('-').reverse().slice(0, 2).join('/')
  const endT = p.end_time.slice(0, 5)
  return `${startD} ${startT} → ${endD} ${endT}`
}
```

### D7. Validacion centralizada

**Decision**: Agregar `validatePromotion(data: PromotionFormData)` a `validation.ts`. Retorna `{ isValid, errors: Partial<Record<keyof PromotionFormData, string>> }` con **i18n keys** como errores (`'validation.required'`, `'validation.priceNonNegative'`, `'promotions.endBeforeStart'`, `'promotions.noBranchesSelected'`, etc.). La accion del form los pasa a `<Input error={...}>` que los traduce con `t()`.

**Reglas** (en orden):

- `name`: requerido + trim + max 120 → `'validation.required'` | `'validation.maxLength'`
- `description`: max 500 (opcional) → `'validation.maxLength'`
- `price`: `isValidNumber` + `>= 0` → `'validation.required'` | `'validation.priceNonNegative'`
- `start_date`, `start_time`, `end_date`, `end_time`: requeridos → `'validation.required'`
- `end_datetime >= start_datetime` (combinado con `new Date(`${date}T${time}`)`) → error en **`end_date`** field: `'promotions.endBeforeStart'`
- `branch_ids.length >= 1` → error en field `branch_ids`: `'promotions.noBranchesSelected'`
- `product_ids`: opcional (una promocion puede crearse sin items y agregarlos despues)

### D8. WebSocket routing incremental

**Decision**: Extender el `useMenuWebSocketSync` existente (no crear uno nuevo). El switch interno agrega `case 'promotion': promotionStore.applyWSCreated/Updated/Deleted(...)`. El ref pattern, filtrado por branch, y manejo de `CASCADE_DELETE` siguen intactos.

**Filtro por branch (sutileza)**: un ADMIN con visibilidad multi-branch ve TODAS las promociones del tenant. Si `selectedBranchId` esta seteado, filtramos solo las que tienen esa branch en `p.branches`. La suscripcion WS usa `dashboardWS.onFiltered(selectedBranchId, '*', ...)` — los eventos de promociones que solo tocan OTRAS branches (sin la selectedBranchId) **no llegan** a este hook. Para un ADMIN que necesite ver "todo el tenant", bastante con no seleccionar branch — la suscripcion WS cae de `onFiltered` a `on('*', ...)` (ver decision ya tomada en C-15).

### D9. Deduplicacion optimistic vs WS echo

**Decision**: Cuando el usuario crea una promocion, el flow es:

1. `createAsync` genera `tempId = crypto.randomUUID()`, agrega a `pendingTempIds`, inserta item optimista con `id: tempId`.
2. POST devuelve la promocion real con `id: "123"`.
3. Reemplazamos el item con `id === tempId` por la version real. Removemos `tempId` de `pendingTempIds`.
4. Despues, el WS `ENTITY_CREATED` llega con la misma promocion. En `applyWSCreated`, verificamos `if (items.some((p) => p.id === event.id)) return` — ya esta, no duplicamos.

El `pendingTempIds` no sirve para dedup en este flow (porque el id ya es el real), pero **si** sirve para el flow donde el POST falla: no queremos que un WS de otra pestana inserte algo que localmente rollback-eamos. En la practica, el orden `POST response → WS event` puede invertirse con latencia alta. La unica regla segura: idempotencia por `id`.

### D10. Cascade preview: backend no tiene endpoint dedicado, calculamos client-side

**Decision**: Igual que en C-15 para ingredients/allergens, el preview se calcula leyendo el store ya hidratado.

```typescript
// cascadeService.ts
export function getPromotionPreview(promotionId: string): CascadePreview | null {
  const promotion = usePromotionStore.getState().items.find((p) => p.id === promotionId)
  if (!promotion) return null

  const items = [
    { label: 'promotions.cascade.branches', count: promotion.branches.length },
    { label: 'promotions.cascade.items', count: promotion.items.length },
  ].filter((i) => i.count > 0)

  return {
    totalItems: items.reduce((sum, i) => sum + i.count, 0),
    items,
  }
}

export async function deletePromotionWithCascade(promotionId: string): Promise<void> {
  return usePromotionStore.getState().deleteAsync(promotionId)
}
```

El backend con `DELETE /api/admin/promotions/{id}` hace el cascade a `PromotionBranch` y `PromotionItem` automaticamente. El preview client-side es cosmetico (mostrar al usuario que el delete afectara N branches y M items). Si el store no esta hidratado (edge case), retorna `null` y `ConfirmDialog` no muestra preview — el delete sigue funcionando.

### D11. Persistencia + migracion con type guard

**Decision**: `STORE_VERSIONS.PROMOTION = 1` inicial. `persist()` con `STORAGE_KEYS.PROMOTION` y `migrate(persistedState: unknown, version: number)`. El migrate usa type guard estricto:

```typescript
migrate: (persistedState: unknown, version: number) => {
  if (!persistedState || typeof persistedState !== 'object') {
    return { items: [], isLoading: false, error: null, pendingTempIds: new Set() }
  }
  const state = persistedState as { items?: unknown }
  if (!Array.isArray(state.items)) {
    return { items: [], isLoading: false, error: null, pendingTempIds: new Set() }
  }
  // version 1 → nothing to migrate yet
  return {
    items: state.items as Promotion[],
    isLoading: false,
    error: null,
    pendingTempIds: new Set(),
  } as PromotionState
},
```

### D12. RBAC: hide MANAGER's delete button

**Decision**: El backend responde 403 a MANAGER en DELETE. En el frontend:

- `useAuthPermissions` expone `canDeletePromotion = isAdmin`.
- La columna "Acciones" renderiza el boton delete SOLO si `canDeletePromotion === true`.
- El boton "Delete" en el modal de edit (si existe) tampoco se renderiza para MANAGER.
- Si por alguna razon el MANAGER recibe 403 (cache stale, race), el toast de error muestra `t('permissions.deleteForbidden')` y no hay rollback (no se hizo nada optimistico).

## Risks / Trade-offs

- **[Risk] Timezone confusion en `start_date + start_time`** — el backend guarda `date` y `time` separados sin timezone. El `new Date(`${date}T${time}`)` asume la zona local del navegador. Si el admin crea una promocion "18:00" y un diner en otra timezone la ve, los times son los mismos strings pero el "ahora" se evalua en zonas diferentes.
  → **Mitigacion**: por ahora, todas las comparaciones se hacen client-side con `new Date().toISOString().slice(0, 10)` para la date y `toTimeString().slice(0, 5)` para la hora, en la zona local del navegador. El `promotion.start_time` es "la hora local del restaurante" (convencion tacita). Documentar esto en `helpContent.promotions` y en `knowledge-base/05-dx/03_trampas_conocidas.md`. Para multi-tenant cross-timezone, queda pendiente un change futuro que agregue `timezone` al `branch`.

- **[Risk] Volumen alto de promociones (>200)** — filtros client-side pueden volverse lentos con filtros compuestos (estado + sucursal + vigencia).
  → **Mitigacion**: los filtros se calculan con `useMemo` sobre el array ya extraido del store, complejidad `O(n)`. Con 200 promociones el tiempo es despreciable (<1ms). Si el volumen explota, agregar paginacion server-side con `?status=active&branch_id=...&valid_at=now`.

- **[Risk] Optimistic create falla despues de que el WS `ENTITY_CREATED` llego primero (de otra pestana)** — el WS insertaria el item con su id real, luego el POST responderia con error y rollbackeariamos algo que NO es nuestro.
  → **Mitigacion**: el rollback de `createAsync` solo remueve items con `id === tempId`. El WS insert usa `id` real, nunca tempId. Zero conflict.

- **[Risk] `now()` congelado en render da estado equivocado si la pagina esta abierta >1 hora** — una promocion `scheduled` a las 17:55 se ve como "scheduled" a las 18:05 hasta que el user refresca.
  → **Mitigacion**: aceptable para este caso (los admins refrescan frecuentemente, y el WS dispara re-renders por cambios en el store). Documentado en `helpContent.promotions`: "Si no ves el estado actualizado, refresca la pagina".

- **[Risk] DateRangePicker + locale del navegador en es-AR** — el formato mostrado por `<input type="date">` depende del locale del browser. En algunas combinaciones raras puede mostrar MM/DD/YYYY.
  → **Mitigacion**: no hay forma portable de forzar el formato en `<input type="date">` (HTML spec). El formato en la tabla y resumenes usa `formatPromotionValidity` que siempre es DD/MM. El picker del browser es cosmetico y accesible, el valor internamente siempre es ISO `YYYY-MM-DD`. Aceptable.

- **[Risk] MultiSelect con muchas sucursales (>20)** — el dropdown se vuelve largo.
  → **Mitigacion**: agregar un `<input type="search">` arriba del listbox para filtrar por nombre. Implementar si el volumen lo amerita (ticket pospuesto). Para el MVP: overflow scroll con `max-h-64`.

- **[Trade-off] Dos componentes UI nuevos solo para esta pagina** — podria parecer excesivo.
  → **Razon**: ambos son primitivos reutilizables. `DateRangePicker` se usara en sales reports, waiter assignments con ventanas horarias, billing con filtros de fecha. `MultiSelect` se usara en staff roles, waiter sectores multi-asignados, etc. Pagar el costo una vez, amortizar en futuros changes.

- **[Trade-off] Sin paginacion server-side** — si un tenant tiene 1000 promociones, el GET inicial puede ser pesado.
  → **Razon**: el backend ya soporta `?limit=&offset=`. Hoy el frontend usa `limit=50&offset=0` y pagina en el cliente lo que viene. Si un admin tiene mas de 50 promociones, aparecera un "ver mas" o sumamos paginacion server-side en un change posterior. Para el MVP de restaurantes medianos, 50 alcanza.

## Migration Plan

**N/A — change 100% frontend**. No hay migraciones de DB, no hay schema changes en backend, no hay feature flags. El deploy es:

1. Merge del PR.
2. CI ejecuta `pnpm --filter dashboard lint && pnpm --filter dashboard typecheck && pnpm --filter dashboard test`.
3. Build del Dashboard (`pnpm --filter dashboard build`) y deploy al contenedor.
4. El usuario refresca el navegador y ve la nueva ruta `/promotions` + item en sidebar.

**Rollback**: `git revert` + redeploy. Zero data migration, zero lock.

## Open Questions

Ninguna bloqueante. Tres decisiones menores que se cierran en apply:

1. **¿El fetch de `promotion_types` se hace al montar la pagina o al abrir el modal?** → Al montar la pagina (1 solo fetch, cache en `catalogStore`). El modal lo lee del cache.
2. **¿El filtro "Vigencia" muestra "todas" o "vigentes" por default?** → `todas` — el admin ve el backlog completo por defecto, filtra si quiere.
3. **¿El `Toggle` inline dispara `updateAsync` o un `toggleActiveAsync` dedicado?** → `toggleActiveAsync` dedicado, mas semantico y separa la responsabilidad en el store. El router es el mismo endpoint (`PATCH /api/admin/promotions/{id}` con `{ is_active }`).
