## Context

pwaMenu shell (C-17) quedó listo con sesión, menú público e i18n base. Backend `rounds` (C-10) y `ws-gateway-base` (C-09) exponen los endpoints `/api/diner/cart/*`, `/api/diner/rounds`, `/ws/diner` y `/ws/catchup/session` con autenticación por Table Token HMAC. La siguiente pieza — convertir a ese comensal en un cliente real que pueda pedir — vive 100% en frontend: no hay que tocar DB ni APIs nuevas.

El contexto del negocio impone tres requerimientos que moldean el diseño:

1. **Multi-dispositivo en la misma mesa**: 4 amigos se sientan, cada uno escanea el QR desde su teléfono; los 4 ven el mismo carrito compartido en vivo. El carrito es **local por comensal** (persistido via eventos WS que replican cada operación al resto de la sesión), no es un estado único en Redis — el estado real está en `cart_item` de la DB y el WS solo notifica cambios.
2. **Conectividad inestable**: wifi de restaurante saturado, 4G intermitente en sótano. Cualquier acción del comensal (agregar al carrito, enviar ronda) tiene que sentirse **inmediata** aun cuando la red esté caída, y tiene que **no perderse** cuando vuelva.
3. **Bloqueo en PAYING**: cuando la mesa solicita el check, `TableSession.status` pasa a `PAYING` y el backend rechaza nuevos rondas con 409. El cliente tiene que detectar ese estado (evento `TABLE_STATUS_CHANGED`) y bloquear defensivamente el CTA, con feedback traducido.

Stack disponible: React 19.2 (con `useOptimistic`), Zustand 5 (con `useShallow`), TypeScript 5.9, react-i18next, Vitest 4. Sin libs de sync nuevas (no RxJS, no Yjs, no Automerge) — todo manual con selectores + reducer discipline.

El change se integra con lo existente:
- `sessionStore` (C-17) provee `token`, `sessionId`, `branchSlug`.
- Cliente API (C-17) inyecta `X-Table-Token` y convierte errores 401.
- i18n lazy loading (C-17) se extiende con nuevos namespaces.

## Goals / Non-Goals

**Goals:**
- Carrito compartido sincronizado entre dispositivos de la misma mesa en <500ms (p95) sobre wifi razonable.
- Optimistic UI: agregar/editar/quitar items se percibe como instantáneo (<50ms).
- Tolerancia a pérdida de conectividad: ninguna operación se pierde; al volver la red, todo se sincroniza.
- Estado de rondas en tiempo real (CONFIRMED → SERVED) con feedback visual claro (READY parpadea naranja).
- Bloqueo robusto y explicado cuando la mesa está en PAYING.
- 0 strings hardcodeadas — todo `t()` con keys en es/en/pt.
- Cobertura de tests ≥85% en stores nuevos.

**Non-Goals:**
- **Billing / check request**: lo cubre C-19. Este change solo detecta la transición a PAYING para bloquear pedidos; no solicita el check.
- **Service calls (llamar al mozo)**: hay un endpoint disponible pero la UI de service calls vive en otro change.
- **Offline completo**: no se persiste el menú para navegación offline (C-17 ya lo hace con service worker); este change asume menú disponible y falla con feedback si no lo está.
- **Sincronización peer-to-peer**: no se usa WebRTC/broadcast entre dispositivos; todo va por el WS gateway.
- **Notificaciones push** para rondas listas: pwaMenu no pide permisos de push (pwaWaiter sí, en otro change).
- **Modificación de rondas ya enviadas**: una vez submitted, el comensal no las edita — el mozo tiene la potestad (C-21).
- **Multi-idioma dinámico durante la sesión**: el idioma se fija al entrar; no se refresca el carrito al cambiar idioma mid-session.
- **Backend changes**: cero endpoints nuevos, cero migraciones, cero cambios de modelo.

## Decisions

### D-01: `cartStore` mantiene items locales + remotos, normalizados por `item_id` backend

**Decisión**: el store expone un único objeto `items: Record<string, CartItem>` (key = `item_id` string, convertido en el boundary desde el `int` del backend). Los items optimistas en vuelo usan id temporal con prefijo `tmp_` hasta que el backend responde con el id real — al llegar la respuesta, el item temporal se reemplaza por el item real con el id del backend. El evento WS `CART_ITEM_ADDED` trae ya el id real; si coincide con un id temporal pendiente (match por `product_id + diner_id + timestamp`), se fusionan.

**Alternativas consideradas**:
- Dos stores separados (local / shared) → complica reconciliación y duplica renders.
- UUID client-side persistido → el backend ya emite id único; doble fuente es innecesaria.

**Rationale**: un solo store significa un solo selector, un solo render path, y la reconciliación local↔WS queda en el reducer del store (único lugar con lógica de merge). Items temporales desaparecen en cuanto el backend confirma — no hay estado "zombie".

