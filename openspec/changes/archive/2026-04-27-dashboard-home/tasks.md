## 1. Preparación y skills

- [x] 1.1 Leer `.agents/SKILLS.md` y cargar las skills aplicables al change: `dashboard-crud-page`, `zustand-store-pattern`, `ws-frontend-subscription`, `help-system-content`, `vercel-react-best-practices`, `interface-design`, `tailwind-design-system`, `test-driven-development`
- [x] 1.2 Releer `openspec/changes/dashboard-home/proposal.md`, `design.md` y `specs/dashboard-home/spec.md` para internalizar goals y non-goals
- [x] 1.3 Revisar el estado actual de `Dashboard/src/pages/HomePage.tsx`, `stores/branchStore.ts`, `stores/tableStore.ts`, `stores/salesStore.ts`, `components/layout/BranchSwitcher.tsx`, `components/sales/SalesKPICard.tsx`, `hooks/useTableWebSocketSync.ts` y `utils/helpContent.tsx`
- [x] 1.4 Confirmar con el equipo (si dudas) el set de quick-links definitivo y sus rutas — default: Cocina, Ventas, Mesas, Staff, Asignación de Mozos

## 2. Tests primero (TDD — skill test-driven-development)

- [x] 2.1 Crear `Dashboard/src/pages/HomePage.test.tsx` con la estructura base (mocks de `branchStore`, `tableStore`, `salesStore`, `dashboardWS`) y un test rojo para "estado sin sucursal"
- [x] 2.2 Agregar test rojo para "estado con sucursal + datos mockeados" (8 mesas, 3 OCCUPIED, daily KPIs del escenario del spec)
- [x] 2.3 Agregar test rojo para "actualización reactiva" al cambiar `tableStore` (una mesa pasa a OCCUPIED)
- [x] 2.4 Agregar test rojo para "CTA dispara `CustomEvent('dashboard:focus-branch-switcher')`"
- [x] 2.5 Agregar tests unitarios para los nuevos selectores `selectActiveTablesCount` y `selectTotalTablesCount` en `Dashboard/src/stores/tableStore.test.ts`
- [x] 2.6 Agregar test para el hook `useSalesWebSocketRefresh` que verifica el throttle (leading + trailing, máximo 2 fetch en una ráfaga de 10 eventos en <1s) y que filtra eventos no financieros (ROUND_IN_KITCHEN no dispara fetch)
- [x] 2.7 Verificar que todos los tests fallan con los mensajes esperados (`npm run test` en Dashboard)

## 3. Selectores nuevos en `tableStore`

- [x] 3.1 Agregar a `Dashboard/src/stores/tableStore.ts` los selectores `selectActiveTablesCount: (s: TableState) => number` (cuenta `items` con `status === 'OCCUPIED' && is_active`) y `selectTotalTablesCount: (s: TableState) => number` (cuenta `items` con `is_active`)
- [x] 3.2 Ejecutar `tableStore.test.ts` y confirmar tests 2.5 en verde

## 4. Hook `useSalesWebSocketRefresh`

- [x] 4.1 Crear `Dashboard/src/hooks/useSalesWebSocketRefresh.ts` siguiendo el ref-pattern de `useTableWebSocketSync`:
  - Effect 1 (sin deps): sincroniza `handleEventRef.current`
  - Effect 2 (deps: `[branchId, date]`): suscribe a `dashboardWS.onFiltered(branchId, '*', handler)`
  - Handler filtra eventos `ROUND_SUBMITTED`, `ROUND_SERVED`, `ROUND_CANCELED`, `CHECK_PAID`
  - Aplica throttle 3s (leading + trailing) antes de invocar `useSalesStore.getState().fetchDaily(branchId, date)`
