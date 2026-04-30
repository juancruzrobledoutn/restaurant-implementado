## ADDED Requirements

### Requirement: Seed runner supports `--full` flag for enriched demo dataset

The seed runner (`backend/rest_api/seeds/runner.py`) SHALL accept an optional `--full` command-line flag. When absent, the runner MUST behave exactly as today (tenant + branch + 4 users + sector + 3 tables + 5 products + 1 promotion + 1 waiter assignment). When present, the runner MUST execute the enriched seed (`seed_demo_full`) AFTER `seed_staff_management` and BEFORE the final `safe_commit(db)`, inside the same database transaction.

The flag parsing MUST use Python's standard `argparse` module. The runner MUST NOT accept unknown flags — invalid arguments SHALL cause `argparse` to exit with a non-zero code and a usage message.

#### Scenario: Run seed without flags (backwards-compatible default)
- **WHEN** `python -m rest_api.seeds.runner` is executed against a clean database
- **THEN** the runner SHALL produce the same result as today: 1 tenant, 1 branch, 4 users, 1 sector, 3 tables, 2 categories, 3 subcategories, 5 products, 1 promotion, 1 waiter assignment — and NO table sessions, rounds, checks, payments, service calls, or additional allergens

#### Scenario: Run seed with `--full` flag on a clean database
- **WHEN** `python -m rest_api.seeds.runner --full` is executed against a clean database
- **THEN** the runner SHALL first execute the base seed and then the enriched seed in the same transaction
- **AND** the database SHALL additionally contain 3 allergens, 2 extra categories, 2 extra subcategories, 5 extra products, the product-allergen links, 3 active or historical table sessions (2 active + 3 closed historical), their rounds and kitchen tickets, 1 check with a partial payment, and 2 service calls

#### Scenario: Unknown flag is rejected
- **WHEN** `python -m rest_api.seeds.runner --unknown-flag` is executed
- **THEN** `argparse` SHALL exit with a non-zero code without touching the database

---

### Requirement: `seed_demo_full` module lives at `backend/rest_api/seeds/demo_full.py`

The enriched seed SHALL be implemented as a single module `backend/rest_api/seeds/demo_full.py` exposing an async function `seed_demo_full(db: AsyncSession, tenant_id: int, branch_id: int) -> None`. The module MUST NOT call `db.commit()` directly — the caller (`runner.py`) owns the commit via `safe_commit(db)`.

All database access MUST use `.where(Model.is_active.is_(True))` for soft-delete filters — never `== True`. Every logger call MUST use `get_logger(__name__)` from `shared.config.logging` — never `print()` or the standard `logging` module directly.

#### Scenario: Module is independently importable
- **WHEN** `from rest_api.seeds.demo_full import seed_demo_full` is executed at import time
- **THEN** it SHALL import successfully without touching the database or loading fixtures

#### Scenario: Module never commits on its own
- **WHEN** `seed_demo_full(db, tenant_id, branch_id)` is called with a non-autocommit session and the caller does NOT commit
- **THEN** the inserted rows SHALL NOT be persisted (they SHALL be rolled back when the session closes)

---

### Requirement: Enriched seed is fully idempotent

Running `seed_demo_full` multiple times on the same database SHALL produce the same counts as running it once. The idempotency check for each entity MUST use a deterministic natural key:

| Entity | Natural key |
|--------|-------------|
| Allergen | `(tenant_id, name)` |
| Category | `(branch_id, name)` |
| Subcategory | `(category_id, name)` |
| Product | `(subcategory_id, name)` |
| BranchProduct | `(product_id, branch_id)` |
| ProductAllergen | `(product_id, allergen_id)` |
| TableSession (active) | `(table_id, status IN ('OPEN','PAYING'), is_active=True)` |
| Diner | `(session_id, name)` |
| Round | `(session_id, round_number)` |
| KitchenTicket | `(round_id)` |
| Check | `(session_id)` |

Entities without a unique natural key (Charge, Payment, Allocation, ServiceCall) SHALL be idempotent AT THE BLOCK LEVEL: if the parent check already has at least one charge, the entire billing block for that check is skipped; if the branch already has the 3 CLOSED historical sessions in the target date range, the historical block is skipped entirely.

#### Scenario: Second run does not duplicate entities
- **WHEN** `python -m rest_api.seeds.runner --full` is executed twice in a row
- **THEN** after the second run, the counts of allergens, categories, products, branch_products, product_allergens, table_sessions, rounds, round_items, kitchen_tickets, checks, charges, payments, allocations, and service_calls SHALL be identical to the counts after the first run

