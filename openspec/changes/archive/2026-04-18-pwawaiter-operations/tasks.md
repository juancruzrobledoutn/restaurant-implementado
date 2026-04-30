## 1. Setup y dependencias

- [x] 1.1 Agregar `idb` (^8) a `pwaWaiter/package.json` y correr `npm install`
- [x] 1.2 Crear archivo `pwaWaiter/src/lib/constants.ts` con `EMPTY_ARRAY: readonly []` estable (si no existe)
- [x] 1.3 Crear `pwaWaiter/src/lib/idb.ts` con wrapper tipado sobre `idb` (openDB, put, delete, getAll, count, clear)
- [x] 1.4 Crear `pwaWaiter/src/lib/idempotency.ts` con helper `generateClientOpId()` usando `crypto.randomUUID()`
- [x] 1.5 Confirmar que `.agents/SKILLS.md` lista las skills que se van a aplicar: `zustand-store-pattern`, `ws-frontend-subscription`, `react19-form-pattern`, `vercel-react-best-practices`, `pwa-development`, `systematic-debugging`, `test-driven-development`

## 2. Extensión de servicios API (pwaWaiter/src/services/)

- [x] 2.1 Extender `services/waiter.ts` con `getCompactMenu(branchId: string): Promise<CompactMenuDTO>`
- [x] 2.2 Agregar `createWaiterRound(sessionId: string, payload: CreateRoundDTO, clientOpId: string): Promise<RoundDTO>` con header `Idempotency-Key`
- [x] 2.3 Agregar `confirmRound(sessionId: string, roundId: string, clientOpId: string): Promise<RoundDTO>`
- [x] 2.4 Agregar `requestCheck(sessionId: string, clientOpId: string): Promise<CheckDTO>`
- [x] 2.5 Agregar `submitManualPayment(payload: ManualPaymentDTO, clientOpId: string): Promise<PaymentDTO>`
- [x] 2.6 Agregar `closeTable(tableId: string, clientOpId: string): Promise<void>`
- [x] 2.7 Agregar `listServiceCalls(): Promise<ServiceCallDTO[]>`, `ackServiceCall(id, clientOpId)`, `closeServiceCall(id, clientOpId)`
- [x] 2.8 Agregar `fetchWaiterTables(): Promise<TableDTO[]>` (reemplaza el mock de C-20)
- [x] 2.9 Agregar `activateTable(tableId: string): Promise<TableSessionDTO>`
- [x] 2.10 Agregar `catchupWaiterEvents(branchId: string, since: number): Promise<WaiterEventDTO[]>` apuntando a `/ws/catchup`
- [x] 2.11 Conversión de IDs number↔string en todos los mappers DTO (frontend = string, backend = number)
- [x] 2.12 Tests unitarios de cada función de `services/waiter.ts` con MSW (happy + error + idempotency header)

## 3. retryQueueStore (IndexedDB persistence)

- [x] 3.1 Crear `pwaWaiter/src/stores/retryQueueStore.ts` (Zustand + `idb`)
- [x] 3.2 Definir tipo `RetryEntry` con `id`, `op`, `payload`, `clientOpId`, `createdAt`, `attempts`, `nextAttemptAt`, `failed?`
- [x] 3.3 Inicializar DB `waiter-retry-queue` con object store scoped por `userId` (clave `{userId}:{entryId}`)
- [x] 3.4 Implementar `enqueue(op, payload)` con cap de 500 entries (bloquea y retorna error si está lleno)
- [x] 3.5 Implementar `drain()` que recorre entries con `nextAttemptAt <= now`, llama el handler correspondiente, elimina on success, incrementa `attempts` + calcula backoff on failure
- [x] 3.6 Backoff: `min(1000 * 2^attempts, 30000) + jitter(0..500)`; marcar `failed: true` al llegar a 10 intentos
- [x] 3.7 Registrar listeners `window.addEventListener('online', drain)` + hook en `waiterWsStore.on('open', drain)`
- [x] 3.8 Exportar selectores: `selectPendingCount`, `selectFailedEntries`, `selectEntriesBySession`
- [x] 3.9 Integrar con `authStore`: al logout → limpiar entries del `userId` saliente
- [x] 3.10 Tests: enqueue + drain + backoff + cap 500 + user-scoping + failed-after-10

