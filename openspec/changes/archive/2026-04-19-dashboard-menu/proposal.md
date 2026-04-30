# dashboard-menu Proposal

> Change ID: **C-15** | Fase: **1D — Frontends** | Governance: **BAJO**
> Dependencias archivadas requeridas: **C-14 (dashboard-shell)**, **C-04 (menu-catalog)**, **C-05 (allergens)**, **C-06 (ingredients)**

## Why

El Dashboard ya tiene scaffold (C-14) — shell navegable, auth, i18n, convenciones Zustand enforced — pero todavia no sirve para operar el restaurante: **no hay paginas de negocio**. El backend ya expone todos los endpoints de menu (C-04), alergenos (C-05), ingredientes (C-06) y recetas (C-06), pero un ADMIN/MANAGER no puede crear una categoria, definir un precio por sucursal, linkear un alergeno a un producto, ni gestionar la base de recetas desde el navegador. Hoy todo eso solo se puede tocar con curl.

Este change entrega las **primeras seis paginas CRUD de negocio** del Dashboard — Categories, Subcategories, Products, Allergens, Ingredients, Recipes — montadas sobre un **patron reutilizable** (`useFormModal` + `useConfirmDialog` + `useActionState`) que todos los CRUDs siguientes (staff, tables, sectors, etc. en C-16) van a copiar. Tambien introduce por primera vez la **suscripcion WebSocket del Dashboard** a eventos `ENTITY_*` y `CASCADE_DELETE`, con **optimistic updates** y rollback automatico, para que cuando un admin edita un producto desde otra pestana el cambio aparezca en tiempo real. Establecemos tambien el sistema formal de **store migrations con `STORE_VERSIONS`** que todo store persistido del proyecto va a usar de ahora en adelante.

Hacerlo bien aca significa que cada CRUD futuro del Dashboard es "copiar una page, agregar un store, agregar selectores, registrar ruta". Hacerlo mal significa repetir boilerplate en cada pagina y heredar bugs de WebSocket y migraciones a todos los stores siguientes.

## What Changes

- **Seis paginas CRUD nuevas** en `Dashboard/src/pages/`: `Categories.tsx`, `Subcategories.tsx`, `Products.tsx`, `Allergens.tsx`, `Ingredients.tsx`, `Recipes.tsx`. Todas siguen la estructura canonica definida por la skill `dashboard-crud-page` (selectors Zustand + `useFormModal` + `useConfirmDialog` + `usePagination` + `useActionState` + `PageContainer` con `helpContent` obligatorio + `HelpButton size="sm"` como primer elemento del form).
- **Hook trio reutilizable** en `Dashboard/src/hooks/`: `useFormModal<FormData, Entity>` (maneja apertura/cierre del modal de create/edit y el form data), `useConfirmDialog<Entity>` (confirmacion de delete con item target), `usePagination<T>` (client-side pagination con `paginatedItems`, `currentPage`, `totalPages`, `setCurrentPage`). Reemplazan cualquier `useState` manual en paginas CRUD.
- **Sistema de validacion** en `Dashboard/src/utils/validation.ts`: `validateCategory`, `validateSubcategory`, `validateProduct`, `validateAllergen`, `validateIngredientGroup`, `validateIngredient`, `validateSubIngredient`, `validateRecipe`, mas helpers (`isValidNumber`, `isPositiveNumber`, `isNonNegativeNumber`, `validateImageUrl`). Todas retornan `{ isValid, errors: Partial<Record<keyof T, string>> }`.
- **`FormState<T>` type** en `Dashboard/src/types/form.ts`: `{ errors?, message?, isSuccess? }` — consumido por `useActionState` en todas las paginas.
- **Seis stores Zustand persistidos** en `Dashboard/src/stores/`: `categoryStore`, `subcategoryStore`, `productStore` (incluye `BranchProduct` management), `allergenStore` (incluye `ProductAllergen` linking y cross-reactions), `ingredientStore` (maneja `IngredientGroup` + `Ingredient` + `SubIngredient` jerarquico), `recipeStore`. Todos con selectores nombrados (`selectCategories`, `selectIsLoading`, etc.), `EMPTY_ARRAY` estable como fallback, `useShallow` para objetos/arrays derivados, y acciones async (`fetchAsync`, `createAsync`, `updateAsync`, `deleteAsync`) que consumen los endpoints admin del backend.
- **Sistema formal de store migrations**: nueva constante `STORE_VERSIONS` en `Dashboard/src/utils/constants.ts` (`CATEGORY`, `SUBCATEGORY`, `PRODUCT`, `ALLERGEN`, `INGREDIENT`, `RECIPE` — todos en version 1 para arrancar). Cada store persistido con `persist()` declara `version: STORE_VERSIONS.XXX` y una funcion `migrate(persistedState: unknown, version: number)` con type guard (nunca `any`). Las migraciones devuelven defaults seguros si el shape es invalido.
- **Optimistic updates con rollback automatico** en todos los stores: `createAsync` y `updateAsync` aplican el cambio localmente antes de hacer el request; en caso de error del backend, restauran el estado previo y dejan el error en `state.error`. `deleteAsync` sigue el mismo patron.
- **Suscripcion WebSocket del Dashboard a eventos admin**: nuevo `Dashboard/src/hooks/useMenuWebSocketSync.ts` montado en `MainLayout`, subscripto con el **ref pattern obligatorio** (dos effects, `useRef(handler)` + subscribe una sola vez con `[]` deps) via `dashboardWS.onFiltered(selectedBranchId, '*', ...)`. Maneja los cuatro tipos de evento admin:
  - `ENTITY_CREATED` → aplica el insert al store correspondiente si no vino de esta pestana (deduplicacion por `id` + `tempId`).
  - `ENTITY_UPDATED` → aplica merge del update en el store correspondiente.
  - `ENTITY_DELETED` → marca `is_active=false` o remueve el item del store correspondiente.
  - `CASCADE_DELETE` → recibe `{ entity, id, affected: { Subcategory: 5, Product: 12 } }` y remueve items en cada store impactado, mostrando toast `t('menu.cascadeNotified', { count })`.
