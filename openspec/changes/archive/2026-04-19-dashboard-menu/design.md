# dashboard-menu Design

> Technical design for **C-15 dashboard-menu**.
> See `proposal.md` for motivation and `specs/*/spec.md` for normative requirements.

## Context

El Dashboard arranca este change con **scaffold completo pero cero paginas de negocio**. C-14 dejo: authStore, fetchAPI con refresh silencioso, MainLayout con sidebar/navbar/breadcrumbs, routing con React Router v7 lazy, i18n es/en con ~700 keys base, `useIdleTimeout`, convenciones Zustand enforced por ESLint. No hay `Modal`, no hay `Table`, no hay `useFormModal`, no hay `dashboardWS`, no hay stores de dominio, no hay validacion, no hay `helpContent`.

El backend expone (archivado en C-04/C-05/C-06):

- **Categories**: branch-scoped, fields `name`, `order`, `icon`, `image`. Admin CRUD `/api/admin/categories`. Delete ADMIN-only con cascade a subcategorias y productos.
- **Subcategories**: pertenecen a una category, fields `name`, `order`, `image`. Delete cascade a productos.
- **Products**: pertenecen a una subcategory, fields `name`, `description`, `price` (centavos), `image` (URL con anti-SSRF validation), `featured`, `popular`. Linking con allergens via `POST /api/admin/products/{id}/allergens` con `presence_type` y `risk_level`.
- **BranchProduct**: per-branch pricing + `is_available` (runtime toggle distinto de `is_active`). `POST /api/admin/branch-products`.
- **Allergens**: tenant-scoped (compartidos entre branches), fields `name`, `icon`, `description`, `is_mandatory`, `severity`. Cross-reactions bidireccionales. Delete ADMIN-only.
- **Ingredients**: jerarquia tenant-scoped `IngredientGroup → Ingredient → SubIngredient`. Delete cascade soft. ADMIN-only para todo.
- **Recipes**: receta por producto con lista de ingredientes. JWT K/M/A.

**Eventos WebSocket disponibles** (routed a conexiones `/ws/admin` exclusivamente, Direct Async, no outbox):

- `ENTITY_CREATED`, `ENTITY_UPDATED`, `ENTITY_DELETED`: payload `{ entity: "category"|"product"|..., id, data }`, filtrados por `branch_id` en el router del gateway.
- `CASCADE_DELETE`: payload `{ entity, id, affected: { Subcategory: 5, Product: 12 } }`.

**Stakeholders**: ADMIN (autonomia completa, unico rol con delete), MANAGER (CRUD sin delete, branch-scoped a sus sucursales), KITCHEN y WAITER (sin acceso a estas paginas — lectura via menu publico).

**Constraint clave**: este change fija el **patron canonico de CRUD del Dashboard**. Cualquier desviacion (destructuring de store, `useState` para modales, `onSubmit` + `preventDefault`, pagina sin `helpContent`, `console.log`, WS subscription sin ref pattern, migration con `any`) se va a heredar a todas las paginas de C-16 y en adelante. No se permite.

## Goals / Non-Goals

**Goals**:

- Entregar **seis paginas CRUD operables** (Categories, Subcategories, Products, Allergens, Ingredients, Recipes) desde el navegador, con create/edit/delete + cascade preview + optimistic updates + WS sync + help content + i18n es/en + accesibilidad completa.
- Establecer el **hook trio reutilizable** (`useFormModal` + `useConfirmDialog` + `usePagination`) como contrato canonico para todo CRUD futuro del Dashboard.
- Introducir la **primera conexion WebSocket del Dashboard** con el ref pattern obligatorio documentado y testeado. Dejar `dashboardWS` y `useMenuWebSocketSync` como referencia de como suscribirse en C-16 en adelante.
- Formalizar **`STORE_VERSIONS` + migraciones con type guard** como contrato para todo store persistido del Dashboard (y referencia cruzada para pwaMenu/pwaWaiter).
- Implementar **optimistic updates con rollback automatico** en los seis stores — cualquier create/update/delete se ve instantaneo; en caso de error del backend, el estado previo se restaura y el error se muestra en toast.
- Tests Vitest que validan: stores (CRUD + migrate + rollback), paginas (render + flujos), hooks, WS handler, validation, i18n parity.

**Non-Goals**:

