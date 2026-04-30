## Context

El backend de billing existe completo desde C-12 (`app_check`, `charge`, `allocation`, `payment`, `BillingService`, eventos Outbox) y el receipt printing desde C-16 (`/api/admin/checks/{id}/receipt`). Sin embargo, los endpoints de consulta actuales son *per-session*: `GET /api/billing/check/{session_id}` devuelve un solo check y sólo se obtienen pagos de forma indirecta (nested en `CheckOut.payments`). No hay endpoints listing con paginación, filtros por fecha/método/estado, ni agregados por método — requisitos centrales de la auditoría administrativa que pide C-26.

El Dashboard ya tiene toda la infraestructura de UI establecida desde C-14: `PageContainer`, `HelpButton`, `Table`, `Pagination`, `usePagination`, `TableSkeleton`, `Modal`, `Card`, `Badge`. El patrón de páginas administrativas está consolidado (Sales es el precedente más cercano — también es read-only, filtrable por fecha, con KPIs). El sistema WebSocket (`dashboardWS.onFiltered`) rutea eventos por `branch_id` desde C-14 y ya recibe los eventos Outbox `CHECK_*` / `PAYMENT_*` del ws_gateway.

**Stakeholders técnicos:**
- Backend: la superficie nueva es chica (dos endpoints de lectura). No hay cambios al modelo ni a la lógica FIFO.
- Frontend Dashboard: dos páginas nuevas + un store modular + un servicio API + tres componentes + una entrada en Sidebar. Es el 80% del trabajo.
- ws_gateway: zero cambios.
- pwaMenu / pwaWaiter: zero cambios.

**Governance ALTO**: este change se propone completo pero no se implementa sin aprobación explícita. Los tradeoffs de este documento existen para que el revisor pueda validar el approach antes de invertir en apply.

## Goals / Non-Goals

**Goals:**
- Exponer dos endpoints administrativos de lectura (`GET /api/admin/checks`, `GET /api/admin/payments`) con paginación cursor-less (page/page_size) y filtros por rango de fechas, estado y método.
- Entregar dos páginas Dashboard (`/checks`, `/payments`) que consuman esos endpoints, reaccionen en tiempo real a `CHECK_*` / `PAYMENT_*`, muestren KPIs operativos del día y permitan imprimir recibos.
- Centralizar el estado en un store modular `billingAdminStore/` con selectores independientes, `useShallow` para arrays filtrados y `EMPTY_ARRAY` estable.
- Integrar la suscripción WS vía ref pattern canónico (`dashboardWS.onFiltered(branchId, ...)`).
- Mantener paridad de permisos con C-12: endpoints y páginas son ADMIN o MANAGER; KITCHEN/WAITER no tienen acceso.
- Cobertura de tests: store (upsert por WS, aplicación de filtros, selectores estables), página (render de KPIs, modal de detalle, agrupación por método), endpoints backend (RBAC, filtros, paginación, tenant isolation).

**Non-Goals:**
- **No** mutar ningún recurso desde Dashboard. Todo es lectura + WS. Request check, manual payment, MP preference siguen viviendo en sus routers originales (pwaMenu / pwaWaiter).
- **No** editar ni anular pagos (refunds fuera de alcance; sería otro change).
- **No** agregar reportes con export CSV / PDF (fuera de alcance; posible change futuro).
- **No** modificar la lógica FIFO, el modelo de datos, ni los eventos Outbox existentes.
- **No** crear dashboards cross-branch. C-26 trabaja sobre la branch seleccionada (igual que Sales y el resto del Dashboard).
- **No** implementar gráficos temporales (timeseries). Los KPIs son valores puntuales del día (mismo patrón que Sales).
- **No** alterar el receipt HTML ni su endpoint (C-16 ya cubre esto; C-26 lo reutiliza).

## Decisions

### D1. Dos endpoints administrativos nuevos en `/api/admin/billing/...` (no reutilizar `/api/billing/`)