- **Cascade service** en `Dashboard/src/services/cascadeService.ts`: `deleteCategoryWithCascade`, `deleteSubcategoryWithCascade`, `deleteIngredientGroupWithCascade`, `deleteAllergenWithCascade`, mas helpers `getCategoryPreview`, `getSubcategoryPreview`, `getIngredientGroupPreview`, `getAllergenPreview` que calculan el preview de items afectados para mostrar en `<CascadePreviewList>` dentro de `<ConfirmDialog>`.
- **Componentes UI base nuevos** en `Dashboard/src/components/ui/`: `Modal`, `ConfirmDialog`, `Table`, `TableSkeleton`, `Pagination`, `Badge`, `Card`, `PageContainer`, `HelpButton`, `Input`, `Toggle`, `Select`, `ImagePreview`, `CascadePreviewList`. Todos con accesibilidad correcta (`aria-label` en icon-only buttons, `<span className="sr-only">` en Badges, `aria-hidden="true"` en iconos decorativos, focus trap en modales). Solo lo minimo para soportar las seis paginas de este change; componentes avanzados quedan para C-16.
- **`helpContent.tsx`** en `Dashboard/src/utils/`: entries para `categories`, `subcategories`, `products`, `allergens`, `ingredients`, `recipes` — contenido explicativo reutilizable en `PageContainer` y en los `HelpButton` de los modales.
- **Toast store** en `Dashboard/src/stores/toastStore.ts`: `toast.success`, `toast.error`, `toast.info`, auto-dismiss a 4s, rendered via `<ToastContainer>` en `MainLayout`. Usado por todas las acciones async de los stores.
- **Sidebar extendido** en `Dashboard/src/components/layout/Sidebar.tsx`: items nuevos para Categories, Subcategories, Products, Allergens, Ingredients, Recipes, agrupados bajo seccion "Menu", con iconos (lucide-react) y `t()` en todas las labels.
- **Routing extendido** en `Dashboard/src/router.tsx`: seis rutas nuevas con `React.lazy`, `handle.breadcrumb` para cada una, todas protegidas por `ProtectedRoute` bajo `MainLayout`.
- **i18n extendido**: nuevas keys bajo `menu.*` (categories, subcategories, products, allergens, ingredients, recipes, cascadeNotified, websocketEvent.*) en `public/locales/es.json` y `en.json`. Mantiene la paridad bidireccional verificada por `i18n.test.ts` (ya existente de C-14).
- **Tests Vitest**: (a) los seis stores — CRUD feliz + error con rollback + migrate con type guard + persistencia entre sesiones; (b) las seis paginas — render con/sin branch, create/edit/delete happy path, validacion inline, cascade preview, loading skeleton, branch guard; (c) `useFormModal`, `useConfirmDialog`, `usePagination` — comportamiento aislado; (d) `useMenuWebSocketSync` — recibe ENTITY_CREATED y actualiza el store correcto, recibe CASCADE_DELETE y remueve items de multiples stores, no re-subscribe en re-render (ref pattern); (e) `validation.ts` — casos felices y edge cases por entidad; (f) i18n parity — todas las keys nuevas existen en es y en.

