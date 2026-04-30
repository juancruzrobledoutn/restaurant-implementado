# Backend — Integrador / Buen Sabor

Python 3.12 + FastAPI 0.115 + SQLAlchemy 2.0. Port `8000`.

## Quick start

```bash
cd backend
pip install -r requirements.txt
alembic upgrade head
python -m rest_api.seeds.runner
uvicorn rest_api.main:app --reload --port 8000
```

## Seed data

The seed runner creates the minimum dataset needed to run the application in dev mode.

### Base seed (safe for any environment)

```bash
cd backend
python -m rest_api.seeds.runner
```

Creates:
- Tenant: "Demo Restaurant"
- Branch: "Sucursal Central" (slug: `demo`)
- 4 Users: `admin@demo.com`, `manager@demo.com`, `waiter@demo.com`, `kitchen@demo.com`
- Sector "Salón principal" with 3 tables (T01, T02, T03)
- Basic menu: 2 categories, 3 subcategories, 5 products
- Demo promotion + waiter sector assignment

### Rich demo seed (DEV ONLY)

> **WARNING**: Never run `--full` against staging or production. This flag seeds
> operational state (open sessions, payments, service calls) that would corrupt
> a real environment.

```bash
cd backend
python -m rest_api.seeds.runner --full
```

Additionally creates (on top of the base seed):
- 3 allergens: Gluten, Lácteos, Mariscos — with `ProductAllergen` links
- 2 new categories + 5 new products (with allergen presence_type coverage)
- **T01 OPEN**: 2 diners (Juan, María), Round #1 SERVED, Round #2 IN_KITCHEN
- **T02 PAYING**: 1 diner (Pedro), Round SERVED, Check REQUESTED with partial payment (2000/4500 cents)
- **2 service calls** on T01: 1 ACKED, 1 CREATED (shows red badge in pwaWaiter)
- **3 historical CLOSED sessions** on T01 (relative dates: -1d, -2d, -3d) with PAID checks

State machines covered:
| Entity | States |
|--------|--------|
| TableSession | OPEN, PAYING, CLOSED |
| Round | IN_KITCHEN, SERVED |
| KitchenTicket | IN_PROGRESS, DELIVERED |
| ServiceCall | CREATED, ACKED |
| Check | REQUESTED, PAID |
| Payment | APPROVED |

Both commands are idempotent — safe to run multiple times without duplicating data.

**Idempotency between seed versions**: if a newer version of `--full` adds entities,
re-running it will add only the missing ones (get-or-create pattern). It will not
remove or modify entities from a previous run.

## Running tests

```bash
cd backend
pytest
```

The test suite uses in-memory SQLite (via `conftest.py`). No database connection needed.
