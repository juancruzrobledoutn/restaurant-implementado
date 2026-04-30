## Context

C-10 (rounds) dejó el backend con la máquina de estados completa (`PENDING → CONFIRMED → SUBMITTED → IN_KITCHEN → READY → SERVED → CANCELED`), el endpoint `PATCH /api/admin/rounds/{id}` para SUBMITTED/CANCELED, y todos los eventos `ROUND_*` emitidos (Outbox para SUBMITTED/READY, Redis directo para el resto). C-11 agregó kitchen tickets. C-16 (dashboard-operations) construyó la Kitchen Display (columnas SUBMITTED/IN_KITCHEN/READY filtradas por rol kitchen) y el `kitchenDisplayStore`.

**Brecha actual**: no existe una vista **admin-wide** que consolide el historial de rondas de la sucursal con filtros (fecha, sector, estado, mesa), con el detalle completo de cada ronda (timestamps por transición, items, comensal) y con la acción de cancelación para MANAGER/ADMIN. La Kitchen Display muestra SOLO las rondas en cocina; Tables muestra la sesión pero no las rondas individuales.

**Constraint crítica**: el backend NO tiene endpoint de listado `GET /api/admin/rounds`. Debe agregarse. El endpoint de cancelación ya existe.

**Stakeholders**: ADMIN/MANAGER (uso principal), WAITER/KITCHEN (lectura si se les da acceso a la ruta — fuera de scope de C-25; la página se restringe a management por default vía `ProtectedRoute` ya existente).

**Current state — archivos relevantes**:
- Backend: `backend/rest_api/routers/admin_rounds.py` (solo PATCH), `services/domain/round_service.py`, `schemas/round.py`.
- Frontend: `Dashboard/src/stores/kitchenDisplayStore.ts` (patrón WS upsert a replicar), `pages/KitchenDisplay.tsx` (patrón columnas), `components/layout/Sidebar.tsx` (slot `/orders` con `disabled: true`).
- Skills a aplicar: `clean-architecture`, `fastapi-domain-service`, `fastapi-code-review`, `dashboard-crud-page`, `zustand-store-pattern`, `ws-frontend-subscription`, `help-system-content`, `vercel-react-best-practices`, `python-testing-patterns`, `test-driven-development`.

---

## Goals / Non-Goals

**Goals:**
- Una sola pantalla `/orders` donde MANAGER/ADMIN auditan el ciclo de vida de cualquier ronda del día (o de cualquier fecha filtrada) de la sucursal activa.
- Actualización en tiempo real: cada transición emite WS, la UI se refresca sin refetch.
- Cancelación con `cancel_reason` obligatoria, confirmada con dialog, auditada en backend (C-10 ya lo hace).
- Dos vistas complementarias: **Columnas** (operación en vivo) y **Lista** (auditoría con paginación).
- Filtros server-side performantes para 100-500 rondas/día por sucursal.
- Reutilización máxima: `Table`, `Badge`, `Modal`, `ConfirmDialog`, `Pagination`, `PageContainer`, `HelpButton` ya existen.

**Non-Goals:**
- **No** se crea vista para WAITER o KITCHEN (cada uno tiene su propia app/pantalla).
- **No** se permite edición de items de una ronda desde esta pantalla (ya existe `void-item` en waiter; fuera de scope).
- **No** se implementa export a CSV/PDF en C-25 (backlog futuro).
- **No** se muestran totales agregados (KPIs) — eso es C-16 Sales.
- **No** se manipulan estados SUBMITTED → IN_KITCHEN ni READY → SERVED desde esta pantalla (Kitchen Display y pwaWaiter lo hacen).
- **No** hay persistencia del store — las rondas cambian constantemente.
- **No** se agregan eventos WebSocket nuevos — solo se consumen los existentes.

---

## Decisions

### D1. Un nuevo endpoint `GET /api/admin/rounds` vs. reutilizar `GET /api/kitchen/rounds`

**Decisión**: crear `GET /api/admin/rounds` nuevo.

**Alternativas consideradas**:
- **A**: reutilizar `GET /api/kitchen/rounds` de C-11 → rechazado. Está filtrado a SUBMITTED/IN_KITCHEN y diseñado para kitchen workflow (product_name resuelto, no table_code, no filtros por fecha/sector). Cambiar su contrato rompe cocina.
- **B**: agregar `GET /api/admin/rounds` con filtros y schema `RoundAdminOutput` enriquecido → **elegido**. Endpoint nuevo, schema propio, reutiliza `RoundService` con un método adicional `list_for_admin`.

