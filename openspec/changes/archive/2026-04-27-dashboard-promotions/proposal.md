# dashboard-promotions Proposal

> Change ID: **C-27** | Fase: **2 — Dashboard final pages** | Governance: **BAJO**
> Dependencias archivadas requeridas: **C-13 promotions** (backend), **C-15 dashboard-menu** (hook trio, componentes UI, WS sync, cascade service, helpContent), **C-29 dashboard-branch-selector** (branchStore multi-branch)

## Why

El backend ya expone CRUD completo de promociones desde C-13 (`/api/admin/promotions` con branch linking, product linking, cascade delete, eventos `ENTITY_*`), pero el Dashboard **no tiene UI** para gestionarlas. Hoy un ADMIN/MANAGER no puede crear una promocion "2x1 martes", vincularla a dos sucursales, agregarle tres productos ni ver su vigencia desde el navegador — solo con curl. Las promociones son un requerimiento operativo real: los restaurantes necesitan crearlas, editarlas, activarlas/desactivarlas y eliminarlas de forma rapida, con vigencia temporal precisa (`start_date + start_time` ↔ `end_date + end_time`).

Este change entrega la **pagina `/promotions`** montada sobre el **patron canonico de CRUD del Dashboard** (ya establecido en C-15 con `useFormModal` + `useConfirmDialog` + `useActionState` + `dashboardWS` + cascade service). No inventamos nada nuevo: reutilizamos el patron, agregamos la pagina, un store mas (`promotionStore`), un DateRangePicker nuevo, y el multi-select de sucursales + la tabla de items vinculados.

Hacer esto bien significa cerrar el ultimo CRUD de administracion pendiente del Dashboard (luego de menu C-15 y operations C-16), con la misma consistencia de patrones. Hacerlo mal significa copiar mal el patron, romper la ergonomia del admin, e introducir drift respecto del resto de paginas ya armadas.

## What Changes

- **Nueva pagina CRUD** `Dashboard/src/pages/Promotions.tsx` registrada en el router bajo `/promotions` (lazy, breadcrumb `layout.sidebar.promotions`). Sigue la estructura canonica: selectores Zustand + `useFormModal` + `useConfirmDialog` + `usePagination` + `useActionState` + `PageContainer` con `helpContent.promotions` obligatorio + `HelpButton size="sm"` como primer elemento del form.
- **Listado de promociones** con columnas: nombre, tipo (desde catalogo `promotion_type`), vigencia (`start_date start_time → end_date end_time` formateada), sucursales activas (badge count), estado (`Badge` success/danger segun `is_active`), y acciones (editar, toggle `is_active` inline, eliminar). Sort por nombre, paginacion client-side con `usePagination` default 10/pagina.
- **Filtros de listado**: select "Estado" (todas / solo activas / solo inactivas), select "Sucursal" (todas / una especifica del `selectedBranchId` o las sucursales del usuario), select "Vigencia" (todas / vigentes ahora / proximas / expiradas — calculado client-side comparando `now()` con `start_date+start_time` y `end_date+end_time`).
- **Formulario crear/editar (modal)**:
  - `Input` Nombre (requerido, max 120).
  - `Textarea` Descripcion (opcional, max 500).
  - `Input type="number"` Precio (centavos convertidos para display — el usuario ve `$125.50` y el store guarda `12550`). Requerido, `>= 0`. Helper visual: `formatPrice(cents)` para mostrar conversion en tiempo real.
  - `Select` Tipo de promocion (catalogo tenant-scoped desde `promotion_type` expuesto por `/api/admin/catalogs/promotion-types` — nuevo fetch en `catalogStore`, OPCIONAL, `null` permitido).
  - `DateRangePicker` nuevo componente UI base: dos pares `date + time` (inicio y fin) validado con `start_datetime <= end_datetime`.
  - `MultiSelect` de sucursales (activa solo las sucursales a las que el usuario tiene acceso via `UserBranchRole`). Se guarda como `branch_ids: number[]` en el POST/PATCH.
  - Tabla inline de items: boton "Agregar producto", abre sub-modal con `Select` de productos (buscable, paginado — lee `productStore.items` ya hidratado por C-15). Cada fila muestra `product_name` + boton eliminar. Se guarda como `product_ids: number[]` en el POST.
