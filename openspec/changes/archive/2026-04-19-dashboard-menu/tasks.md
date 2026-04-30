# dashboard-menu Tasks

> Implementation checklist for **C-15 dashboard-menu**.
> Reference: `proposal.md` (scope), `design.md` (how), `specs/*/spec.md` (what).
> Governance BAJO — autonomia completa si `pnpm --filter dashboard lint`, `pnpm --filter dashboard typecheck`, `pnpm --filter dashboard test` pasan al final.

**Pre-implementation (mandatory)**: lee `.agents/SKILLS.md`, identifica TODAS las skills aplicables segun estos tasks, y carga cada `.agents/skills/<skill>/SKILL.md` antes de tocar codigo. Aplica los patterns de cada skill cargada durante TODA la implementacion.

> **Nota sobre scope**: este change es 100% frontend. No hay tasks de modelos/migraciones/servicios/routers backend — todas esas capabilities ya estan archivadas (C-04 menu-catalog, C-05 allergens, C-06 ingredients). El orden "models → migrations → services → routers → stores → components → tests" se aplica aca saltando los pasos backend; los tasks arrancan desde la capa de tipos y utils compartidos del frontend.

## 1. Tipos, constantes y validacion

- [x] 1.1 Crear `Dashboard/src/types/form.ts` con `FormState<T>` (`{ errors?, message?, isSuccess? }`) y `ValidationErrors<T>` (`Partial<Record<keyof T, string>>`) + export barrel
- [x] 1.2 Crear `Dashboard/src/types/menu.ts` con interfaces `Category`, `Subcategory`, `Product`, `BranchProduct`, `Allergen`, `ProductAllergen`, `AllergenCrossReaction`, `IngredientGroup`, `Ingredient`, `SubIngredient`, `Recipe` y sus respectivos `<Entity>FormData` (IDs como `string`, `price_cents` como `number` en centavos)
- [x] 1.3 Extender `Dashboard/src/utils/constants.ts` agregando `STORE_VERSIONS` (`CATEGORY: 1, SUBCATEGORY: 1, PRODUCT: 1, ALLERGEN: 1, INGREDIENT: 1, RECIPE: 1`) y `STORAGE_KEYS.{CATEGORY, SUBCATEGORY, PRODUCT, ALLERGEN, INGREDIENT, RECIPE, SELECTED_BRANCH}`
- [x] 1.4 Crear `Dashboard/src/utils/validation.ts` con helpers (`isValidNumber`, `isPositiveNumber`, `isNonNegativeNumber`, `validateImageUrl` anti-SSRF) y validadores por entidad (`validateCategory`, `validateSubcategory`, `validateProduct`, `validateAllergen`, `validateIngredientGroup`, `validateIngredient`, `validateSubIngredient`, `validateRecipe`) — todos retornan `{ isValid, errors }` con errores como i18n keys
- [x] 1.5 Crear `Dashboard/src/utils/formatters.ts` con `formatPrice(cents: number)` (convierte centavos a `$125.50`), `parseImageUrl(url)`, conversion de IDs `number ↔ string`
- [x] 1.6 Tests Vitest para `validation.test.ts` — happy path, required fields, longitudes, numeros negativos, imagen HTTP/IP privada/loopback, imagen HTTPS valida; para `formatters.test.ts` — centavos a peso formateado, boundary casos (0, decimales, grandes)

## 2. Hooks base reutilizables

- [x] 2.1 Crear `Dashboard/src/hooks/useFormModal.ts` con generics `<FormData, Entity>`, expone `{ isOpen, selectedItem, formData, setFormData, openCreate, openEdit, close }`; `openEdit(item, mapper)` aplica `mapper(item)` al formData
- [x] 2.2 Crear `Dashboard/src/hooks/useConfirmDialog.ts` con `<Entity>`, expone `{ isOpen, item, open, close }`
- [x] 2.3 Crear `Dashboard/src/hooks/usePagination.ts` con `<T>`, client-side: expone `{ paginatedItems, currentPage, totalPages, totalItems, itemsPerPage, setCurrentPage }`; default `itemsPerPage = 10`
- [x] 2.4 Crear `Dashboard/src/hooks/useAuthPermissions.ts` derivando `{ isAdmin, isManager, canCreate, canEdit, canDelete }` desde `authStore.user.role`
- [x] 2.5 Agregar ESLint rule `no-restricted-syntax` custom que bloquea `useState` cuando el nombre de la variable matchea `isOpen|selectedItem|formData|isDialogOpen|currentPage` dentro de archivos bajo `Dashboard/src/pages/`
- [x] 2.6 Tests Vitest: `useFormModal.test.ts` (openCreate con defaults; openEdit con mapper; close resetea; setFormData actualiza), `useConfirmDialog.test.ts` (open/close preserva/limpia item), `usePagination.test.tsx` (125 items → 13 paginas, setCurrentPage mueve ventana, items cambian recalcula totalPages)

