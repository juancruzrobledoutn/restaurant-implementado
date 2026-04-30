## ADDED Requirements

### Requirement: StaffService for user + role management
The system SHALL provide a `StaffService` (extending `BranchScopedService[User, UserOut]`) that manages users (`app_user`) and their branch-scoped roles (`user_branch_role`). The service MUST automatically filter queries so that MANAGER users only see users whose `UserBranchRole.branch_id` is in the manager's accessible branches, while ADMIN users see all users of the tenant. Password hashing MUST reuse `bcrypt_context` from the existing auth module (no new hashing code).

#### Scenario: ADMIN lists all users of the tenant
- **WHEN** an ADMIN calls `StaffService.list_users(tenant_id=1)`
- **THEN** the service SHALL return all `User` rows with `is_active.is_(True)` that have at least one `UserBranchRole` in any branch of tenant 1

#### Scenario: MANAGER lists only users in their branches
- **WHEN** a MANAGER with access to `branch_ids=[3, 5]` calls `StaffService.list_users(tenant_id=1)`
- **THEN** the service SHALL return only users who have a `UserBranchRole.branch_id IN (3, 5)`

#### Scenario: Create user with role assignment
- **WHEN** `StaffService.create_user(email, password, first_name, last_name, assignments=[{branch_id: 1, role: "WAITER"}])` is invoked
- **THEN** the service SHALL hash the password with `bcrypt_context.hash`, insert the `User`, insert the `UserBranchRole(user_id, branch_id=1, role="WAITER")`, and call `safe_commit(db)`

#### Scenario: Email uniqueness validation
- **WHEN** `create_user` is called with an email that already exists in `app_user`
- **THEN** the service SHALL raise `ConflictError` with HTTP 409 BEFORE commit

---

### Requirement: Admin staff CRUD endpoints
The system SHALL expose admin endpoints under `/api/admin/staff` requiring JWT. Create/update operations MUST pass `PermissionContext.require_management()`. Delete (soft delete) MUST require `PermissionContext.require_admin()` — MANAGER cannot delete users.

#### Scenario: POST /api/admin/staff creates a user
- **WHEN** an ADMIN sends `POST /api/admin/staff` with body `{email, password, first_name, last_name, assignments: [{branch_id, role}]}`
- **THEN** the system SHALL return 201 with `{id, email, first_name, last_name, assignments: [...]}` (password NEVER in response)

#### Scenario: GET /api/admin/staff supports filters
- **WHEN** a MANAGER sends `GET /api/admin/staff?branch_id=3&role=WAITER&limit=50&offset=0`
- **THEN** the system SHALL return paginated users with role WAITER in branch 3 (filtered by the manager's accessible branches)

#### Scenario: PATCH /api/admin/staff/{id} updates a user
- **WHEN** an ADMIN sends `PATCH /api/admin/staff/5` with `{first_name: "Juan"}`
- **THEN** the system SHALL update the user and return 200 with the new state

#### Scenario: DELETE /api/admin/staff/{id} soft-deletes the user
- **WHEN** an ADMIN sends `DELETE /api/admin/staff/5`
- **THEN** the system SHALL set `User.is_active=False`, `deleted_at=now()`, `deleted_by_id=admin.id` and return 204

#### Scenario: MANAGER cannot delete staff
- **WHEN** a MANAGER sends `DELETE /api/admin/staff/5`
- **THEN** the system SHALL return 403 Forbidden

#### Scenario: Password update flow
- **WHEN** an ADMIN sends `PATCH /api/admin/staff/5` with `{password: "newpass123"}`
- **THEN** the service SHALL hash the password with `bcrypt_context.hash` before storing, NEVER store plaintext

---

### Requirement: Role assignment endpoints
The system SHALL expose endpoints to assign and revoke branch-scoped roles on users.

#### Scenario: Assign a role to a user in a branch
- **WHEN** an ADMIN sends `POST /api/admin/staff/5/branches` with `{branch_id: 3, role: "KITCHEN"}`
- **THEN** the system SHALL create a `UserBranchRole(user_id=5, branch_id=3, role="KITCHEN")` and return 201

#### Scenario: Reassignment of same user+branch changes the role
- **WHEN** user 5 already has `UserBranchRole(branch_id=3, role="WAITER")`
- **AND** an ADMIN sends `POST /api/admin/staff/5/branches` with `{branch_id: 3, role: "KITCHEN"}`
- **THEN** the system SHALL update the existing row's role to "KITCHEN" (upsert) and return 200

#### Scenario: Revoke a role from a branch
- **WHEN** an ADMIN sends `DELETE /api/admin/staff/5/branches/3`
- **THEN** the system SHALL hard-delete the `UserBranchRole` row for `user_id=5, branch_id=3` and return 204

#### Scenario: MANAGER cannot assign roles outside their branches
- **WHEN** a MANAGER (branches [3, 5]) sends `POST /api/admin/staff/5/branches` with `{branch_id: 8, role: "WAITER"}`
- **THEN** the system SHALL return 403 Forbidden

---

### Requirement: Multi-tenant isolation in staff queries
The system SHALL ensure `StaffService` queries NEVER return users from other tenants. A user belongs to a tenant via the `UserBranchRole.branch.tenant_id` chain.

#### Scenario: Staff from another tenant is invisible
- **WHEN** tenant 1's ADMIN queries `GET /api/admin/staff`
- **AND** tenant 2 has users with their own branches
- **THEN** the response SHALL contain only users that have at least one `UserBranchRole` in a branch of tenant 1
