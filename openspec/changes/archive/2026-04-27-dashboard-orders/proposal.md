## Why

Hoy ADMIN y MANAGER pueden ver la cocina en vivo (C-16 Kitchen Display) y cada mesa individual (C-16 Tables), pero **no existe una pantalla que consolide TODAS las rondas de la sucursal** con historial, filtros y acción de cancelación. Cuando un comensal reclama un pedido "que no aparece", el staff no tiene una vista única para auditar el ciclo de vida completo (PENDING → CONFIRMED → SUBMITTED → IN_KITCHEN → READY → SERVED → CANCELED) con timestamps por transición, mesa, sector y comensal. El backend ya expone `PATCH /api/admin/rounds/{id}` (C-10) para cancelar, y los eventos WS `ROUND_*` ya se emiten por transición — falta construir **la página Orders del Dashboard** sobre infraestructura existente, más el endpoint `GET /api/admin/rounds` de listado con filtros que aún no existe.

## What Changes

- **Nueva página `/orders`** (Dashboard) visible en sidebar (slot `orders` ya reservado como `disabled: true` en `Sidebar.tsx` — se habilita):
  - **Toggle de vista**: "Columnas" (tablero kanban por estado) vs "Lista" (tabla con paginación).
  - **Vista Columnas** — 4 columnas compactas (PENDING / CONFIRMED / SUBMITTED / READY), una card por ronda con mesa, sector, #items, comensal (cuando aplica), tiempo en estado. IN_KITCHEN y SERVED se omiten de esta vista (IN_KITCHEN ya está en Kitchen Display, SERVED es historial).
  - **Vista Lista** — tabla `Table` reutilizando componente UI, columnas: #ronda, mesa, sector, estado (`Badge`), creada, items, total, acciones.
  - **Detalle de ronda** (modal al hacer click en una card/row): items con producto + cantidad + notas + voided; timestamps por estado (pending_at, confirmed_at, submitted_at, in_kitchen_at, ready_at, served_at, canceled_at); `cancel_reason` si aplica; comensal que la creó; sector y mesa.
  - **Acción de cancelación** (solo MANAGER/ADMIN, visible si estado ∈ {PENDING, CONFIRMED, SUBMITTED, IN_KITCHEN, READY}): `ConfirmDialog` con textarea obligatoria `cancel_reason`, llama `PATCH /api/admin/rounds/{id}` con `{status: "CANCELED", cancel_reason}`. Emite `ROUND_CANCELED` vía backend.
  - **Filtros** sticky en el top: `date` (default = hoy, `<input type="date">`), `sector_id` (select con sectores del branch seleccionado), `status` (select multi o single con los 7 estados), `table_code` (search input, server-side). `branch_id` viene del `branchStore` activo.
  - **Empty state** cuando no hay rondas que matcheen el filtro — mensaje claro + CTA "Limpiar filtros".
  - **HelpButton** en header con entrada en `helpContent.tsx` explicando estados, filtros y cuándo cancelar (obligatorio por skill `help-system-content`).

- **Nuevo backend endpoint `GET /api/admin/rounds`** — listado de rondas con filtros y paginación:
  - Query params: `branch_id` (int, required), `date` (YYYY-MM-DD, optional, default = hoy), `sector_id` (int, optional), `status` (str, optional — uno de los 7 estados), `table_code` (str, optional — match case-insensitive sobre `table.code`), `limit` (default 50, max 200), `offset` (default 0).
  - Response: `{ items: RoundAdminOutput[], total: int, limit: int, offset: int }`.
  - Nuevo schema `RoundAdminOutput` — extiende `RoundOutput` con campos denormalizados para UI: `table_code`, `table_number`, `sector_id`, `sector_name`, `diner_name` (opcional), `items_count`, `total_cents` (suma de `price_cents_snapshot * quantity` de items no voided).
  - Método nuevo en `RoundService`: `list_for_admin(tenant_id, branch_id, filters, limit, offset) -> (items, total)`. Filtra por `tenant_id` (multi-tenant) y `branch_id` ∈ `user.branch_ids` si no es ADMIN. Query única con JOINs a Table, BranchSector, Diner; evita N+1.
  - Tests pytest: filtros por fecha/sector/status/table_code, paginación, cross-tenant 403, empty results.

- **Nuevo Zustand store `roundsAdminStore`** (Dashboard) con patrón canónico (skill `zustand-store-pattern`):
  - Estado: `rounds: Round[]`, `total`, `filters: { branch_id, date, sector_id?, status?, table_code? }`, `isLoading`, `error`, `pagination: { limit, offset }`, `selectedRoundId: string | null` (para detalle).
  - `EMPTY_ROUNDS: Round[] = []` como fallback estable.
  - Acciones: `fetchRounds(filters)`, `setFilter(key, value)`, `clearFilters()`, `selectRound(id)`, `cancelRound(id, reason)`, `reset()`.
  - **Handlers WS** (upsert por `round.id`): `handleRoundPending`, `handleRoundConfirmed`, `handleRoundSubmitted`, `handleRoundInKitchen`, `handleRoundReady`, `handleRoundServed`, `handleRoundCanceled`. Cada handler evalúa si la ronda pasa el filtro activo antes de insertar/actualizar (ej: si `filters.status === 'PENDING'` y llega `ROUND_CONFIRMED`, se quita de la lista).
  - Selectores: `selectAdminRounds`, `selectRoundsFilters`, `selectSelectedRound`, `selectRoundsLoading`, `selectRoundsTotal`.
  - Acciones via `useRoundsAdminActions()` con `useShallow`.
  - **NO persiste** — las rondas cambian constantemente, un snapshot en localStorage confunde.

