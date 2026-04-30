## 1. Preparación y skills

- [x] 1.1 Leer `.agents/SKILLS.md` y cargar: `clean-architecture`, `fastapi-domain-service`, `fastapi-code-review`, `dashboard-crud-page`, `zustand-store-pattern`, `ws-frontend-subscription`, `help-system-content`, `vercel-react-best-practices`, `python-testing-patterns`, `test-driven-development`, `systematic-debugging`
- [x] 1.2 Releer `knowledge-base/01-negocio/04_reglas_de_negocio.md` §2 (Round Lifecycle) y §11 (RBAC)
- [x] 1.3 Releer `knowledge-base/02-arquitectura/04_eventos_y_websocket.md` — matriz de routing de `ROUND_*`
- [x] 1.4 Releer `openspec/changes/dashboard-orders/proposal.md`, `design.md`, `specs/dashboard-orders/spec.md`
- [x] 1.5 Abrir `Dashboard/src/stores/kitchenDisplayStore.ts` y `pages/KitchenDisplay.tsx` como referencia de patrón WS + columnas

## 2. Backend — schemas y tests de servicio (TDD)

- [x] 2.1 Agregar `RoundAdminOutput` a `backend/rest_api/schemas/round.py` con todos los campos denormalizados definidos en spec (`table_code`, `table_number`, `sector_id`, `sector_name`, `diner_name`, `items_count`, `total_cents` + timestamps de lifecycle + `cancel_reason`)
- [x] 2.2 Agregar `RoundAdminListOutput` (`items`, `total`, `limit`, `offset`) y `RoundAdminListFilters` (validation de `status` con `Literal`, `limit` max 200)
- [x] 2.3 Agregar `RoundAdminWithItemsOutput` extendiendo `RoundAdminOutput` con `items: list[RoundItemOutput]` (para el detalle)
- [x] 2.4 Escribir `backend/tests/test_round_service_list_for_admin.py` con fixtures que seedan: 2 tenants, 2 branches/tenant, 3 sectores, 5 mesas, rondas en cada estado, items activos y voided
- [x] 2.5 Test: filtro por `date` retorna solo rondas del día indicado (timezone-aware)
- [x] 2.6 Test: filtro por `sector_id` retorna solo rondas cuyas mesas pertenecen a ese sector
- [x] 2.7 Test: filtro por `status` retorna solo rondas en ese estado
- [x] 2.8 Test: filtro por `table_code` hace match case-insensitive parcial (`ILIKE '%code%'`)
- [x] 2.9 Test: combinación de filtros (`date + sector + status`) intersecta correctamente
- [x] 2.10 Test: paginación — `limit=10, offset=20` con 35 matches → retorna `items.length==10, total==35`
- [x] 2.11 Test: cross-tenant — MANAGER de tenant A pidiendo branch de tenant B recibe `ForbiddenError`
- [x] 2.12 Test: MANAGER sin ese `branch_id` en JWT recibe `ForbiddenError`
- [x] 2.13 Test: no N+1 — con 20 rondas seeded, el número de SQL statements ejecutados es ≤ 2 (un select + un count)
- [x] 2.14 Test: `items_count` y `total_cents` excluyen items voided
- [x] 2.15 Test: orden por `pending_at DESC` se respeta

## 3. Backend — implementación del servicio

- [x] 3.1 Agregar `list_for_admin(tenant_id, branch_id, date, sector_id, status, table_code, limit, offset) -> tuple[list[RoundAdminOutput], int]` en `backend/rest_api/services/domain/round_service.py`
- [x] 3.2 Implementar query con JOIN a Table, BranchSector, Diner, RoundItem, `GROUP BY round.id`, `func.count`/`func.coalesce(func.sum(...))` con `.filter(RoundItem.is_voided.is_(False))`
- [x] 3.3 Implementar query de `total` separada (distinct count con los mismos filtros sin JOINs innecesarios)
- [x] 3.4 Resolver timezone: obtener `branch.timezone` y convertir `date` local → rango UTC para comparar contra `pending_at`
- [x] 3.5 Verificar todos los filtros usan `.is_(True)` / `.is_(False)` en booleanos y `tenant_id == ...` explícito (skill `fastapi-domain-service`, nunca CRUDFactory)
- [x] 3.6 Correr `pytest backend/tests/test_round_service_list_for_admin.py` — todos en verde