Creamos `GET /api/admin/checks` y `GET /api/admin/payments` en un nuevo router `backend/rest_api/routers/admin_billing.py`, montados bajo `/api/admin`. El router existente `/api/billing/` mantiene su contrato per-session intacto.

**Por qué:**
- El router `/api/billing/` acepta JWT *o* Table Token (diners de pwaMenu). Los nuevos endpoints son ADMIN/MANAGER exclusivos. Mezclar superficies públicas y administrativas en el mismo prefix confunde auth y complica testing.
- El patrón `admin_checks.py` (C-16) ya estableció el prefijo `/api/admin/checks/*` para operaciones administrativas de billing. Extender ese prefijo es consistente.
- Rate limits distintos: administrativo es 60/min (listing de auditoría); billing público es 20/min (operaciones críticas).

**Alternativa considerada:** agregar `GET /api/billing/admin/checks` al router existente. Rechazada porque obliga a bifurcar auth dentro del mismo router (parte acepta Table Token, parte no) y complica la lectura.

### D2. Reutilizar `BillingService` vs. crear `AdminBillingService`

Creamos un **nuevo** `AdminBillingService` en `backend/rest_api/services/domain/admin_billing_service.py`. `BillingService` queda intacto.

**Por qué:**
- `BillingService` hoy expone operaciones mutativas complejas (`request_check`, `register_manual_payment`, `process_mp_webhook`) que no aplican acá.
- Las queries administrativas necesitan joins y agregaciones distintas (p.ej., sumar `amount_cents` agrupado por `method` para el resumen de `/payments`). Meter eso en `BillingService` infla su responsabilidad.
- Mantener Clean Architecture: un servicio = una responsabilidad. `AdminBillingService` = queries de auditoría; `BillingService` = lifecycle transaccional.

**Alternativa considerada:** agregar métodos `list_checks_admin()` / `list_payments_admin()` a `BillingService`. Rechazada por lo anterior. Ambos servicios comparten los mismos repositorios y modelos; zero duplicación de datos.

### D3. Paginación page/page_size (no cursor)

Parámetros: `?page=1&page_size=20&from=2026-04-20&to=2026-04-21&status=REQUESTED`. Default: `page=1`, `page_size=20`, `max page_size=100`. Respuesta incluye `{ items: [...], total, page, page_size, total_pages }`.

**Por qué:**
- Consistencia con el resto del Dashboard: `usePagination` hook espera page numbers, no cursors.
- El volumen esperado es bajo (decenas a cientos de checks/día por branch). Cursor sería over-engineering.
- Filtros por fecha + branch + tenant reducen dramáticamente el resultset; `ORDER BY created_at DESC` con `LIMIT/OFFSET` es performante con índices correctos (ya existen desde C-12: `ix_app_check_branch_id`, `ix_app_check_created_at`, composite `(tenant_id, branch_id, created_at)`).

**Alternativa considerada:** cursor-based pagination (keyset). Rechazada: el beneficio de performance no justifica la complejidad dado el volumen.

### D4. Store modular `billingAdminStore/` (no monolítico)

Estructura:
```
Dashboard/src/stores/billingAdminStore/
├── store.ts        # create() + actions + WS handlers internos (upsertCheck/upsertPayment)
├── selectors.ts    # Todos los hooks de lectura + EMPTY_ARRAY constantes
├── types.ts        # BillingAdminState, ChecksFilter, PaymentsFilter, ChecksKPIs
└── index.ts        # re-exports
```

**Por qué:**
- El store tiene dos dominios (`checks` y `payments`) con filtros y acciones independientes — supera el umbral del store plano según `zustand-store-pattern`.
- Selectores independientes (checks por un lado, payments por otro) requieren muchos `select*` hooks; agruparlos en `selectors.ts` mejora discoverability.
- Referencias: `pwaMenu/src/stores/tableStore/` es el precedente canónico.

