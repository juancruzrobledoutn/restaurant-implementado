## Purpose

Enable administrators to organize restaurant spaces into sectors and tables, assign waiters to sectors daily, and provide a public API for branch discovery. This supports multi-location operations where each branch has distinct physical areas (sectors like "Terraza", "Comedor") with multiple tables per sector.

## Requirements

### Requirement: BranchSector model
The system SHALL store branch sectors with fields: `id` (BigInteger PK), `branch_id` (FK to branch), `name` (String 255), `is_active` (Boolean, default True), plus `AuditMixin` fields (`created_at`, `updated_at`). Table name: `branch_sector`. Index on `branch_id`.

#### Scenario: Create a sector for a branch
- **WHEN** a BranchSector record is created with `branch_id=1` and `name="Terraza"`
- **THEN** the record SHALL be persisted in `branch_sector` table with `is_active=True` and audit timestamps set

#### Scenario: Sector belongs to a branch
- **WHEN** querying sectors for a branch
- **THEN** the system SHALL filter by `branch_id` and `is_active.is_(True)`

---

### Requirement: Table model (app_table)
The system SHALL store tables with fields: `id` (BigInteger PK), `branch_id` (FK to branch), `sector_id` (FK to branch_sector), `number` (Integer), `code` (String 50, alphanumeric e.g. "INT-01"), `capacity` (Integer), `status` (String 20, default "AVAILABLE"), `is_active` (Boolean, default True), plus `AuditMixin` fields. Table name: `app_table`. UniqueConstraint on `(branch_id, code)`. Indexes on `branch_id` and `sector_id`.

#### Scenario: Create a table with alphanumeric code
- **WHEN** a Table record is created with `code="INT-01"`, `capacity=4`, `sector_id=1`, `branch_id=1`
- **THEN** the record SHALL be persisted in `app_table` with `status="AVAILABLE"` and `is_active=True`

#### Scenario: Table code uniqueness within branch
- **WHEN** a Table with `code="INT-01"` already exists for `branch_id=1`
- **AND** another Table with `code="INT-01"` is created for `branch_id=1`
- **THEN** the system SHALL reject the creation with a 409 Conflict error

#### Scenario: Same code allowed across different branches
- **WHEN** a Table with `code="INT-01"` exists for `branch_id=1`
- **AND** a Table with `code="INT-01"` is created for `branch_id=2`
- **THEN** the system SHALL accept the creation successfully

---

### Requirement: WaiterSectorAssignment model
The system SHALL store daily waiter-to-sector assignments with fields: `id` (BigInteger PK), `user_id` (FK to app_user), `sector_id` (FK to branch_sector), `date` (Date). Table name: `waiter_sector_assignment`. UniqueConstraint on `(user_id, sector_id, date)` to prevent duplicate assignments. Indexes on `sector_id, date` for lookup queries.

#### Scenario: Assign a waiter to a sector for today
- **WHEN** a WaiterSectorAssignment is created with `user_id=5`, `sector_id=2`, `date=2026-04-16`
- **THEN** the record SHALL be persisted in `waiter_sector_assignment`

#### Scenario: Prevent duplicate assignment
- **WHEN** a WaiterSectorAssignment already exists for `user_id=5`, `sector_id=2`, `date=2026-04-16`
- **AND** the same assignment is created again
- **THEN** the system SHALL reject with a 409 Conflict error

#### Scenario: Same waiter assigned to multiple sectors on same day
- **WHEN** a waiter is assigned to `sector_id=2` for `date=2026-04-16`
- **AND** the same waiter is assigned to `sector_id=3` for `date=2026-04-16`
- **THEN** the system SHALL accept both assignments (waiter covers multiple sectors)

---

### Requirement: Admin sector CRUD endpoints
The system SHALL provide admin CRUD endpoints for branch sectors at `/api/admin/sectors`. All endpoints MUST require JWT authentication. Create and update MUST be restricted to ADMIN and MANAGER roles with branch access. Delete MUST be restricted to ADMIN role only. List endpoint MUST support `branch_id` query parameter and pagination (`?limit=50&offset=0`).

#### Scenario: Create a sector
- **WHEN** an ADMIN sends `POST /api/admin/sectors` with `{"branch_id": 1, "name": "Terraza"}`
- **THEN** the system SHALL create the sector and return 201 with the sector data

#### Scenario: List sectors for a branch
- **WHEN** an authenticated user sends `GET /api/admin/sectors?branch_id=1&limit=50&offset=0`
- **THEN** the system SHALL return paginated sectors for that branch filtered by `is_active=True`

#### Scenario: Update a sector name
- **WHEN** an ADMIN sends `PUT /api/admin/sectors/{id}` with `{"name": "Terraza VIP"}`
- **THEN** the system SHALL update the sector name and return 200

#### Scenario: Delete a sector (soft delete with cascade)
- **WHEN** an ADMIN sends `DELETE /api/admin/sectors/{id}`
- **THEN** the system SHALL set `is_active=False` on the sector AND on all tables belonging to that sector

#### Scenario: MANAGER cannot delete sectors
- **WHEN** a MANAGER sends `DELETE /api/admin/sectors/{id}`
- **THEN** the system SHALL return 403 Forbidden

#### Scenario: KITCHEN/WAITER cannot access admin sector endpoints
- **WHEN** a KITCHEN or WAITER user sends any request to `/api/admin/sectors`
- **THEN** the system SHALL return 403 Forbidden