- Ningun cambio en backend o ws_gateway — las capabilities `menu-catalog`, `allergen-system`, `ingredient-catalog`, `recipe-management` no se tocan.
- Paginas operativas (Tables, Staff, Sectors, Kitchen Display, Sales) — es C-16.
- Customizations, Promotions, drag-and-drop, bulk ops, import/export — ninguno en este change.
- Portugues (`pt`) — exclusivo de pwaMenu.
- Design system completo de componentes (Dropdown, Tooltip, Popover, etc.) — solo lo minimo necesario para las seis paginas; los componentes avanzados llegan con un change de UI kit futuro.
- Paginacion server-side — client-side con `usePagination` es suficiente para los volumenes esperados (decenas a pocos cientos de items por branch/tenant).

## Decisions

### D1. Hook trio (`useFormModal` + `useConfirmDialog` + `usePagination`) como contrato canonico

**Decision**: Encapsular el estado de modal+form+delete-dialog+pagination en tres hooks tipados, prohibiendo explicitamente el uso de `useState` crudo para esos roles en paginas CRUD.

**Alternativas**:

- *`useState` crudo en cada pagina*: repite ~40 lineas de boilerplate por pagina. Cualquier refactor requiere tocar N paginas.
- *Un solo hook god-mode `useCRUDPage`*: acopla demasiado, cada caso tiene variaciones (branch-scoped vs tenant-scoped, cascade vs no-cascade, etc.).
- *Hook trio* (elegida): cada hook resuelve UNA responsabilidad. La combinacion se aplica donde se necesita. `useFormModal<FormData, Entity>` es generico, lo mismo `useConfirmDialog<Entity>` y `usePagination<T>`.

**Contrato**:

```typescript
// useFormModal
interface UseFormModalReturn<F, E> {
  isOpen: boolean
  selectedItem: E | null
  formData: F
  setFormData: Dispatch<SetStateAction<F>>
  openCreate: (initial?: Partial<F>) => void
  openEdit: (item: E, mapper: (item: E) => F) => void
  close: () => void
}

// useConfirmDialog
interface UseConfirmDialogReturn<E> {
  isOpen: boolean
  item: E | null
  open: (item: E) => void
  close: () => void
}

// usePagination
interface UsePaginationReturn<T> {
  paginatedItems: T[]
  currentPage: number
  totalPages: number
  totalItems: number
  itemsPerPage: number
  setCurrentPage: (page: number) => void
}
```

**Rationale**: mismo patron que pwaWaiter ya adoptado en changes operativos, consistencia entre sub-proyectos. La skill `dashboard-crud-page` ya lo documenta como obligatorio — aca lo materializamos.

### D2. `useActionState` (React 19) para toda form submission — sin excepcion

**Decision**: Toda pagina CRUD usa `useActionState<FormState<F>, FormData>(submitAction, initialState)` con `<form action={formAction}>`. `onSubmit` + `preventDefault` queda prohibido por ESLint rule.

**Alternativas**:

- *`onSubmit` + `useState` para isLoading/errors*: mas verbose, requiere manejar `e.preventDefault`, loading state manual, reset manual. Ya discutido en C-14 scaffold.
- *React Hook Form*: dependencia adicional, API propia, no integrada con React 19 actions. Sobre-dimensionado para forms simples.
- *`useActionState` nativo* (elegida): la API nueva de React 19, manejo automatico de `isPending`, `state`, reinicio tras success. El proyecto entero (pwaMenu, pwaWaiter) ya adopto el patron.

**Contrato del action**:

```typescript
async (_prev: FormState<F>, formData: FormData): Promise<FormState<F>> => {
  const data: F = extractFromFormData(formData)
  const validation = validateX(data)
  if (!validation.isValid) return { errors: validation.errors, isSuccess: false }
  try {
    if (modal.selectedItem) await updateAsync(modal.selectedItem.id, data)
    else await createAsync(data)
    toast.success('Guardado')
    return { isSuccess: true }
  } catch (e) {
    return { isSuccess: false, message: handleError(e, 'Page.submitAction') }
  }
}
```

Cerrar modal via guard `if (state.isSuccess && modal.isOpen) modal.close()` fuera del action — NUNCA adentro.

### D3. `useFormModal` con `formData` interno (controlled) vs `defaultValue` (uncontrolled)

**Decision**: `useFormModal` expone `formData` y `setFormData`. Los inputs son controlados (`value={modal.formData.x}` + `onChange`). FormData se extrae de `<form>` en el action function.