**Alternativa considerada:** dos stores separados (`adminChecksStore`, `adminPaymentsStore`). Rechazada porque la suscripción WS es una sola (los 4 eventos llegan por la misma conexión filtrada por branch) y dividir en dos stores duplica el setup del ref pattern.

### D5. Un solo `useEffect` de suscripción WS con `dashboardWS.onFiltered(branchId, '*', ...)`

El store expone dos upsert actions (`upsertCheck(check)`, `upsertPayment(payment)`) pero la **suscripción vive en un componente contenedor** (no en el store), siguiendo el ref pattern obligatorio de `ws-frontend-subscription`:

```typescript
// Dashboard/src/components/billing/BillingRealtimeBridge.tsx (o inline en cada página)
function BillingRealtimeBridge() {
  const branchId = useBranchStore(selectSelectedBranchId)
  const upsertCheck = useBillingAdminStore((s) => s.upsertCheck)
  const upsertPayment = useBillingAdminStore((s) => s.upsertPayment)

  const handleEvent = (e: WSEvent) => {
    if (e.type === 'CHECK_REQUESTED' || e.type === 'CHECK_PAID') upsertCheck(e.payload)
    if (e.type === 'PAYMENT_APPROVED' || e.type === 'PAYMENT_REJECTED') upsertPayment(e.payload)
  }

  const ref = useRef(handleEvent)
  useEffect(() => { ref.current = handleEvent })
  useEffect(() => {
    if (!branchId) return
    const unsub = dashboardWS.onFiltered(branchId, '*', (e) => ref.current(e))
    return unsub
  }, [branchId])

  return null
}
```

**Por qué:**
- `dashboardWS.onFiltered` ya filtra por branch server-side; filtrar dos veces es waste.
- Usar `'*'` con filtro en el handler es más barato que cuatro suscripciones separadas (una por tipo de evento) cuando el store las consume juntas.
- Mantener la suscripción en un componente — no en el store — cumple con el ref pattern (único lugar donde se garantiza cleanup al desmontar).
- El `BillingRealtimeBridge` se monta desde `/checks` y `/payments`; también se puede montar desde `MainLayout` si ambas páginas lo requieren simultáneamente (a decidir al implementar — ambas opciones son compatibles con el patrón).

**Alternativa considerada:** suscripción directa en el store vía un `initializeWebSocket()` action llamado desde `App.tsx`. Rechazada porque el store no es un React node y no puede usar el ref pattern con useRef; llevaría a listener accumulation al re-inicializar tras login/logout.

### D6. KPIs derivados en el cliente (no endpoint separado)

Los tres KPIs (`cuentas del día`, `total facturado`, `cuentas pendientes`) se derivan con `useMemo` del array `checks` ya en el store filtrado por fecha del día.

**Por qué:**
- El resultset del día es pequeño (< 500 cuentas típicamente). Calcular `reduce`/`filter` en memoria es instantáneo.
- Evita una llamada de red adicional y mantiene los KPIs siempre sincronizados con los eventos WS en vivo.
- Patrón idéntico al usado en Sales.tsx (KPIs computados desde top products).

**Alternativa considerada:** endpoint `GET /api/admin/billing/kpis?date=...` con agregaciones SQL. Rechazada por lo anterior. Si el volumen crece (caso multi-sucursal o histórico largo), se puede promover a endpoint sin romper contrato de store.

### D7. CheckDetailModal reutiliza `CheckOut` completo vía llamada extra

Al abrir el modal se dispara `GET /api/billing/check/{session_id}` (endpoint existente de C-12) para obtener `charges + allocations + payments` con `remaining_cents` computado. El listing (`GET /api/admin/checks`) devuelve sólo summary (id, total_cents, status, created_at, session_id) — no trae nested charges/payments para mantener payloads livianos.

