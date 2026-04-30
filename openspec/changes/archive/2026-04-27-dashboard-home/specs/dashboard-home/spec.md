## ADDED Requirements

### Requirement: Home page renders empty branch state when no branch is selected
El Dashboard SHALL renderizar, en la ruta índice `/`, un estado vacío accionable cuando el usuario autenticado no tiene una sucursal seleccionada (`branchStore.selectedBranch === null`). El estado vacío MUST mostrar un mensaje explicativo y un CTA que dispare la apertura del selector de sucursales ubicado en el Navbar.

#### Scenario: Usuario autenticado sin sucursal seleccionada
- **WHEN** el usuario accede a `/` con `branchStore.selectedBranch === null`
- **THEN** la Home SHALL renderizar una card con el título "Seleccioná una sucursal"
- **AND** un texto explicativo indicando que sin sucursal no hay datos operativos para mostrar
- **AND** un botón con label "Elegir sucursal" accesible por teclado (rol button, focusable)
- **AND** la Home NO SHALL realizar ninguna llamada a `fetchDaily` ni `fetchByBranch`

#### Scenario: CTA abre el selector de sucursales del Navbar
- **WHEN** el usuario hace click en el botón "Elegir sucursal" del estado vacío
- **THEN** el Dashboard SHALL emitir un `CustomEvent('dashboard:focus-branch-switcher')` en `window`
- **AND** el componente `BranchSwitcher` del Navbar SHALL escuchar ese evento y abrir su dropdown (si hay >1 sucursal) o enfocar su botón

#### Scenario: Usuario con una única sucursal auto-seleccionada
- **WHEN** el usuario entra a `/` y el `branchStore` auto-seleccionó la única sucursal disponible (comportamiento existente de C-29)
- **THEN** la Home NO SHALL renderizar el estado vacío
- **AND** SHALL renderizar el modo "con sucursal" definido más abajo

---

### Requirement: Home page renders operational summary when a branch is selected
Cuando hay una sucursal seleccionada, el Dashboard SHALL renderizar en `/` un resumen operativo que incluye: (a) un header con el nombre de la sucursal y la fecha de hoy, (b) una grilla de 4 KPI cards con métricas del día, y (c) una grilla de quick-links a las vistas operativas principales.

#### Scenario: Header muestra nombre de sucursal y fecha de hoy
- **WHEN** el usuario entra a `/` con `branchStore.selectedBranch = { id: 1, name: "Centro", ... }`
- **THEN** el header SHALL mostrar el texto "Centro" como título visible
- **AND** SHALL mostrar la fecha actual formateada en locale `es-AR` (ejemplo: "lunes, 21 de abril de 2026")

#### Scenario: KPI grid muestra 4 métricas con formato correcto
- **WHEN** la Home se renderiza con `tableStore.items` que incluye 8 mesas activas (3 con `status === 'OCCUPIED'`, 5 con otros estados), y `salesStore.daily = { orders: 42, revenue_cents: 150000, average_ticket_cents: 3571, diners: 65 }`
- **THEN** la grilla SHALL contener exactamente 4 cards en el siguiente orden visual:
  1. "Mesas activas" con valor `3/8`
  2. "Pedidos del día" con valor `42`
  3. "Ingresos del día" con valor `$1.500,00` (formato `formatPrice` existente)
  4. "Ticket promedio" con valor `$35,71`
- **AND** cada card SHALL tener un `aria-label` que combine label y valor para lectores de pantalla

#### Scenario: KPI cards muestran placeholders mientras `salesStore.daily` no está cargado
- **WHEN** la Home se renderiza con `salesStore.daily === null` y `salesStore.isLoading === true`
- **THEN** los KPI cards de ventas (pedidos, ingresos, ticket promedio) SHALL mostrar un skeleton o el valor `—` en vez de valores numéricos
- **AND** el KPI "mesas activas" SHALL seguir mostrándose si `tableStore.items` ya está cargado