**Alternativa considerada**: Inputs uncontrolled con `defaultValue={modal.formData.x}` y extraccion solo via `formData.get`. Simplifica el render pero complica casos como preview de imagen (necesito el valor en vivo) o validacion condicional (mostrar/ocultar campo segun otro campo). Rechazado por rigidez.

**Trade-off**: un poco mas verbose en JSX, pero flexibilidad completa para features como image preview, conditional fields, etc.

### D4. Optimistic updates con rollback automatico

**Decision**: Cada mutate action del store sigue el patron:

```typescript
createAsync: async (data) => {
  const tempId = `temp-${Date.now()}`
  const optimistic: Entity = { ...data, id: tempId, is_active: true, _optimistic: true }
  set((s) => ({ items: [...s.items, optimistic] }))
  try {
    const real = await api.create(data)
    set((s) => ({ items: s.items.map((i) => (i.id === tempId ? real : i)) }))
    return real
  } catch (e) {
    set((s) => ({ items: s.items.filter((i) => i.id !== tempId), error: String(e) }))
    throw e
  }
}
```

**Alternativas**:

- *Pessimistic (wait for server, then set state)*: UX laggy cuando el backend esta lento. Rechazado para CRUD admin donde el usuario espera feedback inmediato.
- *Optimistic sin rollback*: si el backend rechaza, el UI queda inconsistente. Rechazado — la consistencia es no-negociable.
- *Optimistic con rollback* (elegida): UX instantaneo + consistencia garantizada.

**Clave**: el `_optimistic: true` flag permite al UI deshabilitar botones de accion sobre items en vuelo si se quiere. En este change lo dejamos sin UI indicator explicito — los tests verifican solo el comportamiento de rollback.

**Edge case — ENTITY_CREATED del WS durante el optimistic**: cuando el WS trae el evento del backend para el mismo item que creamos optimistamente, el handler lo descarta si el id ya esta en el store (dedup por `id`). Si el item llega antes de que el store reemplace el `tempId`, el dedup lo filtra por timestamp tambien (matcheando `tempId` recientes creados por este tab via un `Set<string>` de tempIds propios).

### D5. `dashboardWS` + ref pattern obligatorio en `useMenuWebSocketSync`

**Decision**: Un unico hook montado en `MainLayout` que se suscribe a `'*'` via `dashboardWS.onFiltered(selectedBranchId, '*', ...)` y routea el evento al store correspondiente. Implementacion siguiendo la skill `ws-frontend-subscription`:

```typescript
const handler = (event: WSEvent) => { /* switch on event.type */ }
const handlerRef = useRef(handler)
useEffect(() => { handlerRef.current = handler })   // Effect 1: sync ref, no deps

useEffect(() => {
  const unsubscribe = dashboardWS.onFiltered(
    selectedBranchId,
    '*',
    (e) => handlerRef.current(e)
  )
  return unsubscribe
}, [selectedBranchId])                              // Effect 2: resubscribe only on branch change
```

**Alternativas**:

- *Subscribirse por pagina*: cada pagina CRUD se suscribe cuando se monta. Problema: si el usuario navega entre paginas, el store de Categories pierde los eventos entrantes. Los stores necesitan escuchar siempre.
- *Subscribirse por store (dentro del `create`)*: el store tiene referencia al WS. Problema: testeabilidad (el store depende de una instancia global WS) y acoplamiento.
- *Hook centralizado en `MainLayout`* (elegida): una sola subscripcion, ruteo explicito a stores. Testeable (se puede mockear `dashboardWS`). Resiliente a navegacion entre paginas.

**Branch filter**: `dashboardWS.onFiltered(selectedBranchId, '*', cb)` usa un selector de `branchStore` (definido en C-14 o C-16; si C-16 no existe aun, este change declara un `branchStore` stub con `selectedBranchId: string | null` y lo popula desde `authStore.user.default_branch_id` hasta que C-16 entregue un selector de branch propio). **Nota**: el branchStore completo es de C-16 — aca creamos solo el stub minimo con `selectedBranchId` para habilitar `onFiltered`.

### D6. `STORE_VERSIONS` centralizado + migrate con type guard

**Decision**: Una unica constante `STORE_VERSIONS` exportada desde `utils/constants.ts` con todas las versiones de stores persistidos. Cada store declara `version: STORE_VERSIONS.XXX` y una funcion `migrate(persistedState: unknown, version: number)` con type guard.

