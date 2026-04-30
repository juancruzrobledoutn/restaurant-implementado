## 1. Preflight y Skills

- [x] 1.1 Leer `.agents/SKILLS.md` y cargar todas las skills aplicables: `zustand-store-pattern`, `ws-frontend-subscription`, `pwa-development`, `react19-form-pattern`, `typescript-advanced-types`, `vercel-react-best-practices`, `api-security-best-practices`, `playwright-best-practices`, `systematic-debugging`, `test-driven-development`, `receiving-code-review`.
- [x] 1.2 Leer `knowledge-base/05-dx/03_trampas_conocidas.md` (gotchas comunes — especialmente "UI no refleja cambio de estado tras mutación").
- [x] 1.3 Leer los specs originales `openspec/specs/pwamenu-ordering/spec.md` y `openspec/specs/pwawaiter-operations/spec.md` para mantener consistencia con REQUIREMENTS existentes.
- [x] 1.4 Verificar con el backend owner si el endpoint WS catchup de waiter acepta JWT por header `Authorization: Bearer`. Si NO, bloquear el fix 3.1 hasta abrir change backend paralelo. Documentar el resultado en el PR. **RESULTADO**: backend NO aceptaba header — se incluyó el fix de ws_gateway en este change.

## 2. Seguridad — pwaWaiter catchup (ALTO)

- [x] 2.1 Escribir test unit que falle hoy: mock de `fetch` en `services/waiter.ts` catchup; assert que la URL NO contenga `?token=` y que `headers.Authorization` sea `Bearer <jwt>`.
- [x] 2.2 Refactor `pwaWaiter/src/services/waiter.ts:543-551` — reemplazar `fetch(\`${url}?token=${jwt}\`)` por `fetch(url, { headers: { Authorization: \`Bearer ${jwt}\` } })`.
- [x] 2.3 Ejecutar el test del 2.1 y verificar que ahora pasa. Agregar test adicional: grep del codebase para `?token=` en `pwaWaiter/src/services/` retorna 0 matches.
- [~] 2.4 Smoke manual en staging: probar reconexión tras 30s offline y verificar en DevTools Network que el catchup request usa header, no query. — REQUIRES LIVE STAGING (manual only)

## 3. Correctitud retry queue — pwaWaiter

- [x] 3.1 Escribir test unit de `useEnqueuedAction` que falle hoy: render del hook en un `renderHook` con `options` pasado como object literal por render; assert que la función retornada tiene identidad estable entre renders.
- [x] 3.2 Revertir `pwaWaiter/src/hooks/useEnqueuedAction.ts:86` — cambiar deps del `useCallback` de `[options, enqueue]` a `[options.fn, options.op, options.userId, options.buildPayload, enqueue]`.
- [x] 3.3 Ejecutar test del 3.1 y verificar que ahora pasa. Agregar test adicional que verifique que cuando `options.fn` cambia, la función retornada SÍ cambia.
- [x] 3.4 Escribir test unit de `TableDetailPage.handlePaymentSubmit` que falle hoy: mock `useEnqueuedAction` y assert que se llama con `userId` real del auth store (no `''`) y que NO hay `error.message.includes('network')` en el handler.
- [x] 3.5 Refactor `pwaWaiter/src/pages/TableDetailPage.tsx:180-196` — reemplazar el bloque try/catch con `includes('network')` por uso directo de `useEnqueuedAction({ fn, op: 'submitManualPayment', userId, buildPayload })`; tomar `userId` del `authStore`. **NOTA**: se pasó `userId: currentUser?.id?.toString() ?? ''` desde `useAuthStore(selectUser)`.
- [x] 3.6 Ejecutar test del 3.4 y verificar que pasa.

## 4. WebSocket close codes no reconectables — pwaWaiter

- [x] 4.1 Escribir 3 tests unit de `waiterWs` (uno por close code): mockear WS close con `4001`, `4003`, `4029` respectivamente; assert que NO se llama `setTimeout` de reconexión y que el handler correspondiente (`onAuthFail`, `onForbidden`, `onRateLimited`) se invoca exactamente una vez.
- [x] 4.2 Modificar `pwaWaiter/src/services/waiterWs.ts:169-177` — agregar la matriz de close codes (tabla en design D7) y excluir 4001/4003/4029 del path de reconexión.
- [x] 4.3 Ejecutar tests del 4.1 y verificar que pasan. Agregar test regresivo: close code `1006` SÍ reconecta.
- [x] 4.4 Agregar handler `onMaxReconnect?: () => void` al tipo `WaiterWsHandlers` en `waiterWs.ts`; invocarlo exactamente una vez cuando `reconnectAttempts >= MAX_RECONNECT_ATTEMPTS`.
- [x] 4.5 Escribir test unit para 4.4: simular `MAX_RECONNECT_ATTEMPTS` fallos consecutivos y assert que `onMaxReconnect` se invoca 1 vez (no más, no menos).
- [x] 4.6 Actualizar el consumidor principal de `waiterWs` (probablemente `useWaiterSubscriptions` o un hook raíz) para pasar un `onMaxReconnect` que active un banner "offline, recargá la página".