### D-02: Optimistic UI con `useOptimistic` de React 19, no con estado pesimista

**Decisión**: el componente `ProductCard` llama `addToCart(product, qty)` que hace **dos cosas en paralelo**:
1. Inserta un item optimista en el store con flag `pending: true` e id temporal `tmp_${crypto.randomUUID()}`.
2. Dispara `POST /api/diner/cart/add`. Si 2xx, el store reemplaza el tmp por el real. Si falla, lo revierte y encola en `retryQueueStore`.

`useOptimistic` se usa dentro del componente del cart drawer para que el conteo en el botón flotante refleje items pendientes, pero el estado autoritativo vive en el store Zustand (no en el hook). React 19 permite pasar un store de Zustand como base del `useOptimistic` sin fricción.

**Alternativas consideradas**:
- Bloqueo hasta respuesta del backend → lag de 200-1000ms por item, UX terrible en conexiones lentas.
- Optimistic SIN retry queue → al fallar, se pierde silenciosamente la operación.

**Rationale**: React 19 explícitamente introduce `useOptimistic` para este caso; usarlo es idiomático. El patrón `pending → confirmed | failed → retried` cubre los tres escenarios que aparecen en campo.

### D-03: Reconciliación WS: los eventos entrantes son fuente de verdad

**Decisión**: cuando llega `CART_ITEM_ADDED`/`UPDATED`/`REMOVED` vía WS, el handler **aplica el cambio al store sin comparar con el estado previo**, con una sola excepción: si existe un item temporal con mismo `product_id + diner_id` creado en los últimos 10 segundos, se fusiona (el tmp se reemplaza por el item real). Esto evita duplicados cuando el WS llega antes que la respuesta HTTP.

Para eventos `UPDATED` y `REMOVED`, el item se busca por `item_id` real. Si no existe (caso raro: llegó el UPDATE sin haber visto el ADD), se aplica igual (UPDATE crea el item, REMOVE es no-op).

**Alternativas consideradas**:
- Comparar timestamps y priorizar el más nuevo → complejidad innecesaria; el backend ya serializa las mutaciones por `cart_item.updated_at`.
- Ignorar eventos WS si hay mutación local pendiente → crea divergencia; el WS SIEMPRE gana.

**Rationale**: el backend es la única fuente de verdad. Los eventos WS representan lo que YA ocurrió; resistirlos en el cliente lleva a divergencia permanente. La ventana de 10s para fusionar tmp cubre el 99% de casos de race.

### D-04: Catch-up post-reconexión via `GET /ws/catchup/session`

**Decisión**: al reconectar el WS (estado `RECONNECTING → CONNECTED`), el cliente llama `GET /ws/catchup/session?session_id=${id}&since=${lastEventTimestamp}&token=${tableToken}` y aplica los eventos devueltos **en orden**, pasándolos por los mismos handlers que usa el WS live. El `lastEventTimestamp` se guarda en el store (no en `localStorage` — una desconexión de 5min+ ya excede el TTL del catch-up, conviene hidratar con `GET /api/diner/cart` en ese caso).

**Alternativas consideradas**:
- Refetch completo de `GET /api/diner/cart` al reconectar → más simple pero pierde los eventos ROUND_* intermedios, y refresca el carrito aun cuando nada cambió.
- Sin catch-up, solo reconectar → pierde eventos durante la ventana de desconexión (típicamente 2-10s en red móvil).

**Rationale**: el endpoint `/ws/catchup/session` existe precisamente para esto (C-09). Usarlo mantiene consistencia con lo que hacen Dashboard/pwaWaiter. Si el catch-up devuelve `too_old` (timestamp fuera del TTL de 5min), hidratamos con `GET /api/diner/cart` + recargar rondas visibles como fallback.

### D-05: `retryQueueStore` persistido en `localStorage`, FIFO, con TTL por item

**Decisión**: cola en `localStorage` bajo key `pwamenu-retry-queue`. Cada item: `{ id, operation: 'cart.add'|'cart.update'|'cart.remove'|'rounds.submit', payload, enqueuedAt, attempts }`. Reintento dispara cuando:
- `window.addEventListener('online', ...)` se dispara.
- Un ping a `/api/health` (ya expuesto por backend) responde 2xx después de un error de red.
- Timer periódico cada 15s si la cola no está vacía.

Reglas:
- FIFO estricto (orden de encolado).
- Si un item falla 3 veces consecutivas, se descarta y se emite un toast traducido al usuario.
- Items con `enqueuedAt + 5min < now` se descartan al cargar la cola (el backend probablemente ya no los acepta).
- Máximo 50 items; al exceder, se descartan los más antiguos con warning.

