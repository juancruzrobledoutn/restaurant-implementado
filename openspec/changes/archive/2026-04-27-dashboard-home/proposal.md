## Why

La página de inicio del Dashboard (`/`) hoy es un placeholder estático (título, saludo al usuario y un cuadro vacío). Un administrador o manager que entra al Dashboard no tiene visibilidad inmediata del pulso operativo de su sucursal ni accesos rápidos a las tareas del día. HU-1901 pide un dashboard de métricas operativas y HU-1901 (scope C-30) lo acota a una **home funcional** que reutiliza las APIs y stores ya construidos en C-16 (operations) y C-29 (branch selector): sin nuevos endpoints, sin nuevo store, solo composición.

## What Changes

- Reescribir `Dashboard/src/pages/HomePage.tsx` con dos estados excluyentes según `selectedBranch` del `branchStore`:
  - **Sin sucursal seleccionada**: card prominente con instrucción ("Seleccioná una sucursal para ver el resumen operativo") y un CTA que enfoca el `BranchSwitcher` del Navbar.
  - **Con sucursal seleccionada**:
    - Header: nombre de la sucursal + fecha de hoy formateada en `es-AR`.
    - Grid de 4 KPI cards: **mesas activas / total**, **pedidos del día**, **ingresos del día**, **ticket promedio**.
    - Grid de quick-links a: Kitchen Display, Ventas, Mesas, Staff y Asignación de Mozos (con iconos y descripción breve).
- Componer los KPIs desde `tableStore.items` (mesas) y `salesStore.daily` (pedidos, ingresos, ticket promedio) — cero nuevas llamadas a backend.
- Disparar `fetchDaily(branchId, todayISO)` y `fetchByBranch(branchId)` en el `useEffect` de montaje / cambio de branch si los stores están vacíos o en otra fecha.
- Suscribir la página a eventos WS `TABLE_STATUS_CHANGED`, `TABLE_SESSION_STARTED`, `TABLE_CLEARED`, `ROUND_SUBMITTED`, `ROUND_SERVED` y `ROUND_CANCELED` reutilizando `useTableWebSocketSync(branchId)` y un nuevo hook `useSalesWebSocketRefresh(branchId, date)` que, ante un `ROUND_*` relevante, invoca `fetchDaily` con throttle.
- Registrar la entrada en `helpContent.home` y usar `PageContainer` para cumplir el skill `help-system-content`.
- Integrar tests (`HomePage.test.tsx`) con casos: (a) render sin sucursal + CTA, (b) render con sucursal + 4 KPIs correctos desde mocks, (c) actualización reactiva al cambiar el store de tablas.

## Capabilities

### New Capabilities
- `dashboard-home`: Página de inicio del Dashboard que compone KPIs operativos del día y accesos directos a las vistas de operación para la sucursal seleccionada, sin introducir nuevas APIs.

### Modified Capabilities
<!-- Sin cambios de requisitos en otras capabilities. La home solo consume lo ya especificado por dashboard-operations, sales-reporting y dashboard-realtime-sync. -->

## Impact

- **Código Dashboard**:
  - `Dashboard/src/pages/HomePage.tsx` (reescritura).
  - Nuevos componentes: `Dashboard/src/components/home/HomeKPIGrid.tsx`, `HomeQuickLinks.tsx`, `HomeEmptyBranchState.tsx`, `HomeKPICard.tsx` (o reutilizar `SalesKPICard` con variante).
  - Nuevo hook: `Dashboard/src/hooks/useSalesWebSocketRefresh.ts` para el throttle de re-fetch ante `ROUND_*`.
  - `Dashboard/src/utils/helpContent.tsx`: agregar entrada `home`.
  - `Dashboard/src/utils/i18n/es.json` (y `en.json`, `pt.json` si existen para Dashboard): claves `pages.home.*` para branch vacío, labels de KPI y quick-links.
- **Tests**: `Dashboard/src/pages/HomePage.test.tsx` (Vitest + Testing Library), con mocks de `branchStore`, `tableStore`, `salesStore` y `dashboardWS`.
- **Sin cambios backend**: no se agregan endpoints, servicios ni migraciones. Se consume `GET /api/admin/sales/daily` y `GET /api/admin/tables` existentes.
- **Sin cambios de schema**: se reutilizan `DailyKPIs`, `Table`, `TableStatus` ya definidos en `Dashboard/src/types/operations.ts`.
- **Governance**: MEDIO — implementación con checkpoints; no toca Auth, Billing, Allergens ni Staff RBAC.
- **Dependencias satisfechas**: C-29 (dashboard-branch-selector, archivado) y C-16 (dashboard-operations, archivado).
