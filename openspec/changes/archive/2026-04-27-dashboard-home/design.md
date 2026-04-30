## Context

La ruta índice del Dashboard (`/`) se resuelve hoy a `Dashboard/src/pages/HomePage.tsx`, que solo muestra un título, saludo al usuario autenticado y un cuadro "placeholder" vacío. Tras C-29 (selector de sucursales, archivado) tenemos `branchStore` completo con `selectedBranch`, `branches` y `BranchSwitcher` en el Navbar. Tras C-16 (dashboard-operations, archivado) tenemos:

- `tableStore` con `items: Table[]` por sucursal y `handleTableStatusChanged` conectado a eventos WS.
- `salesStore` con `daily: DailyKPIs` (revenue_cents, orders, average_ticket_cents, diners) por sucursal+fecha.
- `useTableWebSocketSync(branchId)` — ref pattern para suscribirse a `TABLE_STATUS_CHANGED`, `TABLE_SESSION_STARTED`, `TABLE_CLEARED`.
- `SalesKPICard` (label + value + format currency/number).
- `PageContainer` + `HelpButton` + `helpContent` — todas las páginas del Dashboard pasan por `PageContainer`.

No tenemos en cambio nada de "home operativa": ni KPI grid, ni mensaje de branch-no-seleccionada, ni quick-links. La home es el punto de entrada del admin/manager — merece mostrar el pulso del negocio en 5 segundos y enrutar a las vistas operativas.

**Restricciones**:
- Governance MEDIO — implementación con checkpoints, no toca auth ni billing.
- Sin nuevos endpoints, sin nuevo store — solo composición de estado ya cargado.
- Stack: React 19.2, TypeScript 5.9, Zustand 5, Tailwind 4.1. Theme naranja `#f97316`, UI en español.
- Reglas frontend no-negociables: selectores (nunca destructuring), `useShallow` para arrays/objetos, `EMPTY_ARRAY` estable, IDs string en frontend, precios centavos, logger central.
- WebSocket: ref pattern en dos effects, `return unsubscribe` siempre.

## Goals / Non-Goals

**Goals:**
- Mostrar en `/` un resumen operativo accionable para ADMIN/MANAGER de la sucursal seleccionada.
- Guiar a quien llega sin sucursal con un CTA claro que enfoca el `BranchSwitcher`.
- Componer 4 KPIs del día (mesas activas vs total, pedidos, ingresos, ticket promedio) desde stores existentes.
- Actualización cuasi-instantánea por WS: cambios de estado de mesa reflejan en el KPI de mesas; cierres y confirmaciones de ronda disparan re-fetch de KPIs de ventas con throttle.
- Quick-links visibles a las 5 páginas operativas más usadas: Kitchen Display, Ventas, Mesas, Staff, Asignación de Mozos.
- Cobertura de tests unitarios para los 3 estados (sin branch, con branch, con datos reactivos).
- Cumplir skills: `dashboard-crud-page` (adapt), `zustand-store-pattern`, `ws-frontend-subscription`, `help-system-content`, `vercel-react-best-practices`, `interface-design`, `test-driven-development`.

**Non-Goals:**
- Gráficos interactivos, filtros por rango de fechas, comparativas semanales/mensuales (eso es HU-1902/1903, changes futuros).
- Dashboards multi-sucursal / vista agregada (HU-1901 habla de "por sucursal"; el scope C-30 es solo la branch seleccionada).
- Nuevas APIs, nuevo domain service, nueva migración.
- Persistir nuevo estado en localStorage — la home es puramente derivada.
- i18n completo (en/pt) de las nuevas strings: se entrega español + fallback en inglés; pt se completa en un change de i18n separado si aplica.
- Reemplazar el endpoint `GET /api/admin/sales/daily` por streaming de métricas en tiempo real.

## Decisions

### D1 — Home como componente "compositor" sin store propio

**Decisión**: `HomePage` consume `branchStore`, `tableStore`, `salesStore` y un hook de throttle; no introduce un `homeStore`.

**Racional**: Los KPIs son funciones puras de estado ya presente. Un `homeStore` duplicaría datos y añadiría superficie para bugs de sincronización. Zustand con selectores + `useShallow` es suficiente. Esto respeta la regla del skill `zustand-store-pattern`: "no crear stores para estado derivado".

**Alternativa rechazada**: `homeStore` con sus propios `kpis` cacheados. Descartada por duplicación, superficie extra para invalidar y porque el skill explícitamente lo desaconseja.

### D2 — Derivación de KPIs con selectores memoizados y `useShallow`

**Decisión**: Calcular los 4 KPIs vía:
- `activeTablesCount` = `tableStore.items.filter(t => t.status === 'OCCUPIED' && t.is_active).length`
- `totalTablesCount` = `tableStore.items.filter(t => t.is_active).length`
- `ordersToday` = `salesStore.daily?.orders ?? 0`
- `revenueTodayCents` = `salesStore.daily?.revenue_cents ?? 0`
- `averageTicketCents` = `salesStore.daily?.average_ticket_cents ?? 0`

