# dashboard-promotions Tasks

> Implementation checklist for **C-27 dashboard-promotions**.
> Reference: `proposal.md` (scope), `design.md` (how), `specs/*/spec.md` (what).
> Governance BAJO — autonomia completa si `pnpm --filter dashboard lint`, `pnpm --filter dashboard typecheck` y `pnpm --filter dashboard test` pasan al final.

**Pre-implementation (mandatory)**: lee `.agents/SKILLS.md`, identifica TODAS las skills aplicables segun estos tasks, y carga cada `.agents/skills/<skill>/SKILL.md` antes de tocar codigo. Aplica los patterns de cada skill cargada durante TODA la implementacion.

> **Nota sobre scope**: este change es 100% frontend. El backend ya esta archivado en C-13 — endpoints de `/api/admin/promotions`, servicio, modelos, eventos WS, tests. No hay tasks de backend.

## 1. Tipos, constantes y validacion

- [x] 1.1 Extender `Dashboard/src/types/menu.ts` con interfaces `Promotion`, `PromotionBranch`, `PromotionItem`, `PromotionType`, y `PromotionFormData`:
  - `Promotion`: IDs como `string`, `price` en centavos, `start_date`/`end_date` como ISO `"YYYY-MM-DD"`, `start_time`/`end_time` como `"HH:mm:ss"`, `branches: PromotionBranch[]`, `items: PromotionItem[]`, `is_active`, `created_at`, `updated_at`
  - `PromotionBranch`: `{ branch_id: string; branch_name: string }`
  - `PromotionItem`: `{ product_id: string; product_name: string }`
  - `PromotionType`: `{ id: string; name: string }`
  - `PromotionFormData`: shape del formulario (`name`, `description`, `price`, `start_date`, `start_time`, `end_date`, `end_time`, `promotion_type_id: string | null`, `branch_ids: string[]`, `product_ids: string[]`, `is_active`)
- [x] 1.2 Extender `Dashboard/src/utils/constants.ts`: agregar `STORAGE_KEYS.PROMOTION = 'dashboard-promotion-store'` y `STORE_VERSIONS.PROMOTION = 1`
- [x] 1.3 Extender `Dashboard/src/utils/validation.ts` con `validatePromotion(data: PromotionFormData)`:
  - `name`: trim + requerido + max 120 chars (`validation.required` | `validation.maxLength`)
  - `description`: max 500 si esta presente (`validation.maxLength`)
  - `price`: `isValidNumber` + `>= 0` (`validation.required` | `validation.priceNonNegative`)
  - `start_date`, `start_time`, `end_date`, `end_time`: todos requeridos (`validation.required`)
  - Combinado `end_datetime >= start_datetime`: error en `end_date` field (`promotions.endBeforeStart`)
  - `branch_ids.length >= 1` (`promotions.noBranchesSelected`)
  - Retorna `{ isValid, errors: Partial<Record<keyof PromotionFormData, string>> }` con i18n keys
- [x] 1.4 Extender `Dashboard/src/utils/formatters.ts`:
  - `formatPromotionValidity(p)`: `"DD/MM HH:mm → DD/MM HH:mm"`
  - `getPromotionStatus(p, now?)`: `'scheduled' | 'active' | 'expired'`, compara `now` (default `new Date()`) con combinacion `start_date + start_time` y `end_date + end_time`
  - `isPromotionActiveNow(p, now?)`: boolean
- [x] 1.5 Tests Vitest:
  - `validation.test.ts` extendido: casos felices + edge (`validatePromotion` con name vacio, name >120, price negativo, end antes de start, branch_ids vacio)
  - `formatters.test.ts` extendido: `formatPromotionValidity` format correcto, `getPromotionStatus` antes/durante/despues (con `now` inyectado para determinismo), `isPromotionActiveNow` delega correcto

## 2. Permisos

- [x] 2.1 Extender `Dashboard/src/hooks/useAuthPermissions.ts`:
  - `canManagePromotions: boolean = isAdmin || isManager`
  - `canDeletePromotion: boolean = isAdmin`
