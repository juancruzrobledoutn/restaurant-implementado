## Context

El sistema de seeds del backend vive en `backend/rest_api/seeds/` y es el punto de arranque de cualquier ambiente dev. Hoy consta de 4 módulos: `tenants.py`, `users.py`, `demo_data.py` (sector + mesas + menú básico) y `staff_management.py` (promoción + asignación de mozo), orquestados por `runner.py` dentro de una única `AsyncSession` con `safe_commit(db)` al final.

Cada módulo sigue el patrón **get-or-create idempotente**: antes de insertar una entidad, hace un `SELECT` con `is_active.is_(True)` y salta si ya existe. El criterio de match es siempre un natural key del dominio (`email` para users, `slug` para branches, `(tenant_id, name)` para promociones, `code` para mesas). Esto permite correr el runner infinitas veces sin duplicar datos.

Los changes archivados C-08 (`table-sessions`), C-10 (`rounds`), C-11 (`kitchen` + `service-calls`) y C-12 (`billing`) ya pusieron en producción los modelos operativos que este change necesita: `TableSession`, `Diner`, `Round`, `RoundItem`, `KitchenTicket`, `KitchenTicketItem`, `ServiceCall`, `Check` (tabla `app_check`), `Charge`, `Payment`, `Allocation`. Todos son navegables desde los routers existentes y tienen sus máquinas de estado bien documentadas en `knowledge-base/01-negocio/04_reglas_de_negocio.md` §2, §3, §5, §6, §7.

El spec actual `seed-data` sólo cubre los datos base (tenant + branch + 4 users). No hay requirements escritos para `demo_data.py` ni `staff_management.py` — esos se documentaron al archivar sus respectivos changes pero nunca se promovieron a requirements del spec `seed-data`. Este change agrega requirements NUEVOS al spec `seed-data` para el seed rico, sin romper los existentes.

### Constraints

- **Sin nuevas migraciones**: el change no crea tablas ni columnas. Reutiliza todo lo existente.
- **Sin touch al seed base**: `runner.py` sin flags debe seguir produciendo el mismo resultado que hoy. Sólo se agrega una rama condicional cuando `--full` está presente.
- **Idempotencia estricta**: correr `--full` 2, 5 o 100 veces debe dejar siempre los mismos counts. Los naturales keys para match son críticos.
- **No invocar Domain Services**: los servicios `RoundService.submit_round()`, `BillingService.request_check()`, etc. requieren `PermissionContext` (un usuario autenticado con `branch_ids`), escriben en la `outbox_event`, publican en Redis. Nada de eso tiene sentido durante un seed offline. El seed persiste **modelos directos** con los campos finales ya escritos (estado + timestamps de transición).
- **Multi-tenant**: todos los datos quedan en `tenant_id=1, branch_id=1` (el demo existente). Sin excepción.
- **Precios en centavos**: todos los `price_cents_snapshot`, `amount_cents`, `total_cents` son enteros.
- **SQL booleans**: `is_active.is_(True)`, nunca `== True`.
- **Commits**: el `runner.py` hace un único `safe_commit(db)` al final — los módulos nunca commitean por su cuenta.

## Goals / Non-Goals

**Goals:**

- Un comando (`python -m rest_api.seeds.runner --full`) deja el ambiente demo con **TODAS las máquinas de estado cubiertas por al menos un representante** — round en 2 estados, table session en 3 estados, check en 2 estados, payment en 1 estado, service call en 2 estados.
- La página "Ventas" del Dashboard muestra datos reales al abrir (3 sesiones PAID de días anteriores).
- Kitchen Display muestra al menos 1 ticket IN_PROGRESS sin necesidad de generar tráfico manual.
- pwaWaiter muestra 1 mesa con llamada de servicio sin resolver (parpadeo rojo) sin hacer nada.
- La prueba de alérgenos en pwaMenu se puede ejercitar (hay productos con `ProductAllergen.presence_type = contains` y `may_contain`).
- El runner base NO cambia de comportamiento para el usuario actual ni para CI.
- Tests pytest que garantizan idempotencia y counts exactos.