## 4. compactMenuStore

- [x] 4.1 Crear `pwaWaiter/src/stores/compactMenuStore.ts`
- [x] 4.2 Shape: `{ branchId: string | null, categories: CompactCategory[], products: CompactProduct[], status: 'idle'|'loading'|'ready'|'error', error?: string }`
- [x] 4.3 Action `loadMenu(branchId)`: cache-first (skip si ya tiene `branchId` y `status==='ready'`)
- [x] 4.4 Selectores: `selectMenuStatus`, `selectProductsByCategory(catId)`, `selectProductById(id)` con `useShallow`
- [x] 4.5 Tests: primera carga, cache hit, error de red (sin encolar)

## 5. waiterCartStore (carrito local por sesión)

- [x] 5.1 Crear `pwaWaiter/src/stores/waiterCartStore.ts` con shape `Record<sessionId, CartItem[]>`
- [x] 5.2 Acciones: `addItem(sessionId, productId, quantity)`, `updateQuantity`, `removeItem`, `clearCart(sessionId)`, `setNotes`
- [x] 5.3 Selectores scoped por `sessionId` con `useShallow` y `EMPTY_ARRAY` fallback
- [x] 5.4 Helper `computeCartTotalCents(items, menu)` en `lib/cartMath.ts`
- [x] 5.5 Tests: add/update/remove/clear, aislamiento entre sessionIds

## 6. roundsStore

- [x] 6.1 Crear `pwaWaiter/src/stores/roundsStore.ts` con shape `{ bySession: Record<sessionId, Record<roundId, Round>> }`
- [x] 6.2 Action `upsertRound(round)` idempotente por `roundId`
- [x] 6.3 Action `updateRoundStatus(roundId, newStatus)` con validación de transiciones según `knowledge-base/01-negocio/04_reglas_de_negocio.md` §2
- [x] 6.4 Action `removeRound(roundId)` (solo en TABLE_CLEARED)
- [x] 6.5 Selectores: `selectRoundsBySession(sessionId)`, `selectPendingRounds(sessionId)`, `selectReadyRounds(sessionId)`
- [x] 6.6 Integración con handlers WS (delegado a §8)
- [x] 6.7 Tests: upsert idempotente, transiciones válidas, selectores con useShallow

## 7. serviceCallsStore

- [x] 7.1 Crear `pwaWaiter/src/stores/serviceCallsStore.ts` indexado por `id`
- [x] 7.2 Actions: `hydrate(list)`, `upsert(call)`, `remove(id)`
- [x] 7.3 Selectores: `selectActiveCalls`, `selectCallsByTable(tableId)`, `selectCallsBySector(sectorId)` con `useShallow`
- [x] 7.4 Tests: hydrate, upsert, remove, filtros por sector/mesa

## 8. Extensión de tableStore (reemplaza shell de C-20)

- [x] 8.1 Refactorizar `pwaWaiter/src/stores/tableStore.ts`: del shell mock a fetch real via `fetchWaiterTables()`
- [x] 8.2 Shape: `{ byId: Record<tableId, Table>, bySector: Record<sectorId, tableId[]>, status, lastFetch }`
- [x] 8.3 Action `loadTables()`: fetch + hidratación inicial
- [x] 8.4 Actions para WS: `applySessionStarted`, `applySessionCleared`, `applyStatusChanged`, `applyCheckRequested`, `applyCheckPaid`
- [x] 8.5 Selectores: `selectTableById`, `selectTablesBySector` con `useShallow` y `EMPTY_ARRAY`
- [x] 8.6 Tests unit: fetch, hydrate, aplicación de eventos WS (sin WS real)
- [x] 8.7 Actualizar tests heredados de C-20 para el shape nuevo

## 9. Extensión de waiterWsStore (suscripciones completas)