**Rationale**: separación de consumidores por rol. Kitchen y admin tienen necesidades distintas (kitchen: minimal, admin: enriched + filtrable). Clean Architecture mantiene un router por audiencia.

### D2. Vista Columnas (kanban) vs. Lista — ¿cuál mostrar por default?

**Decisión**: **Columnas por default**; toggle a Lista persiste en `localStorage` bajo `orders.viewMode` (string `'columns' | 'list'`).

**Rationale**: el uso diario del manager es operacional (monitorear qué está pasando ahora); la lista sirve para auditoría/búsqueda puntual. Persistir la preferencia evita fricción en cada visita.

**Por qué 4 columnas (PENDING, CONFIRMED, SUBMITTED, READY)** y no las 7 posibles:
- IN_KITCHEN ya está completamente cubierto por **Kitchen Display** (C-16) — mostrarla acá es redundante y confunde.
- SERVED y CANCELED son estados terminales — no accionables operativamente; van a la vista Lista cuando el usuario los filtra explícitamente.
- 4 columnas caben bien en desktop 1440px (360px cada una) sin scroll horizontal.

**Alternativa considerada**: 7 columnas (todas) → rechazada, el ancho de pantalla se rompe y las cards se vuelven ilegibles.

### D3. Filtros — client-side vs. server-side

**Decisión**: **server-side** para todos los filtros (`date`, `sector_id`, `status`, `table_code`, `branch_id`).

**Rationale**:
- Una sucursal grande puede generar 500+ rondas/día; traerlas todas al cliente es ineficiente.
- `date` es el filtro dominante — limitar el dataset ya desde backend reduce payload 10×.
- `table_code` es búsqueda textual → `ILIKE '%code%'` en backend con índice parcial es más rápido que filtrado en JS.

**Alternativa considerada**: traer todas las del día y filtrar en el cliente → rechazado por escalabilidad.

**Gotcha — coherencia WS**: cuando llega un evento WS para una ronda que NO pasa el filtro activo, el handler NO la agrega; si pasa, la upsertea. Si una ronda in-store transiciona a un estado que ya no pasa el filtro, el handler la **remueve**. Esto mantiene la lista consistente con el filtro del usuario.

### D4. Store Zustand — ¿persistir snapshot o no?

**Decisión**: **NO persistir** (igual que `kitchenDisplayStore`).

**Rationale**: los estados de rondas cambian en segundos. Mostrar un snapshot de hace 10 minutos al reabrir la tab genera confusión ("¿por qué esta ronda sigue en PENDING si ya fue servida?"). Solo se persiste la **preferencia de vista** (`'columns' | 'list'`) en `localStorage`, no en el store.

**Alternativa considerada**: `persist` con TTL corto → rechazado; la UX es peor que un simple `fetchRounds()` en mount.

### D5. WS handlers — qué hace cada uno con el filtro activo

**Decisión**: cada handler WS invoca un helper `_passesFilter(round, filters)` antes de upsert/remove.

```
handleRoundConfirmed(event):
  1. Extraer round del event.data
  2. Si round está en store Y _passesFilter(round) → UPDATE
  3. Si round está en store Y NO pasa → REMOVE (transicionó fuera del filtro)
  4. Si NO está en store Y pasa filtro → ADD
  5. Si NO está en store Y NO pasa → ignorar
```

Helper `_passesFilter`:
- Match por `branch_id === filters.branch_id` (siempre).
- Match por `date === filters.date` (comparar `pending_at.slice(0,10)` con `filters.date`).
- Match por `sector_id === filters.sector_id` si está seteado.
- Match por `status === filters.status` si está seteado.
- Match por `table_code.includes(filters.table_code)` (case-insensitive) si está seteado.

**Alternativa considerada**: refetchear tras cada evento WS → rechazado, genera ruido de red y puede saltar actualizaciones cuando caen 3 eventos seguidos.

### D6. Cancelación — UX flow

**Decisión**: dos pasos.

1. Usuario clickea "Cancelar" en card/row o detalle modal.
2. `ConfirmDialog` se abre con:
   - Texto: "¿Cancelar ronda #{round_number} de mesa {table_code}?"
   - Textarea `cancel_reason` (required, max 500 chars) con counter.
   - Botones "Volver" y "Cancelar ronda" (destructive red).