#### Scenario: Base seed run before `--full` is upgraded cleanly
- **WHEN** the runner is first invoked WITHOUT flags (base seed applied)
- **AND** then invoked again WITH `--full`
- **THEN** the base entities SHALL remain untouched and the enriched entities SHALL be added as if the base had just been run

---

### Requirement: Enriched seed creates 3 extra allergens in the demo tenant

`seed_demo_full` SHALL create exactly 3 `Allergen` rows in `tenant_id=1`:

| Name | is_mandatory | severity |
|------|--------------|----------|
| Gluten | true | moderate |
| Lácteos | true | moderate |
| Mariscos | true | severe |

Each allergen MUST have `is_active=True` and be idempotent by `(tenant_id, name)`.

#### Scenario: Allergens exist after `--full`
- **WHEN** the enriched seed completes
- **THEN** `SELECT name, severity, is_mandatory FROM allergen WHERE tenant_id=1 AND is_active=true ORDER BY name` SHALL return exactly the three rows described above

---

### Requirement: Enriched seed adds 2 categories with 5 products and allergen links

`seed_demo_full` SHALL create:

- Category `Entradas` (branch_id=1) with subcategory `Platos fríos` containing `Tostadas bruschetta` (price 650) and `Provoleta` (price 1200) and `Empanadas de carne` (price 900 — subcategory `Platos calientes`).
- Category `Postres` (branch_id=1) with subcategory `Dulces` containing `Flan mixto` (price 550) and `Langostinos al ajillo` (price 2800 — subcategory `Mariscos`).

Each product MUST have a `BranchProduct` entry in `branch_id=1` with `is_available=True` and `price_cents` equal to the product's base price. Each product MUST have the `ProductAllergen` links defined in design.md §D-04.

All prices SHALL be stored as integer cents (e.g., 650 = $6.50). NO float values SHALL be used.

#### Scenario: Extra products exist with branch pricing
- **WHEN** the enriched seed completes
- **THEN** `SELECT COUNT(*) FROM product WHERE subcategory_id IN (SELECT id FROM subcategory WHERE category_id IN (SELECT id FROM category WHERE branch_id=1 AND name IN ('Entradas','Postres')))` SHALL return 5
- **AND** each product SHALL have exactly one corresponding `BranchProduct` row in `branch_id=1`

#### Scenario: Product-allergen links cover contains and may_contain
- **WHEN** the enriched seed completes
- **THEN** `SELECT COUNT(*) FROM product_allergen WHERE presence_type='contains'` SHALL be >= 5
- **AND** `SELECT COUNT(*) FROM product_allergen WHERE presence_type='may_contain'` SHALL be >= 1

---

### Requirement: Enriched seed creates T01 session OPEN with rounds in two states

`seed_demo_full` SHALL create one active `TableSession` on table code `T01`:

- `status='OPEN'`, `is_active=True`, `branch_id=1`.
- 2 `Diner` rows linked to the session (`name='Juan'` and `name='María'`).
- `Round #1` with `status='SERVED'`, `round_number=1`, `created_by_role='DINER'`, ALL transition timestamps populated (`pending_at`, `confirmed_at`, `submitted_at`, `in_kitchen_at`, `ready_at`, `served_at`). `created_by_diner_id` references Juan. `confirmed_by_id`, `submitted_by_id` reference user id 1 (ADMIN demo).
- `Round #1` SHALL contain at least 2 `RoundItem` rows with `price_cents_snapshot` matching the current `BranchProduct.price_cents`.
- `Round #1` SHALL have a corresponding `KitchenTicket` with `status='DELIVERED'`, `started_at`, `ready_at` and `delivered_at` populated.
- `Round #2` with `status='IN_KITCHEN'`, `round_number=2`, `pending_at`, `confirmed_at`, `submitted_at`, `in_kitchen_at` populated, and `ready_at`, `served_at` NULL.
- `Round #2` SHALL contain at least 3 `RoundItem` rows.
- `Round #2` SHALL have a corresponding `KitchenTicket` with `status='IN_PROGRESS'`, `started_at` populated, and `ready_at`, `delivered_at` NULL.

The unique partial index `uq_table_session_active_per_table` MUST be respected — only one active session per table.