**Non-Goals:**

- **NO** reemplazar ni deprecar el seed base.
- **NO** agregar seeding de customers reales (pwaMenu), push subscriptions, recipes con BOM ni ingredientes detallados.
- **NO** generar fixtures de datos para tests automáticos — el test suite backend tiene sus fixtures propias (`conftest.py`).
- **NO** exponer el seed como endpoint HTTP.
- **NO** hacer seed de múltiples tenants/branches.
- **NO** agregar randomness o variación por run — el dataset es determinista y fijo.

## Decisions

### D-01 — Persistir modelos directos vs. invocar Domain Services

**Decisión**: El seed persiste instancias de los modelos SQLAlchemy directamente, con todos los campos de estado y timestamps poblados manualmente. NO llama a `RoundService.submit_round()`, `BillingService.request_check()`, ni a ningún Domain Service que requiera transiciones de estado.

**Rationale**:
- Los Domain Services piden `PermissionContext(user)` que requiere un JWT válido — no tiene sentido en un seed offline.
- Los servicios escriben en `outbox_event` y disparan publicaciones a Redis; el seed correría sin ws_gateway conectado y los eventos quedarían huérfanos o fallarían.
- El objetivo del seed es llegar a un **estado** determinado, no ejercitar los **caminos** que llevan a ese estado. Los tests de transición viven en el test suite, no acá.
- Persistir modelos directos con los campos correctamente poblados produce filas indistinguibles (desde el punto de vista del DB) de las que escribiría el service real.

**Alternativa considerada**: Llamar a los services con un "system user" mock (ADMIN virtual). Se descartó porque:
- Requiere montar el contexto de auth (crear JWT falso, bypass de rate limiting, etc.).
- Arrastra lógica de emisión de eventos que complica el debug del seed.
- Mezcla responsabilidades: el seed pasa de ser "data primer" a "end-to-end smoke test" — peor compromiso, no mejor.

**Implicancia**: los scripts de seed DEBEN conocer qué campos de estado y timestamps setear para cada máquina. Esto se vuelve documentación imperativa del contrato de estados, lo cual refuerza el spec.

### D-02 — Idempotencia por natural keys compuestas

**Decisión**: Cada inserción usa un par `(scope_key, entity_key)` como natural key para el get-or-create:

| Entidad | Natural key |
|---------|-------------|
| `Allergen` | `(tenant_id, name)` |
| `Category` (nueva) | `(branch_id, name)` |
| `Subcategory` | `(category_id, name)` |
| `Product` | `(subcategory_id, name)` |
| `BranchProduct` | `(product_id, branch_id)` |
| `ProductAllergen` | `(product_id, allergen_id)` (UniqueConstraint existente) |
| `TableSession` | `(table_id, is_active=True AND status IN ('OPEN','PAYING'))` para sesiones ACTIVAS; `(table_id, status='CLOSED', created_at date)` para historial |
| `Diner` | `(session_id, name)` |
| `Round` | `(session_id, round_number)` |
| `RoundItem` | `(round_id, product_id, diner_id)` |
| `KitchenTicket` | `(round_id)` (UniqueConstraint existente) |
| `Check` | `(session_id)` (UniqueConstraint existente) |
| `Charge` | `(check_id, diner_id, amount_cents)` (no hay natural key única — aceptamos idempotencia débil: si ya hay charges para el check, skip el bloque entero) |
| `Payment` | `(check_id, external_id)` cuando external_id está seteado; sino `(check_id, amount_cents, method)` |
| `Allocation` | `(charge_id, payment_id)` |
| `ServiceCall` | `(session_id, status, created_at date)` — el seed usa una fecha fija para poder matchear |

