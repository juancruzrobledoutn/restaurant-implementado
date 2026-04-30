## ADDED Requirements

### Requirement: Seed runner creates minimum development data

The seed runner (`backend/rest_api/seeds/runner.py`) SHALL be executable via `python -m rest_api.seeds.runner` and SHALL create: 1 Tenant, 1 Branch, 4 Users (ADMIN, MANAGER, WAITER, KITCHEN) with their corresponding UserBranchRole entries.

#### Scenario: Run seed on empty database
- **WHEN** `python -m rest_api.seeds.runner` is executed against an empty database (after migration 001)
- **THEN** the database SHALL contain exactly 1 tenant, 1 branch, 4 users, and 4 user_branch_role records

#### Scenario: Run seed is idempotent
- **WHEN** `python -m rest_api.seeds.runner` is executed twice
- **THEN** the second run SHALL NOT create duplicates; it SHALL skip existing records (matched by email for users, slug for branches)

### Requirement: Seed tenant data matches specification

The seed SHALL create a Tenant with `id=1`, `name="Demo Restaurant"`, `is_active=True`.

#### Scenario: Verify tenant data
- **WHEN** the seed completes
- **THEN** `SELECT * FROM app_tenant WHERE id=1` SHALL return a row with `name="Demo Restaurant"` and `is_active=true`

### Requirement: Seed branch data matches specification

The seed SHALL create a Branch with `id=1`, `tenant_id=1`, `name="Sucursal Central"`, `address="Av. Corrientes 1234, Buenos Aires"`, `slug="demo"`, `is_active=True`.

#### Scenario: Verify branch data
- **WHEN** the seed completes
- **THEN** `SELECT * FROM branch WHERE id=1` SHALL return a row matching all specified field values

### Requirement: Seed creates four users with correct roles

The seed SHALL create 4 users with the following data:

| id | email | full_name | role |
|----|-------|-----------|------|
| 1 | admin@demo.com | Admin Demo | ADMIN |
| 2 | manager@demo.com | Manager Demo | MANAGER |
| 3 | waiter@demo.com | Waiter Demo | WAITER |
| 4 | kitchen@demo.com | Kitchen Demo | KITCHEN |

All users SHALL have `tenant_id=1`, `is_active=True`, and a bcrypt-hashed password. Each user SHALL have exactly one `UserBranchRole` entry linking them to `branch_id=1`.

#### Scenario: Verify admin user and role
- **WHEN** the seed completes
- **THEN** `app_user` SHALL contain a row with `email="admin@demo.com"` and `user_branch_role` SHALL contain `(user_id=1, branch_id=1, role="ADMIN")`

#### Scenario: Verify all four roles are assigned
- **WHEN** the seed completes
- **THEN** `user_branch_role` SHALL contain exactly 4 rows, one for each role: ADMIN, MANAGER, WAITER, KITCHEN

### Requirement: Seed passwords use bcrypt hashing

Each seed user's `hashed_password` SHALL be a valid bcrypt hash of their respective plaintext password (`admin123`, `manager123`, `waiter123`, `kitchen123`). The hashing MAY use a pre-computed hash string to avoid a runtime dependency on passlib in C-02.

#### Scenario: Stored password is a valid bcrypt hash
- **WHEN** the seed creates user `admin@demo.com` with password `admin123`
- **THEN** `hashed_password` SHALL start with `$2b$` and be verifiable by any bcrypt implementation

### Requirement: Seed module structure is modular

The seed SHALL be organized in `backend/rest_api/seeds/` with separate modules: `runner.py` (entry point), `tenants.py` (tenant + branch creation), `users.py` (users + roles creation).

#### Scenario: Seed modules are independently importable
- **WHEN** `from rest_api.seeds.tenants import seed_tenants` is called
- **THEN** it SHALL import successfully without side effects