**No-goals (fuera de scope)**:

- Paginas operativas (Tables, Staff, Sectors, Kitchen Display, Sales, Waiter Assignments) — eso es **C-16 dashboard-operations**.
- Customizations (opciones de personalizacion de producto) — llega con C-16 o con un change dedicado.
- Promotions — fuera de este change; entidad existe en backend pero su UI va en un change posterior.
- Drag-and-drop para reordenar categories/subcategories/products — este change entrega el campo `order` editable por input numerico; el DnD se pospone.
- Bulk operations (seleccion multiple, delete batch) — solo CRUD por item.
- Import/export de menu (CSV, JSON) — fuera de scope.
- Feature de "preview del menu publico desde el Dashboard" — se puede abrir el slug publico en otra tab, no requiere UI dedicada.
- Portugues (`pt`) — exclusivo de pwaMenu.
- Cambios al backend — este change es 100% frontend. Si un endpoint no existe o necesita tuning, eso va a un change de backend separado.

## Capabilities

### New Capabilities

Este change introduce **tres capabilities frontend nuevas**. Todas son frontend puro — consumen capabilities backend ya existentes (`menu-catalog`, `allergen-system`, `ingredient-catalog`, `recipe-management`) pero no tocan sus requirements.

- `dashboard-menu-pages`: Paginas CRUD de menu del Dashboard. Cubre las seis paginas de negocio (Categories, Subcategories, Products, Allergens, Ingredients, Recipes), el patron canonico de CRUD page (`useFormModal` + `useConfirmDialog` + `usePagination` + `useActionState` + `HelpButton`), la validacion inline, el cascade preview en deletes, la branch guard (fallback card cuando no hay branch seleccionada), y los componentes UI base (Modal, Table, ConfirmDialog, etc.) que habilitan estas paginas.

- `dashboard-realtime-sync`: Suscripcion WebSocket del Dashboard a eventos admin del backend. Cubre la conexion al `/ws/admin` via `dashboardWS`, el ref pattern obligatorio para suscripciones, el filtrado por branch via `onFiltered`, el manejo de los cuatro tipos de evento (`ENTITY_CREATED`, `ENTITY_UPDATED`, `ENTITY_DELETED`, `CASCADE_DELETE`), la deduplicacion de eventos originados en la misma pestana, y el toast informativo al recibir `CASCADE_DELETE`.

- `dashboard-store-persistence`: Sistema formal de stores Zustand persistidos con versionado y migraciones. Cubre la constante `STORE_VERSIONS` como fuente de verdad de versiones, el contrato de `migrate(persistedState: unknown, version: number): State` con type guards (nunca `any`), los defaults seguros en caso de shape invalido, el patron de optimistic update con rollback automatico, y la declaracion de cada store persistido bajo su key de `STORAGE_KEYS`.

### Modified Capabilities

- `dashboard-layout`: Se extiende con entries de sidebar para las seis paginas de menu (agrupadas bajo seccion "Menu" con icono) y con el montaje de `useMenuWebSocketSync` en `MainLayout`, ademas del render del `<ToastContainer>`. Los requirements del layout no cambian — se mantienen: sidebar colapsable, navbar, breadcrumbs, router v7 lazy. Esta modificacion es aditiva.

- `dashboard-i18n`: Se agregan ~120 keys nuevas bajo `menu.*` (seis entidades x ~15 keys por entidad en promedio: title, description, empty, create/edit/delete labels, field labels, validation messages, cascade messages, websocket toast) en `es.json` y `en.json`. La regla de paridad bidireccional y el fallback `en→es` no cambian.

## Impact

**Codigo afectado (todo nuevo salvo los archivos extendidos de C-14)**:

- `Dashboard/src/pages/` (nuevo): `Categories.tsx`, `Subcategories.tsx`, `Products.tsx`, `Allergens.tsx`, `Ingredients.tsx`, `Recipes.tsx` (+ tests `*.test.tsx`)
- `Dashboard/src/stores/` (nuevo): `categoryStore.ts`, `subcategoryStore.ts`, `productStore.ts`, `allergenStore.ts`, `ingredientStore.ts`, `recipeStore.ts`, `toastStore.ts` (+ tests `*.test.ts`)
- `Dashboard/src/hooks/` (nuevo): `useFormModal.ts`, `useConfirmDialog.ts`, `usePagination.ts`, `useMenuWebSocketSync.ts` (+ tests)
- `Dashboard/src/components/ui/` (nuevo): `Modal.tsx`, `ConfirmDialog.tsx`, `Table.tsx`, `TableSkeleton.tsx`, `Pagination.tsx`, `Badge.tsx`, `Card.tsx`, `PageContainer.tsx`, `HelpButton.tsx`, `Input.tsx`, `Toggle.tsx`, `Select.tsx`, `ImagePreview.tsx`, `CascadePreviewList.tsx`, `ToastContainer.tsx`
- `Dashboard/src/services/` (nuevo): `websocket.ts` (dashboardWS cliente), `cascadeService.ts`
- `Dashboard/src/utils/validation.ts` (nuevo) y `helpContent.tsx` (nuevo)
- `Dashboard/src/types/form.ts` (nuevo): `FormState<T>`, `ValidationErrors<T>`
- `Dashboard/src/utils/constants.ts` (**extendido**): agrega `STORE_VERSIONS`, `STORAGE_KEYS.{CATEGORY,SUBCATEGORY,PRODUCT,ALLERGEN,INGREDIENT,RECIPE}`
- `Dashboard/src/router.tsx` (**extendido**): seis rutas nuevas con lazy
- `Dashboard/src/components/layout/Sidebar.tsx` (**extendido**): seccion "Menu" con seis items
- `Dashboard/src/components/layout/MainLayout.tsx` (**extendido**): monta `useMenuWebSocketSync` y renderiza `<ToastContainer>`
- `Dashboard/public/locales/es.json` y `en.json` (**extendidos**): keys `menu.*`
- Dependencias npm nuevas: `lucide-react` (iconos — si no estaba ya), ninguna otra (React 19 + Zustand 5 + TypeScript ya presentes de C-14).

**APIs backend consumidas (todas existentes, ninguna modificada)**:

- C-04 menu-catalog: `GET|POST|PUT|DELETE /api/admin/categories`, `/api/admin/subcategories`, `/api/admin/products`, `/api/admin/branch-products`
- C-05 allergens: `GET|POST|PUT|DELETE /api/admin/allergens`, `POST|DELETE /api/admin/products/{id}/allergens`, `POST|DELETE /api/admin/allergens/{id}/cross-reactions`
- C-06 ingredients: `GET|POST|PUT|DELETE /api/admin/ingredients`, `/api/admin/ingredients/{id}/items`, `/api/admin/ingredients/{id}/items/{iid}/subs`
- C-06 recipes: `GET|POST|PUT|DELETE /api/recipes`
- C-14 WS: `wss://...:8001/ws/admin?token=...` — se conecta aca por primera vez desde el Dashboard.

**Variables de entorno**: ninguna nueva. Se usan `VITE_API_URL` y `VITE_WS_URL` ya declaradas en C-14.

**Impacto en otros changes**:

- **Desbloquea**: **C-16 dashboard-operations** (reutiliza el hook trio, los componentes UI, el toast store, el patron de WS sync, y la seccion sidebar ampliada).
- **Establece contratos reutilizables**: el patron `useFormModal` + `useConfirmDialog` + `useActionState` + cascade service se convierte en la referencia canonica para cualquier pagina CRUD del Dashboard (C-16 en adelante). El sistema `STORE_VERSIONS` es adoptado por todo store persistido futuro (tanto en Dashboard como referencia cruzada para pwaMenu/pwaWaiter en sus changes propios si persisten datos nuevos).
- **No afecta**: backend, ws_gateway, pwaMenu, pwaWaiter.

**Impacto en `.agents/SKILLS.md`**: las skills `dashboard-crud-page`, `zustand-store-pattern`, `react19-form-pattern`, `ws-frontend-subscription`, `help-system-content` declaran hoy archivos de referencia (`Dashboard/src/pages/Categories.tsx`, hooks, `helpContent.tsx`, `cascadeService.ts`, `FormState` type, etc.) como **"se crean en C-15"**. Este change materializa esas referencias. Despues de archivar, esos archivos existen y las skills dejan de ser "solo template" para convertirse en referencias verificables.

**Gobernanza BAJO**: autonomia completa si al final del apply pasan `pnpm --filter dashboard lint`, `pnpm --filter dashboard typecheck` y `pnpm --filter dashboard test`. Checkpoint solo si se detecta desviacion respecto del scope declarado aca (ej.: intentar agregar DnD, bulk ops, o tocar backend).