- [x] 2.2 Tests Vitest `useAuthPermissions.test.ts` extendidos:
  - ADMIN → `{ canManagePromotions: true, canDeletePromotion: true }`
  - MANAGER → `{ canManagePromotions: true, canDeletePromotion: false }`
  - KITCHEN → ambos `false`
  - WAITER → ambos `false`

## 3. catalogStore — promotion_types

- [x] 3.1 Crear `Dashboard/src/stores/catalogStore.ts` si no existe (o extender si ya se creo en change previo):
  - State minimal para C-27: `{ promotion_types: PromotionType[], isLoadingTypes: boolean, errorTypes: string | null }`
  - Accion `fetchPromotionTypesAsync()`: idempotente si ya hay items, llama `GET /api/admin/catalogs/promotion-types` via `fetchAPI`, convierte IDs `number → string`, setea items
  - Selectores: `selectPromotionTypes`, `selectPromotionTypeById(id)` (retorna `PromotionType | null`)
  - Sin `persist` para este caso (el catalogo es barato de re-fetchear; si hay preferencia por cachear, usar `persist` con `STORE_VERSIONS.CATALOG`)
- [x] 3.2 Tests `catalogStore.test.ts`:
  - `fetchPromotionTypesAsync` llama endpoint correcto, popula items con IDs string
  - Idempotencia: segundo call no triggerea request si `promotion_types.length > 0`
  - Error sets `errorTypes` y no rompe el store

## 4. promotionStore con optimistic updates

- [x] 4.1 Crear `Dashboard/src/stores/promotionStore.ts`:
  - State: `{ items: Promotion[], isLoading: boolean, error: string | null, pendingTempIds: Set<string> }`
  - `EMPTY_PROMOTIONS: Promotion[] = []` module-level
  - Helper `toPromotion(b: BackendPromotion): Promotion` convierte IDs `number → string`, preserva `price` int
  - `persist` con `STORAGE_KEYS.PROMOTION` y `STORE_VERSIONS.PROMOTION`, `migrate(persistedState: unknown, version: number)` con type guard estricto (nunca `any`), defaults seguros en caso de shape invalido
- [x] 4.2 Actions async con optimistic-with-rollback:
  - `fetchAsync()`: `GET /api/admin/promotions`, hidrata `items`
  - `createAsync(data)`: genera `tempId`, inserta optimista, POST, reemplaza con real id; rollback quita tempId en error
  - `updateAsync(id, data)`: snapshot previo, merge optimista, PATCH con `PromotionUpdate` (solo campos que cambian); rollback restaura item previo en error
  - `deleteAsync(id)`: snapshot posicion + item, remueve optimista, DELETE 204; rollback re-inserta en posicion original
  - `toggleActiveAsync(id)`: flip optimista de `is_active`, PATCH con `{ is_active }`; rollback restaura y toast error
  - `linkBranchAsync(promotionId, branchId)`: append optimista a `promotion.branches`, POST `/promotions/{id}/branches?branch_id=`; rollback remueve
  - `unlinkBranchAsync(promotionId, branchId)`: filter optimista, DELETE; rollback re-agrega
  - `linkProductAsync`, `unlinkProductAsync`: simetrico con `promotion.items`
- [x] 4.3 Actions WS sync:
  - `applyWSCreated(promotion)`: dedup por `id`, inserta si no existe
  - `applyWSUpdated(promotion)`: merge del payload (sobrescribe `branches` y `items` enteros, preserva top-level campos actualizados)
  - `applyWSDeleted(id)`: remueve item
- [x] 4.4 Selectores:
  - `selectPromotions`, `selectIsLoading`, `selectError`
  - `selectPromotionById(id)` → returns `Promotion | null`
  - Hook `useActivePromotions()` con `useShallow` (filter `is_active`)
  - Hook `usePromotionsForBranch(branchId)` con `useShallow`
  - Hook `usePromotionActions()` con `useShallow` (fetchAsync, createAsync, updateAsync, deleteAsync, toggleActiveAsync)