3. Submit → `PATCH /api/admin/rounds/{id}` con `{status: "CANCELED", cancel_reason}`.
4. Success → toast "Ronda cancelada", backend emite `ROUND_CANCELED` → el handler WS local remueve/mueve la ronda.
5. Error → toast con detalle del 4xx (409 si ya estaba cancelada, 403 si no es management, 404 si no existe).

**RBAC**: el botón "Cancelar" se renderiza condicional por `authStore.roles.includes('ADMIN') || authStore.roles.includes('MANAGER')`. Si un WAITER/KITCHEN visita la ruta (edge case), el botón no aparece — y el backend igual lo rechaza con 403 (defense in depth).

### D7. Estructura del store — una sola lista vs. lista por estado

**Decisión**: **una sola lista** `rounds: Round[]` + selectores derivados por estado.

```ts
export const selectRoundsByStatus = (status: RoundStatus) =>
  (s: RoundsAdminState) => s.rounds.filter(r => r.status === status) ?? EMPTY_ROUNDS
```

**Rationale**: ronda única cambia de estado → una sola mutación (update in place), vs. mover entre 4 arrays. Simpler store, menos bugs.

**Gotcha**: el selector filtrado crea un array nuevo cada render → usar `useShallow` o memoizar en el componente. Para columnas usaremos `useMemo` por estado en la página, consumiendo `selectAdminRounds` stable.

### D8. Backend query — una query o N+1

**Decisión**: una query con JOIN explícito a `table`, `branch_sector`, `diner`, `round_item` (para count y total).

```python
query = (
    select(Round, Table.code.label("table_code"), Table.number.label("table_number"),
           BranchSector.id.label("sector_id"), BranchSector.name.label("sector_name"),
           Diner.name.label("diner_name"),
           func.count(RoundItem.id).filter(RoundItem.is_voided.is_(False)).label("items_count"),
           func.coalesce(
               func.sum(RoundItem.price_cents_snapshot * RoundItem.quantity)
                   .filter(RoundItem.is_voided.is_(False)),
               0
           ).label("total_cents"))
    .select_from(Round)
    .join(TableSession, Round.session_id == TableSession.id)
    .join(Table, TableSession.table_id == Table.id)
    .outerjoin(BranchSector, Table.sector_id == BranchSector.id)
    .outerjoin(Diner, Round.created_by_diner_id == Diner.id)
    .outerjoin(RoundItem, (RoundItem.round_id == Round.id) & RoundItem.is_active.is_(True))
    .where(Round.tenant_id == tenant_id, Round.branch_id == branch_id,
           Round.is_active.is_(True))
    .group_by(Round.id, Table.code, Table.number, BranchSector.id, BranchSector.name, Diner.name)
    .order_by(Round.pending_at.desc())
)
# Apply filters, limit, offset
```

Total count se obtiene con una segunda query simple (`select(func.count()).select_from(...)` con mismos filtros pero sin joins, usando `distinct(Round.id)`).

**Rationale**: performance previsible O(1) query + O(1) count. Los repos admiten queries raw con filtros tenant.

**Alternativa considerada**: traer rondas y luego resolver relaciones en Python → rechazado por N+1 en datasets grandes.

### D9. Paginación — offset vs. cursor

**Decisión**: **offset** (limit/offset clásico).

**Rationale**: los datos son del día (o rango corto) con `ORDER BY pending_at DESC` — no crece sin límite como feeds infinitos. `offset` es más simple para UI con número de página y total.

**Trade-off**: offset grande es ineficiente (skip de 10k filas). Mitigación: el filtro `date` limita el dataset; si el usuario filtra "últimos 30 días" sin más filtros, se muestra un warning "Pueden ser muchas rondas — considerá filtrar por sector o estado".

### D10. Schema `RoundAdminOutput` — campos mínimos para ambas vistas

```python
class RoundAdminOutput(BaseModel):
    id: int
    round_number: int
    session_id: int
    branch_id: int
    status: str
    # Denorm para UI
    table_id: int
    table_code: str
    table_number: int
    sector_id: Optional[int]
    sector_name: Optional[str]
    diner_id: Optional[int]
    diner_name: Optional[str]
    items_count: int
    total_cents: int
    # Timestamps de máquina de estados
    pending_at: datetime
    confirmed_at: Optional[datetime]
    submitted_at: Optional[datetime]
    in_kitchen_at: Optional[datetime]
    ready_at: Optional[datetime]
    served_at: Optional[datetime]
    canceled_at: Optional[datetime]
    cancel_reason: Optional[str]
    created_by_role: str
    created_at: datetime
    updated_at: datetime
```

