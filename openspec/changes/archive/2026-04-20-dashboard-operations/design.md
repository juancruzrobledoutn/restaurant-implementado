## Context

El Dashboard ya tiene, al terminar C-15, lo siguiente:

- Shell (`MainLayout`, sidebar, breadcrumbs, branch selector), auth con JWT + refresh, `ProtectedRoute`, `branchStore`, `authStore`, `toastStore`.
- Cliente WebSocket `dashboardWS` (singleton) con `on / onFiltered / onFilteredMultiple / onThrottled / onFilteredThrottled / onConnectionChange`, reconnect con backoff, heartbeat, token refresh, catch-up HTTP al reconectar.
- Hook-trio `useFormModal / useConfirmDialog / usePagination` (C-14), `useActionState` pattern para forms (React 19), `handleError` + logger centralizados.
- Componentes base: `PageContainer` (con `helpContent`), `Card`, `Modal`, `Table`, `TableSkeleton`, `Pagination`, `Button`, `Input`, `Toggle`, `Badge`, `ConfirmDialog`, `CascadePreviewList`, `HelpButton`.
- Stores Zustand: `categoryStore`, `subcategoryStore`, `productStore`, `allergenStore`, `ingredientStore`, `recipeStore` (C-15) con pattern canónico (`persist`, `version`, `migrate`, selectores + `useShallow` + `EMPTY_ARRAY`).
- Páginas CRUD: Categories, Subcategories, Products, Allergens, Ingredients, Recipes.
- Validation helpers en `utils/validation.ts`, `utils/helpContent.tsx`, `services/cascadeService.ts`.
- Backend: los endpoints admin de sectores/mesas (C-07), staff + waiter-assignments (C-13), rounds (C-10), kitchen (C-10+C-11), billing (C-12) están todos archivados y funcionales. Solo faltan Sales y el endpoint de recibo.

C-16 completa el Dashboard operativo: mesa, sector, personal, asignaciones, cocina en tiempo real, ventas del día e impresión de recibo. Es la última pieza antes de arrancar los frontends pwa.

## Goals / Non-Goals

**Goals:**
- Dashboard con 6 páginas operativas funcionales (Tables, Sectors, Staff, Waiter Assignments, Kitchen Display, Sales), siguiendo exactamente los patrones de C-15.
- Backend: nuevos endpoints `/api/admin/sales/*` y `/api/admin/checks/{id}/receipt` con Clean Architecture estricta.
- Kitchen Display en tiempo real con WebSocket + refetch en reconexión.
- Recibo HTML imprimible desde el Dashboard (impresora térmica 58/80 mm).
- Tests: stores con WS events, páginas con branch-guard y RBAC, `SalesService` y `ReceiptService` con casos cross-tenant.

**Non-Goals:**
- No se construye pwaWaiter ni pwaMenu (C-17+ en adelante).
- No se implementa PDF de recibo (solo HTML; PDF es trabajo futuro si se necesita).
- No se agregan KPIs avanzados (histórico, comparativas, gráficos) — solo los 4 KPIs del scope: revenue, órdenes, ticket promedio, top productos.
- No se implementa edición multi-ronda en Kitchen Display — las acciones son las existentes (start → ready → delivered).
- No se construye un `AudioAlertSettings` global — el toggle vive en el componente Kitchen Display con `localStorage`.
- No se expone el endpoint `/api/admin/rounds/{id}` PATCH al Kitchen Display para el rol KITCHEN — Kitchen ya tiene su propio endpoint `/api/kitchen/tickets/{id}` (C-11). El Dashboard Kitchen Display es para ADMIN/MANAGER, que usan `/api/admin/rounds/{id}`.

## Decisions

### D1. Backend — `SalesService` se apoya en `Charge` (no en `RoundItem`)

**Decisión**: `SalesService.daily_revenue` y `top_products` agregan sobre `Charge` joined con `Check` (status=PAID) y `RoundItem` (via `round_item_id` si existe, o directamente via `Check.session_id → Round → RoundItem`). El filtro `Check.status == "PAID"` es obligatorio.

