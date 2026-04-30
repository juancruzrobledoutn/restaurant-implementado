## ADDED Requirements

### Requirement: PermissionContext authorization wrapper

The system SHALL provide a `PermissionContext` class that wraps the authenticated user dict and exposes authorization methods. All permission checks in the system SHALL go through `PermissionContext`, never inline role checks in routers.

#### Scenario: Create PermissionContext from user dict
- **WHEN** a `PermissionContext` is instantiated with a user dict containing `user_id`, `tenant_id`, `branch_ids`, `roles`
- **THEN** the context is ready for permission checks and internally selects the appropriate strategy based on the user's highest-privilege role

### Requirement: require_management check

The `PermissionContext` SHALL provide `require_management()` that verifies the user has ADMIN or MANAGER role. If the user does not have either role, it SHALL raise HTTP 403.

#### Scenario: ADMIN passes management check
- **WHEN** `require_management()` is called for a user with role ADMIN
- **THEN** the check passes without error

#### Scenario: MANAGER passes management check
- **WHEN** `require_management()` is called for a user with role MANAGER
- **THEN** the check passes without error

#### Scenario: KITCHEN fails management check
- **WHEN** `require_management()` is called for a user with role KITCHEN
- **THEN** the system raises HTTP 403 with `{"detail": "Management role required"}`

#### Scenario: WAITER fails management check
- **WHEN** `require_management()` is called for a user with role WAITER
- **THEN** the system raises HTTP 403 with `{"detail": "Management role required"}`

### Requirement: require_branch_access check

The `PermissionContext` SHALL provide `require_branch_access(branch_id)` that verifies the user has access to the specified branch. ADMIN users SHALL have access to all branches within their tenant. MANAGER, KITCHEN, and WAITER users SHALL only have access to branches listed in their `branch_ids`.

#### Scenario: ADMIN accessing any branch in their tenant
- **WHEN** `require_branch_access(branch_id)` is called for an ADMIN user
- **THEN** the check passes (ADMIN has access to all branches in their tenant)

#### Scenario: MANAGER accessing assigned branch
- **WHEN** `require_branch_access(branch_id)` is called for a MANAGER whose `branch_ids` includes the requested `branch_id`
- **THEN** the check passes

#### Scenario: WAITER accessing unassigned branch
- **WHEN** `require_branch_access(branch_id)` is called for a WAITER whose `branch_ids` does NOT include the requested `branch_id`
- **THEN** the system raises HTTP 403 with `{"detail": "Branch access denied"}`

### Requirement: Role-specific permission strategies

The system SHALL implement a Strategy pattern with one strategy per role. Each strategy SHALL define the role's permissions for create, edit, and delete operations. A `STRATEGY_REGISTRY` dict SHALL map `Roles` enum values to their strategy classes.

#### Scenario: AdminStrategy permits all operations
- **WHEN** the AdminStrategy is queried for any create, edit, or delete operation
- **THEN** the strategy permits the operation

#### Scenario: ManagerStrategy permits limited operations
- **WHEN** the ManagerStrategy is queried for create or edit on Staff, Tables, Allergens, or Promotions within assigned branches
- **THEN** the strategy permits the operation

#### Scenario: ManagerStrategy denies delete operations
- **WHEN** the ManagerStrategy is queried for any delete operation
- **THEN** the strategy denies the operation

#### Scenario: KitchenStrategy denies all CUD operations
- **WHEN** the KitchenStrategy is queried for any create, edit, or delete operation
- **THEN** the strategy denies the operation

#### Scenario: WaiterStrategy denies all CUD operations
- **WHEN** the WaiterStrategy is queried for any create, edit, or delete operation
- **THEN** the strategy denies the operation

### Requirement: Roles enum and MANAGEMENT_ROLES constant

The system SHALL define a `Roles` enum with values ADMIN, MANAGER, KITCHEN, WAITER. A `MANAGEMENT_ROLES` constant SHALL contain `{Roles.ADMIN, Roles.MANAGER}` for use in permission checks.

#### Scenario: Roles enum contains all defined roles
- **WHEN** the Roles enum is accessed
- **THEN** it contains exactly ADMIN, MANAGER, KITCHEN, WAITER

#### Scenario: MANAGEMENT_ROLES includes only management roles
- **WHEN** MANAGEMENT_ROLES is accessed
- **THEN** it contains exactly ADMIN and MANAGER