Para el detalle modal se hace una segunda llamada `GET /api/admin/rounds/{id}` que devuelve `RoundAdminOutput` + `items: RoundItemOutput[]` embebidos (reutiliza `RoundWithItemsOutput`). Esto evita traer todos los items del día en la lista.

---

## Risks / Trade-offs

| Riesgo | Mitigación |
|--------|-----------|
| Reconexión WS pierde eventos intermedios | Hook invoca `fetchRounds(currentFilters)` en `onReconnect` (ref pattern). Además, el store escucha todos los eventos WS y hace merge — no solo los filtrados. |
| Evento WS llega con payload incompleto (ej: ROUND_SERVED sin `sector_name`) | Handler hace merge con ronda existente en memoria; solo sobreescribe campos presentes. Si la ronda no existe en memoria y el payload está incompleto, se hace `fetchRound(id)` como fallback. |
| Filtro `date` + WS: evento de ayer llega tarde | Handler evalúa `_passesFilter(round, filters)` — si no pasa, se ignora. La ronda no se agrega a la lista fuera de su fecha. |
| Ranuras vacías cuando el filtro `status` está seteado y la ronda transiciona fuera | El handler detecta el mismatch y remueve la ronda del store. La UX muestra transición visual breve (ronda desaparece de la columna filtrada). |
| Query N+1 en Lista | Query única con JOINs + GROUP BY. Tests backend verifican que con 100 rondas se ejecuta 1 query + 1 count (con `db.execute.call_count`). |
| Cancelación concurrente (dos managers cliquean al mismo tiempo) | Backend ya maneja vía `ConflictError` (409) si el estado ya no es cancelable. Frontend muestra toast y refetchea. |
| RBAC bypass en UI | El botón se oculta por rol; además el backend rechaza con 403. Tests cubren ambos caminos. |
| Render performance con 500 rondas en vista Columnas | Limitar a 50 cards por columna (top N por `pending_at DESC`); si el filtro activo genera más, mostrar "Mostrando 50 de N — usá paginación en Lista". |
| Timezone en filtro `date` | Backend interpreta `date` como fecha local de la sucursal (`branch.timezone` — ya existe en C-07). Convierte a UTC para comparar contra `pending_at` UTC. Tests cubren edge case de medianoche. |
| Payload WS con IDs numéricos (backend) vs. strings (frontend) | Helper `_extractId` ya normaliza (mismo patrón de `kitchenDisplayStore`). Todos los handlers pasan por él. |

---

## Migration Plan

**Deploy order** (esta change es aditiva — no rompe contratos):

1. Backend primero: merge de `RoundAdminOutput`, `list_for_admin`, `GET /api/admin/rounds` → deploy.
2. Backend smoke test: `curl -H 'Authorization: Bearer X' 'http://api/admin/rounds?branch_id=1'` retorna 200.
3. Frontend Dashboard: merge de page, store, hook, API client, sidebar → deploy.
4. Smoke test Dashboard: loguear como MANAGER, abrir `/orders`, verificar lista + vista columnas + filtros.

**Rollback**:
- Backend: el endpoint es aditivo — revertir el commit deja el resto intacto. El PATCH de cancelación sigue disponible.
- Frontend: revertir el commit oculta `/orders` (slot vuelve a `disabled: true` en Sidebar).

**No hay migración de DB** — todo se construye sobre modelos existentes (Round, RoundItem, Table, BranchSector, Diner, TableSession). Cero cambios Alembic.

---

## Open Questions

1. **Sort configurable por el usuario en vista Lista** — ¿default `pending_at DESC` es suficiente o agregamos toggle por `updated_at DESC`? → **Default por ahora**; si se pide en feedback, backend agrega `sort_by` query param (trivial).
2. **Refresh manual** — ¿botón "Refrescar" explícito o solo auto-refresh por WS? → **Ambos**. Se agrega botón icono-refresh en el header (invoca `fetchRounds(currentFilters)`), útil para forzar re-sync cuando WS está caído (ya lo indica el `WebSocketStatus` component).
3. **Cancelación batch** — ¿permitir cancelar múltiples rondas con un solo action? → **Fuera de scope C-25**; backlog futuro si los operarios lo piden.
4. **Exportar CSV** — ¿útil para contabilidad? → **Fuera de scope C-25**; evaluar en epic de reporting.