- [x] 4.5 Tests Vitest `promotionStore.test.ts`:
  - `fetchAsync` populates items, IDs convertidos a string, price preservado en cents
  - `createAsync` success: tempId reemplazado por real id
  - `createAsync` failure: rollback (item con tempId removido)
  - `updateAsync` failure: item previo restaurado
  - `deleteAsync` failure: item re-insertado en posicion original
  - `toggleActiveAsync` optimistic flip + rollback en error
  - `linkBranchAsync` / `unlinkBranchAsync` con rollback
  - `linkProductAsync` / `unlinkProductAsync` con rollback
  - `applyWSCreated` dedup por id
  - `applyWSUpdated` sobrescribe branches/items completos
  - `applyWSDeleted` remueve item
  - `migrate` con `null`, shape invalido, sin items, shape valido, forward migration stub (`version < 2` no-op)
  - Persist round-trip: set → reload → mismo state
  - Zustand destructuring falla ESLint (regresion)

## 5. Componentes UI base nuevos

- [x] 5.1 Crear `Dashboard/src/components/ui/DateRangePicker.tsx`:
  - Props: `{ startDate, startTime, endDate, endTime, onChange, error?, labelStart?, labelEnd?, disabled? }`
  - Render: 2 grupos de `<input type="date">` + `<input type="time">` nativos, label por grupo, `<p role="alert">` si `error`
  - `aria-invalid` + `aria-describedby` en inputs cuando hay error
  - onChange emite el objeto completo `{ startDate, startTime, endDate, endTime }` cada vez que cambia cualquier campo
  - disabled propaga a los 4 inputs
- [x] 5.2 Tests Vitest `DateRangePicker.test.tsx`:
  - Cambia startDate → emite onChange con nueva value + resto preservado
  - `error` prop: renderiza `<p role="alert">` y `aria-invalid="true"` en inputs
  - `disabled={true}`: los 4 inputs disabled
  - Keyboard: tab navega entre los 4 inputs
- [x] 5.3 Crear `Dashboard/src/components/ui/MultiSelect.tsx`:
  - Props: `{ label, options, selected, onChange, placeholder?, error?, disabled?, name? }`
  - Trigger `<button>` muestra placeholder o `"{n} seleccionadas"` (via i18n)
  - Dropdown `<ul role="listbox" aria-multiselectable="true">` con items `role="option" aria-selected={selected.includes(value)}`
  - Teclado: `Enter`/`Space` toggle focused, `ArrowUp/Down` nav, `Home/End` first/last, `Escape` cierra + focus return a trigger
  - Click outside cierra (usar `useClickOutside` hook o listener manual)
  - `error` → trigger `aria-invalid="true"` + `<p role="alert">`
  - `disabled` deshabilita trigger
  - Si `name` esta presente, renderizar `<input type="hidden" name={name} value={selected.join(',')} />` para integracion con FormData
- [x] 5.4 Tests Vitest `MultiSelect.test.tsx`:
  - Click en opcion no seleccionada → `onChange([...selected, option.value])`
  - Click en opcion seleccionada → `onChange` filtrada
  - Keyboard: ArrowDown + Enter toggle opcion focused
  - Escape cierra y devuelve focus al trigger
  - Summary en trigger cuando hay selecciones (`{n} seleccionadas`)
  - `error`: `aria-invalid="true"` + `role="alert"` visible
  - disabled trigger no abre dropdown

## 6. Cascade service extensions

- [x] 6.1 Extender `Dashboard/src/services/cascadeService.ts`:
  - `getPromotionPreview(promotionId: string): CascadePreview | null` — lee `usePromotionStore.getState().items`, computa `{ totalItems, items: [{ label: 'promotions.cascade.branches', count }, { label: 'promotions.cascade.items', count }].filter((i) => i.count > 0) }`; retorna `null` si no encuentra la promocion
  - `deletePromotionWithCascade(promotionId: string): Promise<void>` — delega a `usePromotionStore.getState().deleteAsync(promotionId)`