## 4. Backend — router y tests de integración

- [x] 4.1 Escribir `backend/tests/test_admin_rounds_list_router.py`
- [x] 4.2 Test: `GET /api/admin/rounds?branch_id=1` con MANAGER retorna 200 y shape `{items, total, limit, offset}`
- [x] 4.3 Test: sin `branch_id` retorna 422 (required query param)
- [x] 4.4 Test: `status=FOO` retorna 422 (Pydantic Literal validation)
- [x] 4.5 Test: WAITER recibe 403 en list endpoint
- [x] 4.6 Test: cross-tenant branch_id retorna 403
- [x] 4.7 Test: `GET /api/admin/rounds/{id}` existente retorna 200 con items embebidos
- [x] 4.8 Test: `GET /api/admin/rounds/999999` retorna 404
- [x] 4.9 Agregar handler `list_admin_rounds(...)` a `backend/rest_api/routers/admin_rounds.py` (thin router): parse query params, llama `PermissionContext.require_management()`, delega a `RoundService.list_for_admin(...)`, mapea excepciones a HTTP
- [x] 4.10 Agregar handler `get_admin_round_detail(round_id)` que usa nuevo `RoundService.get_admin_detail(...)` (reutiliza `RoundAdminWithItemsOutput`)
- [x] 4.11 Verificar registro del router en `backend/rest_api/main.py` ya existe con prefix `/api/admin` — no duplicar
- [x] 4.12 Correr `pytest backend/tests/test_admin_rounds_list_router.py` — todos en verde

## 5. Frontend — tipos y API client

- [x] 5.1 Agregar tipos a `Dashboard/src/types/operations.ts`: `Round`, `RoundStatus` (union de 7 estados), `RoundItem`, `RoundFilters`, `RoundListResponse`, `ViewMode = 'columns' | 'list'`
- [x] 5.2 Crear `Dashboard/src/services/roundsAdminAPI.ts` con métodos `listRounds(filters)`, `getRound(id)`, `cancelRound(id, reason)` — usa `fetchAPI` + convierte IDs int→string en boundary
- [x] 5.3 Escribir test unit `Dashboard/src/services/roundsAdminAPI.test.ts` con `vi.fn()` mocks — verifica URL, query params, headers, mapeo de respuesta

## 6. Frontend — store (TDD)

- [x] 6.1 Escribir `Dashboard/src/stores/roundsAdminStore.test.ts` usando patrón de `kitchenDisplayStore.test.ts`
- [x] 6.2 Test: `fetchRounds` happy path setea `rounds`, `total`, `isLoading=false`
- [x] 6.3 Test: `fetchRounds` error path setea `error` y limpia `isLoading`
- [x] 6.4 Test: `handleRoundPending` con round que pasa filtro → agregado al store
- [x] 6.5 Test: `handleRoundPending` con round de otro `branch_id` → ignorado
- [x] 6.6 Test: `handleRoundPending` con round en otra `date` que filter → ignorado
- [x] 6.7 Test: `handleRoundConfirmed` con filtro `status=PENDING` y round ya en store → round removido del store
- [x] 6.8 Test: `handleRoundConfirmed` con filtro status vacío y round en store → round actualizado en place
- [x] 6.9 Test: `handleRoundServed` con payload parcial (solo `id, status, served_at`) → merge preserva `table_code`, `sector_name` existentes
- [x] 6.10 Test: `handleRoundCanceled` → remueve del store y limpia `selectedRoundId` si coincide
- [x] 6.11 Test: `setFilter` actualiza filters sin disparar fetch automático (la página decide)
- [x] 6.12 Test: `clearFilters` resetea a `{ branch_id, date: today }` y conserva el resto limpio
- [x] 6.13 Test: `selectAdminRounds` con store vacío retorna misma referencia `EMPTY_ROUNDS` (identity check)
- [x] 6.14 Test: `useRoundsAdminActions` con `useShallow` — cambios de `rounds` no cambian la identity del objeto de acciones
- [x] 6.15 Test: `cancelRound` llama API y en éxito NO muta el store (espera WS) — en error lanza para que la página muestre toast
- [x] 6.16 Implementar `Dashboard/src/stores/roundsAdminStore.ts` siguiendo skill `zustand-store-pattern`: `EMPTY_ROUNDS`, selectores, `useRoundsAdminActions` con `useShallow`, NO `persist()`
- [x] 6.17 Implementar helper interno `_passesFilter(round, filters)` usado por todos los WS handlers
- [x] 6.18 Implementar helper `_extractRound(event)` que mapea payload WS → tipo `Round` (IDs a string, defaults para campos ausentes)
- [x] 6.19 Correr `vitest run roundsAdminStore` — todos en verde

