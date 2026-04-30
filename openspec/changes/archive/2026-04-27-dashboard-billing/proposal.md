## Why

El backend de billing (C-12, archivado) expone la API completa de cuentas y pagos — `app_check`, `charge`, `allocation`, `payment`, eventos Outbox `CHECK_REQUESTED`/`CHECK_PAID`/`PAYMENT_APPROVED`/`PAYMENT_REJECTED`, y el receipt HTML (C-16). Sin embargo, el Dashboard de ADMIN/MANAGER no tiene ninguna vista sobre esa información: no hay forma de auditar cuentas del día, revisar el detalle FIFO de un `Check`, ni consultar el historial de pagos con filtros y totales por método. Esto bloquea el cierre de caja, la conciliación bancaria y la gestión operativa diaria del restaurante. C-26 cierra ese gap incorporando dos páginas de solo lectura al Dashboard que consumen los endpoints existentes y reaccionan en tiempo real a los eventos WebSocket del Outbox.

## What Changes

- **Página `/checks`** (solo ADMIN/MANAGER): listado paginado de cuentas (`app_check`) de la sucursal seleccionada, filtrable por fecha. Cada fila muestra el número de check, total en pesos, monto cubierto, estado (badge amarillo `REQUESTED` / verde `PAID`), hora de creación y acciones (ver detalle, imprimir recibo). Incluye tres KPI cards en el header: cuentas del día, total facturado y cuentas pendientes.
- **Modal de detalle de Check**: abre desde la fila y muestra las tres tablas del patrón FIFO — `charges` (cargo por diner/ítem con `remaining_cents` computado), `allocations` (asignaciones FIFO) y `payments` (cada pago con método, estado, monto y external_id si aplica). Incluye botón "Imprimir recibo" que reutiliza `/api/admin/checks/{id}/receipt` (C-16).
- **Página `/payments`** (solo ADMIN/MANAGER): historial paginado de pagos (`payment`) de la sucursal seleccionada con filtros por rango de fechas, método (`cash` / `card` / `transfer` / `mercadopago`) y estado (`APPROVED` / `REJECTED` / `PENDING`). Al pie de la tabla, un resumen agrupa los totales por método.
- **Store `billingAdminStore`** (modular): `checks`, `payments`, filtros y estados de carga. Selectores independientes con `useShallow` para arrays filtrados y `EMPTY_ARRAY` estable como fallback.
- **WebSocket**: el store se suscribe a `CHECK_REQUESTED`, `CHECK_PAID`, `PAYMENT_APPROVED` y `PAYMENT_REJECTED` vía `dashboardWS.onFiltered(selectedBranchId, ...)` usando el ref pattern canónico. Cada evento hace upsert en el array correspondiente.
- **Nuevos endpoints backend de lectura administrativa**: `GET /api/admin/checks?branch_id&from&to&status&page&page_size` y `GET /api/admin/payments?branch_id&from&to&method&status&page&page_size`. Ambos son read-only, validan `tenant_id` via `PermissionContext.require_management()`, y reusan `BillingService` / repositorios existentes (zero business logic duplicada).
- **Help content**: nuevas entradas `checks` y `payments` en `helpContent.tsx`, con `HelpButton` visible en ambas páginas (obligatorio por convención Dashboard).
- **Navegación**: entradas "Cuentas" y "Pagos" en la `Sidebar` bajo la sección "Facturación" (visible solo para ADMIN/MANAGER).
- **Tests**: unit tests del store (upsert vía WS, aplicación de filtros, selectores estables), tests de página (render de KPIs, modal de detalle, agrupación por método), mocks de `dashboardWS`.

## Capabilities

### New Capabilities

- `dashboard-billing-pages`: dos páginas de solo lectura (`/checks` y `/payments`) del Dashboard que auditan cuentas y pagos de una sucursal, reaccionan en tiempo real a eventos Outbox de billing, y reutilizan el receipt printing de C-16. Incluye `billingAdminStore` (Zustand modular) y suscripción WS con ref pattern.
- `billing-admin-api`: superficie backend de auditoría administrativa sobre billing — dos endpoints de listing (`GET /api/admin/checks`, `GET /api/admin/payments`) con paginación, filtros por fecha/método/estado, y RBAC ADMIN/MANAGER. Reutiliza `BillingService` y repositorios existentes; zero cambios al modelo de datos ni a la lógica FIFO.

### Modified Capabilities

- `dashboard-layout`: la `Sidebar` agrega la sección "Facturación" con dos ítems ("Cuentas", "Pagos") visibles solo para ADMIN/MANAGER. Cambio de UI navegación, sin cambios de permisos subyacentes.

## Impact

- **Dashboard**: nuevas páginas `Checks.tsx` y `Payments.tsx` en `Dashboard/src/pages/`; nuevo store modular `billingAdminStore/` (`store.ts`, `selectors.ts`, `types.ts`); nuevo servicio `billingAdminAPI.ts` en `Dashboard/src/services/`; nueva entrada en `Sidebar.tsx`; tres componentes reutilizables (`CheckStatusBadge`, `CheckDetailModal`, `PaymentMethodSummary`).
- **Backend**: nuevo router `backend/rest_api/routers/admin_billing.py` con dos endpoints de lectura; pequeña extensión en `BillingService` o creación de `AdminBillingService` (a decidir en design.md) — **sin cambios al modelo ni a la lógica FIFO existente**.
- **WebSocket Gateway**: sin cambios. Los eventos `CHECK_*` y `PAYMENT_*` ya se rutean por branch desde C-12.
- **helpContent**: nuevas entradas en `Dashboard/src/utils/helpContent.tsx`.
- **Rutas**: `/checks` y `/payments` agregadas en `Dashboard/src/router.tsx` con guards de rol (ADMIN o MANAGER).
- **No hay cambios en pwaMenu ni pwaWaiter.**
- **Governance ALTO**: este change es *propose only*. No implementar hasta revisión explícita del proposal + design + tasks.
