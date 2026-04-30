# core-models Specification

## Purpose
TBD - created by archiving change core-models. Update Purpose after archive.
## Requirements
### Requirement: AuditMixin provides standard audit fields

All domain models SHALL inherit from `AuditMixin` which provides `is_active` (bool, default True), `created_at` (datetime UTC, auto-set on insert), `updated_at` (datetime UTC, auto-set on update), `deleted_at` (datetime, nullable), and `deleted_by_id` (BigInteger, nullable FK to `app_user.id`).

#### Scenario: New entity gets audit fields automatically
- **WHEN** a new model class includes `AuditMixin`
- **THEN** instances of that model SHALL have `is_active=True`, `created_at` set to current UTC time, `updated_at` set to current UTC time, `deleted_at=None`, and `deleted_by_id=None`

#### Scenario: Updated entity refreshes updated_at
- **WHEN** any field on an entity with `AuditMixin` is modified and committed
- **THEN** `updated_at` SHALL be updated to the current UTC timestamp automatically

### Requirement: Tenant model represents a restaurant organization

The `Tenant` model SHALL map to table `app_tenant` with columns: `id` (BigInteger PK autoincrement), `name` (String, not null). It SHALL include `AuditMixin` fields.

#### Scenario: Create a valid tenant
- **WHEN** a Tenant is created with `name="Demo Restaurant"`
- **THEN** it SHALL be persisted with an auto-generated BigInteger `id`, `is_active=True`, and timestamp fields populated

### Requirement: Branch model represents a physical location of a tenant

The `Branch` model SHALL map to table `branch` with columns: `id` (BigInteger PK autoincrement), `tenant_id` (BigInteger FK to `app_tenant.id`, not null), `name` (String, not null), `address` (String, not null), `slug` (String, not null). It SHALL include `AuditMixin` fields. The combination (`tenant_id`, `slug`) SHALL be unique. There SHALL be a B-tree index on `tenant_id`.

#### Scenario: Create a branch for a tenant
- **WHEN** a Branch is created with `tenant_id=1`, `name="Sucursal Central"`, `slug="demo"`
- **THEN** it SHALL be persisted with FK referencing `app_tenant.id=1`

#### Scenario: Reject duplicate slug within same tenant
- **WHEN** a Branch is created with a `slug` that already exists for the same `tenant_id`
- **THEN** the database SHALL raise an IntegrityError (unique constraint violation)

#### Scenario: Allow same slug in different tenants
- **WHEN** two Branches in different tenants use the same `slug`
- **THEN** both SHALL be persisted successfully

### Requirement: User model represents an authenticated staff member

The `User` model SHALL map to table `app_user` with columns: `id` (BigInteger PK autoincrement), `tenant_id` (BigInteger FK to `app_tenant.id`, not null), `email` (String, globally unique, not null), `full_name` (String, not null), `hashed_password` (String, not null). It SHALL include `AuditMixin` fields. There SHALL be a B-tree index on `tenant_id`.

#### Scenario: Create a valid user
- **WHEN** a User is created with valid `tenant_id`, `email`, `full_name`, and `hashed_password`
- **THEN** it SHALL be persisted with `is_active=True` and a globally unique email

#### Scenario: Reject duplicate email
- **WHEN** a User is created with an `email` that already exists (even in a different tenant)
- **THEN** the database SHALL raise an IntegrityError

### Requirement: UserBranchRole maps users to branches with roles

The `UserBranchRole` model SHALL map to table `user_branch_role` with a composite PK of (`user_id`, `branch_id`, `role`). `user_id` SHALL be FK to `app_user.id`. `branch_id` SHALL be FK to `branch.id`. `role` SHALL be a String constrained to values in `UserRole` enum (ADMIN, MANAGER, KITCHEN, WAITER).

#### Scenario: Assign a user to a branch with a role
- **WHEN** a UserBranchRole is created with `user_id=1`, `branch_id=1`, `role="ADMIN"`
- **THEN** it SHALL be persisted, linking the user to the branch with the ADMIN role

#### Scenario: Same user can have different roles in different branches
- **WHEN** UserBranchRole entries are created for user_id=1 with role ADMIN in branch 1 and role MANAGER in branch 2
- **THEN** both SHALL be persisted successfully

#### Scenario: Same user can have multiple roles in the same branch
- **WHEN** UserBranchRole entries are created for user_id=1, branch_id=1 with roles ADMIN and MANAGER
- **THEN** both SHALL be persisted (composite PK includes role)

### Requirement: TenantRepository filters by tenant_id and is_active

`TenantRepository` SHALL accept an `AsyncSession` and provide methods that automatically filter by `tenant_id` and `is_active.is_(True)`. Methods SHALL include: `get_by_id(id, tenant_id)`, `list_all(tenant_id, limit, offset)`, `create(model_instance)`, `update(model_instance)`, `soft_delete(entity, user_id)`.