#### Scenario: T01 session exposes a served round and an in-kitchen round
- **WHEN** the enriched seed completes
- **THEN** a `SELECT s.status, COUNT(r.id) FROM table_session s JOIN round r ON r.session_id=s.id WHERE s.table_id=(SELECT id FROM app_table WHERE code='T01' AND branch_id=1) AND s.is_active=true GROUP BY s.status` SHALL return `(OPEN, 2)`
- **AND** there SHALL exist exactly one round with `status='SERVED'` and exactly one with `status='IN_KITCHEN'` on that session
- **AND** the `IN_KITCHEN` round SHALL have a `kitchen_ticket` row with `status='IN_PROGRESS'`

---

### Requirement: Enriched seed creates T02 session PAYING with partial payment

`seed_demo_full` SHALL create one active `TableSession` on table code `T02`:

- `status='PAYING'`, `is_active=True`, `branch_id=1`.
- 1 `Diner` (`name='Pedro'`).
- 1 `Round` with `status='SERVED'` and at least 2 `RoundItem` rows with a total of 4500 cents.
- 1 `Check` (`app_check` table) with `status='REQUESTED'`, `total_cents=4500`, `branch_id=1`, `tenant_id=1`.
- 1 `Charge` with `amount_cents=4500` linked to Pedro.
- 1 `Payment` with `status='APPROVED'`, `method='cash'`, `amount_cents=2000`.
- 1 `Allocation` with `amount_cents=2000` linking the payment to the charge.

The check MUST remain in `REQUESTED` (NOT promoted to `PAID`) because `SUM(allocations) = 2000 < charge.amount_cents = 4500`.

#### Scenario: T02 session has a partially paid check in REQUESTED
- **WHEN** the enriched seed completes
- **THEN** `SELECT c.status, c.total_cents, SUM(a.amount_cents) FROM app_check c JOIN charge ch ON ch.check_id=c.id LEFT JOIN allocation a ON a.charge_id=ch.id WHERE c.session_id=(SELECT id FROM table_session WHERE table_id=(SELECT id FROM app_table WHERE code='T02') AND is_active=true) GROUP BY c.status, c.total_cents` SHALL return `(REQUESTED, 4500, 2000)`

---

### Requirement: Enriched seed leaves T03 free (no active session)

`seed_demo_full` SHALL NOT create any `TableSession` row for table code `T03`. The third table MUST remain free so that the dev can exercise the "scan QR → open session" flow manually.

#### Scenario: T03 has no active session
- **WHEN** the enriched seed completes
- **THEN** `SELECT COUNT(*) FROM table_session WHERE table_id=(SELECT id FROM app_table WHERE code='T03' AND branch_id=1) AND is_active=true AND status IN ('OPEN','PAYING')` SHALL return 0

---

### Requirement: Enriched seed creates 2 service calls in distinct states

`seed_demo_full` SHALL create exactly 2 `ServiceCall` rows on the T01 session:

- 1 with `status='CREATED'`, `acked_at=NULL`, `closed_at=NULL`, `acked_by_id=NULL`, `closed_by_id=NULL`, `is_active=True`.
- 1 with `status='ACKED'`, `acked_at` populated, `acked_by_id` referencing user id 3 (WAITER demo), `closed_at=NULL`, `is_active=True`.

Both MUST have `branch_id=1`, `table_id` matching T01, and `session_id` matching the T01 OPEN session.

#### Scenario: Service calls cover CREATED and ACKED states
- **WHEN** the enriched seed completes
- **THEN** `SELECT status, COUNT(*) FROM service_call WHERE branch_id=1 AND is_active=true GROUP BY status ORDER BY status` SHALL return `[(ACKED, 1), (CREATED, 1)]`

---

### Requirement: Enriched seed creates 3 historical CLOSED sessions with paid checks

`seed_demo_full` SHALL create 3 `TableSession` rows on table code `T01` (same physical table as the OPEN session, different sessions) with the following properties:

- `status='CLOSED'`, `is_active=False` (closed sessions are soft-deleted per convention).
- `created_at` set to `now() - 1 day`, `now() - 2 days`, `now() - 3 days` (one session per day, computed in Python at seed time).
- 1 `Diner` per session.
- 1 `Round` per session with `status='SERVED'` and at least 1 `RoundItem`.
- 1 `Check` per session with `status='PAID'`, `total_cents` equal to the sum of the round items.
- 1 `Charge` per check with `amount_cents=total_cents`.
- 1 `Payment` per check with `status='APPROVED'`, `amount_cents=total_cents`. Methods SHALL alternate between `'cash'` and `'card'` across the 3 sessions.
- 1 `Allocation` per check linking payment to charge with `amount_cents=total_cents`. The check IS `PAID` because `SUM(allocations) = SUM(charges)`.