**Alternativas consideradas**:
- IndexedDB → overkill para <50 entries; `localStorage` es suficiente y síncrono.
- Service Worker Background Sync → requiere HTTPS incluso en dev y no todos los navegadores móviles lo soportan bien (Safari iOS < 16).
- Sin retry queue → pérdida silenciosa de operaciones; inaceptable para la UX de pedir.

**Rationale**: la cola simple en `localStorage` cubre el caso real (típicamente 1-3 items pendientes durante 2-30 segundos), sin agregar dependencias ni service worker complexity.

### D-06: WS con ref pattern de dos effects (setup + subscribe)

**Decisión**: seguir el pattern estándar ya usado en Dashboard/pwaWaiter (ver skill `ws-frontend-subscription`):

```tsx
// dinerWS.ts: clase con .on(event, handler): () => void
// useDinerWS hook:
useEffect(() => {
  // Effect 1: setup connection (run once)
  const ws = dinerWS.connect(token);
  return () => dinerWS.disconnect();
}, [token]);

useEffect(() => {
  // Effect 2: subscribe to events (can run many times)
  const unsub = dinerWS.on('CART_ITEM_ADDED', handleCartAdded);
  return unsub; // always return the unsubscribe fn
}, [handleCartAdded]);
```

Handlers se memorizan con `useCallback` y se registran por nombre de evento. El cliente WS interno mantiene un `Map<eventType, Set<handler>>` y publica eventos leyendo de ese map.

**Rationale**: el pattern está probado y skill-documentado; introducir otro pattern rompe consistencia. Dos effects permiten cambiar handlers sin reconectar el WS.

### D-07: Bloqueo en PAYING — doble check (evento + refetch defensivo)

**Decisión**: el estado `tableSession.status` vive en `sessionStore` (C-17) y se actualiza:
1. Reactivamente por evento WS `TABLE_STATUS_CHANGED`.
2. Al entrar a `/cart` o `/cart/confirm` se refetcha `GET /api/diner/session` (ya expuesto en C-08) como chequeo defensivo — por si el evento WS se perdió.

Cuando `status === 'PAYING'`:
- Cart drawer: oculta botones de agregar cantidad, muestra banner naranja con `t('cart.blocked.paying')`.
- ProductCard: el botón "+" queda deshabilitado con tooltip explicativo.
- Confirm page: el CTA "Enviar ronda" queda disabled con copy traducido.

**Alternativas consideradas**:
- Confiar solo en el evento WS → si se pierde, el cliente piensa que sigue OPEN y envía un POST que el backend rechaza con 409 (no se rompe, pero UX confusa).
- Confiar solo en refetch → latencia al abrir `/cart` y no responde a cambios en vivo.

**Rationale**: belt-and-suspenders. El costo del refetch es una request cache-friendly al entrar al flow de confirmación, donde el comensal claramente se va a quedar >1s leyendo.

### D-08: Deduplicación de eventos ROUND_* y CART_*

**Decisión**: cada evento WS trae un `event_id` (uuid generado por el backend al publicar). En `roundsStore` y `cartStore` mantenemos un `Set<string>` de los últimos 200 event_ids procesados; si un evento llega con event_id visto, se ignora. Esto protege contra:
- Eventos outbox (`ROUND_SUBMITTED`, `ROUND_READY`) que el backend puede re-publicar en retry.
- Catch-up devolviendo un evento que también llegó por live WS durante la ventana.

Set con capacity fija (FIFO drop) para no crecer sin límite.

**Alternativas consideradas**:
- Deduplicar por `(round_id, status)` → funciona para ROUND_* pero no cubre CART_* donde un mismo ítem puede tener múltiples updates legítimos.
- Confiar en idempotencia natural del reducer → para `ADDED/REMOVED` funciona; para `STATUS_CHANGED` de ronda también pero pierde transiciones intermedias si llegan desordenadas.

**Rationale**: un `event_id` dedup set es O(1), 200 entries ocupan <20KB, y resuelve los dos problemas (outbox retry + catch-up solapado) con una sola regla.

### D-09: Precios en centavos, IDs como string en frontend

**Decisión**: convenciones del proyecto, reforzadas:
- Todo `price_cents` llega como `int` del backend; se guarda como `number` (integer) en el store; el componente `CartTotals` formatea con `formatPrice(cents, locale)` que vive en `utils/format.ts` (ya creado en C-17, solo extender si hace falta).
- Todos los IDs (`cart_item_id`, `round_id`, `diner_id`) se convierten a `string` al entrar al store — los endpoints los devuelven `number` y se castean en el cliente API.

**Rationale**: convención del proyecto, skill `zustand-store-pattern` lo enforces. Evita bugs de floating point en totales y mismatches de tipo en URLs de rutas.

### D-10: Diner colors — derivados deterministicamente, no stored