- [x] 9.1 Extender `stores/waiterWsStore.ts` con handlers para los 14 eventos del proyecto (ROUND_*, SERVICE_CALL_*, CHECK_*, TABLE_*)
- [x] 9.2 Cada handler escribe `waiter:lastEventTimestamp` en localStorage después de procesar
- [x] 9.3 Disparar `retryQueueStore.drain()` en el handler de `open` del socket
- [x] 9.4 Implementar `performCatchup(branchId)`: lee `lastEventTimestamp`, llama `catchupWaiterEvents`, replay-ea eventos por el mismo router
- [x] 9.5 Llamar `performCatchup` después de `open` (solo si había timestamp previo)
- [x] 9.6 Exponer banner "Datos pueden estar desactualizados" si `catchup` retorna `partial: true` o si la diferencia de tiempo es >5 min
- [x] 9.7 Tests: cada evento muta el store correcto, catchup replay-ea eventos correctamente, lastEventTimestamp se actualiza

## 10. Hook useWaiterSubscriptions (ref pattern)

- [x] 10.1 Crear `pwaWaiter/src/hooks/useWaiterSubscriptions.ts`
- [x] 10.2 Effect A (dep `[]`): crear refs `storesRef` con todos los stores relevantes
- [x] 10.3 Effect B (dep `[sessionId]` para páginas con contexto de mesa, o `[]` para globales): suscribir a eventos con `wsService.on(...)` y `return unsubscribe`
- [x] 10.4 Variante `useGlobalWaiterSubscriptions()` para `/tables` (eventos globales) y `useTableSubscriptions(tableId, sessionId)` para detalle
- [x] 10.5 Tests: re-render no duplica suscripciones, unmount libera suscripciones

## 11. Derivación de estado visual de mesa

- [x] 11.1 Crear `pwaWaiter/src/lib/tableState.ts` con `deriveVisualState(table, session, rounds, serviceCalls, now)`
- [x] 11.2 Implementar prioridad de animaciones: red blink > yellow pulse > orange blink > violet pulse > blue blink
- [x] 11.3 Exportar tipos `VisualTableState` y `VisualAnimation`
- [x] 11.4 Tests: matriz de casos con todas las combinaciones de animación

## 12. Componentes reutilizables

- [x] 12.1 Actualizar `components/TableCard.tsx` (de C-20) para consumir `deriveVisualState` y renderizar animaciones
- [x] 12.2 Crear `components/RoundCard.tsx`: muestra estado + items + botón "Confirmar" si PENDING
- [x] 12.3 Crear `components/ServiceCallItem.tsx`: muestra llamada + botones ACK/Cerrar
- [x] 12.4 Crear `components/CompactMenuGrid.tsx`: lista de productos con botón "+" para agregar al carrito
- [x] 12.5 Crear `components/CartDrawer.tsx`: drawer lateral con items del carrito y botón "Enviar comanda"
- [x] 12.6 Crear `components/ManualPaymentForm.tsx` con `useActionState` y validación
- [x] 12.7 Crear `components/OfflineBanner.tsx`: banner amarillo cuando no hay red o cola pendiente
- [x] 12.8 Crear `components/StaleDataBanner.tsx`: banner "Datos pueden estar desactualizados — Actualizar"
- [x] 12.9 Tests de componentes con RTL: render + interacciones clave

## 13. Páginas

- [x] 13.1 Actualizar `pages/TablesPage.tsx` (de C-20) para usar el nuevo `tableStore` con fetch real + agrupación por sector existente
- [x] 13.2 Crear `pages/TableDetailPage.tsx` en ruta `/tables/:tableId`: muestra rondas, botón "Activar mesa" si no hay sesión, botón "Comanda rápida", botón "Solicitar cuenta" / "Registrar pago", sección service-calls de la mesa
- [x] 13.3 Crear `pages/QuickOrderPage.tsx` en ruta `/tables/:tableId/quick-order`: grid del menú compacto + CartDrawer
- [x] 13.4 Crear `pages/ServiceCallsPage.tsx` en ruta `/service-calls`: inbox global con filtro por sector
- [x] 13.5 Agregar rutas en el router (React Router 7) con guards `authStore` + `branchAssignmentGuard`
- [x] 13.6 Tests integración por página (render + acciones clave)