- **Toggle `is_active` inline** en la columna "Estado" de la tabla (sin abrir modal): click en el `Toggle` → optimistic update via `promotionStore.toggleActiveAsync(id)` → backend es `PATCH /api/admin/promotions/{id}` con `{ is_active }`. Confirmacion toast success/error con rollback.
- **Cascade delete preview** antes de eliminar: abre `ConfirmDialog` con `CascadePreviewList` mostrando `{ PromotionBranch: N, PromotionItem: M }` calculado en `cascadeService.getPromotionPreview(id)`. Si el usuario confirma, `deletePromotionWithCascade(id)` → `DELETE /api/admin/promotions/{id}` (ADMIN-only, MANAGER recibe 403 y se le muestra toast de error).
- **Store `promotionStore`** tenant-scoped, persistido con `STORE_VERSIONS.PROMOTION = 1` y `STORAGE_KEYS.PROMOTION`: state `{ items: Promotion[], isLoading, error, pendingTempIds }`, acciones async (`fetchAsync`, `createAsync`, `updateAsync`, `deleteAsync`, `toggleActiveAsync`, `linkBranchAsync`, `unlinkBranchAsync`, `linkProductAsync`, `unlinkProductAsync`), `applyWSCreated`, `applyWSUpdated`, `applyWSDeleted` para sync en tiempo real, optimistic updates con rollback automatico, dedup por `id` + `tempId`. Selectores: `selectPromotions`, `selectIsLoading`, `selectError`, `selectPromotionById`, `selectActivePromotions` (con `useShallow`), `selectPromotionsForBranch(branchId)` (con `useShallow`), `selectPromotionActions` (grouped actions, con `useShallow`).
- **Extension de `catalogStore`** (ya existe de C-15): agrega `promotion_types: PromotionType[]` + `fetchPromotionTypesAsync()` → `GET /api/admin/catalogs/promotion-types`. Selectores `selectPromotionTypes`, `selectPromotionTypeById`.
- **Extension de `useMenuWebSocketSync`** (ya existe de C-15): agrega el ruteo del entity `promotion` hacia `promotionStore.applyWS*`. El hook mantiene ref pattern, subscribe-once, filtrado por branch via `dashboardWS.onFiltered`. Los eventos `CASCADE_DELETE` con `entity="promotion"` se manejan con toast `t('promotions.cascadeNotified', { count })`.
- **Nuevo componente UI base `DateRangePicker`** en `Dashboard/src/components/ui/DateRangePicker.tsx`: compuesto por dos `Input type="date"` + dos `Input type="time"`, con validacion interna (`start_datetime <= end_datetime`) que emite error via prop `error`. Reusable para futuros rangos (sales reports filtering, etc.).
- **Nuevo componente UI base `MultiSelect`** en `Dashboard/src/components/ui/MultiSelect.tsx`: accepta `options: { value: string, label: string }[]`, `selected: string[]`, `onChange(selected)`. Dropdown con checkboxes, muestra resumen `{n} seleccionadas` en el trigger, soporta `aria-multiselectable="true"`. Reusable para futuros multi-selects (roles del staff, sectores del mozo, etc.).
- **Helpers de vigencia** en `Dashboard/src/utils/formatters.ts` (ya existe de C-15): `formatPromotionValidity(p)` (retorna string `"15/06 18:00 → 15/06 22:00"`), `getPromotionStatus(p)` (retorna `'scheduled' | 'active' | 'expired'` comparando con `now()`), `isPromotionActiveNow(p)` (boolean).
- **Validacion** en `Dashboard/src/utils/validation.ts`: `validatePromotion(data)` — chequea `name` no vacio max 120, `description` max 500, `price >= 0`, `start_date` requerido, `start_time` requerido, `end_date` requerido, `end_time` requerido, `end_datetime >= start_datetime`, `branch_ids.length >= 1` (al menos una sucursal). Retorna `{ isValid, errors: Partial<Record<keyof PromotionFormData, string>> }` con errores como i18n keys.
- **Help content** en `Dashboard/src/utils/helpContent.tsx` (ya existe de C-15): nueva entry `promotions` con explicacion de vigencia, precio, multi-sucursal, items, toggle inline.
- **Sidebar extendido** en `Dashboard/src/components/layout/Sidebar.tsx` (ya existe de C-15): nuevo item "Promociones" (icon `Tag` de `lucide-react`) bajo seccion "Menu", visible solo a ADMIN/MANAGER con `canManagePromotions` permission.
- **Permisos `useAuthPermissions`** (ya existe de C-15): agrega derivacion `canManagePromotions = isAdmin || isManager`, `canDeletePromotion = isAdmin`.
- **i18n extendido**: ~30 keys nuevas bajo `promotions.*` (title, description, empty, create, edit, delete, toggleActive, validity, status.scheduled/active/expired, field labels, validation messages, cascade notifications, websocket toast) en `public/locales/es.json` y `en.json`. Mantiene paridad bidireccional.
- **Tests Vitest**:
  - `promotionStore.test.ts`: CRUD happy path, optimistic rollback en error, toggle inline, linkBranch/linkProduct, `applyWS*`, `migrate` con type guard, persistencia round-trip.
  - `Promotions.test.tsx`: render con/sin branch, lista filtrada por estado/sucursal/vigencia, abre modal create, submit con valores validos, validacion inline (nombre vacio, precio negativo, rango invertido, sin sucursales), toggle inline optimistic, delete con cascade preview, WS sync crea/actualiza/elimina item.
  - `DateRangePicker.test.tsx`: valida que `end >= start`, emite error via prop, cambia ambos campos.
  - `MultiSelect.test.tsx`: toggle selection, `aria-multiselectable`, resumen en trigger, keyboard nav.
  - `validation.test.ts` extendido: casos felices y edge de `validatePromotion`.
  - `formatters.test.ts` extendido: `formatPromotionValidity`, `getPromotionStatus` (antes/durante/despues), `isPromotionActiveNow`.
  - `useMenuWebSocketSync.test.tsx` extendido: `entity="promotion"` en `ENTITY_*` routea al store correcto; `CASCADE_DELETE` con `entity="promotion"` dispara toast.
  - i18n parity: todas las keys `promotions.*` existen en `es` y `en`.