#### Scenario: Quick-links apuntan a las rutas operativas correctas
- **WHEN** la Home se renderiza con sucursal seleccionada
- **THEN** la grilla de quick-links SHALL contener al menos los siguientes 5 links navegables:
  1. "Cocina" → `/kitchen-display`
  2. "Ventas" → `/sales`
  3. "Mesas" → `/tables`
  4. "Staff" → `/staff`
  5. "Asignación de Mozos" → `/waiter-assignments`
- **AND** cada quick-link SHALL ser un componente navegable con role de link o button enrutado por `react-router`
- **AND** cada quick-link SHALL mostrar un icono (`lucide-react`) + título + descripción corta

---

### Requirement: Home page reacts to table WebSocket events in real time
La Home SHALL actualizar el KPI de "mesas activas / total" en tiempo real ante eventos `TABLE_STATUS_CHANGED`, `TABLE_SESSION_STARTED` y `TABLE_CLEARED` emitidos por el `dashboardWS`, reutilizando el hook `useTableWebSocketSync` existente (C-16). La actualización MUST ocurrir sin requerir una nueva llamada HTTP.

#### Scenario: Una mesa pasa a OCCUPIED durante la sesión del admin
- **WHEN** la Home está montada con `selectedBranchId = "1"` y `tableStore.items` contiene una mesa con `status: 'AVAILABLE'`
- **AND** llega un evento WS `{ type: 'TABLE_STATUS_CHANGED', data: { id: <table_id>, status: 'OCCUPIED' } }` para esa sucursal
- **THEN** el KPI "mesas activas" SHALL reflejar el incremento en ≤ 200 ms
- **AND** NO SHALL producirse ninguna llamada HTTP a `/api/admin/tables`

#### Scenario: Evento de otra sucursal no afecta la Home
- **WHEN** la Home está montada con `selectedBranchId = "1"` y llega un evento WS para branch_id diferente
- **THEN** los KPI cards NO SHALL modificar sus valores visibles
- **AND** `tableStore.handleTableStatusChanged` SHALL filtrar por branch_id en la payload (comportamiento existente)

---

### Requirement: Home page refreshes sales KPIs on round lifecycle events
La Home SHALL disparar un re-fetch de `salesStore.fetchDaily(branchId, todayISO())` cuando lleguen eventos WS del ciclo de vida de rondas o pagos que puedan modificar los KPIs de ventas: `ROUND_SUBMITTED`, `ROUND_SERVED`, `ROUND_CANCELED`, `CHECK_PAID`. El re-fetch MUST aplicar throttle (leading + trailing) de al menos 3 segundos para evitar tormentas de eventos.

#### Scenario: Un pedido se marca como SERVED y se actualizan los ingresos
- **WHEN** la Home está montada con `selectedBranchId = "1"` y `salesStore.daily.revenue_cents = 100000`
- **AND** llega un evento WS `{ type: 'ROUND_SERVED', data: { round_id: 42, branch_id: 1 } }`
- **THEN** el hook `useSalesWebSocketRefresh` SHALL invocar `salesStore.fetchDaily("1", todayISO())` una sola vez
- **AND** cuando la API responda con `revenue_cents: 115000`, el KPI "Ingresos del día" SHALL actualizarse en pantalla

#### Scenario: Ráfaga de eventos se agrupa por throttle
- **WHEN** la Home recibe 10 eventos `ROUND_SERVED` en menos de 1 segundo
- **THEN** `fetchDaily` SHALL ser llamado como máximo 2 veces en ese intervalo (leading + trailing)
- **AND** el último evento SHALL disparar un fetch final para reflejar el estado consolidado

#### Scenario: Eventos no financieros no disparan re-fetch
- **WHEN** la Home recibe un evento `ROUND_IN_KITCHEN` o `ROUND_READY`
- **THEN** `salesStore.fetchDaily` NO SHALL ser invocado
- **AND** los KPI cards mantienen su valor actual

---

### Requirement: Home page loads initial data on mount and branch change
La Home SHALL cargar los datos necesarios para renderizar los KPIs cuando se monta o cuando cambia `selectedBranchId`, invocando las acciones de store existentes sin introducir nuevas llamadas backend.

