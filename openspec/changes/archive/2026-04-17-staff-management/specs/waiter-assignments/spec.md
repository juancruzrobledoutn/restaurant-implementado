## ADDED Requirements

### Requirement: WaiterAssignmentService for daily assignments
The system SHALL provide a `WaiterAssignmentService` that manages `WaiterSectorAssignment` rows (model defined in change C-07). The service MUST provide methods to create an assignment, list assignments by `(date, sector_id)` or `(date, branch_id)`, delete an assignment, and verify if a specific user has an assignment for a branch on a specific date.

#### Scenario: Create a daily assignment
- **WHEN** `WaiterAssignmentService.create(user_id=5, sector_id=2, date=date.today())` is called
- **THEN** the service SHALL insert a `WaiterSectorAssignment` row and `safe_commit(db)`

#### Scenario: Unique constraint prevents duplicates
- **WHEN** a `WaiterSectorAssignment(user_id=5, sector_id=2, date=2026-04-17)` already exists
- **AND** the service attempts to create the same row again
- **THEN** the service SHALL raise `ConflictError` mapped to HTTP 409

#### Scenario: verify_for_branch returns matching assignment
- **WHEN** `WaiterAssignmentService.verify_for_branch(user_id=5, branch_id=1, target_date=date.today())` is called
- **AND** the user has a `WaiterSectorAssignment` with `date=today()` in a sector of branch 1
- **THEN** the service SHALL return `{assigned: True, sector_id, sector_name}`

#### Scenario: verify_for_branch returns negative when not assigned
- **WHEN** `WaiterAssignmentService.verify_for_branch(user_id=5, branch_id=1, target_date=date.today())` is called
- **AND** the user has NO `WaiterSectorAssignment` for today in branch 1
- **THEN** the service SHALL return `{assigned: False}`

---

### Requirement: Admin waiter-assignments CRUD endpoints
The system SHALL expose admin endpoints under `/api/admin/waiter-assignments` requiring JWT and `PermissionContext.require_management()` (ADMIN or MANAGER with branch access). Delete MUST also be allowed for MANAGER on their branches (operational need: reassign during shift).

#### Scenario: Create assignment
- **WHEN** an ADMIN sends `POST /api/admin/waiter-assignments` with `{user_id: 5, sector_id: 2, date: "2026-04-17"}`
- **THEN** the system SHALL return 201 with `{id, user_id, sector_id, date, user: {email, first_name}, sector: {name}}`

#### Scenario: List assignments for a date
- **WHEN** an ADMIN sends `GET /api/admin/waiter-assignments?date=2026-04-17&branch_id=1`
- **THEN** the system SHALL return all assignments for that date in sectors of branch 1, eager-loaded with `user` and `sector`

#### Scenario: List assignments for a sector and date range
- **WHEN** an ADMIN sends `GET /api/admin/waiter-assignments?sector_id=2&from_date=2026-04-01&to_date=2026-04-30`
- **THEN** the system SHALL return assignments in that sector within the date range

#### Scenario: Delete an assignment
- **WHEN** an ADMIN sends `DELETE /api/admin/waiter-assignments/42`
- **THEN** the system SHALL hard-delete the row (ephemeral — no soft delete) and return 204

#### Scenario: MANAGER manages only their branches
- **WHEN** a MANAGER with branches [3, 5] sends `POST /api/admin/waiter-assignments` with `{sector_id: 10}` where sector 10 is in branch 8
- **THEN** the system SHALL return 403 Forbidden

---

### Requirement: Waiter verify-branch-assignment endpoint
The system SHALL expose `GET /api/waiter/verify-branch-assignment?branch_id={id}` (JWT WAITER). The endpoint MUST always return HTTP 200 with a stable JSON structure (`{assigned: boolean, sector_id?: number, sector_name?: string}`), NEVER 403/404, to prevent branch/sector enumeration.

#### Scenario: Waiter is assigned today
- **WHEN** a WAITER with `user_id=5` has `WaiterSectorAssignment(sector_id=2, date=today())` in branch 1
- **AND** sends `GET /api/waiter/verify-branch-assignment?branch_id=1` with their JWT
- **THEN** the system SHALL return 200 with `{assigned: true, sector_id: 2, sector_name: "Terraza"}`

#### Scenario: Waiter is not assigned
- **WHEN** a WAITER with `user_id=5` has NO assignment for today in branch 1
- **AND** sends `GET /api/waiter/verify-branch-assignment?branch_id=1`
- **THEN** the system SHALL return 200 with `{assigned: false}` (NOT 403, NOT 404)

#### Scenario: Non-existent branch returns false without leak
- **WHEN** a WAITER sends `GET /api/waiter/verify-branch-assignment?branch_id=9999` (branch does not exist in tenant)
- **THEN** the system SHALL return 200 with `{assigned: false}` (does NOT leak whether branch exists)

#### Scenario: Missing branch_id param returns 422
- **WHEN** a WAITER sends `GET /api/waiter/verify-branch-assignment` without `branch_id`
- **THEN** the system SHALL return 422 Validation Error (standard FastAPI behavior)

#### Scenario: Non-WAITER roles are rejected
- **WHEN** an ADMIN sends `GET /api/waiter/verify-branch-assignment?branch_id=1`
- **THEN** the system SHALL return 403 Forbidden (the endpoint requires WAITER role specifically)

---

### Requirement: Date resolution uses UTC
The system SHALL resolve the "today" date using `date.today()` in UTC. This is documented as an MVP decision; tenant-local timezone support is deferred to a future change.

#### Scenario: verify at UTC boundary
- **WHEN** the server UTC time is 2026-04-17T23:59:00Z
- **AND** a WAITER with an assignment `date=2026-04-17` calls `verify-branch-assignment`
- **THEN** the response SHALL be `{assigned: true, ...}`

#### Scenario: verify after UTC midnight
- **WHEN** the server UTC time is 2026-04-18T00:00:30Z
- **AND** the same WAITER's only assignment is `date=2026-04-17`
- **THEN** the response SHALL be `{assigned: false}`