## 7. Frontend — hook de WebSocket

- [x] 7.1 Crear `Dashboard/src/hooks/useRoundsAdminWebSocketSync.ts` con ref pattern (dos efectos) siguiendo skill `ws-frontend-subscription`
- [x] 7.2 Efecto 1: ref con handlers actuales del store; efecto 2: suscribe a los 7 eventos `ROUND_*` y delega a los handlers por ref
- [x] 7.3 Registrar callback `onReconnect` que invoca `fetchRounds(currentFilters)` para reconciliar
- [x] 7.4 Cada `useEffect` retorna `unsubscribe` en cleanup — sin excepción
- [x] 7.5 Escribir test `useRoundsAdminWebSocketSync.test.tsx` — verifica suscripción y cleanup con `ws.on`/`ws.off` mockeados

## 8. Frontend — componentes UI

- [x] 8.1 Crear `Dashboard/src/components/orders/OrderFilters.tsx` — header sticky con inputs controlados: `date` (type="date"), `sector_id` (Select poblado desde `sectorStore`), `status` (Select con 7 estados + "Todos"), `table_code` (Input con debounce 300ms), botón "Limpiar filtros", botón icono-refresh
- [x] 8.2 Crear `Dashboard/src/components/orders/OrderCard.tsx` — card compacta con `table_code`, `sector_name`, `items_count`, tiempo en estado (calc desde timestamp de último estado), `Badge` de estado, click → `onOpenDetail(id)`
- [x] 8.3 Crear `Dashboard/src/components/orders/OrderColumn.tsx` — columna con título + contador + lista scrollable de `OrderCard`, mensaje "Sin rondas" si vacío, limita a 50 cards (skill `vercel-react-best-practices` — memoizar)
- [x] 8.4 Crear `Dashboard/src/components/orders/OrderListTable.tsx` — tabla usando componente `Table` existente, columnas: #, mesa, sector, estado (Badge), items, total ($), creada, acciones; filas clicables abren detalle
- [x] 8.5 Crear `Dashboard/src/components/orders/OrderDetailsModal.tsx` — Modal reutilizable con timeline de timestamps, items (list con voided marker), metadata (mesa, sector, comensal, creado por rol), botón "Cancelar ronda" (condicionado a rol + estado cancelable)
- [x] 8.6 Crear `Dashboard/src/components/orders/CancelOrderDialog.tsx` — ConfirmDialog con textarea `cancel_reason` (required, max 500, counter), valida antes de submit, deshabilita botón mientras loading
- [x] 8.7 Tests unit de los componentes principales (`OrderCard`, `OrderFilters`, `CancelOrderDialog`) — renders, callbacks, validaciones
- [x] 8.8 Garantizar a11y: `aria-label` en buttons-icono, `role="dialog"` en modales (lo hace `Modal`), focus trap en el dialog

## 9. Frontend — página Orders

