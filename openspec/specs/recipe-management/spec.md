# recipe-management Specification

## Purpose
TBD - created by archiving change ingredients. Update Purpose after archive.
## Requirements
### Requirement: Recipe model represents a preparation with ingredients

The `Recipe` model SHALL map to table `recipe` with columns: `id` (BigInteger PK autoincrement), `tenant_id` (BigInteger FK to `app_tenant.id`, NOT NULL), `name` (String(255), NOT NULL). It SHALL include `AuditMixin` fields. There SHALL be a B-tree index on `tenant_id`. The combination (`tenant_id`, `name`) SHALL be unique.

#### Scenario: Create a valid recipe
- **WHEN** a Recipe is created with `tenant_id=1`, `name="Margherita Pizza"`
- **THEN** it SHALL be persisted with an auto-generated BigInteger `id`, `is_active=True`, and timestamp fields populated

#### Scenario: Reject duplicate recipe name within same tenant
- **WHEN** a Recipe is created with a `name` that already exists for the same `tenant_id`
- **THEN** the system SHALL return a 409 Conflict error

### Requirement: RecipeIngredient junction tracks ingredient quantities in a recipe

The `RecipeIngredient` model SHALL map to table `recipe_ingredient` with columns: `id` (BigInteger PK autoincrement), `recipe_id` (BigInteger FK to `recipe.id`, NOT NULL), `ingredient_id` (BigInteger FK to `ingredient.id`, NOT NULL), `quantity` (Numeric(10,3), NOT NULL), `unit` (String(50), NOT NULL). The combination (`recipe_id`, `ingredient_id`) SHALL be unique.

#### Scenario: Add an ingredient to a recipe
- **WHEN** a RecipeIngredient is created with `recipe_id=1`, `ingredient_id=5`, `quantity=250.000`, `unit="g"`
- **THEN** it SHALL be persisted linking the recipe to the ingredient with the specified quantity and unit

#### Scenario: Reject duplicate ingredient in same recipe
- **WHEN** a RecipeIngredient is created with a `recipe_id` and `ingredient_id` combination that already exists
- **THEN** the database SHALL raise an IntegrityError (unique constraint violation)

#### Scenario: Supported unit values
- **WHEN** a RecipeIngredient is created with `unit` set to any of: "g", "kg", "ml", "l", "unit", "tbsp", "tsp", "cup", "oz"
- **THEN** it SHALL be persisted successfully

### Requirement: Recipe CRUD endpoints at /api/recipes/

The system SHALL expose CRUD endpoints for recipes at `/api/recipes/`. All endpoints SHALL require JWT authentication with KITCHEN, MANAGER, or ADMIN role. Only ADMIN SHALL be able to delete recipes.

#### Scenario: List recipes with pagination
- **WHEN** an authenticated user (KITCHEN/MANAGER/ADMIN) sends `GET /api/recipes/?limit=50&offset=0`
- **THEN** the system SHALL return a paginated list of active Recipes for the user's tenant

#### Scenario: Create a recipe with ingredients
- **WHEN** an authenticated user sends `POST /api/recipes/` with `{"name": "Margherita Pizza", "ingredients": [{"ingredient_id": 5, "quantity": 250, "unit": "g"}, {"ingredient_id": 8, "quantity": 100, "unit": "ml"}]}`
- **THEN** the system SHALL create a Recipe and its RecipeIngredient records atomically, returning the full recipe with ingredients and status 201

#### Scenario: Get recipe detail with ingredients
- **WHEN** an authenticated user sends `GET /api/recipes/{id}`
- **THEN** the system SHALL return the Recipe with all its RecipeIngredient records eagerly loaded, including ingredient name and group name for each

#### Scenario: Update a recipe and its ingredients
- **WHEN** an authenticated user sends `PUT /api/recipes/{id}` with updated name and/or ingredients list
- **THEN** the system SHALL update the Recipe and replace the full ingredients list (delete old RecipeIngredients, insert new ones) atomically

#### Scenario: Soft delete a recipe (ADMIN only)
- **WHEN** an ADMIN user sends `DELETE /api/recipes/{id}`
- **THEN** the system SHALL set `is_active=False` on the Recipe and return status 204

#### Scenario: Non-ADMIN cannot delete recipes
- **WHEN** a KITCHEN or MANAGER user sends `DELETE /api/recipes/{id}`
- **THEN** the system SHALL return 403 Forbidden

#### Scenario: Recipe references inactive ingredients gracefully
- **WHEN** a Recipe contains a RecipeIngredient referencing an Ingredient with `is_active=False`
- **THEN** the GET detail response SHALL include the ingredient with an `is_active: false` flag so the UI can display it as inactive

### Requirement: Recipe queries are tenant-isolated

All recipe queries SHALL filter by the authenticated user's `tenant_id`. A user SHALL never see or modify recipes belonging to a different tenant.

#### Scenario: Tenant isolation on recipe list
- **WHEN** a user from Tenant A sends `GET /api/recipes/`
- **THEN** the response SHALL contain only Recipes where `tenant_id` matches Tenant A

#### Scenario: Cross-tenant recipe access returns 404
- **WHEN** a user from Tenant A sends `GET /api/recipes/{id}` where `{id}` belongs to Tenant B
- **THEN** the system SHALL return 404 Not Found