## 3. Componentes UI base accesibles

- [x] 3.1 Crear `Dashboard/src/components/ui/Card.tsx`, `Badge.tsx` (con `<span className="sr-only">Estado:</span>` antes del texto, variantes success/danger/warning/info), `Button.tsx` (si no existia de C-14, con `isLoading` prop)
- [x] 3.2 Crear `Dashboard/src/components/ui/Input.tsx`, `Toggle.tsx`, `Select.tsx`, `ImagePreview.tsx` — todos con label, error prop, `aria-invalid`, `aria-describedby` cuando hay error
- [x] 3.3 Crear `Dashboard/src/components/ui/Modal.tsx` con `role="dialog"`, `aria-modal="true"`, focus trap (useEffect + first focusable + restore on close), escape para cerrar, backdrop click configurable
- [x] 3.4 Crear `Dashboard/src/components/ui/ConfirmDialog.tsx` (usa Modal internamente) con confirmLabel, cancelLabel, variante `danger` para deletes, soporta `children` para renderizar `<CascadePreviewList>` inline
- [x] 3.5 Crear `Dashboard/src/components/ui/Table.tsx` (`columns: TableColumn<T>[]`, sort opcional, rowKey por id), `TableSkeleton.tsx` (10 filas placeholder), `Pagination.tsx` (con `<` / `>` buttons, `aria-label`, current page indicator)
- [x] 3.6 Crear `Dashboard/src/components/ui/HelpButton.tsx` (trigger `?` icon, abre popover o modal con title + content), `PageContainer.tsx` (requiere `helpContent: ReactNode`, renderiza header con titulo + help trigger + actions slot)
- [x] 3.7 Crear `Dashboard/src/components/ui/CascadePreviewList.tsx` (recibe `{ totalItems, items: [{ label, count }] }`, renderiza lista traducida con icon warning)
- [x] 3.8 Tests Vitest: Modal (focus trap, escape cierra, backdrop cierra, ARIA correctos), ConfirmDialog (confirm llama callback, cancel cierra), Table (render con columnas, empty state), HelpButton (click abre/cierra), Badge (sr-only presente)

## 4. WebSocket service, toast store y cascade service

- [x] 4.1 Crear `Dashboard/src/services/websocket.ts` exportando singleton `dashboardWS`: metodos `connect(token)`, `disconnect()`, `on`, `onFiltered`, `onFilteredMultiple`, `onThrottled`, `onFilteredThrottled`, `onConnectionChange`, `onMaxReconnect`, `setTokenRefreshCallback`; heartbeat 30s + pong timeout 10s; reconnect exponencial; NO reconnect en close codes 4001/4003/4029; catch-up via `GET /ws/catchup` en reconnect exitoso
- [x] 4.2 Crear `Dashboard/src/stores/toastStore.ts` con state `{ toasts: Toast[] }`, accion `add(toast)` (genera id, set timeout 4000ms), `dismiss(id)`; API publica `toast.success(msg)`, `toast.error(msg)`, `toast.info(msg)` como funciones module-level (no hook); selector `selectToasts`
- [x] 4.3 Crear `Dashboard/src/components/ui/ToastContainer.tsx` que consume `toastStore`, renderiza fixed top-right, cada toast con `role="status"`/`aria-live="polite"` (success/info) o `role="alert"`/`aria-live="assertive"` (error); animacion de entrada/salida
- [x] 4.4 Crear `Dashboard/src/services/cascadeService.ts` con `getCategoryPreview(id)`, `getSubcategoryPreview(id)`, `getIngredientGroupPreview(id)`, `getAllergenPreview(id)` consultando los stores ya hidratados; y wrappers `deleteCategoryWithCascade`, `deleteSubcategoryWithCascade`, `deleteIngredientGroupWithCascade`, `deleteAllergenWithCascade` que llaman a `store.deleteAsync(id)`
- [x] 4.5 Tests Vitest: `websocket.test.ts` (connect emite `onConnectionChange(true)`, `on('X', cb)` invoca cb en evento tipo X, `onFiltered` filtra por branch_id, close 4001 no reconecta, reconnect dispara catch-up), `toastStore.test.ts` (add auto-dismiss 4s, dismiss manual, multiples toasts concurrentes), `cascadeService.test.ts` (preview calcula counts correctos desde stores mockeados, delete wrapper llama deleteAsync)