```typescript
// constants.ts
export const STORE_VERSIONS = {
  CATEGORY: 1,
  SUBCATEGORY: 1,
  PRODUCT: 1,
  ALLERGEN: 1,
  INGREDIENT: 1,
  RECIPE: 1,
} as const

// store.ts
migrate: (persistedState: unknown, version: number): CategoryState => {
  if (!persistedState || typeof persistedState !== 'object') {
    return { items: EMPTY_ARRAY, isLoading: false, error: null }
  }
  const state = persistedState as { items?: unknown }
  if (!Array.isArray(state.items)) {
    return { items: EMPTY_ARRAY, isLoading: false, error: null }
  }
  return { items: state.items as Category[], isLoading: false, error: null }
}
```

**Alternativa**: `migrate` casteando a `any`. Rechazada por seguridad — un `any` se propaga y oculta errores de shape.

**Rationale**: cuando evolucione el shape (ej.: agregar campo `tags: string[]` a `Category` en un change futuro), se sube `STORE_VERSIONS.CATEGORY` a 2 y se agrega una rama `if (version < 2) items = items.map(i => ({ ...i, tags: [] }))`. El proceso queda documentado y estandarizado.

### D7. Branch scoping — guard visual + filter en store

**Decision**: Entities branch-scoped (`Category`, `Subcategory` heredado, `Product` heredado, `BranchProduct`) requieren `selectedBranchId`. Patron:

1. Si `!selectedBranchId`, la pagina muestra un `<Card>` con "Selecciona una sucursal" + link al dashboard.
2. Si `selectedBranchId`, el store filtra por `branch_id` via `useShallow` selector y la pagina muestra la lista.
3. `openCreate` preseta `branch_id: selectedBranchId` en el formData inicial.

Entities tenant-scoped (`Allergen`, `IngredientGroup/Ingredient/SubIngredient`, `Recipe` si lo declaramos tenant-scoped) no tienen esta guard — se muestran siempre para el tenant activo.

**Clasificacion explicita**:

| Entity | Scope |
|--------|-------|
| Category | branch |
| Subcategory | branch (via parent Category) |
| Product | branch (via parent Subcategory) |
| BranchProduct | branch (explicito) |
| Allergen | tenant |
| IngredientGroup | tenant |
| Ingredient | tenant (via parent Group) |
| SubIngredient | tenant (via parent Ingredient) |
| Recipe | tenant |

### D8. Cascade preview: client-side calculation, server-side enforcement

**Decision**: El `cascadeService` calcula el preview en el frontend consultando los stores ya hidratados (`categoryStore.items.filter(c => c.x_id === deleteTarget.id)`). El preview se muestra en `<CascadePreviewList>` dentro del `<ConfirmDialog>`. El delete real lo hace el backend, que devuelve `affected: { Subcategory: 5, Product: 12 }` — el frontend NO toma esa respuesta como fuente de verdad, porque el usuario ya confirmo. El WS `CASCADE_DELETE` posterior actualiza los stores de las entidades hijas.

**Alternativa considerada**: Llamar `GET /api/admin/categories/{id}/preview` antes del delete. Rechazado — roundtrip innecesario, los datos ya estan en el store y son suficientemente frescos (TTL de polling / event-driven). Si el store esta outdated y el preview no matchea la realidad, el delete real del backend ejecuta segun su estado — el UI se sincroniza via CASCADE_DELETE.

**Trade-off**: el preview puede ser ligeramente inexacto si el store no se re-fetcheo recientemente. Aceptable — el cascade real lo ejecuta el backend, y el WS actualiza todo luego. El preview es UX, no contrato.

### D9. Componentes UI base nuevos: minimos y accesibles

**Decision**: Crear solo los componentes UI que las seis paginas necesitan directamente: `Modal`, `ConfirmDialog`, `Table`, `TableSkeleton`, `Pagination`, `Badge`, `Card`, `PageContainer`, `HelpButton`, `Input`, `Toggle`, `Select`, `ImagePreview`, `CascadePreviewList`, `ToastContainer`. No crear `Dropdown`, `Tooltip`, `Popover`, `DatePicker`, `RichText`, etc. — esos entran con changes posteriores si se necesitan.

**Accesibilidad obligatoria**:

- `aria-label` en todo boton icon-only (Pencil, Trash2).
- `aria-hidden="true"` en iconos decorativos.
- `<span className="sr-only">Estado:</span>` antes del texto visible en `<Badge>` para screen readers.
- Focus trap en `<Modal>` y `<ConfirmDialog>` (biblioteca: implementacion propia minima usando `useEffect` + `focus()` en el primer focusable + restore en unmount).
- `role="dialog"`, `aria-modal="true"` en modales.
- Tab order correcto (HelpButton → campos → botones Cancelar/Submit).
- Focus visible en `Table` rows si son clickeables.