**Alternativa considerada**: agregar directamente sobre `RoundItem.price_cents_snapshot` con `Round.status != "CANCELED"`. **Rechazada** porque (a) una ronda SERVED sin pago no debe contar como venta confirmada, (b) el sistema contable es `Check → Charge → Allocation → Payment`, no las rondas, (c) las rondas canceladas después de SUBMITTED quedan con `status=CANCELED` pero sus items siguen en `RoundItem` — contar sobre ellos sobreestima ventas.

**Cuidado**: el modelo `Charge` tiene `check_id` + `diner_id` + `amount_cents`. Para `top_products` hay que join con `RoundItem` (un `Charge` debe referenciar su `RoundItem` — verificar si existe esa FK; si no, derivarla del `Check.session_id → Round.items`).

### D2. Backend — `ReceiptService` genera HTML, no PDF

**Decisión**: `ReceiptService.render(check_id, tenant_id)` retorna un `str` con HTML que incluye `@media print { @page { size: 80mm auto; margin: 2mm; } }` y estilos mono-espaciados optimizados para impresora térmica. El endpoint `GET /api/admin/checks/{id}/receipt` responde `Content-Type: text/html; charset=utf-8` y el frontend lo abre en `window.open()` + `window.print()`.

**Alternativa considerada**: generar PDF con `weasyprint` o `reportlab`. **Rechazada** porque (a) la impresora térmica acepta HTML desde el browser vía el diálogo nativo de print (controladores ESC/POS ya traducen HTML a comandos de impresora), (b) HTML es 10 líneas de template vs. una dependencia pesada, (c) no hay requisito de archivar el PDF.

### D3. Backend — estructura del router

**Decisión**: crear `backend/rest_api/routers/admin/sales.py` (nuevo) y agregar el endpoint `GET /api/admin/checks/{id}/receipt` en un nuevo `backend/rest_api/routers/admin/checks.py` en vez de ensuciar el router de billing (que es de consumo por el comensal/mozo). Ambos usan `PermissionContext.require_management()`.

### D4. Frontend — `kitchenDisplayStore` no persiste, refetch en reconexión

**Decisión**: `kitchenDisplayStore` NO usa `persist()`. Mantiene el snapshot en memoria: `rounds: RoundWithItems[]`, `audioEnabled: boolean` (este último sí persistido en `localStorage` directamente, clave `kitchenDisplay.audio`).

Al conectar WebSocket (efecto 2 del ref pattern) llama a `fetchKitchenRounds(selectedBranchId)` para obtener el snapshot actual; al recibir `onConnectionChange(true)` hace lo mismo. Los eventos `ROUND_SUBMITTED/IN_KITCHEN/READY/CANCELED` parchan el store en memoria (upsert por `round.id` + status).

**Alternativa considerada**: persistir el snapshot en `localStorage` con TTL. **Rechazada** porque los datos cambian en segundos; un snapshot viejo confunde al usuario. Un refetch de ~200 filas es económico y resuelve el caso de uso.

### D5. Frontend — Kitchen Display layout y urgencia

**Decisión**: 3 columnas flex responsivas (mobile → vertical stacked), cada `KitchenTicketCard` con:
- Header: número de mesa + sector + diner count + timer (`now - submitted_at`).
- Items: lista plana con `quantity × product_name`, notas en itálica.
- Badge de urgencia: `<5min` verde, `5-10min` amarillo, `10-15min` naranja, `>15min` rojo (configurable vía constantes, no hardcoded en el componente).
- Acciones al final: botones según status actual (SUBMITTED → "Iniciar preparación", IN_KITCHEN → "Marcar listo", READY → "Marcar entregado"). Cada uno dispara el PATCH apropiado.

El timer live se re-renderiza cada 30s con un `setInterval` en el componente padre que actualiza un `now` en estado local (no en el store — evita re-render de todos los cards).

