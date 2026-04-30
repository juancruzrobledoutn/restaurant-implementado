## Context

Tras cerrar C-18 (pwamenu-ordering) y C-21 (pwawaiter-operations), los code reviews y smoke tests identificaron 18 defectos de diversa severidad. Ninguno es blocker funcional — ambos frontends compilan y sirven el happy path — pero en conjunto comprometen seguridad, UX mobile (WCAG), performance bajo carga, y coherencia de tipado.

**Estado actual del código**:
- pwaWaiter catchup usa query param: `fetch(url?token=${jwt})`. Queda en logs nginx y Referer del browser.
- `useEnqueuedAction` fue modificado durante C-21 para usar `[options, enqueue]` como deps del `useCallback`. Como `options` es el objeto literal pasado por el caller, CADA render genera una identidad nueva → la función nunca es estable → cualquier downstream `useEffect([fn])` se dispara en loop.
- `cartStore.ts:134` y `roundsStore.ts:67` usan `Array.includes()` para dedup en un path caliente (cada evento WS). En una mesa con 50+ items, es O(n²) acumulado.
- `CartItem` minus/plus buttons son `w-7 h-7` (28px). WCAG 2.5.5 AA pide 44x44. Misclicks en mobile reales > 20% según smoke.
- `OfflineBanner` de pwaMenu estaba en el scope de tasks de C-18 pero el file nunca se creó.
- WS del waiter reconecta indefinidamente incluso tras 4001 (auth expirado) — genera loop de reconexión + fallo permanente.
- `RoundCard.tsx` muestra `Producto #1234` literal cuando no tiene el nombre cacheado → el menú compacto SÍ lo tiene, pero nadie lo busca.
- `App.tsx` del pwaMenu ejecuta retry queue tras reconexión: `replaceAll([...existing, item])` sin verificar si `item` ya está → duplica items si el servidor ya persistió antes del crash.

**Constraints**:
- No romper nada del comportamiento actual que ya funciona.
- Todos los fixes deben ser coverage por test (unit mínimo, E2E donde aplique).
- Ningún fix debe requerir migración de datos.
- Skills aplicables: `zustand-store-pattern`, `ws-frontend-subscription`, `pwa-development`, `react19-form-pattern`, `typescript-advanced-types`, `vercel-react-best-practices`, `api-security-best-practices`, `playwright-best-practices`, `systematic-debugging`, `test-driven-development`, `receiving-code-review`.

**Stakeholders**:
- Owner de C-18 y C-21 (reviewer original).
- QA (smoke tests).
- Backend owner (para el fix del JWT catchup, si endpoint requiere ajuste).

## Goals / Non-Goals

**Goals:**

- Eliminar la vulnerabilidad de seguridad ALTA del JWT en query string (pwaWaiter catchup).
- Cumplir WCAG 2.5.5 AA en touch targets de pwaMenu `CartItem`.
- Restaurar estabilidad referencial en `useEnqueuedAction`.
- Eliminar duplicación de items tras reconexión + retry en pwaMenu.
- Completar el `OfflineBanner` de pwaMenu que quedó pendiente del scope C-18.
- Fortalecer tipado: `CartWsEvent` como discriminated union real; `EMPTY_ARRAY` como `readonly never[]`.
- Corregir política de reconexión WS en pwaWaiter (no reconectar en close codes definitivos).
- Corregir filtrado de subcategorías en `compactMenuStore` y filtro de sectores en `ServiceCallsPage`.
- Dejar el código con tests que garanticen no-regresión en cada fix.

**Non-Goals:**

- NO introducir nuevas features ni nuevas capabilities.
- NO reescribir stores completos — solo tocar lo que el defecto requiere.
- NO cambiar la arquitectura de retry queue ni de WS service.
- NO tocar el backend (excepto coordinación mínima si el catchup endpoint requiere aceptar header).
- NO agregar nuevas dependencies al `package.json`.
- NO auditoría completa de otros files fuera del scope listado.

## Decisions

### D1: JWT en `Authorization: Bearer` para catchup (pwaWaiter)

**Decisión**: reemplazar `fetch(catchupUrl + ?token=${jwt})` por `fetch(catchupUrl, { headers: { Authorization: \`Bearer ${jwt}\` } })`.

**Rationale**:
- El header `Authorization` no queda en logs de proxy/nginx por convención (los logs comunes filtran `Authorization`).
- El query string queda en logs de acceso, en Referer del browser, en historial, y en herramientas de monitoring (Sentry captura URL completas por default).
- Es consistente con el resto del app (REST calls ya usan Bearer).

**Alternativas consideradas**:
- Mantener query param y filtrar en nginx: descartado. Requiere config coordinada, no elimina el leak en Sentry/browser history.
- Usar cookie HttpOnly: descartado. El catchup es fetch puntual, no sesión continua. Agregar cookie de scope distinto complica el flujo.

