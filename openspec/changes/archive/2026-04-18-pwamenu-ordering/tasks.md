## 1. Types y utilidades base

- [x] 1.1 Crear `pwaMenu/src/types/cart.ts` con `CartItem`, `CartStoreState`, `AddItemPayload`, `UpdateItemPayload`
- [x] 1.2 Crear `pwaMenu/src/types/round.ts` con `Round`, `RoundItem`, `RoundStatus` enum string literal union
- [x] 1.3 Crear `pwaMenu/src/types/wsEvents.ts` con interfaces para `CART_ITEM_ADDED`, `CART_ITEM_UPDATED`, `CART_ITEM_REMOVED`, `CART_CLEARED`, `ROUND_*`, `TABLE_STATUS_CHANGED` incluyendo `event_id`
- [x] 1.4 Crear `pwaMenu/src/utils/dinerColor.ts` con paleta de 8 colores hex contrastados y `getDinerColor(dinerId: string): string`
- [x] 1.5 Extender `pwaMenu/src/utils/format.ts` con `formatCartItemSubtotal(priceCents: number, qty: number, locale: string): string` si no existe ya el helper base

## 2. cartStore (Zustand)

- [x] 2.1 Crear `pwaMenu/src/stores/cartStore.ts` con estado `{ items: Record<string, CartItem>, processedEventIds: Set<string> }`, acciones `addItem`, `updateItem`, `removeItem`, `clear`, `applyWsEvent`, `replaceAll` (para catch-up fallback)
- [x] 2.2 Implementar selectores puros: `selectItems`, `selectMyItems(dinerId)`, `selectSharedItems(dinerId)`, `selectTotalCents`, `selectConfirmedTotalCents`, `selectItemCount` — todos con `useShallow` en consumers
- [x] 2.3 Implementar `EMPTY_ARRAY` y `EMPTY_RECORD` constantes reference-stable para fallbacks
- [x] 2.4 Implementar deduplicación de eventos con set FIFO capacity 200 (insertar + drop oldest al exceder)
- [x] 2.5 Implementar fusión de item tmp con evento WS entrante (match por `productId + dinerId + createdAt < 10s`)
- [x] 2.6 Tests en `pwaMenu/src/tests/cartStore.test.ts`: add optimistic, reemplazo tmp→real en success, rollback en error, WS ADDED/UPDATED/REMOVED/CLEARED, dedup por event_id, fusión tmp↔WS

## 3. retryQueueStore (Zustand + localStorage)

- [x] 3.1 Crear `pwaMenu/src/stores/retryQueueStore.ts` con estado `{ queue: RetryEntry[] }`, acciones `enqueue`, `dequeue(id)`, `incrementAttempts(id)`, `hydrate`, `purgeStale`
- [x] 3.2 Persistencia en `localStorage` bajo key `pwamenu-retry-queue` via middleware `persist` de Zustand, con fallback a memoria si `localStorage` falla (try/catch + logger)
- [x] 3.3 Implementar `purgeStale()` que descarta entries con `enqueuedAt + 5min < now` al hidratar
- [x] 3.4 Implementar cap de 50 entries: al exceder, drop oldest con warning via `utils/logger.ts`
- [x] 3.5 Implementar drainer: escucha `window.addEventListener('online', drain)`, timer periódico `setInterval(15s)`, expone `drain()` público; reproduce en FIFO, remueve en success, incrementa attempts en fail
- [x] 3.6 Descarte tras 3 intentos fallidos consecutivos con toast `t('errors.retry.gave_up')`
- [x] 3.7 Tests en `pwaMenu/src/tests/retryQueueStore.test.ts`: enqueue + orden FIFO, persistencia en localStorage, hidratación + purge stale, descarte tras 3 fails, fallback en memoria, drain en `online`

## 4. roundsStore (Zustand)

