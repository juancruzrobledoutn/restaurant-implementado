## Why

Code review y smoke tests de C-18 (pwamenu-ordering) y C-21 (pwawaiter-operations) detectaron **18 defectos** que deben corregirse antes de habilitar ambos frontends en producción:

- **1 vulnerabilidad de seguridad ALTA**: JWT expuesto en query string del catchup endpoint — queda registrado en logs de nginx/proxy y es exfiltrable.
- **3 bugs de correctitud**: retry queue con detección de red por string-match y `userId=''`, efecto React con deps inestables que rompe la estabilidad referencial, race condition en el executor de retry que duplica items al reaplicar.
- **2 problemas de UX crítico**: touch targets por debajo del mínimo WCAG 2.5.5 (28px vs 44px), `OfflineBanner` del scope original de C-18 nunca implementado, UI que no refleja cambios de estado tras mutación exitosa (ronda confirmada).
- **5 problemas de performance**: dedup O(n) en stores de alta escritura, `handleRefresh` sin `useCallback`, `drain()` secuencial bajo carga, filtrado incorrecto de subcategorías, filtro de sectores sin efecto.
- **7 mejoras de calidad de código**: WebSocket que reconecta tras 4001/4003/4029, labels placeholder en `RoundCard`, selectores duplicados en lugar de reutilizar `selectFailedEntries`, tipos con `as unknown as` en eventos WS del cart, hook con doble-ref redundante, falta de `useActionState` en `CartConfirmPage`, y falta de handler `onMaxReconnect` para fallo definitivo.

Todos los defectos tienen reproducibilidad confirmada, archivo exacto y línea específica. Este change NO introduce features nuevas — corrige problemas existentes de las capabilities ya desplegadas.

## What Changes

### pwaWaiter (C-21)

- **BREAKING (seguridad)**: mover JWT del query param al header `Authorization: Bearer` en `services/waiter.ts:543-551` (catchup fetch). Requiere cambio coordinado backend si el endpoint valida via query — validar primero.
- `TableDetailPage.tsx:180-196` — reemplazar detección `error.message.includes('network')` por uso directo de `useEnqueuedAction`, pasar `userId` real del auth store (no `''`).
- `useEnqueuedAction.ts:86` — revertir deps del `useCallback` de `[options, enqueue]` a `[options.fn, options.op, options.userId, options.buildPayload, enqueue]` para restaurar estabilidad referencial rota en code review C-21.
- `services/waiterWs.ts:169-177` — NO reconectar en close codes 4001 (auth fail), 4003 (forbidden) ni 4029 (rate limited); solo reconectar en 1000-1015 y 4xxx reintentables.
- `stores/compactMenuStore.ts:109-127` — normalizar filtrado usando `subcategoryId` consistentemente (no mezclar `category.id` con `subcategoryId`).
- `components/RoundCard.tsx:33` — resolver nombre de producto desde `compactMenuStore` por `productId`, eliminar placeholder `"Producto #1234"`.
- `components/StaleDataBanner.tsx:19` — envolver `handleRefresh` en `useCallback`.
- `components/OfflineBanner.tsx:15-17` — reutilizar selector existente `selectFailedEntries` del retry queue store.
- `pages/ServiceCallsPage.tsx:34` — hacer que `filterSector` afecte `displayCalls` (actualmente se ignora).
- `stores/retryQueueStore.ts:199` — paralelizar `drain()` con `Promise.allSettled` para mejorar throughput bajo carga.
- `services/waiterWs.ts` — agregar handler `onMaxReconnect` para UI de fallo definitivo tras agotar reintentos.
- Diagnóstico de sync UI tras mutación (smoke): investigar por qué el confirm round no refleja cambios — hipótesis: selector inestable o evento WS no publicado por backend. Incluye test de reproducción + fix.

### pwaMenu (C-18)

- `stores/cartStore.ts:134` y `stores/roundsStore.ts:67` — reemplazar dedup `Array.includes()` O(n) por `Set<string>` O(1) manteniendo orden FIFO con array paralelo.
- `components/CartItem.tsx` — agrandar touch targets de `w-7 h-7` (28px) a `min-w-[44px] min-h-[44px]` (WCAG 2.5.5 AA).
- `components/OfflineBanner.tsx` (pwaMenu) — implementar el componente; estaba en el scope original de C-18 pero nunca se creó.
- `hooks/useDinerWS.ts:57-95` — eliminar doble-ref redundante; el `useCallback` con deps `[]` ya provee estabilidad, la ref de arriba es ruido.
- `types/ws.ts` y `stores/cartStore.ts` — transformar `CartWsEvent` en discriminated union real con `type` como discriminante para eliminar casts `as unknown as` en el switch del store.
- `App.tsx:81` — en el executor del retry queue, verificar si el item ya existe antes de `replaceAll([...existing, item])` para evitar duplicados en reaplicación.
- `pages/CartConfirmPage.tsx` — migrar a `useActionState` por consistencia con la skill `react19-form-pattern`.