Idempotency for this block MUST check: if there are already >=3 `TableSession` rows on the target table with `status='CLOSED'` and `created_at` within `[now() - 4 days, now()]`, skip the entire block.

#### Scenario: Historical sessions feed the Sales page
- **WHEN** the enriched seed completes
- **THEN** `SELECT COUNT(*) FROM app_check WHERE status='PAID' AND branch_id=1 AND created_at >= now() - INTERVAL '4 days'` SHALL return exactly 3
- **AND** the 3 associated payments SHALL use at least 2 distinct payment methods

#### Scenario: Historical block is idempotent over the same day
- **WHEN** `python -m rest_api.seeds.runner --full` is executed twice on the same UTC day
- **THEN** the count of CLOSED sessions in the last 4 days SHALL remain 3 (not 6)

---

### Requirement: Enriched seed uses relative dates, never hard-coded calendar dates

Every timestamp for historical sessions, rounds, checks, payments and allocations SHALL be computed relative to `datetime.now(timezone.utc)` at seed execution time. No absolute calendar date (e.g., `date(2026, 4, 10)`) SHALL be used for these entities. The existing base seed's hard-coded dates for the promotion (`_PROMO_START_DATE`, `_PROMO_END_DATE`) are NOT affected by this requirement — they remain as-is.

#### Scenario: Historical timestamps drift with wall-clock time
- **WHEN** `seed_demo_full` is executed today and again 7 days later
- **THEN** the `created_at` of the enriched CLOSED sessions on the second run SHALL be within the last 4 days relative to that second run's execution time — NOT frozen at the dates from the first run

---

### Requirement: Enriched seed is documented in the backend README and knowledge-base

The documentation SHALL be updated:

- A "Seed data" section in `backend/README.md` (create the section if missing) describing both commands (`python -m rest_api.seeds.runner` and `... --full`), what each produces, and a warning that `--full` is for dev environments only.
- A new "Seed enriquecido (flag `--full`)" section at the bottom of `knowledge-base/07-anexos/08_seed_data_minimo.md` listing the additional entities created, the state of each session, and the natural keys used for idempotency.

#### Scenario: Backend README documents both commands
- **WHEN** a reader opens `backend/README.md`
- **THEN** there SHALL be a "Seed data" section containing the strings "python -m rest_api.seeds.runner" and "--full"

#### Scenario: Knowledge-base documents the enriched dataset
- **WHEN** a reader opens `knowledge-base/07-anexos/08_seed_data_minimo.md`
- **THEN** there SHALL be a section describing the `--full` flag, the additional allergens, the 3 table sessions in distinct states, the partial payment, and the historical CLOSED sessions

---

### Requirement: Enriched seed has pytest coverage for idempotency and counts

The test suite SHALL include `backend/tests/test_seeds_demo_full.py` with at least the following test cases:

- `test_seed_demo_full_runs_without_error`: calls `seed_demo_full` once and verifies no exception is raised.
- `test_seed_demo_full_is_idempotent`: calls `seed_demo_full` twice and asserts identical counts for allergens, categories, products, branch_products, product_allergens, table_sessions, rounds, round_items, kitchen_tickets, checks, charges, payments, allocations, and service_calls between run 1 and run 2.
- `test_seed_demo_full_covers_all_state_machines`: asserts that at least one row exists for `Round.status='SERVED'`, `Round.status='IN_KITCHEN'`, `TableSession.status='OPEN'`, `TableSession.status='PAYING'`, `TableSession.status='CLOSED'`, `Check.status='REQUESTED'`, `Check.status='PAID'`, `Payment.status='APPROVED'`, `ServiceCall.status='CREATED'`, `ServiceCall.status='ACKED'`.
- `test_seed_demo_full_historical_uses_relative_dates`: freezes time at `T`, runs the seed, verifies historical `created_at` values fall within `[T-4d, T]`.

Tests MUST use the async test infrastructure (`pytest-asyncio`) and the in-memory SQLite fixture from `backend/tests/conftest.py`.

#### Scenario: Idempotency test passes
- **WHEN** `pytest backend/tests/test_seeds_demo_full.py::test_seed_demo_full_is_idempotent` is executed
- **THEN** it SHALL pass without errors, asserting equal counts between the two runs

#### Scenario: State-coverage test passes
- **WHEN** `pytest backend/tests/test_seeds_demo_full.py::test_seed_demo_full_covers_all_state_machines` is executed
- **THEN** it SHALL pass, confirming the 10 required state combinations exist in the database