## 5. branchStore minimal y extension de authStore

- [x] 5.1 Crear `Dashboard/src/stores/branchStore.ts` con state `{ selectedBranchId: string | null }`, accion `setSelectedBranchId`, `persist()` con `STORAGE_KEYS.SELECTED_BRANCH` y `STORE_VERSIONS` (no version especifica — se inserta version 1 inline con comentario); selector `selectSelectedBranchId`; hook de inicializacion desde `authStore.user.default_branch_id` (convirtiendo number→string) cuando `!selectedBranchId`
- [x] 5.2 Extender `authStore.logout()` para limpiar `branchStore.setSelectedBranchId(null)` tras el reset de auth
- [x] 5.3 Tests Vitest: `branchStore.test.ts` (persist round-trip, inicializacion desde authStore, logout limpia), extension de `authStore.test.ts` (logout tambien limpia branchStore)

## 6. Seis stores del menu con optimistic updates

- [x] 6.1 Crear `Dashboard/src/stores/allergenStore.ts` (tenant-scoped): state `{ items, crossReactions, isLoading, error, pendingTempIds }`, acciones `fetchAsync`, `createAsync`, `updateAsync`, `deleteAsync`, `linkCrossReactionAsync`, `unlinkCrossReactionAsync`, `applyWSCreated`, `applyWSUpdated`, `applyWSDeleted`, dedup por id + tempId; selectores `selectAllergens`, `selectIsLoading`, `selectError`, `selectAllergenById`; persist + migrate con type guard
- [x] 6.2 Crear `Dashboard/src/stores/ingredientStore.ts` (tenant-scoped, jerarquia `IngredientGroup → Ingredient → SubIngredient`): state `{ groups, ingredients, subIngredients, isLoading, error, pendingTempIds }`, acciones para cada nivel (`fetchGroupsAsync`, `createGroupAsync`, `createIngredientAsync`, `createSubIngredientAsync`, equivalents update/delete), `applyWS*` que routea por `entity` field; selectores `selectGroups`, `selectIngredientsByGroup(groupId)`, `selectSubIngredientsByIngredient(ingredientId)`; persist + migrate
- [x] 6.3 Crear `Dashboard/src/stores/categoryStore.ts` (branch-scoped): state `{ items, isLoading, error, pendingTempIds }`, acciones CRUD + `applyWS*`, selectores `selectCategories`, `selectCategoriesByBranch(branchId)` con `useShallow`; optimistic pattern documentado con test
- [x] 6.4 Crear `Dashboard/src/stores/subcategoryStore.ts` (branch-scoped via parent category): similar a categoryStore, selectores `selectSubcategoriesByCategory(categoryId)` con `useShallow`
- [x] 6.5 Crear `Dashboard/src/stores/productStore.ts` (branch-scoped via parent subcategory): state incluye `branchProducts: BranchProduct[]` y `productAllergens: ProductAllergen[]`, acciones CRUD de product + `upsertBranchProductAsync`, `toggleAvailabilityAsync`, `linkAllergenToProductAsync`, `unlinkAllergenFromProductAsync`; selectores `selectProducts`, `selectProductsBySubcategory(id)` con `useShallow`, `selectBranchProductsByProduct(id)`, `selectAllergensForProduct(id)`
- [x] 6.6 Crear `Dashboard/src/stores/recipeStore.ts` (tenant-scoped): state `{ items, isLoading, error, pendingTempIds }`, acciones CRUD + `applyWS*`, selectores `selectRecipes`, `selectRecipeByProduct(productId)`
- [x] 6.7 Tests Vitest — uno por store (`allergenStore.test.ts`, `ingredientStore.test.ts`, `categoryStore.test.ts`, `subcategoryStore.test.ts`, `productStore.test.ts`, `recipeStore.test.ts`): (a) fetch happy path + error; (b) create optimistic + tempId → real id; (c) create failure → rollback; (d) update optimistic + rollback; (e) delete optimistic + rollback; (f) migrate con persistedState=null devuelve defaults; (g) migrate con shape invalido devuelve defaults; (h) migrate con shape valido preserva items; (i) applyWSCreated dedupea por id pendiente; (j) applyWSDeleted remueve item; (k) applyWSUpdated mergea; (l) selectores no destructurados retornan misma referencia si no hubo cambio

