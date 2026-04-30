## 1. Preparación

- [x] 1.1 Leer `.agents/SKILLS.md` e identificar todas las skills aplicables (al menos: `clean-architecture`, `python-testing-patterns`, `test-driven-development`); cargar cada SKILL.md antes de escribir código.
- [x] 1.2 Revisar el código existente como referencia: `backend/rest_api/seeds/demo_data.py` y `backend/rest_api/seeds/staff_management.py` (patrón get-or-create), `backend/rest_api/models/round.py`, `backend/rest_api/models/billing.py`, `backend/rest_api/models/service_call.py`, `backend/rest_api/models/kitchen_ticket.py`, `backend/rest_api/models/allergen.py` (campos y FKs exactas).

## 2. Tests primero (TDD)

- [x] 2.1 Crear `backend/tests/test_seeds_demo_full.py` con los 4 tests definidos en el spec (`test_seed_demo_full_runs_without_error`, `test_seed_demo_full_is_idempotent`, `test_seed_demo_full_covers_all_state_machines`, `test_seed_demo_full_historical_uses_relative_dates`). Reutilizar fixtures async de `conftest.py`. Los tests DEBEN fallar con `ImportError` o `AttributeError` porque el módulo todavía no existe — eso es el punto de partida.
- [x] 2.2 Agregar un test de `runner.py` (`backend/tests/test_seeds_runner.py` si no existe) que valide el parsing del flag `--full` con argparse y que `--flag-desconocido` termina con código distinto de 0 sin tocar la DB.

## 3. Implementación del módulo `demo_full.py`

- [x] 3.1 Crear `backend/rest_api/seeds/demo_full.py` con el esqueleto: `get_logger`, constantes del dataset (alérgenos, productos, precios en centavos), y la función `async def seed_demo_full(db, tenant_id, branch_id) -> None` que orquesta los 6 bloques privados (`_seed_extra_allergens`, `_seed_extra_menu`, `_seed_table_session_open`, `_seed_table_session_paying`, `_seed_service_calls`, `_seed_historical_sessions`). Respetar `.where(Model.is_active.is_(True))` y NUNCA `db.commit()`.
- [x] 3.2 Implementar `_seed_extra_allergens` (3 alérgenos idempotentes por `(tenant_id, name)`) y `_seed_extra_menu` (2 categorías + subcategorías + 5 productos + BranchProduct + ProductAllergen según la tabla del design §D-04).
- [x] 3.3 Implementar `_seed_table_session_open` (T01 OPEN + 2 Diners + Round #1 SERVED con KitchenTicket DELIVERED + Round #2 IN_KITCHEN con KitchenTicket IN_PROGRESS). Poblar TODOS los timestamps de transición y los campos de actor. Usar natural keys `(table_id, status IN ('OPEN','PAYING'))` para skip.
- [x] 3.4 Implementar `_seed_table_session_paying` (T02 PAYING + 1 Diner + Round SERVED + Check REQUESTED + Charge + Payment APPROVED parcial + Allocation). Verificar que `SUM(allocations) < total_cents` y que el check queda en REQUESTED.
- [x] 3.5 Implementar `_seed_service_calls` (1 CREATED + 1 ACKED en la sesión OPEN de T01). Idempotencia por `(session_id, status)`.
- [x] 3.6 Implementar `_seed_historical_sessions` (3 sesiones CLOSED con `created_at` relativo usando `datetime.now(timezone.utc) - timedelta(days=N)`, `is_active=False`, cada una con Round SERVED + Check PAID + Charge + Payment APPROVED + Allocation completo). Idempotencia por "bloque": si ya hay >=3 sesiones CLOSED en `[now()-4d, now()]` para la tabla, skip.

## 4. Integración en el runner

- [x] 4.1 Modificar `backend/rest_api/seeds/runner.py`: agregar parsing de `--full` con `argparse` en `main()`, pasar el bool a `run(full: bool)`, llamar `await seed_demo_full(db, tenant_id=tenant.id, branch_id=branch.id)` después de `seed_staff_management` y antes del `safe_commit(db)` cuando `full=True`. El comportamiento sin flag no debe cambiar.
- [x] 4.2 Verificar manualmente: (a) `python -m rest_api.seeds.runner` produce el mismo resultado que antes (counts intactos), (b) `python -m rest_api.seeds.runner --full` agrega el dataset nuevo, (c) correrlo 2 veces seguidas no duplica. (requiere entorno real con DB)

## 5. Documentación

- [x] 5.1 Actualizar `backend/README.md`: agregar sección "Seed data" con los dos comandos, qué produce cada uno, y un WARNING de que `--full` es solo para dev (nunca staging ni producción).
- [x] 5.2 Actualizar `knowledge-base/07-anexos/08_seed_data_minimo.md`: agregar al final una sección "Seed enriquecido (flag `--full`)" con el listado de entidades, los estados representados, y la tabla de natural keys del design §D-02.

## 6. Validación final

- [x] 6.1 Correr toda la suite backend: `cd backend && pytest tests/test_seeds_demo_full.py tests/test_seeds_runner.py -v`. Debe pasar todo en verde. Si hay lint (ruff/mypy configurado en el proyecto), correrlo y limpiar cualquier error en los archivos nuevos/modificados.