- [x] 4.2 Implementar un helper `throttle` local al hook o reutilizar un utility si existe (verificar `utils/`); si no existe, agregar `Dashboard/src/utils/throttle.ts` con un throttle minimal de leading + trailing
- [x] 4.3 Usar `useSalesStore.getState()` dentro del handler para evitar dependencias stale (mismo patrón que `useTableWebSocketSync`)
- [x] 4.4 Ejecutar el test 2.6 y confirmar verde

## 5. Componentes visuales de la Home

- [x] 5.1 Crear `Dashboard/src/components/home/HomeEmptyBranchState.tsx` — card full-width con icono `Building2`, título, texto y botón "Elegir sucursal" que al hacer click despacha `window.dispatchEvent(new CustomEvent('dashboard:focus-branch-switcher'))` (wrapper `typeof window !== 'undefined'`)
- [x] 5.2 Crear `Dashboard/src/components/home/HomeKPIGrid.tsx` que recibe props `{ activeTables, totalTables, orders, revenueCents, averageTicketCents, isLoadingSales }` y renderiza 4 `SalesKPICard`:
  - "Mesas activas" — format `number`, valor string `${active}/${total}` (se requiere una pequeña adaptación: permitir `value: number | string` en `SalesKPICard`, o agregar prop opcional `displayValue?: string` que tome precedencia)
  - "Pedidos del día" — `number`
  - "Ingresos del día" — `currency`
  - "Ticket promedio" — `currency`
  - Mientras `isLoadingSales && orders === null`, mostrar "—" en los tres KPIs de ventas
- [x] 5.3 Crear `Dashboard/src/components/home/HomeQuickLinks.tsx` que renderiza un grid responsive de 5 `QuickLinkCard` con icono + título + descripción + `to="/<ruta>"` vía `Link` de `react-router`
- [x] 5.4 Crear `Dashboard/src/components/home/QuickLinkCard.tsx` (componente interno reutilizable): `Link` con Tailwind classes `bg-gray-800 border border-gray-600 rounded-lg p-5 hover:border-orange-500/50 transition-colors flex items-start gap-3`
- [x] 5.5 Extender `Dashboard/src/components/sales/SalesKPICard.tsx` para soportar prop opcional `displayValue?: string` (toma precedencia sobre el formateo de `value`) y prop opcional `icon?: LucideIcon`. Mantener retrocompatibilidad total con los usos actuales de `Sales.tsx`
- [x] 5.6 Agregar test de snapshot/unit mínimo para `HomeEmptyBranchState` verificando que el click despacha el `CustomEvent` (usar `vi.spyOn(window, 'dispatchEvent')`)

## 6. `BranchSwitcher` escucha el CustomEvent

- [x] 6.1 Modificar `Dashboard/src/components/layout/BranchSwitcher.tsx` (dentro de `BranchDropdown`) para agregar un `useEffect` que registre `window.addEventListener('dashboard:focus-branch-switcher', handler)` y retorne cleanup
- [x] 6.2 En el handler, si hay >1 sucursal, setear `isOpen=true`; si hay 1 sucursal (rama `SingleBranchDisplay`), hacer focus del botón
- [x] 6.3 Para el caso `SingleBranchDisplay`, mover el listener al componente externo `BranchSwitcher` para que cualquier variante escuche (alternativa: refactor menor para que el listener viva en el wrapper y cause scroll/focus al nodo correcto)
- [x] 6.4 Agregar un test mínimo en `BranchSwitcher.test.tsx` (crear si no existe) que dispara el `CustomEvent` y verifica que el dropdown se abre (`role="listbox"` visible)

## 7. `HomePage.tsx` — compositor principal

