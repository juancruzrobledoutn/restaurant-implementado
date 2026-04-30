## Why

The system has a complete menu catalog (C-04) and authentication stack (C-03), but no physical layout representation. Every order, session, and waiter assignment depends on sectors and tables existing in the database. Without C-07, there is no way to create table sessions (C-08), assign waiters to sectors (C-20 pwaWaiter), or route WebSocket events by sector. C-07 is on the critical path — it unblocks C-08 (table-sessions), which in turn unblocks the entire ordering and billing pipeline.

## What Changes

- **Models**: `BranchSector` (sector within a branch, e.g., "Terraza", "Salón principal"), `Table` (table name `app_table` — SQL reserved word, with alphanumeric code like "INT-01", capacity, status), `WaiterSectorAssignment` (daily assignment linking a user to a sector for a specific date).
- **Domain services**: `SectorService` extending `BranchScopedService` with cascade soft-delete to tables; `TableService` extending `BranchScopedService` with code uniqueness validation within branch and status management.
- **Admin CRUD endpoints**: `POST/GET/PUT/DELETE /api/admin/sectors` and `/api/admin/tables` — branch-scoped, paginated (`?limit=50&offset=0`), protected by JWT + `PermissionContext` (ADMIN/MANAGER create/edit, ADMIN delete).
- **Waiter sector assignment endpoints**: `POST/GET/DELETE /api/admin/sectors/{id}/assignments` — ADMIN/MANAGER assign waiters to sectors for a given date.
- **Public branches endpoint**: `GET /api/public/branches` — unauthenticated listing of active branches (used by pwaWaiter pre-login flow for branch selection before authentication).
- **Pydantic schemas**: Request/response models for sectors, tables, waiter assignments, and public branch listing.
- **Alembic migration 005**: Creates tables `branch_sector`, `app_table`, `waiter_sector_assignment` with FKs, indexes, and constraints.
- **Tests**: Sector and table CRUD, table code uniqueness per branch, daily waiter assignment creation/verification/cleanup, public branches endpoint, multi-tenant isolation.

## Capabilities

### New Capabilities
- `sectors-tables`: Branch sector and table management covering BranchSector/Table/WaiterSectorAssignment models, admin CRUD endpoints, daily waiter-to-sector assignment, and public branch listing for pwaWaiter pre-login flow.

### Modified Capabilities
_(none — no existing specs are modified by this change)_

## Impact

- **Backend files created**:
  - `backend/rest_api/models/sector.py` — BranchSector, Table, WaiterSectorAssignment models
  - `backend/rest_api/services/domain/sector_service.py` — SectorService
  - `backend/rest_api/services/domain/table_service.py` — TableService
  - `backend/rest_api/routers/admin_sectors.py` — admin CRUD router (sectors, tables, waiter assignments)
  - `backend/rest_api/routers/public_branches.py` — public branch listing endpoint
  - `backend/rest_api/schemas/sector.py` — Pydantic request/response schemas
  - `backend/alembic/versions/005_sectors_tables.py` — migration for sector/table/assignment tables
- **Backend files modified**:
  - `backend/rest_api/models/__init__.py` — register new models
  - `backend/rest_api/models/branch.py` — add relationships (sectors, tables)
  - `backend/rest_api/services/domain/__init__.py` — register new services
  - `backend/rest_api/main.py` — register new routers
- **Infrastructure dependencies**: PostgreSQL 16 (no new infra — Redis not needed for this change)
- **API surface**: ~12 new endpoints (CRUD sectors + CRUD tables + assignment management + public branches)
- **Downstream impact**: C-08 (table-sessions) creates TableSession referencing Table; C-20 (pwaWaiter-shell) consumes public branches endpoint and waiter assignments; C-13 (staff-management) may reference sector assignments
