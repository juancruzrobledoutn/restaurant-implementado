## Why

C-15 dio al Dashboard la administración del menú, pero ADMIN y MANAGER todavía no pueden operar el día-a-día del restaurante desde la web: no hay gestión de mesas, sectores, personal y asignaciones, no hay pantalla de cocina en tiempo real, no hay vista de ventas del día, y no se puede imprimir un recibo. C-16 cubre esa brecha y completa la versión "lista para operar" del Dashboard, apoyándose en los endpoints de backend que ya construyeron C-07 (sectores/mesas), C-10 (rounds), C-11 (kitchen tickets), C-12 (billing) y C-13 (staff/assignments).

## What Changes

- Nuevas páginas CRUD en Dashboard (React 19 + Zustand + hook-trio de C-14/C-15):
  - **Tables** — gestión de mesas por sucursal (número, código, capacidad, sector, estado), branch-guard, cascade preview.
  - **Sectors** — gestión de `BranchSector` por sucursal, cascade soft-delete a mesas.
  - **Staff** — gestión de usuarios con asignación de rol por sucursal (`UserBranchRole`), password hash server-side, MANAGER no puede eliminar (403).
- Nueva página **Kitchen Display** — 3 columnas (SUBMITTED / IN_KITCHEN / READY) alimentadas por `GET /api/kitchen/rounds` + WebSocket `ROUND_*`, con colores de urgencia según tiempo desde `submitted_at`, timers live, toggle de audio alert al llegar `ROUND_READY`, acciones para transicionar tickets (solo para ADMIN/MANAGER desde aquí — `PATCH /api/admin/rounds/{id}` o `PATCH /api/kitchen/tickets/{id}`).
- Nueva página **Waiter Assignments** — asignación diaria mozo → sector vía `POST /api/admin/sectors/{id}/assignments`, listado por fecha, hard-delete (son efímeras).
- Nueva página **Sales** — KPIs del día para la sucursal seleccionada: revenue total, órdenes, ticket promedio, top productos. Usa nuevos endpoints `/api/admin/sales/daily` y `/api/admin/sales/top-products`.
- Nuevo servicio backend **`SalesService`** (Clean Architecture, `BranchScopedService`) y router `/api/admin/sales` — agrega datos desde `Check` + `Charge` + `RoundItem` filtrado por `branch_id` y rango de fecha.
- Nuevo servicio backend **`ReceiptService`** — genera HTML imprimible (ESC/POS-friendly, 58 mm / 80 mm) a partir de un `Check`, expuesto vía `GET /api/admin/checks/{id}/receipt` (content-type `text/html`). El frontend lo abre en ventana nueva y dispara `window.print()`.
- Nuevos stores Zustand en Dashboard: `tableStore`, `sectorStore`, `staffStore`, `waiterAssignmentStore`, `kitchenDisplayStore`, `salesStore`. Todos con selectores + `useShallow` + `EMPTY_ARRAY` estables.
- Suscripción WebSocket (ref pattern, dos efectos, filtrada por `branch_id`) para:
  - `kitchenDisplayStore`: `ROUND_SUBMITTED`, `ROUND_IN_KITCHEN`, `ROUND_READY`, `ROUND_CANCELED` (recarga/patcha el snapshot).
  - `tableStore` y página Tables: `TABLE_STATUS_CHANGED`, `TABLE_SESSION_STARTED`, `TABLE_CLEARED`.
- Navegación (`MainLayout` sidebar) y rutas (`router.tsx`) para las 6 nuevas páginas; i18n de labels (Dashboard ya tiene scaffold es).
- `helpContent.tsx` con entrada por página (tono y estructura existente, sin tildes).
- Tests: Vitest para stores (kitchenDisplayStore WS catch-up incluido), páginas (Tables branch-guard, Staff RBAC), hooks. Pytest para `SalesService` (agregaciones, filtros tenant), `ReceiptService` (template rendering), routers nuevos (`/admin/sales`, `/admin/checks/{id}/receipt`).

## Capabilities

### New Capabilities
- `dashboard-operations`: páginas operativas del Dashboard (Tables, Sectors, Staff, Waiter Assignments, Kitchen Display, Sales) con sus stores, suscripciones WS, help content y navegación.
- `sales-reporting`: endpoints `/api/admin/sales/*` y `SalesService` que agrega revenue diario, órdenes, ticket promedio y top productos por sucursal y rango de fecha.
- `receipt-printing`: `ReceiptService` + endpoint `GET /api/admin/checks/{id}/receipt` que renderiza HTML imprimible desde un `Check` completo (cargos + pagos + allocations) optimizado para impresora térmica.