**No-goals (fuera de scope)**:

- Backend: cero cambios — C-13 ya dejo endpoints, servicios, modelos, eventos WS, tests de promotions. Si falta algun endpoint menor (ej. `/api/admin/catalogs/promotion-types`), se expone como tarea trivial dentro del fetch pero **no** se modifican los requirements de la capability backend.
- Promotions en pwaMenu (render como items del menu publico) — eso ya existe desde C-18 (pwamenu-ordering) o va a un change futuro. Este change es 100% Dashboard.
- Drag-and-drop para reordenar items de la promocion — el orden no es relevante para `promotion_item`.
- Bulk operations (activar/desactivar varias promociones en batch) — solo CRUD por item + toggle inline.
- Import/export de promociones (CSV, JSON) — fuera de scope.
- Catalogo `promotion_type` CRUD UI — el catalogo es tenant-scoped, compartido, y se gestiona fuera de este change (se consume read-only via `catalogStore`). Crear/editar tipos de promocion va a un change administrativo de catalogos tenant-scoped.
- Preview de la promocion como se vera en el menu publico — se puede abrir el slug publico en otra tab.
- Notificaciones push a diners cuando se crea una promocion — fuera de scope.
- Programacion de promociones recurrentes (ej. "todos los martes 18-22hs") — el modelo actual soporta un rango unico; recurrencia va a un change dedicado con extension de schema.
- Descuentos porcentuales / escalonados / condicionales — el modelo actual es precio fijo por paquete; features de descuentos avanzados van a un change de pricing-engine.

## Capabilities

### New Capabilities

Este change introduce **una capability frontend nueva** y **reutiliza** las capabilities ya establecidas por C-15 (`dashboard-menu-pages`, `dashboard-realtime-sync`, `dashboard-store-persistence`) sin modificarlas.

- `dashboard-promotions-page`: Pagina CRUD de promociones del Dashboard. Cubre la pagina `/promotions`, el formulario crear/editar con DateRangePicker + MultiSelect de sucursales + tabla inline de items, el toggle `is_active` inline, el cascade delete preview, los filtros (estado, sucursal, vigencia), los helpers de vigencia (`formatPromotionValidity`, `getPromotionStatus`, `isPromotionActiveNow`), el `promotionStore` con optimistic updates + WS sync + linkBranch/linkProduct/toggleActive, los componentes UI base nuevos (`DateRangePicker`, `MultiSelect`), y la validacion (`validatePromotion`).

### Modified Capabilities

- `dashboard-layout`: Se extiende con un item de sidebar nuevo ("Promociones" bajo seccion "Menu") visible solo a ADMIN/MANAGER via `canManagePromotions`, y con el ruteo del entity `promotion` dentro de `useMenuWebSocketSync` (ya montado en `MainLayout`). Los requirements del layout no cambian — es una extension aditiva del catalogo de rutas del sidebar.

- `dashboard-realtime-sync`: Se extiende `useMenuWebSocketSync` agregando el ruteo del entity `promotion` hacia `promotionStore.applyWS*`. El ref pattern, filtrado por branch, deduplicacion por tempId y manejo de `CASCADE_DELETE` no cambian — es pura extension del map `entity → store`.

- `dashboard-store-persistence`: Se agregan las entries `STORAGE_KEYS.PROMOTION` y `STORE_VERSIONS.PROMOTION = 1` al contrato existente. El nuevo `promotionStore` se persiste bajo este contrato con migrate + type guard. No cambia el contrato en si — solo se suma un store mas.

- `dashboard-i18n`: Se agregan ~30 keys bajo `promotions.*` en `es.json` y `en.json`. La regla de paridad bidireccional y el fallback `en→es` no cambian.

## Impact

**Codigo afectado (todo nuevo salvo los archivos extendidos de C-15)**:

- `Dashboard/src/pages/Promotions.tsx` (nuevo) + `Promotions.test.tsx`
- `Dashboard/src/stores/promotionStore.ts` (nuevo) + `promotionStore.test.ts`
- `Dashboard/src/stores/catalogStore.ts` (**extendido** — o creado si no existe como parte de C-15): agrega `promotion_types` + `fetchPromotionTypesAsync()` + selectores
- `Dashboard/src/components/ui/DateRangePicker.tsx` (nuevo) + `DateRangePicker.test.tsx`
- `Dashboard/src/components/ui/MultiSelect.tsx` (nuevo) + `MultiSelect.test.tsx`
- `Dashboard/src/types/menu.ts` (**extendido**): agrega `Promotion`, `PromotionFormData`, `PromotionItem`, `PromotionBranch`, `PromotionType`
- `Dashboard/src/utils/validation.ts` (**extendido**): agrega `validatePromotion`
- `Dashboard/src/utils/formatters.ts` (**extendido**): agrega `formatPromotionValidity`, `getPromotionStatus`, `isPromotionActiveNow`
- `Dashboard/src/utils/helpContent.tsx` (**extendido**): agrega entry `promotions`
- `Dashboard/src/utils/constants.ts` (**extendido**): agrega `STORAGE_KEYS.PROMOTION`, `STORE_VERSIONS.PROMOTION = 1`
- `Dashboard/src/hooks/useAuthPermissions.ts` (**extendido**): agrega `canManagePromotions`, `canDeletePromotion`
- `Dashboard/src/hooks/useMenuWebSocketSync.ts` (**extendido**): agrega ruteo de `entity="promotion"` a `promotionStore.applyWS*`
- `Dashboard/src/services/cascadeService.ts` (**extendido**): agrega `getPromotionPreview`, `deletePromotionWithCascade`
- `Dashboard/src/router.tsx` (**extendido**): ruta `/promotions` lazy + breadcrumb + protegida
- `Dashboard/src/components/layout/Sidebar.tsx` (**extendido**): item "Promociones" bajo seccion "Menu"
- `Dashboard/public/locales/es.json` y `en.json` (**extendidos**): keys `promotions.*`

**APIs backend consumidas (todas existentes desde C-13, ninguna modificada)**:

- `GET /api/admin/promotions?branch_id={id}&limit=50&offset=0` — lista
- `GET /api/admin/promotions/{id}` — detalle
- `POST /api/admin/promotions` — crear (body: `PromotionCreate` con `branch_ids[]` y `product_ids[]`)
- `PATCH /api/admin/promotions/{id}` — actualizar metadata (incluye `is_active` para toggle inline)
- `DELETE /api/admin/promotions/{id}` — ADMIN-only, soft delete
- `POST /api/admin/promotions/{id}/branches?branch_id={id}` — linkear sucursal
- `DELETE /api/admin/promotions/{id}/branches/{branch_id}` — unlinkear sucursal
- `POST /api/admin/promotions/{id}/products?product_id={id}` — linkear producto
- `DELETE /api/admin/promotions/{id}/products/{product_id}` — unlinkear producto
- `GET /api/admin/catalogs/promotion-types` — listar catalogo tenant (read-only)

**Eventos WebSocket consumidos**: `ENTITY_CREATED`, `ENTITY_UPDATED`, `ENTITY_DELETED`, `CASCADE_DELETE` con `entity="promotion"`, routed a `/ws/admin` filtrado por branch. Payload shape identico al resto de entidades admin (C-15).

**Variables de entorno**: ninguna nueva. Se usan `VITE_API_URL` y `VITE_WS_URL` ya declaradas en C-14.

**Dependencias npm**: ninguna nueva. El `DateRangePicker` y `MultiSelect` se implementan con `<input type="date">`, `<input type="time">` y `<button>` + Tailwind — cero libs externas.

**Impacto en otros changes**:

- **Cierra el loop** de CRUD de administracion del Dashboard junto con C-15 (menu) y C-16 (operations).
- **Establece referencia** para futuros multi-selects y date-range-pickers en el Dashboard (staff roles, waiter assignments time windows, sales reporting, etc.).
- **No afecta**: backend, ws_gateway, pwaMenu, pwaWaiter. Las capabilities `promotions` (backend) y `ws-gateway` no se tocan.

**Impacto en `.agents/SKILLS.md`**: las skills `dashboard-crud-page`, `zustand-store-pattern`, `react19-form-pattern`, `ws-frontend-subscription`, `help-system-content` siguen aplicando. Esta pagina es una aplicacion mas del patron canonico — no introduce nuevas skills ni modifica las existentes.

**Gobernanza BAJO**: autonomia completa si al final del apply pasan `pnpm --filter dashboard lint`, `pnpm --filter dashboard typecheck` y `pnpm --filter dashboard test`. Checkpoint solo si se detecta desviacion respecto del scope declarado aca (ej. tocar backend, agregar descuentos avanzados, promociones recurrentes).