**Alternativas consideradas**:

- *Radix UI*: cumple todo acc, pero pesada y estilizada de otra manera. Por coherencia con el resto del stack custom, los construimos nosotros.
- *shadcn/ui*: copia-pega-customiza. Viable en un change futuro si queremos acelerar; en este change mantenemos propio para no bloquear por discusion.

### D10. Validation: funciones puras en `utils/validation.ts`, retornan `{ isValid, errors }`

**Decision**: Una funcion `validateX(data: XFormData)` por entidad. Cero side effects, cero dependencias React. Se llama desde dentro del `submitAction` antes del network.

```typescript
export function validateCategory(data: CategoryFormData): ValidationResult<CategoryFormData> {
  const errors: ValidationErrors<CategoryFormData> = {}
  if (!data.name || data.name.trim().length === 0) errors.name = 'validation.required'
  if (data.name && data.name.length > 255) errors.name = 'validation.maxLength'
  if (!isNonNegativeNumber(data.order)) errors.order = 'validation.invalidNumber'
  return { isValid: Object.keys(errors).length === 0, errors }
}
```

**Key returned**: siempre una i18n key (`validation.required`, `validation.invalidPrice`, etc.) — el componente traduce con `t(state.errors.name)`. Esto evita tener mensajes en espanol hardcodeados en `validation.ts`.

**Helpers compartidos**: `isValidNumber`, `isPositiveNumber`, `isNonNegativeNumber`, `validateImageUrl` (aplica las mismas reglas anti-SSRF que el backend: solo `https`, reject IP privadas/loopback, reject puertos no estandar).

### D11. Toast store: global, auto-dismiss 4s, render en MainLayout

**Decision**: Store Zustand simple con `toasts: Toast[]`, acciones `add(toast)`, `dismiss(id)`, auto-dismiss 4s via `setTimeout` dentro de `add`. API publica `toast.success(msg)`, `toast.error(msg)`, `toast.info(msg)` (funciones, no hook — pueden llamarse desde cualquier `submitAction`).

**Render**: `<ToastContainer>` montado una vez en `MainLayout`, lee `useToastStore(selectToasts)`, renderiza fixed top-right, `role="status"` + `aria-live="polite"` para success/info, `role="alert"` + `aria-live="assertive"` para error.

**Alternativa**: libreria como `sonner` o `react-hot-toast`. Rechazada para mantener coherencia con el resto del stack custom y evitar dependencia extra.

### D12. Permissions: lectura inline via `useAuthPermissions()`

**Decision**: Un hook `useAuthPermissions()` que retorna `{ isAdmin, isManager, canCreate, canEdit, canDelete }` derivando de `authStore.user.role`. Las paginas consumen este hook para ocultar/deshabilitar botones segun rol. NO se duplica la logica de RBAC en cada pagina.

Logica:

- `canCreate = isAdmin || isManager`
- `canEdit = isAdmin || isManager`
- `canDelete = isAdmin` (MANAGER NO puede delete — backend retorna 403 de todas formas)

**Trade-off**: este hook es minimal y se puede extender con permisos mas finos cuando llegue `permission-service-frontend` en un change futuro.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Optimistic update + WS event duplica el item en el store | Dedup por `id` + por `tempId` pendiente. Tests cubren el caso de tempId->realId resolution y el caso de WS adelantandose al response HTTP. |
| Client-side cascade preview puede estar desactualizado | El backend ejecuta el delete real con su estado; el preview es UX. CASCADE_DELETE del WS sincroniza luego. Documentado en D8. |
| `MANAGER` intenta delete y el boton aparece oculto pero hace click via dev tools | El backend responde 403, el toast muestra error. Defense-in-depth: UI + backend. |
| i18n keys explodan (~120 nuevas) y se desordenan | Estructura clara bajo `menu.<entity>.<slot>`. Test `i18n.test.ts` (existente de C-14) bloquea keys huerfanas al construir. |
| El anti-SSRF de imagenes del frontend diverge del backend | Se reusa la misma lista de reglas (documentada en `menu-catalog` spec). Test unitario cubre los casos de la spec (reject http, private IP, loopback; accept https CDN). Si cambia el backend, se actualiza aca tambien. |
| `useFormModal` con genericos `<FormData, Entity>` puede complicar tipado | Refactor gradual — el tipo `FormData` es interno al hook y se provee al `openEdit` via mapper. Documentado con ejemplo en tests y en la skill. |
| Focus trap propio introduce bugs de accesibilidad | Tests con Testing Library verifican que `Tab` cicla dentro del modal. Si aparecen bugs, fallback: `inert` attribute en el resto del DOM (CSS + ARIA). |
| WS handler routea a stores que aun no estan hidratados | Cada store expone una accion `applyWSEvent(event)` idempotente. Si no esta hidratado, el fetch inicial re-hidrata desde backend (que ya tiene el cambio aplicado). |
| Branch scoping: si el usuario cambia de branch mientras tiene cambios sin guardar en el modal | Al detectar cambio de `selectedBranchId`, cerrar modales abiertos con confirm "Hay cambios sin guardar, ¿descartar?". Implementacion via `useEffect` watcher. |
| Bundle size crece con 6 paginas + 15 componentes UI | Todas las paginas lazy-loaded (`React.lazy`). El bundle principal solo crece por hooks, stores, types y los componentes UI compartidos. Medicion al cierre. |