**Rationale**: el patrón ya está probado en `demo_data.py` y `staff_management.py`. Extenderlo a las entidades transaccionales requiere cuidado porque no todas tienen UniqueConstraint explícita. Donde no la hay, el seed usa **idempotencia por "bloque"**: si el padre ya tiene hijos, skip todo el bloque. Esto es válido porque el seed siempre produce el mismo dataset — si el padre ya existe con hijos, esos hijos fueron creados por una corrida previa del mismo seed.

**Alternativa considerada**: usar un marker table `seed_run` que registre los IDs generados por cada corrida. Se descartó porque:
- Agrega una tabla sólo para el seed — over-engineering para un tool de DX.
- Confunde la línea entre data real y data del seed.

### D-03 — Snapshot de tiempos históricos

**Decisión**: las 3 sesiones CLOSED de historial usan `created_at` **relativo a `now()`**: `now() - 1 day`, `now() - 2 days`, `now() - 3 days`. Los `Charge`, `Payment`, `Allocation` y `Round` asociados comparten la misma base temporal (con offsets menores en horas para realismo).

**Rationale**:
- La página de Ventas filtra por rango de fechas. Si el seed usara fechas fijas (ej: 2026-04-10), tras unas semanas el histórico queda fuera del rango default y el seed pierde utilidad.
- Usar deltas relativos mantiene el seed útil a lo largo del tiempo.

**Implementación**: SQLAlchemy permite `created_at=text("NOW() - INTERVAL '1 day'")` en el model insert, o calcular en Python con `datetime.now(timezone.utc) - timedelta(days=1)`. Elegimos **Python**: el runner es `asyncio` con `await db.flush()` intercalados y el driver asyncpg pasa los datetimes sin conversión — más simple y portable (SQLite usado en tests no soporta `INTERVAL`).

**Trade-off**: el match por `created_at date` para idempotencia se vuelve frágil si el runner corre justo al filo de medianoche UTC (corrida 1 a las 23:58, corrida 2 a las 00:03 — dos "días" distintos). **Mitigación**: el matcher usa el rango `[now()-3d, now()-1d]` con `table_id` + `status='CLOSED'` y, si encuentra al menos 3 sesiones CLOSED en el rango para el branch, skip el bloque entero.

### D-04 — Scoping de alérgenos

**Decisión**: los 3 alérgenos (Gluten, Lácteos, Mariscos) se crean en `tenant_id=1` con `is_mandatory=True, severity='severe'` para Mariscos y `moderate` para los otros. La vinculación a productos se hace vía `ProductAllergen` con combinaciones explícitas:

| Producto (nuevo) | Alérgeno | presence_type | risk_level |
|------------------|----------|---------------|------------|
| Tostadas bruschetta | Gluten | contains | moderate |
| Tostadas bruschetta | Lácteos | may_contain | mild |
| Provoleta | Lácteos | contains | moderate |
| Empanadas de carne | Gluten | contains | moderate |
| Flan mixto | Lácteos | contains | moderate |
| Langostinos al ajillo | Mariscos | contains | severe |

**Rationale**: cubre los 3 `presence_type` relevantes (`contains`, `may_contain`) y los 3 `risk_level` (mild, moderate, severe). El comensal en pwaMenu puede ejercitar el filtro estricto y el muy estricto.

**Non-goal**: `free_from` NO se seedea porque no aporta a la UX de filtrado (un `free_from` es neutro).

### D-05 — Estructura de T01 OPEN (2 rondas en estados distintos)

**Decisión**:

1. `TableSession(table_id=T01, status='OPEN', branch_id=1)`.
2. 2 `Diner`: "Juan" y "María" asociados a la session.
3. `Round #1` (pending_at, confirmed_at, submitted_at, in_kitchen_at, ready_at, served_at TODOS poblados, status=`SERVED`, 2 `RoundItem` con price_cents_snapshot, 1 `KitchenTicket` status=`DELIVERED` con sus KitchenTicketItem).
4. `Round #2` (pending_at, confirmed_at, submitted_at, in_kitchen_at poblados; ready_at=NULL, served_at=NULL, status=`IN_KITCHEN`, 3 `RoundItem`, 1 `KitchenTicket` status=`IN_PROGRESS`).
5. `created_by_role='DINER'` y `created_by_diner_id=Juan.id` (según mi regla §2.11: el diner creó, el waiter confirmó, admin/manager envió a cocina, etc — todos los campos de actor van poblados a `User.id=1` (ADMIN demo) para los roles staff).