---

### Requirement: Admin table CRUD endpoints
The system SHALL provide admin CRUD endpoints for tables at `/api/admin/tables`. All endpoints MUST require JWT authentication. Create and update MUST be restricted to ADMIN and MANAGER roles with branch access. Delete MUST be restricted to ADMIN role only. List endpoint MUST support `branch_id` and optional `sector_id` query parameters and pagination (`?limit=50&offset=0`).

#### Scenario: Create a table
- **WHEN** an ADMIN sends `POST /api/admin/tables` with `{"branch_id": 1, "sector_id": 2, "number": 1, "code": "INT-01", "capacity": 4}`
- **THEN** the system SHALL create the table with `status="AVAILABLE"` and return 201

#### Scenario: Create a table with duplicate code in same branch
- **WHEN** an ADMIN sends `POST /api/admin/tables` with a code that already exists for that branch
- **THEN** the system SHALL return 409 Conflict

#### Scenario: List tables for a branch
- **WHEN** an authenticated user sends `GET /api/admin/tables?branch_id=1`
- **THEN** the system SHALL return paginated active tables for that branch

#### Scenario: List tables filtered by sector
- **WHEN** an authenticated user sends `GET /api/admin/tables?branch_id=1&sector_id=2`
- **THEN** the system SHALL return only tables belonging to that sector

#### Scenario: Update table details
- **WHEN** an ADMIN sends `PUT /api/admin/tables/{id}` with `{"capacity": 6, "code": "INT-01A"}`
- **THEN** the system SHALL update the table and return 200

#### Scenario: Delete a table (soft delete)
- **WHEN** an ADMIN sends `DELETE /api/admin/tables/{id}`
- **THEN** the system SHALL set `is_active=False` on the table

---

### Requirement: Waiter sector assignment management
The system SHALL provide endpoints to manage daily waiter-to-sector assignments at `/api/admin/sectors/{sector_id}/assignments`. ADMIN and MANAGER roles MUST be able to create and list assignments. ADMIN and MANAGER MUST be able to delete assignments. Assignments are hard-deleted (not soft-deleted) as they are ephemeral daily records.

#### Scenario: Assign a waiter to a sector for a date
- **WHEN** an ADMIN sends `POST /api/admin/sectors/{sector_id}/assignments` with `{"user_id": 5, "date": "2026-04-16"}`
- **THEN** the system SHALL create the assignment and return 201

#### Scenario: Assign a waiter who is not a WAITER role
- **WHEN** an ADMIN tries to assign a user who does not have the WAITER role for the sector's branch
- **THEN** the system SHALL return 422 with an error indicating the user must have WAITER role

#### Scenario: List assignments for a sector on a date
- **WHEN** an ADMIN sends `GET /api/admin/sectors/{sector_id}/assignments?date=2026-04-16`
- **THEN** the system SHALL return all assignments for that sector on that date, including user details

#### Scenario: Delete an assignment
- **WHEN** an ADMIN sends `DELETE /api/admin/sectors/{sector_id}/assignments/{assignment_id}`
- **THEN** the system SHALL hard-delete the assignment record and return 204

---

### Requirement: Public branches endpoint
The system SHALL provide `GET /api/public/branches` that returns a list of active branches without requiring authentication. The response MUST include only `id`, `name`, `address`, and `slug` for each active branch. This endpoint is used by pwaWaiter for branch selection before login.

#### Scenario: List active branches
- **WHEN** an unauthenticated client sends `GET /api/public/branches`
- **THEN** the system SHALL return 200 with a list of all branches where `is_active=True`
- **AND** each branch object SHALL contain only `id`, `name`, `address`, `slug`

#### Scenario: Inactive branches are excluded
- **WHEN** a branch has `is_active=False`
- **AND** a client sends `GET /api/public/branches`
- **THEN** the inactive branch SHALL NOT appear in the response

---

### Requirement: Multi-tenant isolation for sectors and tables
All sector and table queries MUST filter by `tenant_id` through the branch -> tenant FK chain. A user from tenant A MUST NOT be able to see, create, update, or delete sectors or tables belonging to tenant B.

#### Scenario: Tenant A cannot see tenant B sectors
- **WHEN** a user from tenant A sends `GET /api/admin/sectors?branch_id=X` where X belongs to tenant B
- **THEN** the system SHALL return 403 Forbidden (branch access check fails)

#### Scenario: Tenant A cannot create tables in tenant B branch
- **WHEN** a user from tenant A sends `POST /api/admin/tables` with `branch_id` belonging to tenant B
- **THEN** the system SHALL return 403 Forbidden

---

### Requirement: Alembic migration for sectors and tables
The system SHALL include Alembic migration 005 that creates tables `branch_sector`, `app_table`, and `waiter_sector_assignment` with all columns, foreign keys, indexes, and constraints. The migration MUST depend on migration 004. The `downgrade()` function MUST drop tables in reverse dependency order.

#### Scenario: Migration creates all tables
- **WHEN** `alembic upgrade head` is executed
- **THEN** tables `branch_sector`, `app_table`, and `waiter_sector_assignment` SHALL exist with all specified columns, FKs, and constraints

#### Scenario: Migration rollback
- **WHEN** `alembic downgrade` is executed from migration 005
- **THEN** tables `waiter_sector_assignment`, `app_table`, and `branch_sector` SHALL be dropped in that order