### Modified Capabilities
- *(ninguna)* — C-16 solo agrega capacidades nuevas. Las specs de `rounds`, `kitchen`, `billing`, `sectors-tables`, `staff-management` ya están archivadas y no cambian sus requisitos.

## Impact

**Backend — nuevo**
- `backend/rest_api/services/domain/sales_service.py`
- `backend/rest_api/services/domain/receipt_service.py`
- `backend/rest_api/schemas/sales.py`, `backend/rest_api/schemas/receipt.py`
- `backend/rest_api/routers/admin/sales.py`
- Endpoint `GET /api/admin/checks/{id}/receipt` (se añade al router de billing existente o a un nuevo `admin_checks.py`)
- Tests: `backend/tests/test_sales_service.py`, `test_sales_router.py`, `test_receipt_service.py`, `test_receipt_router.py`

**Backend — sin cambios (reutilizados)**
- `/api/admin/sectors/*`, `/api/admin/tables/*`, `/api/admin/sectors/{id}/assignments/*` (C-07)
- `/api/admin/staff/*`, `/api/admin/waiter-assignments/*` (C-13)
- `/api/admin/rounds/{id}` PATCH (C-10)
- `/api/kitchen/rounds`, `/api/kitchen/tickets`, `/api/kitchen/tickets/{id}` PATCH (C-10, C-11)
- `/api/billing/check/{session_id}` GET (C-12) — fuente del recibo

**Frontend Dashboard — nuevo**
- Pages: `Dashboard/src/pages/{Tables,Sectors,Staff,WaiterAssignments,KitchenDisplay,Sales}.tsx` + sus `.test.tsx`
- Stores: `Dashboard/src/stores/{tableStore,sectorStore,staffStore,waiterAssignmentStore,kitchenDisplayStore,salesStore}.ts` + tests
- Hooks: `Dashboard/src/hooks/useKitchenWebSocketSync.ts` (ref pattern para Kitchen Display)
- Componentes: `KitchenTicketColumn.tsx`, `KitchenTicketCard.tsx`, `UrgencyBadge.tsx`, `ReceiptButton.tsx`, `SalesKPICard.tsx`, `TopProductsTable.tsx`
- API clients: `Dashboard/src/services/{tableAPI,sectorAPI,staffAPI,waiterAssignmentAPI,kitchenAPI,salesAPI,receiptAPI}.ts`
- Rutas en `router.tsx` y entradas en `MainLayout` sidebar
- Entradas en `utils/helpContent.tsx`
- Validadores en `utils/validation.ts` (validateTable, validateSector, validateStaff, validateWaiterAssignment)
- Nuevos `STORE_VERSIONS` y `STORAGE_KEYS` en `utils/constants.ts`

**Eventos WebSocket — consumidos (no nuevos)**
- `ROUND_SUBMITTED`, `ROUND_IN_KITCHEN`, `ROUND_READY`, `ROUND_CANCELED`
- `TABLE_STATUS_CHANGED`, `TABLE_SESSION_STARTED`, `TABLE_CLEARED`
- `ENTITY_CREATED/UPDATED/DELETED` para refrescar Tables/Sectors/Staff desde otros tabs/admins

**Gobernanza**: C-16 es **MEDIO** — implementación con checkpoints. El orchestrator delega apply a sub-agent que debe leer `.agents/SKILLS.md` y cargar skills (`clean-architecture`, `fastapi-domain-service`, `dashboard-crud-page`, `react19-form-pattern`, `zustand-store-pattern`, `ws-frontend-subscription`, `help-system-content`, `vercel-react-best-practices`, `python-testing-patterns`, `test-driven-development`, `systematic-debugging`).

**Riesgos principales**
- Kitchen Display con WebSocket debe ser robusto a reconexiones — el `kitchenDisplayStore` debe refetchear el snapshot al reconectar (no solo confiar en el stream de eventos).
- `SalesService` debe agregar sobre `Charge` (no sobre `RoundItem` directo) porque las rondas canceladas no generan charges → esto evita contar ventas fantasma.
- `ReceiptService` retorna HTML, no PDF: la impresora térmica usa el diálogo nativo de print del browser. No se guarda el HTML en DB.
- Todos los endpoints nuevos filtran por `tenant_id` vía `PermissionContext` — los tests deben incluir casos cross-tenant (403).