### Shared (tipado)

- `utils/constants.ts` (pwaMenu y pwaWaiter) — tipar `EMPTY_ARRAY` como `readonly never[]` para evitar casts `as unknown as T[]` en consumidores.

### Tests + calidad

- Agregar o actualizar tests por cada fix (unit + integración mínima).
- Lint + typecheck + build limpios en ambos frontends.
- Sin regresiones en tests E2E existentes de pwaMenu y pwaWaiter.

## Capabilities

### New Capabilities

<!-- Este change no introduce capabilities nuevas — solo corrige comportamiento de capabilities existentes -->

### Modified Capabilities

- `pwamenu-ordering`: se ajustan REQUIREMENTS de UX mobile (touch targets WCAG), disponibilidad de `OfflineBanner`, tipado fuerte de eventos WS del cart, y robustez del retry queue frente a duplicación en reaplicación.
- `pwawaiter-operations`: se ajustan REQUIREMENTS de seguridad (JWT siempre por header, nunca query), política de reconexión WS (no reconectar en 4001/4003/4029), consistencia de filtrado en menú compacto, integridad visual de labels de productos, reactividad de filtros en `ServiceCalls`, y sincronización UI tras mutaciones.

## Impact

### Código afectado

**pwaWaiter** (10 archivos):
- `src/services/waiter.ts` (catchup header migration)
- `src/services/waiterWs.ts` (close code policy + `onMaxReconnect`)
- `src/pages/TableDetailPage.tsx` (retry queue usage)
- `src/pages/ServiceCallsPage.tsx` (filter sector)
- `src/stores/retryQueueStore.ts` (parallel drain)
- `src/stores/compactMenuStore.ts` (subcategory filter)
- `src/hooks/useEnqueuedAction.ts` (stable deps)
- `src/components/RoundCard.tsx` (product name lookup)
- `src/components/StaleDataBanner.tsx` (useCallback)
- `src/components/OfflineBanner.tsx` (reuse selector)

**pwaMenu** (7 archivos):
- `src/stores/cartStore.ts` (Set dedup + discriminated union)
- `src/stores/roundsStore.ts` (Set dedup)
- `src/components/CartItem.tsx` (touch targets)
- `src/components/OfflineBanner.tsx` (new file)
- `src/types/ws.ts` (discriminated union)
- `src/hooks/useDinerWS.ts` (remove double-ref)
- `src/App.tsx` (retry executor idempotency)
- `src/pages/CartConfirmPage.tsx` (useActionState)

**Shared**:
- `pwaMenu/src/utils/constants.ts` y `pwaWaiter/src/utils/constants.ts` (`EMPTY_ARRAY` typing)

### APIs / Backend

- **Potencial coordinación backend**: el catchup endpoint debe aceptar JWT por header. Si hoy solo lo lee de query, se requiere PR backend paralelo (verificar en el task de propuesta del fix).

### Dependencies

- Sin nuevas dependencias — todo se resuelve con las libs existentes (React 19, Zustand 5, TypeScript 5.9).

### Testing

- Unit tests Vitest para: dedup O(1), retry queue idempotent, discriminated union type narrowing, `useEnqueuedAction` stable deps, filtrado por subcategory, filter sector en ServiceCalls.
- E2E Playwright: WS no reconecta en 4001/4003/4029, touch targets clicables en mobile viewport, `OfflineBanner` aparece y reutiliza selector correctamente.

### Riesgo

- **Medio-Alto** por el cambio del JWT catchup (breaking si backend no acepta header). Mitigación: validar endpoint backend antes de aplicar fix; si requiere cambio backend, abrir change adicional.
- **Medio** por el fix del retry executor (App.tsx) — cambio en el path de ejecución de la queue. Mitigación: test de reproducción antes de tocar código.
- **Bajo** para el resto — fixes localizados con tests por cada uno.