#### Scenario: Get entity by ID scoped to tenant
- **WHEN** `get_by_id(id=5, tenant_id=1)` is called
- **THEN** the repository SHALL query with `WHERE id=5 AND tenant_id=1 AND is_active IS TRUE`

#### Scenario: Soft-deleted entity is excluded from queries
- **WHEN** an entity has `is_active=False` and `get_by_id` is called for that entity
- **THEN** the repository SHALL return None (entity not found)

### Requirement: BranchRepository extends TenantRepository with branch filtering

`BranchRepository` SHALL extend `TenantRepository` with additional methods that filter by `branch_id`: `list_by_branch(tenant_id, branch_id, limit, offset)`, `get_by_branch(id, tenant_id, branch_id)`.

#### Scenario: List entities scoped to a specific branch
- **WHEN** `list_by_branch(tenant_id=1, branch_id=2)` is called
- **THEN** the repository SHALL query with `WHERE tenant_id=1 AND branch_id=2 AND is_active IS TRUE`

### Requirement: BaseCRUDService provides generic CRUD with hooks

`BaseCRUDService[Model, Output]` SHALL provide `create(data, tenant_id)`, `update(entity_id, data, tenant_id)`, `delete(entity_id, tenant_id, user_id, user_email)`, `get_by_id(entity_id, tenant_id)`, `list_all(tenant_id, limit, offset)`. It SHALL use `safe_commit(db)` for all write operations. It SHALL expose hooks: `_validate_create`, `_validate_update`, `_after_create`, `_after_update`, `_after_delete`.

#### Scenario: Create entity with validation hook
- **WHEN** a subclass overrides `_validate_create` to check for duplicate names, and `create()` is called with a duplicate name
- **THEN** `_validate_create` SHALL raise `ValidationError` before any DB write

#### Scenario: Delete performs soft delete
- **WHEN** `delete(entity_id, tenant_id, user_id, user_email)` is called
- **THEN** the entity SHALL have `is_active=False`, `deleted_at` set to current UTC, and `deleted_by_id` set to `user_id`; the entity SHALL NOT be physically removed

### Requirement: BranchScopedService extends BaseCRUDService with branch filtering

`BranchScopedService[Model, Output]` SHALL extend `BaseCRUDService` and add `list_by_branch(tenant_id, branch_id, ...)` and `get_by_branch(entity_id, tenant_id, branch_id)`.

#### Scenario: List entities scoped by branch
- **WHEN** `list_by_branch(tenant_id=1, branch_id=2)` is called
- **THEN** results SHALL only include entities matching `tenant_id=1`, `branch_id=2`, and `is_active IS TRUE`

### Requirement: cascade_soft_delete recursively deactivates dependent entities

`cascade_soft_delete(db, entity, user_id)` SHALL set `is_active=False`, `deleted_at`, and `deleted_by_id` on the given entity AND recursively on all dependent entities discovered via SQLAlchemy relationships marked with `cascade="all"` or via an explicit dependency registry.

#### Scenario: Soft-delete a tenant cascades to branches and users
- **WHEN** `cascade_soft_delete(db, tenant, user_id=1)` is called
- **THEN** the tenant, all its branches, all its users, and all their UserBranchRole entries SHALL have `is_active=False` and audit fields set

#### Scenario: Already-deleted entities are skipped
- **WHEN** `cascade_soft_delete` encounters an entity with `is_active=False`
- **THEN** it SHALL skip that entity and not update its timestamps

### Requirement: Alembic migration 001 creates core tables

Migration 001 SHALL create tables `app_tenant`, `branch`, `app_user`, `user_branch_role` with all columns, constraints, indices, and foreign keys as defined in the model requirements.

#### Scenario: Upgrade creates all four tables
- **WHEN** `alembic upgrade head` is executed on an empty database
- **THEN** tables `app_tenant`, `branch`, `app_user`, `user_branch_role` SHALL exist with correct schema

#### Scenario: Downgrade removes all four tables
- **WHEN** `alembic downgrade base` is executed
- **THEN** tables `user_branch_role`, `app_user`, `branch`, `app_tenant` SHALL be dropped in reverse dependency order

### Requirement: Constants module includes Roles alias and ORDERABLE set

`shared/config/constants.py` SHALL export `Roles` as an alias for `UserRole` and `ORDERABLE` as a `frozenset` of `RoundStatus` values that allow new round items (DRAFT).

#### Scenario: Roles alias resolves to UserRole values
- **WHEN** `Roles.ADMIN` is accessed
- **THEN** it SHALL equal `UserRole.ADMIN` (value "ADMIN")

#### Scenario: ORDERABLE contains only DRAFT status
- **WHEN** `ORDERABLE` is inspected
- **THEN** it SHALL contain exactly `{RoundStatus.DRAFT}`