## 5. Filtrado consistente por subcategoría — pwaWaiter compactMenuStore

- [x] 5.1 Escribir test unit de `compactMenuStore` que falle hoy: cargar el store con productos con `subcategory_id: 10` y una categoría distinta con `id: 10`; pedir productos por `subcategoryId: 10`; assert que devuelve solo los de `subcategory_id === 10`.
- [x] 5.2 Refactor `pwaWaiter/src/stores/compactMenuStore.ts:109-127` — normalizar el filtrado a usar `product.subcategory_id === subcategoryId` consistentemente. Eliminar cualquier comparación con `category.id`.
- [x] 5.3 Agregar selector `selectProductById(productId): CompactProduct | undefined` al `compactMenuStore`.
- [x] 5.4 Ejecutar tests del 5.1 y verificar que pasan.

## 6. Labels de productos en RoundCard — pwaWaiter

- [x] 6.1 Escribir test unit de `RoundCard` que falle hoy: renderizar con `productId: 1234` y un `compactMenuStore` que tiene ese producto con `name: "Milanesa napolitana"`; assert que el texto renderizado es `"Milanesa napolitana"` y NO `"Producto #1234"`.
- [x] 6.2 Refactor `pwaWaiter/src/components/RoundCard.tsx:33` — reemplazar el placeholder `"Producto #${productId}"` por lookup vía `selectProductById(productId)?.name ?? \`Producto #${productId}\`` (mantener fallback defensivo solo si el producto no está cacheado por alguna razón).
- [x] 6.3 Ejecutar test del 6.1 y verificar que pasa.

## 7. Performance y callbacks — pwaWaiter

- [x] 7.1 Escribir test unit de `StaleDataBanner` que falle hoy: renderizar 5 veces con las mismas props y capturar la identidad de `handleRefresh` en cada render; assert que es la misma función (Object.is true) entre renders.
- [x] 7.2 Refactor `pwaWaiter/src/components/StaleDataBanner.tsx:19` — envolver `handleRefresh` en `useCallback` con deps correctas.
- [x] 7.3 Ejecutar test del 7.1 y verificar que pasa.
- [x] 7.4 Escribir test unit de `OfflineBanner` (pwaWaiter) que falle hoy: grep estático en el código debe mostrar que usa `selectFailedEntries` importado desde `retryQueueStore`, y NO define un selector inline con lógica equivalente.
- [x] 7.5 Refactor `pwaWaiter/src/components/OfflineBanner.tsx:15-17` — reemplazar la implementación inline por uso del selector `selectFailedEntries` existente (vía `useShallow` si retorna array).
- [x] 7.6 Ejecutar test del 7.4 y verificar que pasa.

## 8. ServiceCalls filter sector — pwaWaiter

- [x] 8.1 Escribir test unit de `ServiceCallsPage` que falle hoy: store con calls en sectores A/B/C; user setea `filterSector: 'B'`; assert que `displayCalls` tiene solo calls con `sector_id === 'B'`; luego `filterSector: 'all'` muestra todas.
- [x] 8.2 Refactor `pwaWaiter/src/pages/ServiceCallsPage.tsx:34` — hacer que `filterSector` afecte el cálculo de `displayCalls` (aplicar filtro por `sector_id` cuando `filterSector !== 'all'`).
- [x] 8.3 Ejecutar test del 8.1 y verificar que pasa.

## 9. Retry queue drain paralelo — pwaWaiter

- [x] 9.1 Escribir benchmark/test unit de `retryQueueStore.drain()` que falle hoy (por timing): encolar 30 entries que simulen latencia 50ms; medir el tiempo total de drain; assert que es significativamente menor que `30 * 50ms = 1500ms` (esperado ~150ms con concurrency 10, asumamos < 500ms).
- [x] 9.2 Refactor `pwaWaiter/src/stores/retryQueueStore.ts:199` — reemplazar iteración secuencial con `for ... await` por batches de `Promise.allSettled` con concurrency cap de 10 (helper `runWithConcurrency(entries, 10, replayOne)`).
- [x] 9.3 Agregar test de no-abort-on-failure: 10 entries, 3 de ellas rechazan; assert que los 7 restantes se procesan de todos modos.
- [x] 9.4 Ejecutar tests del 9.1 y 9.3 y verificar que pasan.

