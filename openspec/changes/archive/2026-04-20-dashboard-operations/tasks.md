## 1. Pre-implementation — Skills y contexto (OBLIGATORIO)

- [x] 1.1 Leer `.agents/SKILLS.md` y cargar todas las skills aplicables: `clean-architecture`, `fastapi-domain-service`, `fastapi-code-review`, `api-security-best-practices`, `python-testing-patterns`, `test-driven-development`, `systematic-debugging`, `dashboard-crud-page`, `react19-form-pattern`, `zustand-store-pattern`, `ws-frontend-subscription`, `help-system-content`, `vercel-react-best-practices`, `typescript-advanced-types`, `tailwind-design-system`, `postgresql-optimization` (para `SalesService`).
- [x] 1.2 Releer `knowledge-base/01-negocio/04_reglas_de_negocio.md` §2 (Round Lifecycle), §6 (Kitchen Ticket), §7 (Billing FIFO + Check states), §11 (RBAC), §12 (Asignación de Mozos).
- [x] 1.3 Releer `knowledge-base/02-arquitectura/04_eventos_y_websocket.md` §Routing de eventos (matriz de roles) y §Flujo 1 ROUND_PENDING end-to-end.
- [x] 1.4 Releer `knowledge-base/02-arquitectura/03_api_y_endpoints.md` §/api/admin/* y §/api/kitchen/* para confirmar paths exactos y shapes. Verificar que los endpoints de C-07/C-10/C-11/C-12/C-13 existen y son consumibles (ver `backend/rest_api/main.py` register).
- [x] 1.5 Scan rápido de `Dashboard/src/` para conocer el estado actual: `MainLayout`, `branchStore`, `dashboardWS`, hooks (`useFormModal`, `useConfirmDialog`, `usePagination`), `helpContent.tsx`, páginas de referencia (Categories, Allergens, Products), `utils/constants.ts` (`STORE_VERSIONS`, `STORAGE_KEYS`), `services/cascadeService.ts`, `services/api.ts`.

## 2. Backend — SalesService (capability `sales-reporting`)

- [x] 2.1 Crear `backend/rest_api/schemas/sales.py` con: `DailyKPIsOutput` (`revenue_cents: int, orders: int, average_ticket_cents: int, diners: int`), `TopProductOutput` (`product_id: int, product_name: str, quantity_sold: int, revenue_cents: int`). Todos `ConfigDict(from_attributes=True)`.
- [x] 2.2 Crear `backend/rest_api/services/domain/sales_service.py` con `SalesService` (no extiende `BranchScopedService` — es read-only aggregator). Constructor recibe `db: Session`. Implementar `get_daily_kpis(branch_id: int, date: date, tenant_id: int) -> DailyKPIsOutput`: SELECT sobre `Check` con `status == "PAID"`, `is_active.is_(True)`, join `Branch` para filtrar `tenant_id`, bound temporal `[date 00:00 UTC, date+1 00:00 UTC)`. Calcular revenue sumando `Payment.amount_cents` con `status="APPROVED"`; orders = count distinct Check; average_ticket = `revenue // orders` (0 si orders=0); diners = count distinct `Diner.id` via `Check → TableSession → Diner`. Usar eager loading o subqueries agregadas (elegir la más performante — documentar en docstring).
- [x] 2.3 Implementar `get_top_products(branch_id: int, date: date, tenant_id: int, limit: int = 10) -> list[TopProductOutput]`: JOIN `RoundItem → Round → TableSession → Check (status=PAID)` con filtros `Check.is_active.is_(True)`, `RoundItem.is_voided.is_(False)`, `Branch.tenant_id == tenant_id`, GROUP BY `product_id, product_name`, ORDER BY `SUM(price_cents_snapshot * quantity) DESC`, LIMIT `limit`. Cap limit a 50 con `min(limit, 50)`.
- [x] 2.4 Exportar `SalesService` en `backend/rest_api/services/domain/__init__.py`.
- [x] 2.5 Crear `backend/rest_api/routers/admin/sales.py` (thin router). Endpoints: `GET /api/admin/sales/daily` (query params: `branch_id: int`, `date: date`), `GET /api/admin/sales/top-products` (query params: `branch_id: int`, `date: date`, `limit: int = Query(10, ge=1, le=50)`). Ambos: `ctx = PermissionContext(user)`, `ctx.require_management()`, `ctx.require_branch_access(branch_id)`, delegar a `SalesService`. Response models `DailyKPIsOutput` y `list[TopProductOutput]`.
- [x] 2.6 Registrar el router en `backend/rest_api/main.py` con prefix correcto (seguir patrón existente de C-15 `admin_products.router`, sin doble prefix).
- [x] 2.7 Crear `backend/tests/test_sales_service.py`: `test_daily_kpis_aggregates_only_paid_checks`, `test_daily_kpis_zero_when_no_sales`, `test_daily_kpis_excludes_other_tenants`, `test_daily_kpis_excludes_other_branches`, `test_daily_kpis_date_bounds_respected` (check creado 23:59:59 del día X va en X, 00:00:00 del día X+1 NO va en X), `test_top_products_ordered_by_revenue_desc`, `test_top_products_excludes_voided_items`, `test_top_products_respects_limit`, `test_top_products_empty_when_no_sales`.
- [x] 2.8 Crear `backend/tests/test_sales_router.py`: `test_admin_get_daily_200`, `test_manager_get_daily_200_branch_access`, `test_manager_get_daily_403_no_branch_access`, `test_waiter_403`, `test_kitchen_403`, `test_cross_tenant_403`, `test_invalid_date_422`, `test_top_products_limit_gt_50_422`, `test_top_products_default_limit_10`.

## 3. Backend — ReceiptService (capability `receipt-printing`)

- [x] 3.1 Crear `backend/rest_api/schemas/receipt.py` (si se necesita para type hints internos — opcional, el endpoint retorna raw HTML).
- [x] 3.2 Crear `backend/rest_api/services/domain/receipt_service.py` con clase `ReceiptService`. Método `render(check_id: int, tenant_id: int) -> str`:
  - Query: `SELECT Check` con `selectinload(Check.charges).selectinload(Charge.round_item).selectinload(RoundItem.product)` (si `Charge.round_item_id` existe; si no, via `Check.session.rounds[].items[]`), `selectinload(Check.payments)`, join `TableSession → Table → Branch` filtrando `Branch.tenant_id == tenant_id`.
  - Raise `NotFoundError("Cuenta", check_id)` si no existe o cross-tenant.
  - Construir `items_lines: list[tuple[quantity, name, unit_cents, subtotal_cents]]`, `payments_lines`, `total_cents`.
  - Renderizar vía f-string template (simple) o Jinja2 — elegir f-string para evitar dependencia nueva. Template inline con `@media print { @page { size: 80mm auto; margin: 2mm; } body { font-family: monospace; font-size: 12px; } }`, header con nombre restaurante + dirección, divisor, líneas de items (formato `qty x name .......... $subtotal`), divisor, total en línea separada, lista de pagos, footer "Gracias por su visita".
  - Retornar `str` HTML (nada de `safe_commit` — es read-only).
- [x] 3.3 Exportar `ReceiptService` en `backend/rest_api/services/domain/__init__.py`.
- [x] 3.4 Crear `backend/rest_api/routers/admin/checks.py` (nuevo) con `GET /api/admin/checks/{check_id}/receipt`. Dependencias: `current_user` + `PermissionContext`. Instanciar `ReceiptService(db)`, llamar `render()`, retornar `HTMLResponse(content=html, status_code=200)`. Permisos: `ctx.require_management()`; verificar acceso a branch del check vía join (el service puede lanzar `NotFoundError` si tenant mismatch; el router mapea a 404).
- [x] 3.5 Aplicar SlowAPI rate limit 20/min per-user al endpoint (seguir patrón de `backend/rest_api/routers/billing.py` de C-12).
- [x] 3.6 Registrar el router en `backend/rest_api/main.py`.
- [x] 3.7 Crear `backend/tests/test_receipt_service.py`: `test_render_returns_html_string`, `test_render_includes_all_items`, `test_render_includes_payments_and_total`, `test_render_html_has_print_styles`, `test_render_cross_tenant_raises_not_found`, `test_render_nonexistent_raises_not_found`, `test_render_uses_ascii_safe_characters` (scan el output).
- [x] 3.8 Crear `backend/tests/test_receipt_router.py`: `test_admin_get_receipt_200_content_type_html`, `test_manager_with_branch_access_200`, `test_manager_without_branch_access_403`, `test_waiter_403`, `test_kitchen_403`, `test_cross_tenant_404`, `test_nonexistent_check_404`, `test_rate_limit_20_per_minute_exceeded_429`.

## 4. Frontend — Tipos, validadores, constantes (Dashboard)

- [x] 4.1 Extender `Dashboard/src/utils/constants.ts`: agregar entries en `STORE_VERSIONS` y `STORAGE_KEYS` para `TABLE_STORE`, `SECTOR_STORE`, `STAFF_STORE`, `WAITER_ASSIGNMENT_STORE`, `SALES_STORE` (ver §D12 del design). También agregar constantes de urgencia Kitchen Display: `KITCHEN_URGENCY_THRESHOLDS_MIN = { warning: 5, high: 10, critical: 15 }`.
- [x] 4.2 Crear `Dashboard/src/types/operations.ts` con interfaces: `Table { id: string, number: int, code: string, sector_id: string, capacity: int, status: string, branch_id: string, is_active: boolean }`, `Sector { id: string, name: string, branch_id: string, is_active: boolean }`, `StaffUser { id: string, email: string, first_name: string, last_name: string, is_active: boolean, assignments: Array<{ branch_id: string, branch_name: string, role: Role }> }`, `WaiterAssignment { id: string, user_id: string, sector_id: string, date: string, user?: UserMini, sector?: SectorMini }`, `KitchenRound { id: string, session_id: string, branch_id: string, status: 'SUBMITTED'|'IN_KITCHEN'|'READY', submitted_at: string, table_number: int, sector_name: string, diner_count: int, items: KitchenRoundItem[] }`, `KitchenRoundItem { product_name: string, quantity: int, notes?: string, is_voided: boolean }`, `DailyKPIs { revenue_cents: int, orders: int, average_ticket_cents: int, diners: int }`, `TopProduct { product_id: string, product_name: string, quantity_sold: int, revenue_cents: int }`. Todos con `FormData` counterparts cuando aplique.
- [x] 4.3 Extender `Dashboard/src/utils/validation.ts` con `validateTable`, `validateSector`, `validateStaff`, `validateWaiterAssignment` (usando los helpers existentes `isValidNumber`, `isPositiveNumber`).
- [x] 4.4 Extender `Dashboard/src/services/cascadeService.ts`: agregar `getSectorPreview(sectorId)` y `deleteSectorWithCascade(sectorId)` (reutilizando la misma UI de preview que Categories).

## 5. Frontend — API clients y WS types

- [x] 5.1 Crear `Dashboard/src/services/tableAPI.ts` con `list(branchId)`, `get(id)`, `create(data)`, `update(id, data)`, `delete(id)`. Usar el `fetchAPI` existente con conversión `parseInt(id, 10)` en boundary.
- [x] 5.2 Crear `Dashboard/src/services/sectorAPI.ts` — mismo patrón.
- [x] 5.3 Crear `Dashboard/src/services/staffAPI.ts` — incluye `assignRole(userId, branchId, role)`, `revokeRole(userId, branchId)`.
- [x] 5.4 Crear `Dashboard/src/services/waiterAssignmentAPI.ts` — `list(date, branchId?)`, `create(sectorId, userId, date)`, `delete(sectorId, assignmentId)`.
- [x] 5.5 Crear `Dashboard/src/services/kitchenAPI.ts` — `listRounds(branchId, status?)`, `patchRoundStatus(roundId, status)` (hits `/api/admin/rounds/{id}`).
- [x] 5.6 Crear `Dashboard/src/services/salesAPI.ts` — `getDailyKPIs(branchId, date)`, `getTopProducts(branchId, date, limit=10)`.
- [x] 5.7 Crear `Dashboard/src/services/receiptAPI.ts` — `getReceiptUrl(checkId)` retorna URL completa con token (resolver **OQ-1** del design: probar `fetch + blob + URL.createObjectURL + window.open`; si el print dialog no funciona bien con blob URL, fallback a query param `?token=`. Documentar decisión en un comentario header).
- [x] 5.8 Extender `Dashboard/src/types/menu.ts` (o el archivo canónico de `WSEvent`) con los tipos de evento adicionales si no están: `ROUND_SUBMITTED`, `ROUND_IN_KITCHEN`, `ROUND_READY`, `ROUND_CANCELED`, `TABLE_STATUS_CHANGED`, `TABLE_SESSION_STARTED`, `TABLE_CLEARED`. Verificar primero si C-15 ya los agregó — si sí, no duplicar.

## 6. Frontend — Stores Zustand (6 stores)

- [x] 6.1 Crear `Dashboard/src/stores/sectorStore.ts` siguiendo el patrón canónico (`persist` con `version` y `migrate` stub v1, selectores `useShallow`, `EMPTY_SECTORS: Sector[] = []`, acciones `fetchByBranch`, `createSectorAsync`, `updateSectorAsync`, `deleteSectorAsync`, `handleWSEvent`). Re-usar la estructura de `categoryStore.ts`.
- [x] 6.2 Crear `Dashboard/src/stores/tableStore.ts` idéntico patrón. Acciones incluyen un `handleTableStatusChanged(event)` que patchea solo el `status` del row afectado.
- [x] 6.3 Crear `Dashboard/src/stores/staffStore.ts`. Acciones extra: `assignRoleAsync(userId, branchId, role)`, `revokeRoleAsync(userId, branchId)`.
- [x] 6.4 Crear `Dashboard/src/stores/waiterAssignmentStore.ts`. Estado `{ assignments, selectedDate, isLoading }`. Acciones `fetchByDate(date, branchId?)`, `createAsync`, `deleteAsync`.
- [x] 6.5 Crear `Dashboard/src/stores/kitchenDisplayStore.ts` — **SIN `persist`** (ver §D4 del design). Estado: `{ rounds: KitchenRound[], isLoading: boolean, audioEnabled: boolean }`. `audioEnabled` se inicializa desde `localStorage.getItem('kitchenDisplay.audio') === 'true'` y cambios llaman `localStorage.setItem`. Acciones: `fetchSnapshot(branchId)`, `handleRoundSubmitted(e)`, `handleRoundInKitchen(e)`, `handleRoundReady(e)`, `handleRoundCanceled(e)`, `toggleAudio()`, `reset()`.
- [x] 6.6 Crear `Dashboard/src/stores/salesStore.ts`. Estado: `{ daily: DailyKPIs | null, topProducts: TopProduct[], isLoading: boolean, selectedDate: string }`. Acciones: `fetchDaily(branchId, date)`, `fetchTopProducts(branchId, date, limit)`, `setDate(date)`, `reset()`.

## 7. Frontend — Hooks y helpers operativos

- [x] 7.1 Crear `Dashboard/src/hooks/useKitchenWebSocketSync.ts` — hook que, dado `branchId`, aplica el ref pattern de dos efectos: (a) efecto 1 sincroniza `handleEventRef`, (b) efecto 2 suscribe `dashboardWS.onFiltered(branchId, '*', ...)` para los 4 eventos ROUND_*, y `dashboardWS.onConnectionChange(isConnected => { if (isConnected) store.fetchSnapshot(branchId) })`. Retorna `unsubscribe` limpio en ambos. Usar la skill `ws-frontend-subscription`.
- [x] 7.2 Crear `Dashboard/src/hooks/useTableWebSocketSync.ts` — similar pero para `TABLE_*` eventos. Conecta al `tableStore`.
- [x] 7.3 Crear `Dashboard/src/hooks/useNowTicker.ts` — retorna un `Date` que se actualiza cada 30s vía `setInterval`. Usado por Kitchen Display para recalcular urgencia sin re-render full.
- [x] 7.4 Crear `Dashboard/src/utils/formatPrice.ts` (si no existe ya de C-15) — `formatPrice(cents: number): string` retorna `"$125.50"` con `Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })`.

## 8. Frontend — Componentes compartidos nuevos

- [x] 8.1 Crear `Dashboard/src/components/kitchen/KitchenTicketCard.tsx` — props: `round: KitchenRound, now: Date, onStatusChange: (status) => void`. Muestra header (mesa, sector, timer), lista de items, `UrgencyBadge`, action button según status.
- [x] 8.2 Crear `Dashboard/src/components/kitchen/UrgencyBadge.tsx` — deriva la clase Tailwind del tiempo elapsed usando `KITCHEN_URGENCY_THRESHOLDS_MIN`. Colores: `<5min → bg-green-500`, `5-10min → bg-yellow-500`, `10-15min → bg-orange-500`, `>15min → bg-red-500`. ARIA label con el estado textual.
- [x] 8.3 Crear `Dashboard/src/components/kitchen/KitchenTicketColumn.tsx` — props: `title, status, rounds, now, onStatusChange`. Layout columna con header y lista de cards.
- [x] 8.4 Crear `Dashboard/src/components/sales/SalesKPICard.tsx` — props: `label, value, format: 'currency'|'number'`. Card simple con valor grande y label.
- [x] 8.5 Crear `Dashboard/src/components/sales/ReceiptButton.tsx` — props: `checkId`. `onClick` dispara `receiptAPI.getReceiptUrl(checkId)` → `window.open + print`.
- [x] 8.6 Agregar `public/sounds/ready.mp3` (archivo de audio corto; dejar un placeholder comentado en el código si no se puede commitear el binario, con el path esperado).

## 9. Frontend — Páginas CRUD (Tables, Sectors, Staff, Waiter Assignments)

- [x] 9.1 Crear `Dashboard/src/pages/Sectors.tsx` siguiendo `dashboard-crud-page` skill al pie de la letra: branch-guard, hook-trio, `useActionState`, columns con `useMemo(deps=[deleteDialog, ...])`, Modal con HelpButton `size="sm"`, ConfirmDialog con `<CascadePreviewList>` via `cascadeService`. Reference: `Dashboard/src/pages/Categories.tsx`.
- [x] 9.2 Crear `Dashboard/src/pages/Tables.tsx`. Columnas: `number`, `code`, `sector` (derivado de `sectorStore` join), `capacity`, `status`, `actions`. En el modal de create/edit, el campo `sector_id` es un `<Select>` poblado desde `sectorStore`. Suscribir el hook `useTableWebSocketSync(selectedBranchId)` al montar.
- [x] 9.3 Crear `Dashboard/src/pages/Staff.tsx`. Columnas: `email`, `full_name`, `roles` (render como list of `<Badge>` con `branch_name / role`), `is_active`, `actions`. El modal de create/edit incluye una sub-sección "Asignaciones" con lista editable: cada fila `{ branch_id (Select), role (Select: WAITER/KITCHEN/MANAGER/ADMIN) }` + botón "Agregar asignación". Las mutaciones de roles se hacen via `staffAPI.assignRole` / `revokeRole` por fila. Delete button solo renderiza si `currentUserRole === 'ADMIN'`.
- [x] 9.4 Crear `Dashboard/src/pages/WaiterAssignments.tsx`. DatePicker en el header (default hoy), lista de asignaciones. Modal de create con `user_id` (Select de `staffStore` filtrado a WAITERs del branch), `sector_id` (Select de `sectorStore`), `date` (hidden, desde DatePicker). `handleDelete` llama hard-delete. No hay edit (create/delete únicamente).

## 10. Frontend — Páginas Kitchen Display y Sales

- [x] 10.1 Crear `Dashboard/src/pages/KitchenDisplay.tsx`:
  - Branch guard si `!selectedBranchId`.
  - `useKitchenWebSocketSync(selectedBranchId)` al montar; `fetchSnapshot(selectedBranchId)` en el primer effect.
  - `const now = useNowTicker()` para urgencia.
  - Layout: 3 `<KitchenTicketColumn>` lado a lado en desktop, stacked en mobile (`flex-col md:flex-row`).
  - Toggle de audio en el header usando el `Toggle` component; `onChange` llama `kitchenDisplayStore.toggleAudio()`.
  - Audio player: `useEffect(() => { subscribe('ROUND_READY', () => if (audioEnabled) new Audio('/sounds/ready.mp3').play().catch(...) )}, [audioEnabled])` — idealmente dentro del mismo hook.
  - Action buttons en cada card disparan `kitchenAPI.patchRoundStatus(roundId, newStatus)` con `handleError` + toast.
  - `helpContent.kitchenDisplay` registrado en `helpContent.tsx`.
- [x] 10.2 Crear `Dashboard/src/pages/Sales.tsx`:
  - Branch guard.
  - DatePicker (default today), selectedDate en `salesStore`.
  - 3 `<SalesKPICard>`: Ingresos (`formatPrice(daily.revenue_cents)`), Órdenes (`daily.orders`), Ticket promedio (`formatPrice(daily.average_ticket_cents)`).
  - `<Table>` con top productos (columns: name, quantity, revenue, optional ReceiptButton column). Usa `usePagination`.
  - `useEffect` en `[selectedBranchId, selectedDate]` para refetch ambos endpoints.
  - `helpContent.sales` registrado.

## 11. Frontend — Navegación, helpContent, rutas

- [x] 11.1 Actualizar `Dashboard/src/router.tsx`: agregar 6 rutas lazy-loaded (`tables`, `sectors`, `staff`, `waiter-assignments`, `kitchen-display`, `sales`) siguiendo el patrón de C-15. Breadcrumb handles con keys `layout.breadcrumbs.*`.
- [x] 11.2 Actualizar `Dashboard/src/components/layout/MainLayout.tsx` sidebar: agregar las 6 entradas con icons (lucide-react). Esconder Staff/WaiterAssignments/Sales si user no es ADMIN/MANAGER (derivar del `authStore`).
- [x] 11.3 Agregar claves i18n al `Dashboard/src/i18n/locales/es.json` (breadcrumbs, labels de sidebar, labels de columnas de tablas, placeholders).
- [x] 11.4 Extender `Dashboard/src/utils/helpContent.tsx` con 6 entradas nuevas siguiendo la estructura exacta del skill `help-system-content`: `tables`, `sectors`, `staff`, `waiterAssignments`, `kitchenDisplay`, `sales`. Cada una con `<div className="space-y-4">` → título → intro → lista de features → `<div className="bg-zinc-800 p-4 rounded-lg mt-4">` con tip. Para `sectors` agregar un bloque `<div className="bg-red-900/50">` advirtiendo del cascade delete a mesas.

## 12. Tests — Stores, hooks, páginas (Vitest)

- [x] 12.1 Crear tests `Dashboard/src/stores/{tableStore,sectorStore,staffStore,waiterAssignmentStore,kitchenDisplayStore,salesStore}.test.ts`. Cada uno: `test_initial_state`, `test_fetch_populates`, `test_create_adds_to_list`, `test_update_replaces_item`, `test_delete_marks_inactive_or_removes`, `test_migrate_from_v1_noop` (solo persisted stores). Para `kitchenDisplayStore`: `test_handle_round_submitted_upserts`, `test_handle_round_canceled_removes`, `test_toggle_audio_persists_to_localStorage`, `test_not_persisted_across_reload`.
- [x] 12.2 Crear `Dashboard/src/hooks/useKitchenWebSocketSync.test.ts`: mockea `dashboardWS`, verifica que `onFiltered` se llama con `branchId` y `'*'`, que al emitir `ROUND_SUBMITTED` el store se actualiza, que al emitir `onConnectionChange(true)` se dispara `fetchSnapshot`, que la cleanup function se invoca en unmount.
- [x] 12.3 Crear `Dashboard/src/pages/Tables.test.tsx`: renderiza fallback card sin branch, lista mesas filtradas por branch, abre modal de create y submitea, submit de edit actualiza, MANAGER no ve delete button, ADMIN ve delete button, botón delete dispara ConfirmDialog con CascadePreview.
- [x] 12.4 Crear `Dashboard/src/pages/Staff.test.tsx`: MANAGER no ve delete button en ninguna fila, ADMIN ve delete, crear usuario con asignaciones llama a los endpoints correctos, editar usuario y agregar/quitar role llama `assignRole`/`revokeRole`, email duplicado muestra error.
- [x] 12.5 Crear `Dashboard/src/pages/KitchenDisplay.test.tsx`: sin branch muestra guard, con branch hace fetch inicial, 3 columnas presentes, al llegar evento `ROUND_SUBMITTED` aparece card en columna "Enviado", al togglear audio se escribe a localStorage, urgency badge con >15min renderiza clase red.
- [x] 12.6 Crear `Dashboard/src/pages/Sales.test.tsx`: muestra KPIs con $0 cuando no hay ventas, cambio de fecha refetch, renderiza tabla top products, ReceiptButton en filas con checkId dispara `receiptAPI.getReceiptUrl`.
- [x] 12.7 Crear `Dashboard/src/pages/WaiterAssignments.test.tsx` y `Sectors.test.tsx`: create, delete, cascade preview (sectors), duplicate assignment muestra error toast.
- [x] 12.8 Correr `cd Dashboard && pnpm vitest run` — 100% nuevos tests pasan, 0 regresiones en C-14/C-15.

## 13. Verificación final y archivado-ready

- [x] 13.1 Correr `cd backend && pytest tests/test_sales_service.py tests/test_sales_router.py tests/test_receipt_service.py tests/test_receipt_router.py -v` — todos pasan.
- [x] 13.2 Correr `cd backend && pytest -q` — 0 regresiones en tests de C-07/C-10/C-11/C-12/C-13.
- [x] 13.3 Correr `cd backend && ruff check rest_api/services/domain/sales_service.py rest_api/services/domain/receipt_service.py rest_api/routers/admin/sales.py rest_api/routers/admin/checks.py` — 0 errores.
- [x] 13.4 Correr `cd backend && mypy rest_api/services/domain/sales_service.py rest_api/services/domain/receipt_service.py` — 0 errores.
- [x] 13.5 Correr `cd Dashboard && pnpm typecheck` (`tsc --noEmit`) — 0 errores.
- [x] 13.6 Correr `cd Dashboard && pnpm lint` — 0 errores, 0 warnings nuevos.
- [x] 13.7 Smoke manual — con backend + WS gateway corriendo:
  - Login ADMIN → navegar a Tables, Sectors, Staff, Waiter Assignments, Kitchen Display, Sales → todas cargan sin errores de consola.
  - RBAC: canDelete: isAdmin verificado en useAuthPermissions.ts — MANAGER no ve Delete; {canDelete && <Button>} en todas las páginas.
  - WebSocket KDS: ronda en SUBMITTED aparece en columna ENVIADOS con badge de tiempo ✅. Bugfix: kitchenAPI usaba /api/admin/rounds/kitchen (405) → corregido a /api/kitchen/rounds.
- [x] 13.8 Correr `openspec validate --strict dashboard-operations` — debe pasar.
- [x] 13.9 Actualizar `openspec/CHANGES.md` marcando C-16 como `[x]` completado — ya marcado en tabla de changes.
- [x] 13.10 Revisar que no haya `TODO`/`FIXME` sin resolver en los archivos creados. Revisar que el README del Dashboard (si existe) tenga mención a las nuevas páginas. Preparar branch y PR.