**Rationale**: demuestra en una sola mesa los dos estados más interesantes de la UI (SERVED visible a todos, IN_KITCHEN visible a cocina).

### D-06 — Estructura de T02 PAYING (check parcialmente pagado)

**Decisión**:

1. `TableSession(table_id=T02, status='PAYING')`.
2. 1 `Diner`: "Pedro".
3. `Round #1` (SERVED, 2 items, total 4500 cents).
4. `Check(session_id=T02.session_id, status='REQUESTED', total_cents=4500)`.
5. `Charge(check_id, diner_id=Pedro, amount_cents=4500, description='Total mesa')` — un solo charge simple (split "partes iguales" con 1 diner).
6. `Payment(check_id, amount_cents=2000, method='cash', status='APPROVED')`.
7. `Allocation(charge_id, payment_id, amount_cents=2000)` — FIFO aplicado al único charge.
8. Remaining: 4500 - 2000 = 2500 cents sin cubrir → check queda en `REQUESTED` (NO pasa a `PAID`).

**Rationale**: permite probar el flujo "completar el pago" en pwaMenu/pwaWaiter sin tener que reproducir la apertura de la mesa + pedido + request check + primer pago. El `Check` en REQUESTED con payment parcial es el estado menos común y el más molesto de reproducir manualmente.

### D-07 — Historial (3 sesiones CLOSED)

**Decisión**: las 3 sesiones históricas se asocian a T01 (table_id=1) con `created_at` = now()-1d, -2d, -3d. Cada una tiene:

- 1 `Diner` ("Histórico N").
- 1 `Round` SERVED con 1-3 items.
- 1 `Check` PAID (total_cents = suma de round items).
- 1 `Charge` amount_cents = total.
- 1 `Payment` APPROVED amount_cents = total, method='card' o 'cash' alternando.
- 1 `Allocation` amount_cents = total (check queda en PAID automáticamente porque `SUM(allocations) == SUM(charges)`).
- `TableSession.status = 'CLOSED'`, `is_active=False` (cerrada + soft-delete según convención de CLOSED sessions).

**Rationale**: la página de Ventas del Dashboard consulta `Check.status='PAID'` + un rango de fechas. Estos 3 rows dan 3 ventas en 3 fechas distintas y con 2 métodos de pago — suficiente para validar breakdown por método, por día, y por rango.

### D-08 — Flag `--full` en el runner

**Decisión**: el parsing se hace con `argparse` estándar en `main()`. El flag es `--full` (store_true). Cuando está presente, `run()` invoca `seed_demo_full(db, tenant_id, branch_id)` DESPUÉS de `seed_staff_management` y ANTES del `safe_commit` final. La ejecución sigue siendo una única transacción.

**Alternativa considerada**: variable de entorno `SEED_FULL=1`. Se descartó porque la flag es más explícita y más cómoda en documentación (`python -m rest_api.seeds.runner --full`).

### D-09 — Logging estructurado

**Decisión**: cada función `_seed_*` del módulo `demo_full.py` loggea con `logger.info("seed: <accion> <entidad> id=%s ...", ...)` siguiendo el formato de `demo_data.py`. El resumen final en `seed_demo_full` loggea los counts:

```python
logger.info(
    "seed: demo_full complete — sessions=%d rounds=%d checks=%d payments=%d service_calls=%d",
    ...
)
```

**Rationale**: consistencia con los otros seed modules, facilita debug.