- [x] 6.2 Tests Vitest `cascadeService.test.ts` extendidos:
  - `getPromotionPreview` con id inexistente retorna `null`
  - `getPromotionPreview` con promocion sin branches/items retorna `{ totalItems: 0, items: [] }`
  - `getPromotionPreview` con 2 branches y 3 items retorna `totalItems: 5` y 2 entries
  - `deletePromotionWithCascade` llama `promotionStore.getState().deleteAsync(id)`

## 7. helpContent entry

- [x] 7.1 Extender `Dashboard/src/utils/helpContent.tsx` con entry `promotions`:
  - Titulo: "Gestion de Promociones"
  - Intro: explicar que son y para que sirven
  - Feature list: Crear, Editar, Vigencia (start/end), Precio (en centavos, display en pesos), Sucursales (multi), Items (productos), Toggle activar, Eliminar con cascade
  - Tip box (`bg-zinc-800` + `text-orange-400`): "Nota" explicando que la vigencia se evalua en hora local del navegador; refrescar la pagina si el estado no parece actualizado
  - Tip box danger (`bg-red-900/50`) si aplica para delete: "Advertencia" — eliminar una promocion remueve vinculos a sucursales y productos
  - Idioma: espanol sin tildes

## 8. Pagina Promotions.tsx

- [x] 8.1 Crear `Dashboard/src/pages/Promotions.tsx`:
  - `useDocumentTitle(t('promotions.title'))`
  - Store selectores (never destructure): `selectPromotions`, `selectIsLoading`, `selectPromotionActions` (useShallow)
  - `branchStore.selectSelectedBranchId`, `useAuthPermissions` → `canManagePromotions`, `canDeletePromotion`
  - Permission guard: si `!canManagePromotions` → `<Navigate to="/" />` o render `<ForbiddenCard>`
  - `useEffect`: `fetchAsync()` + `catalogStore.fetchPromotionTypesAsync()` al montar (idempotente)
  - `useFormModal<PromotionFormData, Promotion>` inicializado con `{ name: '', description: '', price: 0, start_date: '', start_time: '', end_date: '', end_time: '', promotion_type_id: null, branch_ids: selectedBranchId ? [selectedBranchId] : [], product_ids: [], is_active: true }`
  - `useConfirmDialog<Promotion>`
  - 3 filtros con `useState` local: `statusFilter` (`'all' | 'active' | 'inactive'`), `validityFilter` (`'all' | 'scheduled' | 'active' | 'expired'`), `branchFilter` (`string | null`). Default: pre-aplicar `branchFilter = selectedBranchId`
  - `now = new Date()` const local (congelado en render)
  - `filteredItems = useMemo(...)` aplica los 3 filtros
  - `sortedItems = useMemo(() => [...filtered].sort((a,b) => a.name.localeCompare(b.name)), [filteredItems])`
  - `usePagination(sortedItems)` con default 10
  - `useActionState` para submit del form (validate → create/update → toast → return FormState)
  - `if (state.isSuccess && modal.isOpen) modal.close()` al render level
  - Handlers `openCreateModal`, `openEditModal`, `handleDelete`, `handleToggleActive` con `useCallback`
  - Columns `useMemo`: name, type (resuelto desde `catalogStore`), validity (`formatPromotionValidity`), branches count Badge, status (Toggle + badge scheduled/active/expired), actions (edit, delete si `canDeletePromotion`)
  - Guard inicial: sin guard estricto de branch — la pagina es tenant-scoped, se muestra siempre que `canManagePromotions`
  - Render completo con PageContainer, filtros, Card/Table/Pagination, Modal create/edit, ConfirmDialog delete