- [x] 4.1 Crear `pwaMenu/src/stores/roundsStore.ts` con estado `{ rounds: Record<string, Round>, processedEventIds: Set<string> }`
- [x] 4.2 Acciones: `setRounds` (para fetch inicial), `applyWsEvent`, `upsertRound` (para respuesta de POST), `clear`
- [x] 4.3 Selectores: `selectRounds`, `selectRoundsByStatus(status)`, `selectLatestRound`, `selectHasReady`
- [x] 4.4 Filtrado por `sessionId` actual: ignorar eventos de otras sesiones
- [x] 4.5 Deduplicación de eventos por `event_id` (mismo pattern que cartStore)
- [x] 4.6 Tests en `pwaMenu/src/tests/roundsStore.test.ts`: apply ROUND_PENDING→CONFIRMED→SUBMITTED→IN_KITCHEN→READY→SERVED, ignorar otras sesiones, dedup duplicado, upsert desde respuesta POST

## 5. Servicios API (diner)

- [x] 5.1 Extender `pwaMenu/src/services/dinerApi.ts` con `cart.add(payload)`, `cart.update(itemId, payload)`, `cart.remove(itemId)`, `cart.list()` — todos con `X-Table-Token` y conversión int↔string en boundary
- [x] 5.2 Agregar `rounds.submit(notes?)` y `rounds.list()` — mismo patrón
- [x] 5.3 Agregar `session.get()` (wrapper de `GET /api/diner/session`) para refetch defensivo
- [x] 5.4 Crear `pwaMenu/src/services/catchup.ts` con `fetchSessionCatchup(sessionId, since)` que devuelve `{ status: 'ok', events: WsEvent[] } | { status: 'too_old' }`
- [x] 5.5 Manejar 409 estructurado: parsear `detail.reason` (`session_paying`, `insufficient_stock`) y exponer tipos tipados al caller
- [x] 5.6 Tests con MSW en `pwaMenu/src/tests/dinerApi.test.ts`: happy path add/update/remove, 409 session_paying, 409 insufficient_stock con lista de productos, 401 → limpia sesión

## 6. Cliente WebSocket diner

- [x] 6.1 Crear `pwaMenu/src/services/ws/dinerWS.ts` como clase singleton con `connect(token)`, `disconnect()`, `on(event, handler): () => void`, `emit` interno, estado `CONNECTED | CONNECTING | RECONNECTING | DISCONNECTED | AUTH_FAILED`
- [x] 6.2 Implementar reconexión con backoff exponencial (1s → 2s → 4s ... → 30s), jitter ±30%, máx 50 intentos
- [x] 6.3 Detectar códigos de cierre no recuperables (4001, 4003, 4029): NO reconectar, limpiar sesión via `sessionStore`, redirigir a `/scan`
- [x] 6.4 Heartbeat: responder `pong` a `ping` del servidor cada 30s
- [x] 6.5 Mantener `lastEventTimestamp` interno para catch-up
- [x] 6.6 Al transicionar de `RECONNECTING → CONNECTED`, disparar `fetchSessionCatchup()` y re-emitir eventos a través del mismo pipeline de handlers; si `too_old`, emitir evento interno `REHYDRATE_REQUIRED` que cartStore/roundsStore escuchan para hacer refetch completo
- [x] 6.7 Tests en `pwaMenu/src/tests/dinerWS.test.ts` con `mock-socket` o stub manual: backoff exponencial calculado correctamente, 4001 no reconecta, catch-up dispara en RECONNECTING→CONNECTED

## 7. Hooks de integración

- [x] 7.1 Crear `pwaMenu/src/hooks/useDinerWS.ts`: dos effects — `useEffect([token])` para conectar/desconectar y `useEffect([handlers])` para suscribir/desuscribir; handlers memorizados con `useCallback`
- [x] 7.2 Crear `pwaMenu/src/hooks/useOptimisticCart.ts`: wrapper de `useOptimistic` React 19 que combina items confirmados del store con items pendientes locales para render del drawer
- [x] 7.3 Crear `pwaMenu/src/hooks/useSessionStatusGuard.ts`: refetch `GET /api/diner/session` al montar y actualizar `sessionStore.tableStatus`; usado en `/cart` y `/cart/confirm`
- [x] 7.4 Crear `pwaMenu/src/hooks/useRetryQueueDrainer.ts`: inicializa drainer global al montar el app shell, registra listeners `online` + timer; cleanup en desmonte
- [x] 7.5 Tests de hooks con `@testing-library/react` en `pwaMenu/src/tests/hooks/`: rerender no reconecta WS, cleanup desuscribe, optimistic incluye pendientes

