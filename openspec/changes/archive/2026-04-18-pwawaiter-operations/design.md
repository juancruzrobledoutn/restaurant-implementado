## Context

C-20 entregó el shell de pwaWaiter (pre-login, auth, tableStore esqueleto, waiterWsStore con reconnect + catch-up stub, push notifications opt-in). El backend expuso en C-10/C-11/C-12/C-13 todos los endpoints `/api/waiter/*` y el WS gateway en C-09 enruta los eventos relevantes al canal `/ws/waiter`. Lo que falta es el **wiring operativo**: el mozo entra, ve sus mesas en tiempo real, toma pedidos rápidos, confirma los que vienen de pwaMenu, acusa recibo de llamadas de servicio, pide la cuenta y registra pagos manuales — todo con resiliencia ante red inestable (el mozo se mueve por el salón y el Wi-Fi flaquea).

**Constraints heredadas**:
- Zustand 5 con **selectores + `useShallow`** (nunca destructuring); `EMPTY_ARRAY` estable; stores slice-puro sin side-effects en render.
- WebSocket ref pattern (dos effects: uno para refs, otro para suscripciones), `return unsubscribe` siempre; ver skill `ws-frontend-subscription`.
- IDs `string` en frontend, `number` en backend — convertir en boundary de `services/api.ts`.
- Precios en centavos (int) — `12550 = $125.50`.
- Forms via React 19 `useActionState` (skill `react19-form-pattern`).
- No tocamos backend: todos los contratos ya están cerrados.

**Stakeholders**: mozo (usuario primario, debe poder trabajar con una mano + pantalla táctil), cocina (recibe `ROUND_SUBMITTED` pero NO por acción de mozo en este change — la transición CONFIRMED→SUBMITTED es de MANAGER/ADMIN, queda en C-16), admin (verá eventos en dashboard).

## Goals / Non-Goals

**Goals:**
- Mozo puede tomar un pedido por comanda rápida desde la mesa en <10s usando el menú compacto sin imágenes.
- Mozo ve todas sus mesas con estado visual correcto (FREE/ACTIVE/PAYING/OUT_OF_SERVICE) y animaciones para eventos urgentes (service call = parpadeo rojo, nueva ronda = pulso amarillo, ronda lista = naranja, cuenta = violeta).
- Confirmar rondas PENDING (pedidos que llegaron desde pwaMenu) con un tap.
- Solicitar la cuenta y registrar un pago manual en efectivo/tarjeta/transferencia.
- Inbox de service-calls con ACK y cierre.
- Operaciones críticas (rondas, payments, ACKs) sobreviven a desconexión de red: se encolan en IndexedDB y se reintentan al volver online.
- Al reconectar WS, recuperar eventos perdidos via `GET /ws/catchup` (últimos 5 min).

**Non-Goals:**
- Transición CONFIRMED → SUBMITTED (exclusiva de MANAGER/ADMIN, vive en dashboard-ops C-16).
- División de cuenta compleja (partes iguales / por consumo / personalizada): eso es responsabilidad del comensal en pwaMenu (C-19). Aquí el mozo solo registra pagos manuales totales o parciales.
- Integración con Mercado Pago (lo paga el comensal, no el mozo).
- Modo "offline completo" (degradación total sin red): acá implementamos retry queue para operaciones transitorias; la lectura del menú/mesas requiere conexión inicial.
- Editar/anular rondas ya enviadas (cancelación es MANAGER+).
- Gestión de inventario o stock visual.

## Decisions

### D1. Stores granulares por dominio, no un mega-store
**Elección**: Crear 5 stores nuevos (`compactMenuStore`, `waiterCartStore`, `roundsStore`, `serviceCallsStore`, `retryQueueStore`) + extender `tableStore` y `waiterWsStore`.

**Rationale**: Cada store tiene un ciclo de vida distinto. `waiterCartStore` es efímero por mesa; `roundsStore` se indexa por `sessionId`; `retryQueueStore` persiste en IndexedDB. Fusionarlos en uno solo violaría SRP y haría los selectores costosos. La skill `zustand-store-pattern` lo pide explícitamente.

**Alternativa descartada**: Un solo `waiterOperationsStore` con slices — más fácil de importar pero dificulta tests aislados y genera re-renders cruzados.

### D2. Carrito del mozo local (no compartido con comensales)
**Elección**: `waiterCartStore` vive solo en memoria del cliente pwaWaiter y se envía como payload a `POST /api/waiter/sessions/{id}/rounds`. No se sincroniza con `CART_*` events (esos son del carrito colaborativo del comensal en pwaMenu).

**Rationale**: La **comanda rápida** es para clientes sin teléfono. No hay carrito colaborativo. El backend ya modela esto: `rounds` waiter-created pasan directo a CONFIRMED (skippean PENDING), el servicio espera un array de items en el POST.

**Alternativa descartada**: Reutilizar el cartStore del comensal — no aplica, el mozo no está en la sesión de pwaMenu.