**Coordinación backend**: verificar PRIMERO que el endpoint catchup acepta JWT por header. Si solo lee query, el fix requiere un change backend paralelo ANTES de aplicar este fix frontend (de lo contrario rompe catchup). Documentar en task.

### D2: `useEnqueuedAction` — deps del `useCallback` a propiedades específicas

**Decisión**: revertir deps de `[options, enqueue]` a `[options.fn, options.op, options.userId, options.buildPayload, enqueue]`.

**Rationale**:
- Pasar `options` como dep exige que el caller memoíce el objeto entero. En la práctica, los callers pasan object literal → nueva identidad por render → `useCallback` no cachea nada.
- Las propiedades internas (`fn`, `op`, `userId`, `buildPayload`) SÍ son estables en la mayoría de los callers (son imports o valores de auth store).
- Esto restaura el comportamiento pre-C-21 que funcionaba.

**Alternativas**:
- Forzar a los callers a memoízar `options` con `useMemo`: descartado. Viola el contrato "pasá options como objeto literal" y propaga fricción a cada consumer.
- Usar `useEventCallback` custom: descartado. Se resuelve con deps específicas sin introducir hooks nuevos.

### D3: Dedup con `Set<string>` + array paralelo (FIFO)

**Decisión**: estructura de datos para dedup en `cartStore` y `roundsStore`:

```ts
const seenIds = new Set<string>();
const orderedIds: string[] = [];

function addIfNew(id: string) {
  if (seenIds.has(id)) return;
  seenIds.add(id);
  orderedIds.push(id);
}
```

**Rationale**:
- `Set.has()` es O(1) amortizado, vs `Array.includes()` O(n).
- Array paralelo preserva orden de inserción (FIFO) para rendering.
- Patrón idiomático JS, cero dependencies.

**Alternativas**:
- `Map<string, Item>` con iteración en orden de inserción: también O(1), también preserva orden. Válido. Elegimos Set + array porque los items ya están en otra estructura (el store ya tiene `items: Item[]` por ID), no queremos duplicar storage.
- `LinkedHashSet` custom: overengineering.

### D4: `OfflineBanner` de pwaMenu — componente nuevo, sin nuevo store

**Decisión**: crear `src/components/OfflineBanner.tsx` en pwaMenu leyendo directamente del WS connection status (hook `useDinerWS` ya expone `isConnected`) y del retry queue store (selector `selectFailedEntries` si existe; si no, `selectPendingCount`).

**Rationale**:
- Consistencia con pwaWaiter que ya tiene `OfflineBanner`.
- Reutiliza hooks/selectores existentes → cero lógica nueva.

### D5: `CartWsEvent` como discriminated union

**Decisión**: definir `CartWsEvent` con `type` literal discriminante:

```ts
type CartAddEvent = { type: 'cart.add'; payload: { ... } };
type CartRemoveEvent = { type: 'cart.remove'; payload: { ... } };
type CartUpdateEvent = { type: 'cart.update'; payload: { ... } };
type CartWsEvent = CartAddEvent | CartRemoveEvent | CartUpdateEvent;
```

En el switch, TypeScript narrowing por `event.type` elimina casts.

**Rationale**:
- Patrón idiomático TypeScript 5.9. Cero costo runtime.
- Los casts `as unknown as` silencian errores reales.

### D6: Race condition del retry executor en `App.tsx`

**Decisión**: antes de `replaceAll([...existing, item])`, filtrar duplicados:

```ts
const current = useCartStore.getState().items;
const alreadyExists = current.some(i => i.id === item.id);
if (alreadyExists) return; // server already persisted
useCartStore.getState().replaceAll([...current, item]);
```

Idealmente mover la lógica al store (método `addIfAbsent(item)`) para mantener `App.tsx` thin.

**Rationale**:
- Escenario: user agrega item offline → reconecta → retry reaplica → pero el servidor ya persistió durante la reconexión (vía evento WS previo) → duplicado.
- El fix es idempotente por ID.

### D7: WS close codes NO reconectables

**Decisión**: en `waiterWs.ts:169-177`, matriz:

| Close code | Action        |
|------------|---------------|
| 1000, 1001 | Reconectar con backoff |
| 1006, 1011, 1012, 1013, 1014 | Reconectar con backoff |
| 4001 (auth fail) | NO reconectar, emit `onAuthFail` |
| 4003 (forbidden) | NO reconectar, emit `onForbidden` |
| 4029 (rate limit) | NO reconectar, emit `onRateLimited` |
| default 4xxx | Reconectar con backoff |

**Rationale**:
- Reconectar tras 4001 genera tormenta de intentos con JWT ya inválido.
- UI debe responder a `onAuthFail` redirigiendo a login/refresh.

### D8: `onMaxReconnect` handler

**Decisión**: extender `WaiterWsHandlers` con `onMaxReconnect?: () => void`. Se dispara cuando backoff agotó `MAX_RECONNECT_ATTEMPTS`. UI muestra estado "offline permanente, recargá la página".