Exponer selectores con nombres explícitos en `tableStore.ts` (`selectActiveTablesCount`, `selectTotalTablesCount`) para evitar re-renders cuando cambian tablas irrelevantes. Para el objeto `daily`, usar selector simple (es un objeto reemplazado atómicamente, no requiere `useShallow`).

**Racional**: Evitar renders con "shallow-equal" de `tableStore.items` en cada patch de una mesa ajena; los selectores escalares devuelven primitivos, Zustand usa `Object.is` por defecto.

**Alternativa rechazada**: `useMemo` en el componente con `items` completos. Funciona pero fuerza re-render ante cualquier cambio de lista; los selectores escalares son estrictamente mejores.

### D3 — Trigger de re-fetch de ventas por WS (`useSalesWebSocketRefresh`)

**Decisión**: Nuevo hook `useSalesWebSocketRefresh(branchId, date)` que:
- Se suscribe a `dashboardWS.onFiltered(branchId, '*', handler)`.
- En el handler, si `event.type` ∈ `{ROUND_SUBMITTED, ROUND_SERVED, ROUND_CANCELED, CHECK_PAID}`, invoca `salesStore.fetchDaily(branchId, date)` con throttle de 3 segundos (leading + trailing).
- Ref pattern de dos effects (igual que `useTableWebSocketSync`): Effect 1 sincroniza el ref del handler, Effect 2 se suscribe una sola vez por `[branchId, date]`.

**Racional**: Los KPIs de ventas (revenue, orders, average_ticket) dependen del estado contable consolidado. Intentar mutarlos incrementalmente en el frontend es frágil (cancelaciones, vouchers, splits, etc.). Un re-fetch corto por evento, con throttle para no amplificar picos de eventos, es simple y correcto. La ronda como señal basta: cualquier cambio financiero relevante del día pasa por al menos una transición de ronda o pago.

**Alternativa rechazada**: Recalcular KPIs en el cliente sumando rounds individuales. Descartada: duplicaría la lógica del backend, no maneja anulaciones ni propinas, y rompería ante discrepancias de redondeo.

**Trade-off aceptado**: Hasta 1 GET `/api/admin/sales/daily` cada 3 segundos mientras hay actividad. Aceptable: respuesta cacheada, payload pequeño, solo dispara en eventos.

### D4 — Estado "sin sucursal": card con CTA que enfoca el `BranchSwitcher`

**Decisión**: Cuando `selectedBranch === null`, renderizar `HomeEmptyBranchState` — una `Card` full-width con:
- Icono `Building2` grande + título "Seleccioná una sucursal".
- Texto explicativo breve.
- Botón primario "Elegir sucursal" que al hacer click dispara un `CustomEvent('dashboard:focus-branch-switcher')` global que el `BranchSwitcher` escucha (en un `useEffect` con `addEventListener`) y se auto-abre + enfoca su botón.

**Racional**: El selector vive en el Navbar (componente hermano, no prop-drilling). Usar un `CustomEvent` evita acoplar `HomePage` al DOM del `BranchSwitcher` ni pasar refs por context. Es un patrón estándar React para coordinación lateral ligera, perfectamente compatible con el ref-pattern ya usado en el selector.

**Alternativa rechazada**: Zustand action `branchStore.openSwitcher()`. Descartada porque ensucia la API pública del store con estado UI que solo vive microsegundos.

**Alternativa rechazada**: Nuevo `Context` de layout. Overkill para una interacción.

### D5 — Grid responsive + theme naranja consistente

**Decisión**: Layout mobile-first con Tailwind:
- KPI grid: `grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4`.
- Quick-links grid: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4`.
- Cards con `bg-gray-800 border-gray-600 rounded-lg`, valor en `text-3xl font-bold text-white tabular-nums`, label en `text-xs uppercase tracking-wide text-gray-400`.
- Accent hover: `hover:border-orange-500/50 transition-colors` en quick-links.
- Quick-links con iconos `lucide-react` coherentes: `ChefHat` (Kitchen), `TrendingUp` (Ventas), `Grid3x3` (Mesas), `Users` (Staff), `ClipboardList` (Asignaciones).

**Racional**: Coherencia con `SalesKPICard`, `BranchSwitcher` y el resto del Dashboard. Orange `#f97316` solo en hover/accent, no fondo — mantenemos densidad informativa alta.

### D6 — Reutilizar `SalesKPICard` con variante opcional

**Decisión**: Extender `SalesKPICard` con una prop opcional `icon?: LucideIcon` y una prop `tone?: 'default' | 'highlight'` para el caso "mesas activas" (destacar con color ámbar cuando `active > 0.8 * total`). Renombrar archivo a `Dashboard/src/components/sales/SalesKPICard.tsx` permanece; crear barrel `Dashboard/src/components/home/HomeKPICard.tsx` que re-exporta `SalesKPICard` con defaults home-específicos.