**Por qué:**
- Listing de 20 checks con todos sus charges/payments sería un payload pesado (potencialmente 50+ KB por página).
- El detalle sólo se consulta cuando el usuario abre el modal — lazy load natural.
- El endpoint `GET /api/billing/check/{session_id}` ya existe y retorna exactamente lo que el modal necesita. Zero código backend nuevo.

**Alternativa considerada:** siempre devolver nested. Rechazada por payload size. El listado es de auditoría — sólo se necesita summary para escanear filas.

### D8. Receipt printing: reutilizar `receiptAPI` existente de C-16

El botón "Imprimir recibo" en cada fila y en el modal de detalle llama a `receiptAPI.printCheck(checkId)` (ya implementado en C-16). Zero código nuevo.

**Por qué:** el feature existe end-to-end. Reutilizar es literal copy-paste de la invocación.

### D9. Filtros persistidos en el store, no en URL

Los filtros (`date`, `method`, `status`) viven en `billingAdminStore.checksFilter` / `paymentsFilter`. No se agregan a la URL (no query params en `/checks?date=2026-04-21`).

**Por qué:**
- Consistencia con Sales, Staff, Tables — ninguna página Dashboard usa URL state hoy.
- Simplicidad. Si en el futuro aparece un requisito de deep-linking, se puede migrar.
- Los filtros se persisten en `localStorage` vía `persist()` middleware — consistente con otros stores administrativos.

**Alternativa considerada:** URL state con `useSearchParams`. Rechazada por inconsistencia con el resto del Dashboard.

### D10. Method summary: agregación en cliente, tabla al pie

En `/payments`, la tabla resumen por método se calcula con `useMemo` iterando `paymentsFiltered` y agrupando por `method`, sumando `amount_cents` sólo para `status === 'APPROVED'`.

**Por qué:**
- Mismo razonamiento que D6: dataset pequeño, cálculo barato.
- Evita inconsistencias: lo que se muestra en la tabla principal coincide byte a byte con los totales por método (mismos datos fuente).
- `REJECTED` y `PENDING` se excluyen del total por convención contable — un pago rechazado no es ingreso.

## Risks / Trade-offs

- **[Volumen alto de checks rompe la paginación en memoria]** → Si una branch procesa > 1000 checks/día, el KPI derivation se vuelve lento y el payload del listing crece. **Mitigación:** `page_size` máximo 100 enforced en backend; KPIs se derivan sólo del `page` actual (no del total). Si el requisito crece, promover KPIs a endpoint SQL agregado (D6 alternative).

- **[WebSocket desconectado → UI desincronizada silenciosamente]** → Si la conexión WS cae, los nuevos pagos/checks no aparecen en tiempo real y el usuario no lo sabe. **Mitigación:** usar `dashboardWS.onConnectionChange` para mostrar un banner "Sin conexión en vivo — recargá para ver datos nuevos" (patrón ya establecido en Dashboard desde C-14).

- **[Payloads nested de `CHECK_PAID` evento Outbox no incluyen todo lo necesario]** → Si el evento WS sólo trae `{check_id, status}`, el upsert del store no tendrá datos suficientes para refrescar la fila completa. **Mitigación:** confirmar en apply el shape exacto del payload del Outbox event (documentado en `04_eventos_y_websocket.md`). Si es insuficiente, el handler hace refetch del check via `GET /api/billing/check/{session_id}` antes del upsert.

- **[Tenant bleed en admin endpoints]** → Un ADMIN/MANAGER no debe ver checks de otra branch o tenant. **Mitigación:** `PermissionContext.require_management()` valida tenant y devuelve las branches autorizadas del usuario. El query filtra por `branch_id IN (user.branch_ids) AND tenant_id = user.tenant_id`. Tests obligatorios de aislamiento cross-tenant.

