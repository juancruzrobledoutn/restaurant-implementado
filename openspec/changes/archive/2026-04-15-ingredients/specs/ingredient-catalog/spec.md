## ADDED Requirements

### Requirement: IngredientGroup model represents a top-level ingredient category

The `IngredientGroup` model SHALL map to table `ingredient_group` with columns: `id` (BigInteger PK autoincrement), `tenant_id` (BigInteger FK to `app_tenant.id`, NOT NULL), `name` (String(255), NOT NULL). It SHALL include `AuditMixin` fields. There SHALL be a B-tree index on `tenant_id`. The combination (`tenant_id`, `name`) SHALL be unique.

#### Scenario: Create a valid ingredient group
- **WHEN** an IngredientGroup is created with `tenant_id=1`, `name="Dairy"`
- **THEN** it SHALL be persisted with an auto-generated BigInteger `id`, `is_active=True`, and timestamp fields populated

#### Scenario: Reject duplicate group name within same tenant
- **WHEN** an IngredientGroup is created with a `name` that already exists for the same `tenant_id`
- **THEN** the system SHALL return a 409 Conflict error

#### Scenario: Allow same group name in different tenants
- **WHEN** two IngredientGroups in different tenants use the same `name`
- **THEN** both SHALL be persisted successfully

### Requirement: Ingredient model represents an ingredient within a group

The `Ingredient` model SHALL map to table `ingredient` with columns: `id` (BigInteger PK autoincrement), `group_id` (BigInteger FK to `ingredient_group.id`, NOT NULL), `tenant_id` (BigInteger FK to `app_tenant.id`, NOT NULL, denormalized for query efficiency), `name` (String(255), NOT NULL). It SHALL include `AuditMixin` fields. There SHALL be a B-tree index on `tenant_id`. The combination (`group_id`, `name`) SHALL be unique.

#### Scenario: Create a valid ingredient
- **WHEN** an Ingredient is created with `group_id=1`, `name="Whole Milk"` and the group's `tenant_id` is 1
- **THEN** it SHALL be persisted with `tenant_id=1` (copied from parent group), `is_active=True`, and timestamp fields populated

#### Scenario: Ingredient tenant_id matches parent group
- **WHEN** an Ingredient is created for a group belonging to tenant 1
- **THEN** the Ingredient's `tenant_id` SHALL be automatically set to 1, matching its parent group

#### Scenario: Reject duplicate ingredient name within same group
- **WHEN** an Ingredient is created with a `name` that already exists for the same `group_id`
- **THEN** the system SHALL return a 409 Conflict error

### Requirement: SubIngredient model represents a component of an ingredient

The `SubIngredient` model SHALL map to table `sub_ingredient` with columns: `id` (BigInteger PK autoincrement), `ingredient_id` (BigInteger FK to `ingredient.id`, NOT NULL), `name` (String(255), NOT NULL). It SHALL include `AuditMixin` fields. The combination (`ingredient_id`, `name`) SHALL be unique.

#### Scenario: Create a valid sub-ingredient
- **WHEN** a SubIngredient is created with `ingredient_id=1`, `name="Lactose"`
- **THEN** it SHALL be persisted with `is_active=True` and timestamp fields populated

#### Scenario: Reject duplicate sub-ingredient name within same ingredient
- **WHEN** a SubIngredient is created with a `name` that already exists for the same `ingredient_id`
- **THEN** the system SHALL return a 409 Conflict error

### Requirement: Ingredient CRUD endpoints at /api/admin/ingredients

The system SHALL expose CRUD endpoints for the ingredient hierarchy under `/api/admin/ingredients`. All endpoints SHALL require JWT authentication with ADMIN role.

#### Scenario: List ingredient groups with pagination
- **WHEN** an ADMIN user sends `GET /api/admin/ingredients?limit=50&offset=0`
- **THEN** the system SHALL return a paginated list of IngredientGroups for the user's tenant, each including a count of child ingredients

#### Scenario: Create an ingredient group
- **WHEN** an ADMIN user sends `POST /api/admin/ingredients` with `{"name": "Dairy"}`
- **THEN** the system SHALL create an IngredientGroup scoped to the user's tenant and return it with status 201

#### Scenario: Get ingredient group detail with children
- **WHEN** an ADMIN user sends `GET /api/admin/ingredients/{group_id}`
- **THEN** the system SHALL return the IngredientGroup with all its active Ingredients eagerly loaded

#### Scenario: Create an ingredient within a group
- **WHEN** an ADMIN user sends `POST /api/admin/ingredients/{group_id}/items` with `{"name": "Whole Milk"}`
- **THEN** the system SHALL create an Ingredient under the specified group, auto-setting `tenant_id` from the group, and return it with status 201

#### Scenario: Create a sub-ingredient within an ingredient
- **WHEN** an ADMIN user sends `POST /api/admin/ingredients/{group_id}/items/{ingredient_id}/subs` with `{"name": "Lactose"}`
- **THEN** the system SHALL create a SubIngredient under the specified Ingredient and return it with status 201

#### Scenario: Update an ingredient group
- **WHEN** an ADMIN user sends `PUT /api/admin/ingredients/{group_id}` with `{"name": "Dairy Products"}`
- **THEN** the system SHALL update the IngredientGroup name and return the updated entity

#### Scenario: Soft delete an ingredient group with cascade
- **WHEN** an ADMIN user sends `DELETE /api/admin/ingredients/{group_id}`
- **THEN** the system SHALL set `is_active=False` on the IngredientGroup AND all its child Ingredients AND all their child SubIngredients, returning status 204

#### Scenario: Reject non-ADMIN access
- **WHEN** a user with MANAGER, KITCHEN, or WAITER role sends any request to `/api/admin/ingredients/*`
- **THEN** the system SHALL return 403 Forbidden

### Requirement: Ingredient queries are tenant-isolated

All ingredient queries SHALL filter by the authenticated user's `tenant_id`. A user SHALL never see or modify ingredients belonging to a different tenant.

#### Scenario: Tenant A cannot see Tenant B ingredients
- **WHEN** a user from Tenant A sends `GET /api/admin/ingredients`
- **THEN** the response SHALL contain only IngredientGroups where `tenant_id` matches Tenant A

#### Scenario: Tenant A cannot modify Tenant B ingredient
- **WHEN** a user from Tenant A sends `PUT /api/admin/ingredients/{id}` where `{id}` belongs to Tenant B
- **THEN** the system SHALL return 404 Not Found (not 403, to avoid leaking existence)