**Decisión**: cada `diner_id` se mapea a un color de una paleta de 8 colores predefinidos via hash simple (`diner_id % 8`). No se persiste — se recomputa en cada render. La paleta se define en `utils/dinerColor.ts` con contraste verificado sobre fondo blanco.

**Alternativas consideradas**:
- Color persistido en backend (`Diner.color`) → existe en el modelo (ver C-08) pero no lo usamos en este change para mantenerlo 100% frontend y evitar round-trip.
- Color random en cliente → no estable entre dispositivos; rompe la UX "el ítem rojo es de Carlos".

**Rationale**: determinístico + derivado = cero sincronización. Si el backend en el futuro devuelve `diner.color`, preferir ese sobre el hash local (un switch simple).

## Risks / Trade-offs

- **[Risk]** Optimistic item queda en estado `pending` permanente si el backend responde 5xx y el retry queue también falla 3 veces → **Mitigation**: después de 3 fallos, el item se remueve del store y se emite un toast `t('errors.cart.add_failed')` con acción "Reintentar" que vuelve a encolar. El usuario nunca se queda con un UI mentiroso.

- **[Risk]** `TABLE_STATUS_CHANGED` llega tarde y un comensal envía una ronda a una mesa en PAYING → **Mitigation**: backend rechaza con 409 (C-10 spec), cliente muestra toast traducido y refresca `sessionStore` vía `GET /api/diner/session` antes de redirigir al usuario al menú.

- **[Risk]** Retry queue crece más rápido que la red puede drenar (backend caído 10min) → **Mitigation**: límite hard de 50 items + TTL 5min descarta pre-send. Si la cola supera 20 items, se emite warning en UI y se pausa aceptación de nuevas operaciones hasta drenar.

- **[Trade-off]** La fusión de items tmp con eventos WS tiene ventana de 10s — si el backend tarda más (caso extremo), se verá un duplicado temporal que desaparece solo cuando el tmp expira (cleanup cada 30s). **Mitigation**: aceptable: duplicado visible <30s es mejor que perder una confirmación real. Alternativa sería matching por hash del payload, más complejo y no necesariamente más robusto.

- **[Trade-off]** `useOptimistic` de React 19 no persiste entre re-renders si el componente se desmonta (p.ej. cerrar el drawer y volver a abrir). **Mitigation**: la fuente de verdad real son los items `pending` en el store Zustand (que SÍ persisten); `useOptimistic` solo añade UI rápida intra-componente. Si el componente se desmonta, al remontarse reconstruye el estado óptimista desde el store.

- **[Trade-off]** Catch-up con `since` muy antiguo (desconexión >5min) pierde el historial de eventos y cae a refetch de cart + rounds → **Mitigation**: documentado en D-04. Refetch completo es O(1 request) y cubre el caso degenerado.

- **[Risk]** `localStorage` deshabilitado (iOS private mode) rompe retry queue → **Mitigation**: fallback a cola en memoria (igual que `sessionStore` en C-17). Pérdida de items encolados si el usuario recarga la página antes de que drene, pero la sesión entera se re-activa via QR.

- **[Risk]** Comensal abre 2 tabs del mismo dispositivo → dos WS conectados con mismo token, dos stores, inconsistencia entre tabs → **Mitigation**: detectar tabs duplicadas via `BroadcastChannel('pwamenu-session')` en un follow-up. En este change aceptamos el comportamiento: es un edge case raro (el QR lleva a un tab nuevo) y ambas tabs se mantendrán consistentes via eventos WS, solo duplican conexiones.

## Migration Plan

- **Deploy**: 100% frontend, no migrations, no feature flag. Se despliega pwaMenu con la nueva versión y empieza a funcionar. Backend ya tiene todos los endpoints listos (C-08/C-09/C-10 archivados).
- **Rollback**: revertir el build de pwaMenu al commit anterior. Zero data impact (nada se persiste backend-side que no fuera ya expuesto).
- **Canary**: opcional, si el cliente quiere testear con una branch antes de todos. Se puede servir el build nuevo solo para un `branch_slug` específico vía redirect en nginx (out of scope de este change).

## Open Questions

- ¿El color del comensal lo queremos del backend (`Diner.color`) o del hash local? Definimos hash local para este change para mantener 100% frontend, pero si C-18.5 sincroniza `Diner.color` a todos los dispositivos, convendría migrarlo. Decisión: **hash local ahora, review en C-19**.
- ¿Qué hacemos si el comensal scanea el QR de una mesa distinta mid-session? Fuera de scope — pwaMenu-foundation ya limpia y re-activa la sesión. Pero conviene documentar en un follow-up si aparecen reportes.
- ¿Mostrar el historial de rondas CANCELADAS en `/rounds`? Por defecto sí, filtro "mostrar canceladas" false. Se puede ajustar con feedback de UX.