## 8. Componentes de carrito

- [x] 8.1 Crear `pwaMenu/src/components/cart/DinerAvatar.tsx`: círculo con inicial + color de `getDinerColor(dinerId)`
- [x] 8.2 Crear `pwaMenu/src/components/cart/CartItem.tsx`: item propio editable (cantidad +/-, notas, eliminar), respeta `pending` con spinner y opacidad
- [x] 8.3 Crear `pwaMenu/src/components/cart/CartSharedItem.tsx`: item de otro comensal, solo-lectura, muestra `DinerAvatar` + nombre
- [x] 8.4 Crear `pwaMenu/src/components/cart/CartTotals.tsx`: subtotales, total, count de items, formateado con locale
- [x] 8.5 Crear `pwaMenu/src/components/cart/CartBlockedBanner.tsx`: banner naranja con `t('cart.blocked.paying.banner')` cuando `tableStatus === 'PAYING'`
- [x] 8.6 Tests de componentes en `pwaMenu/src/tests/components/cart/`: render con items propios/shared, estado pending, banner visible en PAYING, editabilidad solo en items propios

## 9. Componentes de rondas

- [x] 9.1 Crear `pwaMenu/src/components/rounds/RoundStatusBadge.tsx`: badge con color y texto según status (CONFIRMED naranja, IN_KITCHEN amarillo, READY naranja pulsante, SERVED verde, CANCELED gris) — todos traducidos
- [x] 9.2 Crear `pwaMenu/src/components/rounds/RoundItemList.tsx`: lista de items de una ronda con nombres, cantidades, subtotales
- [x] 9.3 Crear `pwaMenu/src/components/rounds/RoundCard.tsx`: card completa con número de ronda, status badge, timestamps, items, total
- [x] 9.4 Tests de componentes en `pwaMenu/src/tests/components/rounds/`: badge pulsante en READY, sort por submittedAt desc

## 10. Páginas

- [x] 10.1 Crear `pwaMenu/src/pages/CartPage.tsx` (`/cart`): header con back, lista scrollable de items propios + shared agrupada, footer sticky con totales + CTA "Confirmar"; respeta `overflow-x-hidden w-full max-w-full` y safe-area
- [x] 10.2 Crear `pwaMenu/src/pages/CartConfirmPage.tsx` (`/cart/confirm`): summary agrupado por diner, textarea notas opcionales, CTA "Enviar ronda", usa `useSessionStatusGuard` al montar; manejo de 409 session_paying (toast + redirect) y 409 insufficient_stock (panel inline)
- [x] 10.3 Crear `pwaMenu/src/pages/RoundsPage.tsx` (`/rounds`): lista de `RoundCard`, filtro "mostrar canceladas" (default false), refresh on mount con `GET /api/diner/rounds`
- [x] 10.4 Agregar rutas al router de `pwaMenu/src/App.tsx` con lazy loading; redirects: después de submit exitoso → `/rounds`
- [x] 10.5 Integrar bloqueo en `ProductCard` (extender C-17): deshabilitar botón + tooltip cuando `tableStatus === 'PAYING'`
- [x] 10.6 Tests de integración con MSW en `pwaMenu/src/tests/pages/`: CartConfirmPage submit success navega a /rounds, 409 session_paying redirige a /menu, blocked banner en PAYING

## 11. Integración con ProductCard y menu existente

- [x] 11.1 Modificar `pwaMenu/src/components/menu/ProductCard.tsx` (de C-17): botón "Agregar" dispara `cartStore.addItem()` con optimistic; muestra badge con cantidad actual en carrito
- [x] 11.2 Agregar FAB (floating action button) de carrito en `MenuPage` con contador de items y subtotal que navega a `/cart`
- [x] 11.3 Deshabilitar ProductCard "+" y FAB cuando `tableStatus === 'PAYING'` con tooltip traducido
- [x] 11.4 Tests: agregar al carrito actualiza badge, FAB visible con cantidad correcta, FAB oculto/deshabilitado en PAYING

## 12. WebSocket wiring y catch-up