## 7. Hook useMenuWebSocketSync con ref pattern

- [x] 7.1 Crear `Dashboard/src/hooks/useMenuWebSocketSync.ts`: usa el ref pattern estricto (dos useEffect — uno para sync `handlerRef.current = handler` sin deps, otro para subscribe con `[selectedBranchId]`); invoca `dashboardWS.onFiltered(selectedBranchId, '*', e => handlerRef.current(e))`; retorna su cleanup del subscribe
- [x] 7.2 Implementar el handler: switch sobre `event.type` (`ENTITY_CREATED`, `ENTITY_UPDATED`, `ENTITY_DELETED`, `CASCADE_DELETE`) y despacha al store correspondiente segun `event.entity` ("category"/"subcategory"/"product"/"branch_product"/"allergen"/"ingredient_group"/"ingredient"/"sub_ingredient"/"recipe"); `CASCADE_DELETE` remueve parent + child stores y dispara `toast.info(t('menu.cascadeNotified', { count }))`
- [x] 7.3 Tests Vitest `useMenuWebSocketSync.test.tsx`: (a) ref pattern — render 10 veces solo una subscripcion; (b) branch change limpia subscripcion previa y crea nueva; (c) ENTITY_CREATED invoca `applyWSCreated` correcto segun entity; (d) ENTITY_UPDATED invoca applyWSUpdated; (e) ENTITY_DELETED invoca applyWSDeleted; (f) CASCADE_DELETE remueve items de multiples stores y dispara toast; (g) eventos con branch_id distinto son filtrados por `onFiltered`; (h) unmount dispara unsubscribe

## 8. helpContent registry y i18n extendido

- [x] 8.1 Crear `Dashboard/src/utils/helpContent.tsx` con entries `categories`, `subcategories`, `products`, `allergens`, `ingredients`, `recipes` — cada uno un `ReactNode` con titulo + lista explicativa de acciones + referencia a reglas de negocio (ej.: "MANAGER no puede eliminar")
- [x] 8.2 Extender `Dashboard/public/locales/es.json` con `menu.<entity>.*` keys para las seis entidades (title, description, empty, create/edit/delete labels, createSuccess/updateSuccess/deleteSuccess, field labels, confirmDeleteMessage), `menu.cascadeNotified` con interpolation `{{count}}`, `menu.cascadePreview.*`, `menu.websocketEvent.*`, `layout.sidebar.menu.*`, `layout.breadcrumb.menu.*`, `validation.{invalidPrice, invalidImageUrl, invalidNumber, invalidSeverity, invalidPresenceType, invalidRiskLevel, duplicateName, selfReference}`
- [x] 8.3 Extender `Dashboard/public/locales/en.json` como espejo exacto de `es.json` con todas las keys nuevas traducidas al ingles
- [x] 8.4 Correr el test de paridad `i18n.test.ts` (existente de C-14) y ajustar hasta que pase con cero keys huerfanas en cualquier direccion

## 9. Router, sidebar y MainLayout extendidos

- [x] 9.1 Extender `Dashboard/src/router.tsx` agregando seis rutas nuevas bajo el arbol protegido de `MainLayout`: `/categories`, `/subcategories`, `/products`, `/allergens`, `/ingredients`, `/recipes` — todas con `React.lazy(() => import('./pages/<Page>'))` y `handle: { breadcrumb: 'layout.breadcrumb.menu.<page>' }`
- [x] 9.2 Extender `Dashboard/src/components/layout/Sidebar.tsx` agregando seccion "Menu" con items (icono lucide-react + label `t('layout.sidebar.menu.<key>')` + NavLink a ruta) para los seis CRUDs; el grupo tiene un header traducido `layout.sidebar.menu.groupLabel`; cada item active muestra `aria-current="page"` y estado visual activo
- [x] 9.3 Extender `Dashboard/src/components/layout/MainLayout.tsx` montando `useMenuWebSocketSync()` (una sola vez, dentro del componente) y renderizando `<ToastContainer />` una unica vez; asegurar que la conexion `dashboardWS.connect(accessToken)` se inicializa con refresh callback tras un login exitoso y `disconnect()` en logout
- [x] 9.4 Verificar que la conexion WS se cierra correctamente en logout (`dashboardWS.disconnect()`) y que `onMaxReconnect` muestra un toast de error

## 10. Seis paginas CRUD

