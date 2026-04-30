## 1. Models

- [x] 1.1 Create `backend/rest_api/models/sector.py` with `BranchSector` model: `id` (BigInteger PK), `branch_id` (FK to branch, ondelete RESTRICT), `name` (String 255), inherits `AuditMixin`. Table name `branch_sector`. Index on `branch_id`. Relationships: `tables` (1:N to Table), `assignments` (1:N to WaiterSectorAssignment).
- [x] 1.2 Add `Table` model to `sector.py`: `id` (BigInteger PK), `branch_id` (FK to branch, ondelete RESTRICT), `sector_id` (FK to branch_sector, ondelete RESTRICT), `number` (Integer), `code` (String 50), `capacity` (Integer), `status` (String 20, default "AVAILABLE"), inherits `AuditMixin`. Table name `app_table`. UniqueConstraint on `(branch_id, code)`. Indexes on `branch_id` and `sector_id`. Relationship: `sector` (N:1 to BranchSector).
- [x] 1.3 Add `WaiterSectorAssignment` model to `sector.py`: `id` (BigInteger PK), `user_id` (FK to app_user, ondelete RESTRICT), `sector_id` (FK to branch_sector, ondelete RESTRICT), `date` (Date, not nullable). Table name `waiter_sector_assignment`. UniqueConstraint on `(user_id, sector_id, date)`. Index on `(sector_id, date)`. Relationships: `user` (N:1 to User), `sector` (N:1 to BranchSector). No `AuditMixin` — ephemeral daily record.
- [x] 1.4 Register all 3 models in `backend/rest_api/models/__init__.py`. Add relationships to `Branch` model in `branch.py`: `sectors` (1:N to BranchSector), `tables` (1:N to Table).

## 2. Migration

- [x] 2.1 Create Alembic migration `backend/alembic/versions/005_sectors_tables.py`: depends on `004_ingredients_recipes_catalogs`. Create tables `branch_sector` (id, branch_id FK, name, is_active, created_at, updated_at), `app_table` (id, branch_id FK, sector_id FK, number, code, capacity, status, is_active, created_at, updated_at), `waiter_sector_assignment` (id, user_id FK, sector_id FK, date). Add UniqueConstraint `(branch_id, code)` on `app_table`, UniqueConstraint `(user_id, sector_id, date)` on `waiter_sector_assignment`. Add indexes. Include `upgrade()` and `downgrade()`.

## 3. Schemas

- [x] 3.1 Create `backend/rest_api/schemas/sector.py` with Pydantic models: `SectorCreate` (branch_id, name), `SectorUpdate` (name optional), `SectorResponse` (id, branch_id, name, is_active, created_at, updated_at). `TableCreate` (branch_id, sector_id, number, code, capacity), `TableUpdate` (number optional, code optional, capacity optional, status optional), `TableResponse` (all fields). `AssignmentCreate` (user_id, date), `AssignmentResponse` (id, user_id, sector_id, date, user details). `PublicBranchResponse` (id, name, address, slug).

## 4. Domain Services

- [x] 4.1 Create `backend/rest_api/services/domain/sector_service.py` with `SectorService` extending `BranchScopedService[BranchSector, SectorResponse]`. Override `_validate_create` to check branch exists and belongs to tenant. Override `_after_delete` to cascade soft-delete to all tables in the sector.
- [x] 4.2 Create `backend/rest_api/services/domain/table_service.py` with `TableService` extending `BranchScopedService[Table, TableResponse]`. Override `_validate_create` to: (a) verify sector exists, is active, and belongs to the same branch, (b) enforce code uniqueness within branch (query for existing active table with same code + branch_id, return 409 if found). Override `_validate_update` to enforce code uniqueness on code change.
- [x] 4.3 Add waiter assignment methods to `SectorService` (or create standalone): `create_assignment(db, sector_id, user_id, date, permission_ctx)` — verify user has WAITER role for the sector's branch, check no duplicate, create record. `list_assignments(db, sector_id, date, permission_ctx)` — return assignments for sector on given date with user details. `delete_assignment(db, assignment_id, permission_ctx)` — hard delete the assignment record.

## 5. Admin Sectors Router

- [x] 5.1 Create `backend/rest_api/routers/admin_sectors.py` with sector CRUD endpoints: `POST /api/admin/sectors` (ADMIN/MANAGER), `GET /api/admin/sectors` (with `branch_id` query param, pagination limit/offset), `GET /api/admin/sectors/{id}`, `PUT /api/admin/sectors/{id}` (ADMIN/MANAGER), `DELETE /api/admin/sectors/{id}` (ADMIN only). Use `current_user` dependency + `PermissionContext`.
- [x] 5.2 Add table CRUD endpoints to `admin_sectors.py` (or separate `admin_tables.py`): `POST /api/admin/tables`, `GET /api/admin/tables` (with `branch_id` + optional `sector_id` query params, pagination), `GET /api/admin/tables/{id}`, `PUT /api/admin/tables/{id}`, `DELETE /api/admin/tables/{id}`. Same RBAC pattern.
- [x] 5.3 Add waiter assignment endpoints: `POST /api/admin/sectors/{sector_id}/assignments` (ADMIN/MANAGER), `GET /api/admin/sectors/{sector_id}/assignments?date=YYYY-MM-DD` (ADMIN/MANAGER), `DELETE /api/admin/sectors/{sector_id}/assignments/{assignment_id}` (ADMIN/MANAGER).

## 6. Public Branches Router

- [x] 6.1 Create `backend/rest_api/routers/public_branches.py` with `GET /api/public/branches`: no authentication required. Query all branches where `is_active.is_(True)`, return list of `PublicBranchResponse` (id, name, address, slug). Return 200 with empty list if no active branches.

## 7. Router Registration

- [x] 7.1 Register `admin_sectors` router in `backend/rest_api/main.py` with prefix `/api/admin` and appropriate tags.
- [x] 7.2 Register `public_branches` router in `backend/rest_api/main.py` with prefix `/api/public` and appropriate tags.

## 8. Service Registration

- [x] 8.1 Update `backend/rest_api/services/domain/__init__.py` to export `SectorService` and `TableService`.

## 9. Tests

- [x] 9.1 Create `backend/tests/test_sectors_crud.py`: test BranchSector CRUD (create, read, update, soft-delete with cascade to tables). Test sector name update. Test that deleting a sector soft-deletes its tables.
- [x] 9.2 Add table CRUD tests to `backend/tests/test_tables_crud.py`: test Table create, read, update, soft-delete. Test code uniqueness within branch (409 on duplicate). Test same code allowed across branches. Test filtering by sector_id.
- [x] 9.3 Create `backend/tests/test_waiter_assignments.py`: test create assignment for today, test duplicate assignment rejection (409), test list assignments by date, test delete assignment (hard delete), test assigning non-WAITER user (422).
- [x] 9.4 Add multi-tenant isolation tests: verify tenant A cannot access tenant B sectors/tables. Test in `test_sectors_crud.py`.
- [x] 9.5 Add RBAC tests: ADMIN can do all operations, MANAGER can create/edit but not delete, KITCHEN/WAITER get 403 on all admin endpoints. Test in `test_sectors_crud.py`.
- [x] 9.6 Create `backend/tests/test_public_branches.py`: test public branches listing returns active branches only, test inactive branches excluded, test response shape (id, name, address, slug only), test empty list when no active branches.