## 14. Hook useEnqueuedAction (integra useActionState + retry queue)

- [x] 14.1 Crear `pwaWaiter/src/hooks/useEnqueuedAction.ts` que envuelve `useActionState`
- [x] 14.2 Si la llamada al server falla por error de red: encolar en retryQueueStore y retornar `status: 'queued'`
- [x] 14.3 Si falla por error 4xx no reintentable (validación): retornar `status: 'failed'` sin encolar
- [x] 14.4 Si éxito: retornar `status: 'success'` con payload
- [x] 14.5 Tests: happy path, enqueue-on-network-error, no-enqueue-on-4xx

## 15. Aplicación del retry queue a operaciones específicas

- [x] 15.1 Integrar retry queue en `createWaiterRound` (via useEnqueuedAction)
- [x] 15.2 Integrar en `confirmRound`
- [x] 15.3 Integrar en `requestCheck`
- [x] 15.4 Integrar en `submitManualPayment`
- [x] 15.5 Integrar en `closeTable` (con guard "no permitir si hay pagos pendientes")
- [x] 15.6 Integrar en `ackServiceCall` y `closeServiceCall`
- [x] 15.7 Tests E2E-lite: simular offline → encolar → online → drain exitoso

## 16. i18n y estilos

- [x] 16.1 Agregar strings nuevas a `pwaWaiter/src/i18n/es.json` (no existe archivo i18n en C-20 — strings directas en español per spec)
- [x] 16.2 Colores de animación según guía: rojo (#ef4444), amarillo (#eab308), naranja (#f97316), violeta (#a855f7), azul (#3b82f6)
- [x] 16.3 Tailwind classes para animaciones en `index.css` (Tailwind v4 usa @theme y @keyframes, no tailwind.config.ts)
- [x] 16.4 Responsive mobile-first aplicado: `overflow-x-hidden w-full max-w-full` en QuickOrderPage, grid `grid-cols-2` en CompactMenuGrid

## 17. Validación final

- [x] 17.1 `npm run type-check` en `pwaWaiter/` → 0 errores
- [x] 17.2 `npm run test` en `pwaWaiter/` → todos los tests passing (205/205)
- [x] 17.3 `npm run lint` → 0 warnings — Se creó `eslint.config.js` (ESLint v9 flat config) con reglas canónicas del proyecto, se refactorizaron 4 destructuraciones Zustand a selectores individuales, se renombró `useTableStore_apply` → `applyToTableStore` para no violar `react-hooks/rules-of-hooks`
- [~] 17.4 Smoke manual — **PARCIAL 2026-04-18**: probado login → ver mesas → quick-order → crear ronda PENDING → confirmar PENDING→CONFIRMED. **No probado**: submit/in_kitchen/ready/served/request-check/pago/cerrar (requiere C-16 dashboard-operations para flujo multi-rol; en aislamiento el BillingService rechaza con "total 0 centavos" porque solo cuenta items SERVED). Revalidar completo en C-22 e2e-critical-flow. Bugs encontrados y arreglados en esta pasada: (1) `GET /api/waiter/tables` no existía en backend — agregado; (2) status `OCCUPIED` vs `ACTIVE` — derivación en endpoint; (3) compactMenu shape jerárquico vs plano — mapper corregido; (4) CORS `Idempotency-Key` no estaba en `allow_headers`; (5) `confirmRound` URL `/sessions/X/rounds/Y/confirm` vs backend `PATCH /rounds/Y` con body `{status}`; (6) `confirmRound` response sin `items` → `map` crasheaba; (7) UI no refresca tras mutation — issue #6 del code review
- [x] 17.5 Verificar que tests de C-20 no regresaron (205 tests totales passing, incluye los 45 heredados de C-20)
- [x] 17.6 `openspec validate pwawaiter-operations --strict`
- [x] 17.7 Update `openspec/CHANGES.md`: marcar C-21 como `[x]` implementado
- [x] 17.8 Guardar resumen de apply en engram con `topic_key: opsx/pwawaiter-operations/apply`