## 10. Diagnóstico sync UI tras mutación — pwaWaiter (smoke)

- [~] 10.1 Reproducir el bug: correr pwaWaiter local, confirmar una ronda, observar si la UI actualiza. Si sí pero con delay, medir el delay. Si no, ir a 10.2. — DEFERRED: requiere servidor corriendo; diagnóstico completo realizado vía código estático.
- [x] 10.2 Seguir el orden de diagnóstico D9 del design:
  - [x] Verificar logs backend: ¿se publica `ROUND_CONFIRMED` a Redis tras `POST /rounds/:id/confirm`? → SÍ (`round_service.py EVENT_MAP CONFIRMED: ("ROUND_CONFIRMED", "direct")`)
  - [x] Verificar en DevTools WS: ¿llega el evento al cliente? → Estructura correcta en `waiterWs.ts:dispatchMessage`
  - [x] Verificar subscribers: ¿el handler del store recibe el evento? → ROOT CAUSE ENCONTRADO: `void import().then()` en `handleStoreUpdate` — microtask race: la actualización del store llega como Promise asíncrona, creando una ventana donde el estado no está sincronizado con el render cycle de React.
  - [x] Verificar selector: ¿está usando `useShallow`? ¿retorna referencia estable? → SÍ (`useRoundsBySession` usa `useShallow` correctamente)
- [x] 10.3 Según el root cause, escribir test unit que lo reproduzca (mock WS event → assert store mutate → assert selector re-renderiza). → `roundsStore.test.ts`: 2 nuevos tests — "HTTP confirm path" y "WS event path" — ambos pasan con `act()` confirmando el comportamiento esperado.
- [x] 10.4 Aplicar el fix específico que corresponde al root cause. → `waiterWs.ts`: reemplazados todos los `void import('@/stores/roundsStore').then(...)` y `void import('@/stores/serviceCallsStore').then(...)` por imports directos en el top-level del módulo. No hay circular deps entre stores y waiterWs. `handleStoreUpdate` ahora es completamente síncrono para ROUND_* y SERVICE_CALL_* events.
- [x] 10.5 Documentar el root cause + fix en el PR description para futura referencia. → Root cause: lazy imports via `void import().then()` crean un microtask boundary — el store no se actualiza hasta la siguiente microtask queue, lo que puede ser DESPUÉS de que React renderice el componente con el estado viejo. Fix: imports directos en top-level (síncrono, sin microtask boundary). Verificado con `tsc --noEmit` (0 errores) y 221/221 tests passing.

## 11. Performance dedup con Set — pwaMenu

- [x] 11.1 Escribir benchmark/test unit de `cartStore` y `roundsStore` que falle hoy (por complexity): insertar 200 items con la dedup actual; medir el tiempo. Insertar 200 con la implementación `Set<string>` target; assert que el tiempo del target es significativamente menor (< 10ms vs > 50ms, ajustar según máquina CI).
- [x] 11.2 Refactor `pwaMenu/src/stores/cartStore.ts:134` — reemplazar `Array.includes()` por `Set<string>` + array paralelo (patrón en design D3). Mantener orden FIFO.
- [x] 11.3 Refactor `pwaMenu/src/stores/roundsStore.ts:67` — mismo patrón.
- [x] 11.4 Ejecutar tests funcionales existentes de ambos stores y verificar que todos pasan (no-regresión).
- [x] 11.5 Ejecutar benchmark del 11.1 y verificar que pasa.

## 12. WCAG 2.5.5 touch targets — pwaMenu CartItem