**Racional**: Mantener un solo componente "KPI card" evita drift visual. La variante `tone` se resuelve con Tailwind classes condicionales; no altera la API actual (default behavior idéntico).

**Alternativa rechazada**: Crear `HomeKPICard` independiente. Descartada por duplicación de diseño.

### D7 — Fetch en mount y al cambiar branch/date

**Decisión**: `HomePage` arranca un `useEffect` con dependencia `[selectedBranchId]`:
- Si `!selectedBranchId`, hacer early return.
- Si hay `selectedBranchId`:
  - Si `tableStore.items` vacío para esa branch o no cargadas, `fetchByBranch(selectedBranchId)`.
  - `fetchDaily(selectedBranchId, todayISO())` siempre (`salesStore.selectedDate` puede ser otro día; la home siempre muestra HOY). No mutamos `salesStore.selectedDate` — llamamos directo a `fetchDaily` con `todayISO()` para no contaminar la página Sales que tiene su propio DatePicker.

**Racional**: Separación de responsabilidades. Home = siempre HOY. Sales = fecha elegida por el usuario. Usamos la misma acción de fetch pero con fecha fija, lo cual cachea en el store el resultado del día actual (compatible con Sales cuando el usuario también está viendo HOY).

**Alternativa rechazada**: Guardar `selectedDate='today'` al entrar a home. Descartada: rompería la UX de Sales para el usuario que acaba de elegir "ayer" en la página de ventas.

### D8 — Tests: 3 escenarios obligatorios, Testing Library + Vitest

**Decisión**: `HomePage.test.tsx` cubre:
1. **Render sin sucursal**: con `selectedBranch = null`, renderiza `HomeEmptyBranchState`, presente el botón CTA con `role="button"` y label "Elegir sucursal".
2. **Render con sucursal + datos mockeados**: `selectedBranch` con name "Centro", `tableStore.items` con 8 mesas activas (3 ocupadas, 5 libres), `salesStore.daily` con `{ orders: 42, revenue_cents: 150000, average_ticket_cents: 3571, diners: 65 }`. Asserts:
   - Header muestra "Centro" + fecha de hoy en `es-AR`.
   - Los 4 valores aparecen correctamente formateados (`$1.500,00`, `42`, `$35,71`, `3/8`).
   - Los 5 quick-links existen y apuntan a las rutas correctas.
3. **Actualización reactiva**: cambio del `tableStore` (una mesa pasa a OCCUPIED) se refleja en el KPI "mesas activas" sin re-fetch.

Todas las llamadas a `fetchByBranch` y `fetchDaily` están mockeadas (`vi.fn()`) para no disparar red.

**Racional**: Cubrir los 3 estados críticos de la página garantiza que el compositor funciona; el resto es diseño visual revisable por snapshot (no lo incluimos para evitar tests frágiles).

## Risks / Trade-offs

- **[Risk] Throttle demasiado agresivo pierde updates cercanos** → Mitigación: leading + trailing en el throttle para garantizar que el último evento de un burst dispara fetch; 3s es cómodo para una home.
- **[Risk] Muchas re-suscripciones WS si el usuario navega hojas** → Mitigación: hook retorna `unsubscribe` limpiamente; el socket global es singleton (no re-conecta).
- **[Risk] `CustomEvent` para abrir el BranchSwitcher no funciona en SSR / testing** → Mitigación: `HomePage` envuelve el dispatch en `typeof window !== 'undefined'`; el test simula click y mock del `addEventListener` del switcher.
- **[Risk] `tableStore.items` puede tener `_optimistic=true` tras una creación** → Aceptable: cuentan igual; si se revierte, la diff es pequeña y visible por <500ms.
- **[Risk] Fecha de hoy en cliente vs backend timezone** → Mitigación: `todayISO()` toma la fecha local del cliente (igual que `Sales.tsx`); asumimos que el admin está físicamente en la sucursal o en su zona — misma regla que el resto del Dashboard.
- **[Trade-off] Sin gráfico de tendencia** → El change C-30 NO incluye tendencias. Si el usuario quiere ver variaciones, va a Sales. Aceptado por scope.
- **[Trade-off] i18n parcial** → Strings en español + fallback english; pt queda pendiente para un change futuro. Consistente con el estado actual del Dashboard.
- **[Trade-off] No reescribimos `SalesKPICard`** → Extensión opcional retrocompatible. Rollback trivial si la variante `tone` molesta.

## Migration Plan

No hay datos a migrar: es puro frontend.

**Pasos de deploy**:
1. Mergear el change → build Dashboard → deploy estático (Vite produces immutable assets).
2. No requiere flag ni downtime.
3. Rollback: revertir el commit; el placeholder anterior vuelve sin side effects.

## Open Questions

- Ninguna bloqueante. Si el equipo prefiere otro set de quick-links (por ejemplo, sumar "Productos"), se ajusta en `HomeQuickLinks.tsx` sin impacto de arquitectura.