### D-10 — Layout del módulo `demo_full.py`

**Decisión**: un único archivo con funciones privadas por bloque, orquestadas por `seed_demo_full`:

```python
async def seed_demo_full(db, tenant_id, branch_id) -> None:
    await _seed_extra_allergens(db, tenant_id=tenant_id)
    await _seed_extra_menu(db, branch_id=branch_id, tenant_id=tenant_id)
    await _seed_table_session_open(db, branch_id=branch_id)      # T01
    await _seed_table_session_paying(db, branch_id=branch_id)    # T02
    await _seed_service_calls(db, branch_id=branch_id)
    await _seed_historical_sessions(db, branch_id=branch_id, tenant_id=tenant_id)
```

**Rationale**: una función por bloque semántico; cada una es independientemente reejecutable. No se particiona en múltiples archivos porque el dominio del módulo es "dataset demo" — separar en 6 archivos sería over-engineering.

## Risks / Trade-offs

- **Riesgo**: idempotencia débil en `Charge`/`Payment`/`Allocation` (no tienen UniqueConstraint universales). → **Mitigación**: el matcher trabaja por bloque (si el `Check` ya tiene charges, skip todo el bloque de billing para ese check).
- **Riesgo**: el match de historial por `created_at` date puede duplicar rows si el runner corre a caballo de medianoche UTC. → **Mitigación**: el matcher cuenta sesiones CLOSED en el rango `[now()-3d, now()-1d]`; si ya hay >=3 sesiones para la tabla objetivo, skip el bloque completo.
- **Riesgo**: un cambio futuro en el modelo (ej: agregar columna NOT NULL a `Round`) rompe el seed silenciosamente. → **Mitigación**: los tests `test_seeds_demo_full.py` corren en CI y detectan cualquier mismatch de modelo.
- **Riesgo**: el seed `--full` se corre accidentalmente contra una DB de producción. → **Mitigación**: el tenant/branch hardcodeados son el demo — no toca datos reales. El `README.md` advierte que `--full` es sólo para dev. **NO hay chequeo de `ENV=production` en el seed** porque el seed base también debería proteger y no lo hace — agregar esa guard sale del scope de este change.
- **Trade-off**: el histórico usa fechas relativas (`now() - Nd`) → re-correr el mismo día no duplica, pero re-correr al día siguiente genera nuevas 3 sesiones para el día nuevo + las viejas. **Decisión**: aceptar ese drift — es la semántica correcta (siempre hay "los últimos 3 días" con historial).
- **Trade-off**: los tests de idempotencia usan SQLite (no Postgres) vía `conftest.py`. Algunos CHECK constraints y partial indexes no se crean igual. **Mitigación**: los tests no dependen de partial indexes, sólo de counts exactos. Los tests de integración con Postgres se cubren al corrrer el seed en CI de dev (fuera de scope para este change).

## Migration Plan

No aplica — el change no toca DB schema ni datos de producción. El runner base sigue funcionando idéntico; el flag `--full` es opt-in y sólo se corre en dev.

**Rollback**: si el módulo `demo_full.py` introduce un bug, basta revertir el commit y correr el runner base. Ningún dato previo del seed base se pierde porque el seed nuevo sólo AGREGA.

## Open Questions

- ¿El dataset del flag `--full` debería ser idempotente **entre versiones del seed**? Es decir, si v2 del seed agrega un producto más y corremos `--full` contra una DB con v1 ya seeded, ¿qué pasa? → **Resolución propuesta**: idempotencia intra-versión. Entre versiones, el seed simplemente AGREGA lo nuevo (los get-or-create detectan los faltantes). Se documenta en el README del backend.
- ¿Hace falta un flag `--reset` que haga `TRUNCATE` de las tablas operativas antes de correr? → **Resolución propuesta**: NO en este change. Si un dev quiere reset, puede correr `alembic downgrade base && alembic upgrade head` y volver a correr `--full`. Agregar `--reset` sale del scope.