- [x] 10.1 Crear `Dashboard/src/pages/Allergens.tsx` siguiendo la skill `dashboard-crud-page` al pie de la letra (hook trio, useActionState, PageContainer con helpContent, HelpButton en modal, Table con columns memoizado incluyendo `deleteDialog` en deps, branch guard N/A por ser tenant-scoped); modal de cross-reactions como sub-flujo
- [x] 10.2 Crear `Dashboard/src/pages/Ingredients.tsx` con estructura jerarquica: `IngredientGroup` collapsible sections, dentro `Ingredients`, dentro `SubIngredients`; create/edit/delete en cada nivel (tres modales compartiendo la misma pagina); cascade preview en delete de grupo e ingrediente
- [x] 10.3 Crear `Dashboard/src/pages/Categories.tsx` branch-scoped: guard `!selectedBranchId` → fallback card con link a Home; Table con `name`, `order`, `is_active`, actions; cascade preview de subcategorias + productos; `openCreate` presete `branch_id: selectedBranchId`
- [x] 10.4 Crear `Dashboard/src/pages/Subcategories.tsx` branch-scoped con filtro opcional por categoria (Select con `categoryStore` items); cascade preview de productos
- [x] 10.5 Crear `Dashboard/src/pages/Products.tsx` branch-scoped: tabla con `formatPrice(price_cents)`, featured/popular badges, allergen count; modal con `ImagePreview` en vivo + `validateImageUrl` antes de submit; sub-modal `<AllergenLinker>` para gestionar product↔allergen con presence_type y risk_level; toggle inline `is_available` por BranchProduct que llama `PUT /api/admin/branch-products/{id}` optimistamente
- [x] 10.6 Crear `Dashboard/src/pages/Recipes.tsx` tenant-scoped: tabla con `name`, producto linkeado, count de ingredientes; modal con Select de producto + lista editable de ingredientes con quantity
- [x] 10.7 Tests Vitest por pagina (`Allergens.test.tsx`, `Ingredients.test.tsx`, `Categories.test.tsx`, `Subcategories.test.tsx`, `Products.test.tsx`, `Recipes.test.tsx`): render con items mockeados, open create modal, submit feliz crea item, submit invalido muestra errores inline, open delete dialog muestra cascade preview, confirm delete llama store, branch guard visible con selectedBranchId=null (solo branch-scoped), MANAGER no ve boton delete

## 11. Accesibilidad y QA final

- [ ] 11.1 Auditoria manual con `@axe-core/react` integrado en dev: cero violaciones AA en cada una de las seis paginas (Categories, Subcategories, Products, Allergens, Ingredients, Recipes)
- [ ] 11.2 Verificar navegacion por teclado end-to-end: Tab cicla dentro de modales abiertos, Escape cierra modal/dialog, Enter submit en form, focus vuelve al trigger al cerrar modal
- [ ] 11.3 Verificar lectores de pantalla (NVDA/VoiceOver): Badge lee "Estado: Activo/Inactivo", botones icon-only leen accion + nombre de entidad, toasts se anuncian correctamente segun variant (polite/assertive)
- [ ] 11.4 Responsive QA (mobile 375px, tablet 768px, desktop 1440px): sidebar hamburguesa <768, tablas con scroll horizontal cuando es necesario, modales con max-height + scroll interno

## 12. Cierre: lint, typecheck, tests y smoke manual

- [x] 12.1 Ejecutar `pnpm --filter dashboard lint` y corregir cada warning/error; verificar que la regla custom de no-destructuring-store y el bloqueo de `useState` en paginas funcionan
- [x] 12.2 Ejecutar `pnpm --filter dashboard typecheck` (tsc --noEmit) y resolver cada error de tipos; verificar que ningun migrate usa `any`
- [x] 12.3 Ejecutar `pnpm --filter dashboard test` — deben pasar las suites de validation, formatters, hooks (useFormModal, useConfirmDialog, usePagination, useAuthPermissions, useMenuWebSocketSync), services (websocket, cascadeService), stores (branchStore + los 6 del menu + toastStore), componentes UI criticos (Modal focus trap, ConfirmDialog, Badge), paginas (los 6 CRUDs), i18n parity
- [ ] 12.4 Smoke test manual con backend corriendo: `pnpm --filter dashboard dev` → login como ADMIN → navegar a cada CRUD, crear/editar/eliminar un item por entidad, verificar toasts, verificar cascade dialog, abrir dos tabs en /products y verificar que un cambio en la tab A aparece en la tab B via WebSocket; repetir como MANAGER y verificar que no hay delete buttons