- **[Rate limit 60/min insuficiente para dashboards con auto-refresh]** → Si alguien agrega polling (poll each 5s), el listing endpoint agota el rate limit. **Mitigación:** no se implementa polling (WS cubre real-time). Rate limit 60/min es holgado para uso humano. Documentar en tasks que polling está prohibido.

- **[MANAGER ve pagos de todas las sucursales del tenant]** → Si un MANAGER pertenece a 3 sucursales, el endpoint puede devolver checks de las 3. El UI filtra por `selectedBranchId`, pero un MANAGER malicioso podría cambiar el filtro del cliente. **Mitigación:** el backend valida que `branch_id` en query param ∈ `user.branch_ids`. Si el parámetro es omitido, devuelve sólo la branch activa del header contextual.

- **[Filtros en URL vs. store: regresión si el usuario comparte enlace]** → Al no usar URL state (D9), un link a `/payments` siempre abre con los filtros por defecto. **Mitigación:** aceptable; los filtros persisten en localStorage para la sesión del usuario. Si aparece requisito real de compartir vistas, migrar a URL state en un change dedicado.

- **[React Compiler deps: `deleteDialog` vs `deleteDialog.open` en columns]** → Las páginas de C-26 no tienen delete (son read-only), así que este trampa de `dashboard-crud-page` no aplica. Pero el patrón de columns con acciones (Ver detalle, Imprimir) debe incluir el objeto handler completo en deps.

- **[Filter date-range default: si `from`/`to` son `undefined`, el listing devuelve TODO el histórico]** → UX pésima + payload gigante. **Mitigación:** el store inicializa `checksFilter.date = today` y `paymentsFilter.dateRange = {from: today, to: today}`. El backend también enforcea `to - from <= 90 días` como hard limit.

## Migration Plan

Este change no requiere migraciones de DB. Tampoco es breaking para consumidores existentes.

**Deployment sequence:**
1. Deploy backend con nuevos endpoints administrativos (compat total con clientes anteriores).
2. Deploy Dashboard con nuevas páginas + rutas.
3. Smoke test: abrir `/checks` y `/payments` en staging con un tenant con datos reales; disparar `CHECK_REQUESTED` desde pwaMenu y verificar que aparece en tiempo real.

**Rollback:**
- Revertir Dashboard: páginas y rutas desaparecen. Los endpoints backend quedan huérfanos pero sin impacto (nadie los consume).
- Revertir backend: sin dependencias downstream.

## Open Questions

1. **Payload de eventos Outbox `CHECK_PAID` / `PAYMENT_APPROVED`**: ¿trae el objeto completo (check con charges/allocations/payments) o sólo IDs? Resolver en apply leyendo la implementación real del event publisher en `backend/rest_api/services/outbox/` (archivo a identificar durante implementation).

2. **¿Dónde montar `BillingRealtimeBridge`?** Opciones: (a) dentro de cada página `/checks` y `/payments`, (b) en `MainLayout` global. Trade-off: (a) es más explícito y sólo se suscribe cuando el usuario está en billing; (b) mantiene el store fresco incluso fuera de las páginas (útil si un día se agregan KPIs de billing en `HomePage`). **Propuesta:** empezar con (a) y promover a (b) si HomePage incorpora KPIs de billing.

3. **¿Mostrar `PaymentStatusBadge` con 4 estados o colapsar?** Los estados son `PENDING`, `APPROVED`, `REJECTED`, `FAILED`. ¿`FAILED` y `REJECTED` se muestran iguales (rojo) o distintos (rojo vs. gris)? **Propuesta:** colapsar visualmente a "aprobado / rechazado / pendiente" (3 variantes); `FAILED` se mapea a rechazado. Documentar en tasks que el tooltip diferencia.

4. **¿Incluir la columna `external_id` (MP payment ID) en el listado o sólo en el modal?** External IDs de MercadoPago son strings largos. **Propuesta:** solo en el modal de detalle, para no ensuciar el listado. Dejar abierto a feedback del revisor.