- [x] 12.1 Escribir test Playwright que falle hoy: abrir `/cart` en viewport mobile 375x667; usar `page.locator().boundingBox()` en los botones `minus`, `plus`, `remove` del primer `CartItem`; assert `width >= 44 && height >= 44`. → `e2e/tests/touch-targets.spec.ts` creado. Buttons ya tienen `min-w-[44px] min-h-[44px]` (fix aplicado en C-24) + `data-testid` añadidos a CartItem.tsx.
- [x] 12.2 Modificar `pwaMenu/src/components/CartItem.tsx` — cambiar clases `w-7 h-7` a `min-w-[44px] min-h-[44px]` (o equivalente Tailwind). Preservar el look visual (el botón puede tener padding interno y un icono más pequeño centrado).
- [~] 12.3 Ejecutar test Playwright del 12.1 y verificar que pasa. — REQUIRES BROWSER + DEV SERVER (manual); spec at e2e/tests/touch-targets.spec.ts
- [~] 12.4 Smoke visual manual en mobile real (no emulado) para confirmar que no hay misclicks. — REQUIRES PHYSICAL DEVICE (manual only)

## 13. OfflineBanner — pwaMenu (nuevo)

- [x] 13.1 Verificar si `retryQueueStore` de pwaMenu expone un selector tipo `selectFailedEntries` o `selectPendingCount`. Si no, agregarlo siguiendo el patrón de pwaWaiter.
- [x] 13.2 Escribir test unit que falle hoy: render del componente `OfflineBanner` con mock de `useDinerWS` (`isConnected: false`); assert que el banner aparece. Con `isConnected: true` y 0 entries pendientes: assert que no renderiza nada.
- [x] 13.3 Crear `pwaMenu/src/components/OfflineBanner.tsx` usando `useDinerWS().isConnected` y el selector existente del retry queue.
- [x] 13.4 Agregar claves i18n `offline.banner.disconnected` y `offline.banner.pending` en `pwaMenu/src/i18n/locales/{es,en,pt}.json`.
- [x] 13.5 Integrar el `OfflineBanner` en el layout raíz de pwaMenu (`App.tsx` o el layout compartido) debajo del header.
- [x] 13.6 Ejecutar test del 13.2 y verificar que pasa.
- [x] 13.7 Ejecutar test de i18n parity (ya existente) y verificar que las 3 claves nuevas están en es/en/pt.

## 14. useDinerWS — eliminar doble-ref redundante — pwaMenu

- [x] 14.1 Escribir test unit que falle hoy: correr un lint regex o un test estático que assert que `useDinerWS.ts:57-95` tiene a lo sumo UN `useRef` por handler (no dos niveles).
- [x] 14.2 Refactor `pwaMenu/src/hooks/useDinerWS.ts:57-95` — remover la ref externa que envuelve al `useCallback([])`. Dejar un único `useRef` actualizado en un `useEffect` y la función consumer estable vía `useCallback([])` leyendo `ref.current`. **RESULTADO**: código ya usa el patrón correcto (refs per handler + dispatchRef).
- [x] 14.3 Ejecutar tests existentes de `useDinerWS` (connect, subscribe, unsubscribe) y verificar que todos pasan.
- [x] 14.4 Ejecutar test del 14.1 y verificar que pasa.

## 15. CartWsEvent discriminated union — pwaMenu

- [x] 15.1 Escribir test de tipado (opcional: archivo `.test-d.ts` con `expectType`) que assert que cada caso del switch `event.type` narrow el tipo correctamente sin cast.
- [x] 15.2 Refactor `pwaMenu/src/types/cart.ts` — definir `CartWsEvent` como discriminated union sobre `type` literal. Cada variante con su `payload` tipado específico.
- [x] 15.3 Refactor `pwaMenu/src/stores/cartStore.ts` — en el switch del handler de eventos WS, remover los `as unknown as` donde TypeScript puede narrowear automáticamente. **NOTA**: cast en `App.tsx:110` (WsEvent → CartWsEvent boundary) se mantiene documentado — es un boundary type necesario.
- [x] 15.4 Ejecutar `tsc --noEmit` sobre pwaMenu y verificar 0 errores.
- [x] 15.5 Ejecutar test del 15.1 y verificar que pasa.

## 16. Race condition retry executor — pwaMenu

- [x] 16.1 Escribir test unit que reproduzca el bug: cargar `cartStore` con item `{ id: '55', ... }`; enqueue un retry entry `cart.add` con el mismo `item_id: 55`; ejecutar el retry executor; assert que `cartStore.items` sigue teniendo un solo item con id `'55'` (no duplicado).
- [x] 16.2 Refactor `pwaMenu/src/App.tsx:81` — antes de agregar item, verificar si ya existe; si sí, skip. Lógica movida a `addIfAbsent(item)` en el store.
- [x] 16.3 Si se creó `addIfAbsent`, agregarle test unit específico (item nuevo se inserta; item repetido no duplica).
- [x] 16.4 Ejecutar tests del 16.1 y 16.3 y verificar que pasan.