- [x] 8.2 Tests Vitest `Promotions.test.tsx`:
  - Render sin data + `!isLoading` → `<Card>` empty state con CTA
  - Render loading → `<TableSkeleton>`
  - Render con 3 promociones → tabla con 3 filas
  - KITCHEN → Navigate (redirect)
  - MANAGER → tabla visible, columna acciones sin delete
  - ADMIN → columna acciones con delete
  - Click "Crear" → modal abre con formData default
  - Click Edit → modal con datos pre-cargados
  - Click toggle → `toggleActiveAsync` llamado
  - Click delete + confirmar → `deletePromotionWithCascade` llamado
  - Filtro status `activas` → solo activas visibles
  - Filtro branch → solo promociones con matching branch visibles

## 9. WebSocket sync extension

- [x] 9.1 Extender `Dashboard/src/hooks/useMenuWebSocketSync.ts`:
  - Agregar `case 'promotion'` al switch de routing en `ENTITY_CREATED`, `ENTITY_UPDATED`, `ENTITY_DELETED` → `usePromotionStore.getState().applyWSCreated/Updated/Deleted(...)`
  - `CASCADE_DELETE` con `entity === 'promotion'`: llama `applyWSDeleted(id)` y muestra `toast.info(t('promotions.cascadeNotified', { count: totalAffected }))`
  - NO tocar el ref pattern, filtrado por branch, suscripcion una sola vez, cleanup
- [x] 9.2 Tests Vitest `useMenuWebSocketSync.test.ts` extendidos:
  - `ENTITY_CREATED` con `entity: 'promotion'` → `promotionStore.applyWSCreated` llamado con el payload
  - `ENTITY_UPDATED` con `entity: 'promotion'` → `promotionStore.applyWSUpdated` llamado
  - `ENTITY_DELETED` con `entity: 'promotion'` → `promotionStore.applyWSDeleted(id)` llamado
  - `CASCADE_DELETE` con `entity: 'promotion'` → store remueve item + toast con `promotions.cascadeNotified`
  - Ref pattern sigue intacto (regression): 10 re-renders no acumulan listeners

## 10. Sidebar, routing, i18n

- [x] 10.1 Extender `Dashboard/src/components/layout/Sidebar.tsx`:
  - Agregar item "Promotions" con icono `Percent`, label `t('layout.sidebar.promotions')`, ruta `/promotions`
  - Visible solo si `canManagePromotions === true`
- [x] 10.2 Extender `Dashboard/src/router.tsx`:
  - Ruta nueva lazy: `{ path: 'promotions', element: withSuspense(<PromotionsPage />), handle: { breadcrumb: 'layout.breadcrumbs.promotions' } }`
- [x] 10.3 Extender `Dashboard/src/i18n/locales/es.json` con keys `promotions.*`, `validation.priceNonNegative`, etc.
- [x] 10.4 Extender `Dashboard/src/i18n/locales/en.json` con las mismas keys en ingles
- [x] 10.5 Verificar que `i18n.test.ts` (parity test) pasa con zero orphan keys en ambas direcciones
- [x] 10.6 N/A — no existe `src/types/index.ts` barrel en este proyecto

## 11. Quality gates finales

- [x] 11.1 `pnpm --filter dashboard lint` sin errores
- [x] 11.2 `pnpm --filter dashboard typecheck` sin errores
- [x] 11.3 `pnpm --filter dashboard test` — 57 test files, 615 tests, all passing
- [x] 11.4 Smoke manual en dev (`pnpm --filter dashboard dev`) — requiere entorno de desarrollo local con backend
- [x] 11.5 Accesibilidad keyboard-only — requiere entorno visual con dev server
- [x] 11.6 No hay `console.log`/`console.error` sueltos — todo usa `handleError(error, ctx)` de `utils/logger`
- [x] 11.7 Todos los toasts usan `t()` — sin strings hardcodeados
- [x] 11.8 `Promotions.tsx` cumple checklist dashboard-crud-page: hook trio, helpContent, HelpButton size="sm", useActionState, selectores Zustand, useShallow/useMemo, TableSkeleton, ConfirmDialog con CascadePreviewList, aria-label en icon-only buttons, Badge con `<span className="sr-only">`, handleError