### D6. Frontend — audio alert

**Decisión**: un toggle (`<Toggle>`) persistido en `localStorage['kitchenDisplay.audio']`. Cuando está ON y llega un evento `ROUND_READY`, se reproduce `/public/sounds/ready.mp3` (archivo estático incluido en el repo; 1–2 segundos). Si `audioContext` no está inicializado, se intenta `new Audio(...).play()` con catch silencioso — los browsers requieren gesto del usuario para el primer play, así que el primer toggle = gesto.

### D7. Frontend — Sales page

**Decisión**: filtros en la página = `{ branchId: selectedBranchId, date: Date (default hoy) }`. Se muestran 4 KPI cards (revenue, órdenes, ticket promedio, # comensales) + tabla top productos con paginación del trío estándar. El fetch es `GET /api/admin/sales/daily?branch_id=X&date=YYYY-MM-DD` y `GET /api/admin/sales/top-products?branch_id=X&date=YYYY-MM-DD&limit=10`.

Los valores de `revenue_cents` en la respuesta se convierten a pesos en el componente (no en el store — el store guarda cents).

### D8. Frontend — Staff + Waiter Assignments: relación y placement

**Decisión**: son 2 páginas separadas en la sidebar. `Staff.tsx` gestiona el usuario (crear, editar, soft-delete) y sus roles por sucursal (sub-form "Asignaciones" dentro del modal de edición que permite agregar/quitar `UserBranchRole` por branch). `WaiterAssignments.tsx` gestiona la asignación **diaria** del mozo a un sector — es un listado por fecha (default hoy) con create/delete y un picker de fecha. Son modelos distintos: `UserBranchRole` es permanente (rol del user en un branch), `WaiterSectorAssignment` es ephemeral (día concreto).

### D9. Frontend — `ReceiptButton` en la página Sales

**Decisión**: en la tabla de "últimas órdenes" o "últimos checks" de la página Sales hay un botón por fila que dispara:

```typescript
const url = `${env.VITE_API_URL}/api/admin/checks/${checkId}/receipt`
const w = window.open(url, '_blank', 'width=400,height=600')
w?.addEventListener('load', () => w.print())
```

El endpoint incluye el `Authorization` header implícitamente si el window.open hereda cookies, pero como el JWT vive en memoria (no en cookie), el backend debe aceptar un query param `?token=...` en este endpoint específico. Alternativa: exponer un endpoint POST que genera un token de un solo uso, y el GET usa ese token. **Por simplicidad en C-16 usamos query param con el JWT** (igual que el WebSocket), con rate limit de 20/min.

### D10. Frontend — tests con WebSocket mock

**Decisión**: los tests del `kitchenDisplayStore` mockean `dashboardWS` vía `vi.mock('@/services/websocket', () => ({ dashboardWS: mockWS }))`. El mock expone `on`, `onFiltered`, `onConnectionChange`, `_emit(event)` (helper de test). El hook `useKitchenWebSocketSync` se testea dispatcheando eventos manualmente y asertando el estado del store.

### D11. Cascade delete en `sectorStore`

**Decisión**: eliminar un `BranchSector` soft-deletea todas sus `app_table` (ya implementado en backend C-07 como `_after_delete` cascade). El frontend muestra `CascadePreviewList` con el conteo afectado. `cascadeService.ts` debe ganar `getSectorPreview(sectorId)` y `deleteSectorWithCascade(sectorId)`.

### D12. `STORE_VERSIONS` y `STORAGE_KEYS`

**Decisión**: agregar a `Dashboard/src/utils/constants.ts`:
```
STORE_VERSIONS.TABLE_STORE = 1
STORE_VERSIONS.SECTOR_STORE = 1
STORE_VERSIONS.STAFF_STORE = 1
STORE_VERSIONS.WAITER_ASSIGNMENT_STORE = 1
STORE_VERSIONS.SALES_STORE = 1
STORAGE_KEYS.TABLE_STORE = 'integrador.dashboard.tables'
STORAGE_KEYS.SECTOR_STORE = 'integrador.dashboard.sectors'
STORAGE_KEYS.STAFF_STORE = 'integrador.dashboard.staff'
STORAGE_KEYS.WAITER_ASSIGNMENT_STORE = 'integrador.dashboard.waiter-assignments'
STORAGE_KEYS.SALES_STORE = 'integrador.dashboard.sales'
```
`kitchenDisplayStore` NO tiene entrada porque no se persiste (ver D4).

## Risks / Trade-offs

- **[Risk] Kitchen Display pierde eventos durante una desconexión larga** → Mitigation: al `onConnectionChange(true)` el store hace `fetchKitchenRounds(branchId)` refetch completo; el `catchup` HTTP del `dashboardWS` cubre el gap si el hueco es corto.
- **[Risk] `SalesService` consulta potencialmente cara (JOIN check+charge+round+round_item)** → Mitigation: índices ya existentes por `branch_id` + `created_at`; limitar a 1 día por request (no rangos largos); `top_products` limitado a top 10 por default (max 50).
- **[Risk] El HTML del recibo no imprime igual en todas las impresoras térmicas** → Mitigation: usar solo caracteres ASCII seguros (sin emojis, sin tildes problemáticas), `font-family: monospace`, `@page size: 80mm auto`, smoke-test manual con impresora real antes de archivar.
- **[Risk] `window.open + print` con JWT en query** → Mitigation: rate limit 20/min en el endpoint, JWT se valida igual que en header, el query param no se loguea (configurar logging del servidor para redactar `?token=`).
- **[Risk] Timer de urgencia en Kitchen Display re-renderiza demasiado** → Mitigation: `setInterval(30000)` compartido en el padre que setea un `now` local; cada card deriva su urgencia vía `useMemo` dependiendo de `now` y `submitted_at`.
- **[Risk] `MANAGER` no debería poder soft-delete `User` pero el endpoint `/admin/staff DELETE` podría ser accesible** → Mitigation: el endpoint ya hace `require_admin()` (C-13 task 4.1). El frontend oculta el botón Delete si `user.roles` no incluye `ADMIN`.
- **[Trade-off] `kitchenDisplayStore` en memoria obliga a refetch** → Acceptable: menor complejidad, evita stale snapshots.
- **[Trade-off] Audio alert usa archivo estático en `/public`** → Acceptable: no hay CDN en dev; en prod lo sirve Vite build.

## Migration Plan

- No hay migración de datos — solo nuevas tablas de endpoint (backend) y nuevas páginas (frontend).
- Rollback: revertir el PR. Los endpoints nuevos pueden quedar sin consumers sin afectar al resto. Las rutas del Dashboard ya no aparecen en la sidebar si se revierte `MainLayout`.
- El backend NO necesita migración Alembic nueva (no hay modelos nuevos). Si al implementar `SalesService` se descubre una FK faltante entre `Charge` y `RoundItem`, eso se resuelve en un change separado, no acá.

## Open Questions

- **OQ-1**: ¿El endpoint `GET /api/admin/checks/{id}/receipt` debe aceptar `?token=` o el frontend debe hacer `fetch` con `Authorization` y convertir el response a blob + `URL.createObjectURL` + `window.open(blob_url)`? → **Decisión pendiente en apply**: usar `fetch + blob` si el sub-agent confirma que la impresión desde blob URL funciona; fallback a `?token=` si no. Documentar la decisión final en `receiptAPI.ts`.
- **OQ-2**: ¿La página Sales debe tener filtro "desde/hasta" (rango) o solo día? El scope dice "revenue diario" → implementamos solo día. Si el user lo pide luego, se agrega.
- **OQ-3**: ¿Se muestra "comensales del día" como 4º KPI? El scope dice "revenue, órdenes, ticket promedio, top productos" → 3 KPIs + tabla top productos. Agregar comensales solo si no requiere nuevo endpoint (derivable de `Check → Session → count(Diner)`).