- **Suscripción WebSocket** (skill `ws-frontend-subscription`): nuevo hook `useRoundsAdminWebSocketSync()` con ref pattern (dos efectos), suscribe a `ROUND_PENDING | ROUND_CONFIRMED | ROUND_SUBMITTED | ROUND_IN_KITCHEN | ROUND_READY | ROUND_SERVED | ROUND_CANCELED`, filtra por `event.branch_id === activeBranchId`, despacha al handler correspondiente. `return unsubscribe` al cleanup.

- **Tests** — Vitest + pytest:
  - Store: `fetchRounds` con filtros, WS upsert (cada tipo de evento), transición de ronda (PENDING → CONFIRMED mueve de columna), cancelación, `clearFilters`.
  - Página: renderiza empty state, filtros disparan `fetchRounds`, click en card abre modal, botón "Cancelar" visible solo para MANAGER/ADMIN, dialog con reason obligatoria, 4xx muestra toast.
  - Backend: `test_admin_rounds_list_router.py` y `test_round_service_list_for_admin.py` — filtros, paginación, tenant isolation, RBAC.

## Capabilities

### New Capabilities
- `dashboard-orders`: página `/orders` en Dashboard con vista columnas + lista, filtros (fecha, sector, estado, mesa), detalle de ronda, cancelación por MANAGER/ADMIN, WS tiempo real, `roundsAdminStore` + `useRoundsAdminWebSocketSync` + helpContent + navegación sidebar.

### Modified Capabilities
- *(ninguna)* — el endpoint `GET /api/admin/rounds` es una **adición** al capability existente `rounds` sin cambiar requisitos pre-existentes (las transiciones de estado, permisos y eventos no cambian). El backend agrega un list endpoint; no modifica contratos de rondas. El capability `rounds` (C-10) está archivado y sus requisitos siguen válidos.

## Impact

**Backend — nuevo**
- `backend/rest_api/schemas/round.py` — agrega `RoundAdminOutput`, `RoundAdminListOutput`, `RoundAdminListFilters`.
- `backend/rest_api/routers/admin_rounds.py` — agrega handler `GET /rounds` con filtros + paginación.
- `backend/rest_api/services/domain/round_service.py` — agrega `list_for_admin(...)` con query optimizada (JOINs, no N+1).
- `backend/rest_api/repositories/round_repository.py` — agrega método de listado con filtros (si no existe repo level).
- Tests: `backend/tests/test_admin_rounds_list_router.py`, `backend/tests/test_round_service_list_for_admin.py`.

**Backend — sin cambios (reutilizados)**
- `PATCH /api/admin/rounds/{id}` (C-10) — cancelación con `cancel_reason`.
- Outbox + eventos `ROUND_*` (C-10) — ya se emiten por transición.

**Frontend Dashboard — nuevo**
- `Dashboard/src/pages/Orders.tsx` + `Orders.test.tsx`.
- `Dashboard/src/stores/roundsAdminStore.ts` + `roundsAdminStore.test.ts`.
- `Dashboard/src/hooks/useRoundsAdminWebSocketSync.ts`.
- `Dashboard/src/services/roundsAdminAPI.ts` — cliente HTTP para `GET /api/admin/rounds` y `PATCH /api/admin/rounds/{id}`.
- `Dashboard/src/components/orders/` — `OrderColumn.tsx`, `OrderCard.tsx`, `OrderListTable.tsx`, `OrderDetailsModal.tsx`, `OrderFilters.tsx`, `CancelOrderDialog.tsx`.
- `Dashboard/src/types/operations.ts` — agrega tipos `Round`, `RoundStatus`, `RoundItem`, `RoundFilters`.
- `Dashboard/src/utils/helpContent.tsx` — entrada `orders`.
- `Dashboard/src/router.tsx` — ruta `/orders` + breadcrumb.
- `Dashboard/src/components/layout/Sidebar.tsx` — remover `disabled: true` del slot `orders`.
- `Dashboard/src/i18n/` — labels en ES (breadcrumb, sidebar, columnas, botones, dialog).

**Eventos WebSocket — consumidos (no nuevos)**
- `ROUND_PENDING`, `ROUND_CONFIRMED`, `ROUND_SUBMITTED`, `ROUND_IN_KITCHEN`, `ROUND_READY`, `ROUND_SERVED`, `ROUND_CANCELED` — todos ya emitidos por backend desde C-10.

**Gobernanza**: C-25 es **MEDIO** (Ordenes) — implementación con checkpoints. El orchestrator delega apply a sub-agent que debe leer `.agents/SKILLS.md` y cargar skills (`clean-architecture`, `fastapi-domain-service`, `fastapi-code-review`, `dashboard-crud-page`, `zustand-store-pattern`, `ws-frontend-subscription`, `help-system-content`, `vercel-react-best-practices`, `python-testing-patterns`, `test-driven-development`, `systematic-debugging`).

**Riesgos principales**
- **Coherencia WS + snapshot**: al reconectar tras caída, el store debe refetchear con filtros activos — no confiar solo en el stream. El hook debe invocar `fetchRounds(currentFilters)` en `onReconnect`.
- **Filtro por fecha + WS live**: una ronda creada AHORA con `date=ayer` activo NO debe aparecer. Los handlers WS evalúan el filtro antes de upsertear.
- **Performance**: una sucursal activa puede tener 100+ rondas por día — paginación server-side obligatoria; vista Columnas limita a las primeras 50 por estado (orden por `pending_at DESC`).
- **RBAC en UI**: el botón "Cancelar" debe leer `authStore.roles` — MANAGER/ADMIN sí, WAITER/KITCHEN no. Tests cubren ambos casos.
- **Eventos ROUND_SERVED sin sector/diner info**: el payload WS puede no incluir todos los campos denormalizados — el handler hace merge con la ronda existente en memoria en vez de sobreescribir campos faltantes.