### D9: Sync UI tras mutación (smoke discovery)

**Decisión**: diagnóstico primero, fix después. Orden de investigación:

1. Verificar que el backend publica `ROUND_CONFIRMED` a Redis tras `POST /rounds/:id/confirm`.
2. Verificar que `waiterWs.ts` recibe el evento y llama al subscriber.
3. Verificar que el selector expuesto al componente sea estable (no retorne nuevo objeto por render).
4. Si los 3 anteriores OK: el problema es selector sin `useShallow`.

Hipótesis principal: selector que devuelve `{ rounds, someComputed }` sin `useShallow` → React no re-renderiza aunque el store cambie. Requiere reproducción con test antes de fix.

**Rationale**: fix-blind-sobre-sync-UI es una trampa conocida (ver `knowledge-base/05-dx/03_trampas_conocidas.md`). Hay que ver el dato primero.

### D10: Tests por cada fix — no-regresión garantizada

**Decisión**: cada fix incluye al menos 1 unit test (Vitest) de reproducción + validación. Los fixes con impacto de UI (`CartItem` touch targets, `OfflineBanner`) llevan E2E Playwright adicional. Los fixes con paths de WS (reconnect codes, onMaxReconnect, sync UI) llevan test con mock WS.

**Rationale**: skill `test-driven-development` obliga a test-first para bugfixes. Además deja la red protegiendo contra regresiones futuras.

## Risks / Trade-offs

- **[Riesgo A] Backend catchup no acepta header** → Mitigación: verificar ANTES de aplicar el fix frontend. Si no acepta, abrir change backend paralelo. El task de pwaWaiter catchup QUEDA BLOCKED hasta confirmar backend.

- **[Riesgo B] `useEnqueuedAction` deps change rompe caller que dependía del comportamiento buggy** → Mitigación: correr suite completa de pwaWaiter tras el fix. Cualquier re-render excesivo detectado durante testing se revisa.

- **[Riesgo C] `OfflineBanner` de pwaMenu sin selector `selectFailedEntries`** → Mitigación: el retry queue store de pwaMenu puede no exponer ese selector aún. Task inicial es verificar si existe; si no, agregarlo con patrón estándar (`useShallow`, `EMPTY_ARRAY` fallback).

- **[Riesgo D] Sync UI tras mutación puede ser backend, no frontend** → Mitigación: diagnóstico primero (D9). Si el root cause es backend (no publica evento), se documenta y se abre change backend separado. Este change no lo incluye.

- **[Riesgo E] Cambio de `EMPTY_ARRAY` a `readonly never[]` rompe consumers que hacen mutaciones** → Mitigación: buscar todos los consumers con `grep`, verificar que nadie hace `EMPTY_ARRAY.push()`. Si alguno lo hace, es un bug latente — lo arreglamos acá también.

- **[Trade-off A] Paralelizar `drain()` de retry queue** puede saturar backend si hay 100+ items en queue tras reconexión larga. Mitigación: usar `Promise.allSettled` con cap de concurrencia (batch de 10 en 10), no `Promise.all` sin límite.

- **[Trade-off B] Discriminated union de `CartWsEvent`** cambia la firma del tipo. Cualquier consumer que importe `CartWsEvent` debe compilar. Mitigación: typecheck completo + fix de cualquier callsite que rompa.

## Migration Plan

Este change no toca datos ni APIs expuestas. Deploy es frontend-only. No hay feature flags.

1. Mergear PR → CI corre lint + typecheck + unit tests + E2E smoke.
2. Desplegar a staging de pwaMenu y pwaWaiter.
3. QA smoke manual en mobile real (touch targets, OfflineBanner, no reconnect en 4001).
4. Si OK → prod.

**Rollback**: revertir el merge commit. No hay side effects persistentes.

**Coordinación**: antes de mergear, confirmar con backend owner que el catchup endpoint acepta JWT por header. Si no, el fix del JWT queda fuera de este change y se abre uno nuevo.

## Open Questions

1. ¿El catchup endpoint del backend acepta JWT por header hoy, o solo por query? → Verificar en `backend/routes/waiter/catchup.py` (o donde esté) antes de aplicar el fix.
2. ¿El retry queue store de pwaMenu expone `selectFailedEntries`? Si no existe, ¿qué nombre preferimos por consistencia con pwaWaiter? → Si ya existe en pwaWaiter como `selectFailedEntries`, usar el mismo nombre.
3. ¿Hay un lugar compartido entre pwaMenu y pwaWaiter para definir `EMPTY_ARRAY` tipado como `readonly never[]`? → Revisar si hay un `shared/` o si cada frontend tiene el suyo — mantener estilo del proyecto.
4. ¿El smoke de "UI no sincroniza tras confirmar ronda" se reproduce consistentemente o es flaky? → Para escribir test determinista necesitamos reproducción estable. Si es flaky, puede ser race WS/backend.