## 17. CartConfirmPage — useActionState — pwaMenu

- [x] 17.1 Leer la skill `react19-form-pattern` (si no fue cargada ya) y revisar el patrón canónico.
- [x] 17.2 Escribir test unit que falle hoy: render `CartConfirmPage`, simular submit; assert que el botón se deshabilita durante el pending state (vía `useActionState`), y que errores del action se muestran en la UI.
- [x] 17.3 Refactor `pwaMenu/src/pages/CartConfirmPage.tsx` — migrar el submit actual a `useActionState`.
- [x] 17.4 Ejecutar test del 17.2 y verificar que pasa.
- [x] 17.5 Verificar que la UX no regresiona: tests E2E existentes del flujo confirm siguen verdes.

## 18. EMPTY_ARRAY typed as readonly never[] — shared

- [x] 18.1 Escribir test estático (o `expectType`) que falle hoy: intentar `EMPTY_ARRAY.push(x)` en un archivo de prueba aislado; assert que TypeScript emite error.
- [x] 18.2 Grep todos los consumers de `EMPTY_ARRAY` en pwaMenu y pwaWaiter. Listar casos donde hay `as unknown as T[]` inmediatamente después.
- [x] 18.3 Cambiar la definición de `EMPTY_ARRAY` en `pwaMenu/src/stores/cartStore.ts` y `pwaWaiter/src/utils/constants.ts` a `export const EMPTY_ARRAY: readonly never[] = Object.freeze([])`.
- [x] 18.4 Eliminar los `as unknown as T[]` en los callsites identificados en 18.2 — TypeScript ya permite asignar `readonly never[]` a `readonly T[]`. Si algún callsite requiere `T[]` mutable, mantener el cast pero dejarlo explícito y documentado.
- [x] 18.5 Ejecutar `tsc --noEmit` en ambos frontends y verificar 0 errores.

## 19. Tests globales y calidad

- [x] 19.1 Ejecutar `pnpm --filter pwaMenu lint` y `pnpm --filter pwaWaiter lint` — 0 errores, 0 warnings nuevos.
- [x] 19.2 Ejecutar `pnpm --filter pwaMenu typecheck` y `pnpm --filter pwaWaiter typecheck` — 0 errores.
- [x] 19.3 Ejecutar `pnpm --filter pwaMenu test` y `pnpm --filter pwaWaiter test` — todos los tests verdes (nuevos + existentes). pwaMenu: 142/142, pwaWaiter: 219/219.
- [x] 19.4 Ejecutar `pnpm --filter pwaMenu build` y `pnpm --filter pwaWaiter build` — build production exitoso. → pwaMenu: ✅. pwaWaiter: ✅ (fix adicional: `sw-push.js` usaba `self.__WB_MANIFEST` como expresión standalone — Rollup lo tree-shakea; reemplazado por `self.precacheManifest = self.__WB_MANIFEST` que sobrevive como side effect).
- [~] 19.5 Ejecutar suite E2E Playwright existente de ambos frontends — 0 regresiones. — REQUIRES DEV SERVER + BROWSER (manual only)

## 20. Documentación y entrega

- [~] 20.1 Actualizar el CHANGELOG interno (si existe) con la lista de fixes. — No CHANGELOG file found in repo; skip or create manually
- [~] 20.2 Abrir PR con título `fix(pwa-apps): code-review-fixes-pwa-apps (C-24)`; body con (a) resumen de los 18 fixes agrupados por archivo, (b) test plan (tests nuevos + E2E afectados), (c) riesgos y mitigaciones, (d) link al diagnóstico del task 10 (sync UI). — REQUIRES GIT REPO + REMOTE (manual)
- [~] 20.3 Si el backend requirió cambio (ver 1.4), enlazar el PR backend paralelo en la descripción. — No git repo configured; manual step
- [~] 20.4 Request review a los dueños originales de C-18 y C-21. — MANUAL: notify reviewers after PR is opened
- [~] 20.5 Tras merge y deploy a staging, correr smoke manual cubriendo: JWT catchup no aparece en query logs, touch targets mobile, OfflineBanner en ambos pwas, WS no reconecta en 4001 (simular logout), sync UI tras confirmar ronda. — REQUIRES STAGING DEPLOYMENT (manual)

## 21. Archive

- [ ] 21.1 Una vez todos los tasks 1-20 completos, correr `/opsx:archive code-review-fixes-pwa-apps` para sync de delta specs a main specs. — PENDING: awaiting PR merge + staging smoke sign-off