- [x] 9.1 Crear `Dashboard/src/pages/Orders.tsx` — skeleton siguiendo skill `dashboard-crud-page`: `PageContainer`, header con título + `HelpButton` + toggle vista
- [x] 9.2 Seleccionar store vía selectores (nunca destructurar): `selectAdminRounds`, `selectRoundsLoading`, `selectRoundsFilters`, `selectRoundsTotal`, `selectSelectedRound`
- [x] 9.3 Acciones vía `useRoundsAdminActions()` con `useShallow`
- [x] 9.4 Integrar `useRoundsAdminWebSocketSync()` en la página
- [x] 9.5 Sincronizar `activeBranchId` con `filters.branch_id`: en cambio de branch, resetear filters y refetch
- [x] 9.6 Persistir `viewMode` en `localStorage` (`orders.viewMode`) con helper get/set como `kitchenDisplayStore` hace con audio
- [x] 9.7 Renderizar vista condicional: columnas (`OrderColumn` × 4) o lista (`OrderListTable` + `Pagination`)
- [x] 9.8 Manejar estados: loading (Skeleton), error (mensaje + retry), empty (mensaje + "Limpiar filtros")
- [x] 9.9 Abrir `OrderDetailsModal` cuando `selectedRoundId` está seteado; al cerrar, limpiar selección
- [x] 9.10 Enganchar flujo de cancelación: card/row → modal detalle → "Cancelar" → `CancelOrderDialog` → `cancelRound(id, reason)` → toast éxito/error
- [x] 9.11 RBAC condicional en UI: `authStore.roles.includes('ADMIN' || 'MANAGER')` controla visibilidad del botón "Cancelar" en modal y en OrderCard (si se decide mostrar ahí)
- [x] 9.12 Escribir `Dashboard/src/pages/Orders.test.tsx`
- [x] 9.13 Test: renderiza empty state cuando `selectAdminRounds` retorna EMPTY_ROUNDS
- [x] 9.14 Test: cambio de filtro dispara `fetchRounds` (spy en acción)
- [x] 9.15 Test: click en card abre modal de detalle
- [x] 9.16 Test: botón "Cancelar ronda" visible con role MANAGER, ausente con role WAITER
- [x] 9.17 Test: flujo completo cancelación — abre modal → click cancelar → escribe reason → submit llama `cancelRound` → toast éxito
- [x] 9.18 Test: toggle de vista persiste en localStorage (mockear `localStorage`)
- [x] 9.19 Test: cambio de branch activa refetch

## 10. Frontend — integración con router y sidebar

- [x] 10.1 En `Dashboard/src/router.tsx` agregar lazy import `OrdersPage` y ruta `/orders` con `handle: { breadcrumb: 'layout.breadcrumbs.orders' }`
- [x] 10.2 En `Dashboard/src/components/layout/Sidebar.tsx` remover `disabled: true` del item `/orders`
- [x] 10.3 Agregar labels i18n en `Dashboard/src/i18n/` (es): `layout.sidebar.orders`, `layout.breadcrumbs.orders`, `orders.title`, `orders.filters.*`, `orders.columns.*`, `orders.actions.*`, `orders.dialog.*`, `orders.empty.*`

## 11. Help content

- [x] 11.1 Agregar entrada `orders` en `Dashboard/src/utils/helpContent.tsx` siguiendo estructura existente: title + description + sections (Estados, Filtros, Cancelación)
- [x] 11.2 Sin tildes ni emojis (alinear con estilo del archivo actual)
- [x] 11.3 Explicar cada uno de los 7 estados brevemente + quién puede cancelar
- [x] 11.4 Test: render de `<HelpButton page="orders" />` muestra el contenido registrado

## 12. Integración end-to-end y limpieza

- [x] 12.1 Correr `pytest backend/` — todos en verde (pre-existentes + nuevos)
- [x] 12.2 Correr `vitest run` en Dashboard — todos en verde
- [x] 12.3 Lint + typecheck: `pnpm lint && pnpm typecheck` en Dashboard, `ruff + mypy` en backend
- [x] 12.4 Validar que `openspec validate --strict` pasa para el change
- [x] 12.5 Smoke test manual: login como MANAGER, abrir `/orders`, aplicar filtros, ver columnas + lista, abrir detalle, cancelar una ronda de prueba, verificar que `ROUND_CANCELED` WS actualiza la UI en tiempo real
- [x] 12.6 Smoke test manual: login como WAITER, intentar `/orders` — verificar que el botón "Cancelar" no aparece (aunque la ruta esté accesible)
- [x] 12.7 Code review checklist (skill `requesting-code-review`): no CRUDFactory, no `== True` en SQLA, no `?? []` inline, no destructuring de stores, no `print()`, no `console.log`, precios en centavos, IDs string en frontend
- [x] 12.8 Actualizar `openspec/CHANGES.md` si corresponde (marcar C-25 como in-progress o ready)
