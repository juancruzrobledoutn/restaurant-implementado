## Why

El seed actual (`python -m rest_api.seeds.runner`) crea sólo los mínimos operativos (tenant, branch, 4 usuarios, 1 sector, 3 mesas, 5 productos, 1 promoción). Ese set está bien para que los tests automáticos arranquen y para smoke tests, pero deja las pantallas de Dashboard y pwaWaiter VACÍAS cuando un dev o QA quiere probar el flujo operativo a mano: Kitchen Display sin tickets, página de Ventas sin historial, mesas todas libres, sin llamadas de servicio pendientes, sin alérgenos vinculados.

El resultado es que cada dev/QA tiene que reproducir manualmente una operación completa (mesa abierta, ronda en cocina, otra pagando, sesiones cerradas con pagos) antes de poder testear una página. Esto quema tiempo, produce datasets inconsistentes entre ambientes y arrastra bugs de "no puedo reproducir" porque nadie tiene el mismo estado local.

Este change agrega un seed "rico" OPCIONAL (flag `--full`) que deja el ambiente demo en un estado operativo realista — todas las máquinas de estado con representantes — para que cualquier dev levante el stack y en 5 segundos tenga datos suficientes para testear Dashboard, pwaWaiter y pwaMenu end-to-end.

## What Changes

- **Nuevo módulo** `backend/rest_api/seeds/demo_full.py` — extiende el seed base sin reemplazarlo. Idempotente (get-or-create) como el resto del sistema de seeds.
- **Nueva flag `--full` en el runner**: `python -m rest_api.seeds.runner` sigue creando sólo lo mínimo (comportamiento actual intacto). `python -m rest_api.seeds.runner --full` ejecuta primero el seed base y después `seed_demo_full()` dentro de la misma transacción.
- **2 categorías adicionales** del menú: "Entradas" y "Postres", cada una con su subcategoría y productos.
- **5 productos adicionales** con `BranchProduct` y `ProductAllergen` vinculados a 3 alérgenos (gluten, lácteos, mariscos) cubriendo los `presence_type` (`contains`, `may_contain`) y `risk_level` distintos.
- **3 alérgenos tenant-scoped**: Gluten, Lácteos, Mariscos (idempotentes por `(tenant_id, name)`).
- **3 `TableSession` en estados distintos**:
  - **T01 OPEN**: 2 `Diner`, 1 `Round` en `SERVED` (con `KitchenTicket.DELIVERED`) + 1 `Round` en `IN_KITCHEN` (con `KitchenTicket.IN_PROGRESS`). Precios capturados en `price_cents_snapshot`.
  - **T02 PAYING**: 1 `Diner`, 1 `Round` `SERVED`, 1 `Check` `REQUESTED` con sus `Charge`, 1 `Payment` `APPROVED` parcial con su `Allocation` FIFO. El check queda sin cubrir 100% para que se pueda terminar de pagar en UI.
  - **T03**: libre (sin `TableSession` — explícito, verificado).
- **2 `ServiceCall`**: 1 `CREATED` (sin resolver, fuerza el parpadeo rojo en pwaWaiter) y 1 `ACKED` (acusada sin cerrar).
- **Historial de 3 sesiones `CLOSED`** de días anteriores (1, 2 y 3 días atrás) con `Check` en estado `PAID`, `Charge`, `Payment APPROVED` y `Allocation` completa — para que la página de Ventas del Dashboard tenga datos reales.
- **Documentación**: actualizar `knowledge-base/07-anexos/08_seed_data_minimo.md` (seed base + seed rico) y agregar sección "Seed data" al `README.md` del backend con los comandos y qué genera cada flag.
- **Tests**: suite pytest `backend/tests/test_seeds_demo_full.py` que valida (a) idempotencia (correr `seed_demo_full` 2 veces deja los mismos counts) y (b) conteos exactos post-seed por entidad y por estado.

### Máquinas de estado respetadas

El seed NO invoca los Domain Services para transicionar estados (no hay HTTP ni auth en el seed runner). En cambio, persiste DIRECTAMENTE los modelos con los campos de estado y timestamps de transición que los servicios habrían escrito (ej: un `Round` `SERVED` tiene `pending_at`, `confirmed_at`, `submitted_at`, `in_kitchen_at`, `ready_at` y `served_at` poblados). Esta decisión se documenta en `design.md` — los datos resultantes son indistinguibles de los que producirían las transiciones reales vía service.

## Capabilities

### New Capabilities
<!-- ninguna — este change extiende un spec existente -->

### Modified Capabilities
- `seed-data`: agrega requirements nuevos para el seed enriquecido (flag `--full`, módulo `demo_full.py`, datasets por estado). El comportamiento actual del seed base NO cambia — sigue siendo el default sin flags.

## Impact

- **Código backend**:
  - Nuevo: `backend/rest_api/seeds/demo_full.py`
  - Modificado: `backend/rest_api/seeds/runner.py` (parsing de flag `--full`, llamada condicional a `seed_demo_full`)
  - Nuevo: `backend/tests/test_seeds_demo_full.py`
- **Documentación**:
  - Modificado: `knowledge-base/07-anexos/08_seed_data_minimo.md` (nueva sección "Seed enriquecido")
  - Nuevo o modificado: `backend/README.md` (sección "Seed data" — instrucciones de uso)
- **Runtime**: ningún cambio en endpoints REST, WebSocket, Dashboard, pwaMenu, pwaWaiter ni migraciones. El seed es una herramienta de DX pura.
- **CI/CD**: ningún change. El seed `--full` NO se ejecuta en CI ni en producción — es exclusivamente para ambientes dev locales.
- **Seguridad**: sin impacto — el seed usa el mismo tenant_id/branch_id demo existente y no introduce usuarios ni credenciales nuevas.
- **Performance**: sin impacto en runtime. El seed `--full` toma ~1-2 segundos más que el base.
- **Governance**: BAJO — es tooling para DX, no toca lógica de negocio. Autonomía total si los tests pasan.
- **Dependencias**: C-16 archivado (necesita los modelos de `TableSession`, `Round`, `KitchenTicket`, `Check`, `Payment`, `Allocation`, `ServiceCall`, `Allergen`, `ProductAllergen` — todos ya existen).

### Non-goals
- **NO** se agregan nuevos endpoints de API para triggerar seed desde HTTP (sigue siendo CLI-only).
- **NO** se integra al CI pipeline ni a fixtures de tests automáticos — los tests backend siguen usando sus fixtures propias, no este seed.
- **NO** se modifica el seed base (`seed_demo_data`, `seed_staff_management`) — este change SÓLO agrega; la compatibilidad con `python -m rest_api.seeds.runner` sin flags es total.
- **NO** se crean nuevos modelos SQLAlchemy ni migraciones Alembic.
- **NO** se agregan datos para pwaMenu diners reales (customers), push subscriptions ni recipes/ingredients con BOM — fuera de scope.
- **NO** se seedean datos en otros tenants o branches — todo sigue en `tenant_id=1, branch_id=1`.