### D3. RetryQueue con IndexedDB + librería `idb`
**Elección**: Persistir la cola en IndexedDB usando la librería `idb` (^8, 1KB gz, promisified). Drain automático al detectar `online` event + WS `open`.

**Rationale**:
- Mozos se mueven por el salón, Wi-Fi salta. Si usamos `localStorage`, la cola se pierde al cerrar la tab. IDB sobrevive.
- `idb` es mantenido por Jake Archibald, promisified, typed — mucho mejor DX que la API nativa.
- Scope acotado: solo **rondas**, **service-call ack/close**, **pagos manuales**. Fetch de menú / lectura de mesas NO se encola (si hay red, se intenta; si no, pantalla de error con botón retry manual).

**Formato de entry**:
```ts
type RetryEntry = {
  id: string;                    // crypto.randomUUID()
  op: 'createRound' | 'confirmRound' | 'ackServiceCall' | 'closeServiceCall' | 'requestCheck' | 'submitManualPayment' | 'closeTable';
  payload: unknown;              // serializable; no refs
  createdAt: number;             // Date.now()
  attempts: number;              // 0 → N
  nextAttemptAt: number;         // backoff scheduling
};
```

**Backoff**: `min(1000 * 2^attempts, 30000) + jitter(0..500)`. Max 10 intentos; a los 10 se marca `failed: true` y se muestra toast persistente con botón "Reintentar manualmente" o "Descartar".

**Idempotencia**: Cada entry lleva un `clientOpId` (uuid) que se envía al backend via header `Idempotency-Key` (los endpoints `/api/waiter/*` lo soportan desde C-10/C-12). El backend deduplica por `(tenant_id, client_op_id)`.

**Alternativa descartada**: Service Worker con Background Sync API. Más poderoso pero requiere service worker registration adicional; el shell de C-20 ya tiene `sw-push.js` para notifications, agregar Background Sync ensucia ese SW. Pospuesto a un change futuro si hace falta.

### D4. Suscripción WebSocket con ref pattern + auto-unsubscribe
**Elección**: `useWaiterSubscriptions(sessionId?)` hook que usa el patrón de **dos effects** (skill `ws-frontend-subscription`):
1. Effect A (refs de stores, dependency `[]`): guarda `useRef` a los stores para evitar stale closures.
2. Effect B (suscripciones, dependency `[sessionId]`): `wsService.on('ROUND_READY', ...)` + `return unsubscribe`.

**Rationale**: Sin este pattern, cada re-render genera suscripciones duplicadas y memory leaks. Ya lo aplicamos en C-20, acá lo extendemos a los 14 eventos operativos.

### D5. Catch-up post-reconexión
**Elección**: Al detectar `WS open` después de un `close`, antes de habilitar la UI:
1. Leer `lastEventTimestamp` del localStorage (guardado en cada evento recibido).
2. Llamar `GET /ws/catchup?branch_id=<id>&since=<timestamp>&token=<jwt>`.
3. Replay de los eventos recibidos como si vinieran del stream (pasarlos al mismo router).
4. Actualizar `lastEventTimestamp` al último evento.

**Rationale**: El WS gateway mantiene un sorted set de eventos recientes (5 min TTL, 100 eventos). Sin catch-up, perdemos `ROUND_READY` si el mozo pierde señal 30s — catastrófico.

**Trade-off**: Si la reconexión excede los 5 min, catch-up devuelve parcial. Aceptable: el mozo tiene que hacer pull-refresh de mesas si estuvo desconectado >5 min (mostramos banner "Datos pueden estar desactualizados — Actualizar").

### D6. `useActionState` para formularios de pago y ACK
**Elección**: `ManualPaymentForm` y `ServiceCallAckForm` usan `useActionState` de React 19. El action integra con `retryQueueStore.enqueue()` si el fetch falla por red.

**Rationale**: Skill `react19-form-pattern` establece esto como estándar en todos los frontends. Estado transiente (`isPending`) lo da el hook nativo; validación previa con Zod.

### D7. Estado visual de mesa derivado (no almacenado)
**Elección**: `VisualTableState = deriveVisualState(table, session, rounds, serviceCalls, animations)` — función pura en `lib/tableState.ts`. No se guarda en el store.

**Rationale**: Es un valor computado a partir de otros stores. Guardarlo crearía doble fuente de verdad y bugs de sincronización. Los consumidores lo obtienen via selector memoizado con `useShallow`.

**Prioridad de animaciones** (si aplican varias simultáneamente, gana la de mayor prioridad):
1. Service call abierto → parpadeo rojo
2. Ronda PENDING sin confirmar → pulso amarillo
3. Ronda READY esperando ser servida → parpadeo naranja
4. CHECK_REQUESTED (PAYING) → pulso violeta
5. Cambio de estado reciente (<3s) → parpadeo azul

### D8. Mapping de eventos WS a mutaciones de store