- [x] 7.1 Reescribir `Dashboard/src/pages/HomePage.tsx` con:
  - Selectores: `selectSelectedBranch`, `selectSelectedBranchId` del `branchStore`; `selectActiveTablesCount`, `selectTotalTablesCount` del `tableStore`; `selectDailyKPIs`, `selectSalesIsLoading` del `salesStore`; `useTableActions().fetchByBranch` y `useSalesActions().fetchDaily`
  - `useEffect([selectedBranchId])`: early return si null; si presente, invoca `fetchByBranch(selectedBranchId)` (si items vacío) y `fetchDaily(selectedBranchId, todayISO())`
  - Invocar `useTableWebSocketSync(selectedBranchId)` (ya existe) y `useSalesWebSocketRefresh(selectedBranchId, todayISO())` (nuevo)
  - Renderizado condicional: si `!selectedBranch`, `<HomeEmptyBranchState />`; si hay branch, renderizar `PageContainer` con `title={selectedBranch.name}`, `description={fechaHoyFormateada}`, `helpContent={helpContent.home}`, contenido = `<HomeKPIGrid />` + `<HomeQuickLinks />`
  - Helper local `todayISO()` y `formatDateEs(date)` (día de la semana + fecha) — o reutilizar `formatDate` si ya existe en `utils/`; si no, agregar `Dashboard/src/utils/formatDate.ts`
- [x] 7.2 Asegurarse de NO destructurar stores (regla skill `zustand-store-pattern`); cada valor entra via selector nombrado
- [x] 7.3 Cumplir reglas del skill `vercel-react-best-practices` (componentes pequeños, sin side effects fuera de `useEffect`, no mutar estado durante render)

## 8. Ayuda contextual + i18n mínima

- [x] 8.1 Agregar entrada `home` en `Dashboard/src/utils/helpContent.tsx` con la estructura estándar: título, intro, lista de features (KPIs, quick-links, estado vacío), caja de tip — texto en español sin tildes (según convención del archivo)
- [x] 8.2 Agregar las nuevas claves en `Dashboard/src/utils/i18n/es.json` (si existe; si no, crear inline las strings):
  - `pages.home.emptyBranch.title`
  - `pages.home.emptyBranch.description`
  - `pages.home.emptyBranch.cta`
  - `pages.home.kpis.activeTables`, `pages.home.kpis.orders`, `pages.home.kpis.revenue`, `pages.home.kpis.averageTicket`
  - `pages.home.quickLinks.kitchen`, `.sales`, `.tables`, `.staff`, `.waiterAssignments` (title + description)
- [x] 8.3 Añadir las mismas claves en `en.json` con traducciones inglesas (mantener paridad que ya tiene el Dashboard)
- [x] 8.4 Si existe `pt.json` en Dashboard, dejar un placeholder (mismas claves con valores en español como fallback, a completar en un change de i18n dedicado) — si NO existe, skip

## 9. Integración y checklist de calidad

- [x] 9.1 Ejecutar `npm run test` en `Dashboard/` y confirmar que los 6 tests del paso 2 están en verde
- [x] 9.2 Ejecutar `npm run lint` y `npm run typecheck` en `Dashboard/` y resolver todo warning/error introducido por el change
- [x] 9.3 Levantar el Dashboard localmente (`npm run dev`) y verificar manualmente:
  - `/` sin sucursal → estado vacío + CTA abre selector
  - `/` con sucursal → 4 KPIs visibles y correctos, 5 quick-links funcionales
  - Disparar desde otra pestaña / curl un cambio de estado de mesa (ocupar mesa en `/tables`) y ver que el KPI "mesas activas" se actualiza
  - Cambiar de sucursal en `BranchSwitcher` → los KPIs se refetchean
- [x] 9.4 Revisar accesibilidad: `aria-label` en KPIs, roles correctos en quick-links, focus visible, contraste (WCAG AA) — alineado con skill `interface-design`
- [x] 9.5 Confirmar que `HelpButton` de la Home abre el contenido de `helpContent.home` correctamente
- [x] 9.6 Confirmar que ningún endpoint nuevo fue creado en backend (solo consumo de existentes) y que ningún store nuevo fue introducido
- [x] 9.7 Verificar con `openspec status --change "dashboard-home"` que la ruta está lista para archivar