#### Scenario: Primer render con sucursal pre-seleccionada
- **WHEN** la Home se monta con `selectedBranchId = "1"` y los stores vacíos
- **THEN** la Home SHALL invocar `tableStore.fetchByBranch("1")` si `tableStore.items` está vacío
- **AND** SHALL invocar `salesStore.fetchDaily("1", todayISO())` siempre en el mount
- **AND** NO SHALL modificar `salesStore.selectedDate` (para no interferir con la página Sales)

#### Scenario: Usuario cambia de sucursal
- **WHEN** la Home está montada y el usuario selecciona otra sucursal en `BranchSwitcher`
- **AND** `branchStore.setSelectedBranch` dispara `useTableStore.clearAll()` y `useSalesStore.reset()` (comportamiento C-29)
- **THEN** la Home SHALL detectar el cambio via `selectedBranchId` en su `useEffect`
- **AND** SHALL volver a invocar `fetchByBranch` y `fetchDaily` con el nuevo `branchId`

---

### Requirement: Home page integrates with help system
La Home SHALL usar `PageContainer` y registrar contenido de ayuda en `helpContent.home` para cumplir con el sistema de ayuda unificado del Dashboard (skill `help-system-content`).

#### Scenario: HelpButton muestra contenido específico de la home
- **WHEN** el usuario hace click en el `HelpButton` de la Home
- **THEN** SHALL abrirse un popover con el contenido registrado en `helpContent.home`
- **AND** el contenido SHALL explicar: qué significan los KPIs, cómo cambiar de sucursal, y cómo interpretar el estado "sin sucursal"

---

### Requirement: Home page follows Zustand selector patterns
La implementación de la Home SHALL cumplir con el skill `zustand-store-pattern`: consumir los stores solo mediante selectores nombrados, usar `useShallow` para objetos/arrays compuestos, y no destructurar el store. Los valores derivados de `tableStore.items` (mesas activas, totales) SHALL exponerse como selectores escalares reutilizables.

#### Scenario: tableStore expone selectores escalares para conteos
- **WHEN** se implementa la Home
- **THEN** `tableStore.ts` SHALL exportar los selectores `selectActiveTablesCount` y `selectTotalTablesCount` que devuelven `number`
- **AND** la Home SHALL consumirlos vía `useTableStore(selectActiveTablesCount)` y `useTableStore(selectTotalTablesCount)` en lugar de filtrar `items` inline en el componente

#### Scenario: Home no destructura el store
- **WHEN** se revisa el código de `HomePage.tsx`
- **THEN** NO SHALL existir ninguna llamada de la forma `const { x, y } = useStore(s => s)` ni `useStore().x`
- **AND** cada valor del store SHALL obtenerse mediante un selector nombrado dedicado

---

### Requirement: Home page has unit test coverage for the three key states
La Home SHALL contar con tests unitarios (Vitest + Testing Library) que cubran al menos los tres escenarios principales: (a) render sin sucursal con CTA, (b) render con sucursal y datos mockeados, (c) actualización reactiva al cambiar el `tableStore`.

#### Scenario: Test 1 — estado sin sucursal
- **WHEN** se corre el test con `branchStore.selectedBranch = null`
- **THEN** la aserción SHALL confirmar la presencia del texto "Seleccioná una sucursal" y del botón "Elegir sucursal"
- **AND** SHALL confirmar que `salesStore.fetchDaily` no fue invocado

#### Scenario: Test 2 — estado con sucursal y datos
- **WHEN** se corre el test con mocks de `branchStore`, `tableStore` (8 mesas, 3 OCCUPIED) y `salesStore.daily = { orders: 42, revenue_cents: 150000, average_ticket_cents: 3571, diners: 65 }`
- **THEN** las aserciones SHALL confirmar la presencia de los 4 valores KPI con el formato esperado
- **AND** SHALL confirmar la presencia de los 5 quick-links con sus `href` correctos

#### Scenario: Test 3 — actualización reactiva
- **WHEN** el test actualiza `tableStore` para marcar una mesa adicional como OCCUPIED
- **THEN** el KPI "mesas activas" SHALL reflejar el nuevo conteo sin requerir `rerender()` manual
- **AND** `salesStore.fetchDaily` NO SHALL haber sido invocado por ese cambio