| Evento | Store afectado | Acción |
|--------|----------------|--------|
| `ROUND_PENDING` | roundsStore + tableStore | insert round + mark table con pulso amarillo |
| `ROUND_CONFIRMED` | roundsStore | update status |
| `ROUND_SUBMITTED/IN_KITCHEN` | roundsStore | update status |
| `ROUND_READY` | roundsStore + tableStore | update status + animación naranja si no todos listos, lista si todos |
| `ROUND_SERVED/CANCELED` | roundsStore | update status, recompute animaciones |
| `SERVICE_CALL_CREATED` | serviceCallsStore + tableStore | insert + parpadeo rojo |
| `SERVICE_CALL_ACKED/CLOSED` | serviceCallsStore + tableStore | update/remove + clear animación si no hay otros |
| `CHECK_REQUESTED` | tableStore | status → PAYING, pulso violeta |
| `CHECK_PAID` | tableStore | clear violeta |
| `TABLE_SESSION_STARTED` | tableStore | session_id, status → ACTIVE |
| `TABLE_CLEARED` | tableStore + roundsStore | clear session, drop rounds |
| `TABLE_STATUS_CHANGED` | tableStore | update visual status |

### D9. Rutas
```
/                                  → redirect según auth/assignment (heredado C-20)
/branches                          → selector pre-login (heredado)
/login                             → login (heredado)
/tables                            → grilla de mesas del sector asignado (extiende C-20)
/tables/:tableId                   → TableDetailPage (nuevo: rondas + service calls + check + pago)
/tables/:tableId/quick-order       → QuickOrderPage (nuevo: comanda rápida)
/service-calls                     → ServiceCallsPage (nuevo: inbox global)
```

## Risks / Trade-offs

- **[Retry queue duplica operaciones]** Si el backend confirma pero el ACK no llega al cliente, el entry se reintenta. → **Mitigación**: `Idempotency-Key` en todos los POST/PUT del waiter (backend ya deduplica por `client_op_id`). Documentar que el header es obligatorio.
- **[Race condition en roundsStore]** Un evento `ROUND_CONFIRMED` puede llegar antes que el response del POST que creó la ronda, dejando el store inconsistente. → **Mitigación**: usar `round_id` del backend como único identificador; los handlers WS son idempotentes (`upsert by id`, nunca `push`).
- **[Catch-up >5 min incompleto]** Si el mozo estuvo desconectado más de 5 min, se pierden eventos. → **Mitigación**: banner "Datos desactualizados" con pull-to-refresh que re-fetcha `/api/waiter/tables` + `/api/waiter/service-calls`.
- **[IndexedDB quota]** Si la retry queue crece sin límite (backend caído 1h), llenamos IDB. → **Mitigación**: cap de 500 entries; al pasarse, mostrar error "Demasiadas operaciones offline — contacte soporte" y bloquear nuevas operaciones hasta drain manual.
- **[Pago manual sin confirmación backend]** El mozo cobra cash pero la request falla → queda en retry queue; si el cliente se va mientras tanto, el mozo cree que cobró pero el sistema no lo registró. → **Mitigación**: UI muestra pagos "pendientes de sincronizar" en un badge sobre la mesa; no permitir cerrar mesa hasta que el pago esté APPROVED.
- **[Testing WS en Vitest]** Suscripciones WS son difíciles de testear sin un mock server. → **Mitigación**: crear `test-utils/mockWsService.ts` con `emit(eventType, payload)` manual; seguir el patrón de C-20 (ya existe `waiterWs.test.ts`).
- **[React 19 useActionState + retry queue]** Si el action encola y retorna, la UI debe mostrar "enviado" aunque no haya respuesta del server. → **Mitigación**: estado explícito `queued | sending | success | failed` en el hook `useEnqueuedAction`.

## Migration Plan

No hay migración — proyecto DESDE CERO, primer uso de estos stores. Steps:
1. Instalar `idb` npm dep en `pwaWaiter/package.json`.
2. Crear stores + hooks + pages en orden de dependencia (retry queue → api extensions → stores específicos → hook subscriptions → pages).
3. Extender `tableStore` con fetch real (rompe el shell-only de C-20, pero no hay datos migrados — es gate point del roadmap).
4. Tests unitarios por store + integración por página.
5. Ejecutar `npm run typecheck && npm run test` hasta 0 errores antes de `/opsx:archive`.

Rollback: revertir el commit. No hay datos persistentes en backend específicos a este change.

## Open Questions

- ¿Permitimos que el mozo cancele rondas propias (las que él creó) antes del SUBMITTED? **Propuesta**: sí, via `DELETE /api/waiter/sessions/{id}/rounds/{rid}` si existe en backend; si no, diferirlo a un change futuro. → **Validar con `openspec status` de C-10** antes de implementar.
- ¿El pago manual debe imprimir recibo físico? → Fuera de scope. Solo retorna ACK en pantalla.
- ¿RetryQueue debe estar scoped por `userId` o global? → **Propuesta**: por `userId` (clave compuesta `userId:entryId`) — si un mozo cierra sesión y otro se loguea en el mismo device, no queremos que herede operaciones ajenas.