## Migration Plan

No hay datos existentes que migrar — es frontend puro. La migracion es de codigo:

1. **Preparacion**: leer `.agents/SKILLS.md` y cargar `dashboard-crud-page`, `zustand-store-pattern`, `react19-form-pattern`, `ws-frontend-subscription`, `help-system-content`, `interface-design`, `tailwind-design-system`, `typescript-advanced-types`, `test-driven-development`, `vercel-react-best-practices`.
2. **Orden de implementacion**:
   - Types (`types/form.ts`), constants (extender), validation (`utils/validation.ts`), `helpContent.tsx`.
   - Hooks (`useFormModal`, `useConfirmDialog`, `usePagination`) + tests.
   - Componentes UI base + tests de accesibilidad.
   - `toastStore` + `ToastContainer`.
   - Service WS (`dashboardWS`) — cliente WS con ref pattern, `onFiltered`, reconnect, close codes 4001/4003/4029.
   - Cascade service.
   - Stores (6) en orden: `allergenStore` → `ingredientStore` → `categoryStore` → `subcategoryStore` → `productStore` → `recipeStore`. Cada uno con tests de CRUD+rollback+migrate.
   - Hook WS sync (`useMenuWebSocketSync`) + tests.
   - Extender `useAuthPermissions`.
   - Paginas (6) en orden: Allergens → IngredientGroups (incluye Ingredients y SubIngredients anidados en navegacion) → Categories → Subcategories → Products → Recipes. Cada una con tests.
   - Extender sidebar, router, i18n (`es.json`, `en.json`).
   - Montar `useMenuWebSocketSync` y `<ToastContainer>` en `MainLayout`.
   - Tests de integracion manual en dev: crear/editar/eliminar cada entidad, ver toast, ver CASCADE funcionando con dos tabs abiertas.
3. **Cierre**: `pnpm --filter dashboard lint && pnpm --filter dashboard typecheck && pnpm --filter dashboard test` verde.

**Rollback**: revert del commit. Los archivos nuevos desaparecen; los extendidos vuelven al estado C-14. Ningun otro change depende de este hasta que se intente implementar C-16.

## Open Questions

- **¿Donde vive `selectedBranchId` exactamente?** C-14 no entrego `branchStore`. Para no bloquear, este change declara un `Dashboard/src/stores/branchStore.ts` **minimo** con `selectedBranchId: string | null`, poblado desde `authStore.user.default_branch_id` al login, con setter para cambiar branch. C-16 probablemente lo expandira (listado de branches, fetch, cambio por dropdown). Decidido en este change para desbloquear.
- **¿Recipes es tenant-scoped o branch-scoped?** El backend expone `/api/recipes` sin parametro de branch — se asume tenant-scoped. Si resulta que alguna receta varia por branch (improbable en este modelo), se trata en un change futuro de recipes.
- **¿Que pasa si el usuario pierde conexion WS mientras edita?** El hook `useMenuWebSocketSync` ignora eventos de branches distintas al `selectedBranchId` actual. En reconnect, `dashboardWS` dispara catch-up (implementado en C-14 scaffold del WS client). El resultado: tras reconnect, los stores se sincronizan via replay de eventos perdidos.
- **¿Feature flag para activar/desactivar optimistic updates?** No. El optimistic update es parte del patron, no configurable. Si falla, el rollback lo resuelve.