- [x] 12.1 Inicializar `dinerWS` en `App.tsx` o layout root cuando `sessionStore.token` cambia a non-null
- [x] 12.2 Registrar handlers de `CART_*` → `cartStore.applyWsEvent()` y `ROUND_*` → `roundsStore.applyWsEvent()`
- [x] 12.3 Registrar handler de `TABLE_STATUS_CHANGED` → `sessionStore.setTableStatus()`
- [x] 12.4 Registrar handler interno `REHYDRATE_REQUIRED` → dispara `dinerApi.cart.list()` + `dinerApi.rounds.list()` y reemplaza stores con `replaceAll` / `setRounds`
- [x] 12.5 Tests e2e-lite con MSW + mock-socket: WS abre, recibe CART_ITEM_ADDED de otro diner, cartStore actualiza, UI muestra shared item

## 13. i18n

- [x] 13.1 Agregar keys en `pwaMenu/src/i18n/locales/es.json` bajo namespaces `cart`, `rounds`, `connection`, `errors` (~80 keys total): `cart.title`, `cart.empty`, `cart.add`, `cart.remove`, `cart.confirm.title`, `cart.confirm.notes_placeholder`, `cart.confirm.submit`, `cart.blocked.paying.tooltip`, `cart.blocked.paying.banner`, `rounds.title`, `rounds.empty`, `rounds.status.pending|confirmed|submitted|in_kitchen|ready|served|canceled`, `rounds.submitted`, `connection.reconnecting`, `connection.offline`, `errors.cart.add_failed`, `errors.cart.session_paying`, `errors.cart.insufficient_stock`, `errors.retry.gave_up`, etc.
- [x] 13.2 Replicar todas las keys en `en.json` y `pt.json` con traducciones correctas
- [x] 13.3 Extender test de i18n completeness (`pwaMenu/src/tests/i18n.test.ts`): set de keys en es === en === pt, assert zero faltantes
- [x] 13.4 Test de no-hardcoded-strings: escanear `src/components/cart/`, `src/components/rounds/`, `src/pages/Cart*.tsx`, `src/pages/RoundsPage.tsx` buscando texto JSX sin `t()` con regex de palabra española

## 14. Mobile / layout

- [x] 14.1 Verificar que CartPage, CartConfirmPage, RoundsPage tienen `overflow-x-hidden w-full max-w-full` en container raíz
- [x] 14.2 Agregar safe-area-inset-bottom a CTA footers sticky (CartPage footer, CartConfirmPage submit bar)
- [ ] 14.3 Test manual responsive a 320px: ningún elemento excede viewport
- [x] 14.4 Tests con jsdom/testing-library: `expect(container.querySelector('...')).toHaveClass('overflow-x-hidden')`

## 15. Validación final

- [x] 15.1 Ejecutar `npx tsc --noEmit` en `pwaMenu/` — cero errores
- [x] 15.2 Ejecutar `npm run test` en `pwaMenu/` — 100% tests pasan, coverage ≥85% en stores nuevos
- [x] 15.3 Ejecutar `npm run build` en `pwaMenu/` — build exitoso, chunks lazy por página verificados en `dist/assets/`
- [~] 15.4 Manual smoke test local — **PARCIAL 2026-04-18**: probado escaneo QR con cámara (funciona) y navegación al menú público. **No probado**: ver menú (bug de shape frontend — ya arreglado post-smoke) → agregar item → multi-tab → compartido → confirmar ronda → bloqueo en PAYING. Revalidar completo en C-22 e2e-critical-flow. Bugs encontrados y arreglados: (1) `getPublicMenu` esperaba `CategoryDTO[]` plano, backend devuelve `{branch, categories}` envuelto; (2) `ProductDTO` esperaba `image_url` + `is_available`, backend expone `image` y no incluye `is_available` en el endpoint público — mapper hecho tolerante con fallbacks
- [x] 15.5 Ejecutar `openspec validate pwamenu-ordering --strict` — cero errores
- [x] 15.6 Ejecutar skill `requesting-code-review` para review interno antes de solicitar review externo — ejecutado 2026-04-18, veredicto Request Changes con 4 críticos (dedup O(n), touch targets 28px, OfflineBanner faltante, double-ref en useDinerWS), 3 importantes, 3 nits. Resultados en engram topic_key: `opsx/pwamenu-ordering/code-review`
