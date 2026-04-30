## 1. SQLAlchemy Models

- [x] 1.1 Create `backend/rest_api/models/ingredient.py` with `IngredientGroup`, `Ingredient`, `SubIngredient` models using SQLAlchemy 2.0 Mapped types, AuditMixin, proper FKs, unique constraints (`tenant_id`+`name` for groups, `group_id`+`name` for ingredients, `ingredient_id`+`name` for sub-ingredients), and B-tree indexes on `tenant_id`
- [x] 1.2 Create `backend/rest_api/models/recipe.py` with `Recipe` model (tenant-scoped, unique `tenant_id`+`name`) and `RecipeIngredient` junction model (`recipe_id`, `ingredient_id`, `quantity` as Numeric(10,3), `unit` as String(50), unique `recipe_id`+`ingredient_id`)
- [x] 1.3 Create `backend/rest_api/models/catalog.py` with `CookingMethod`, `FlavorProfile`, `TextureProfile`, `CuisineType` models — all sharing identical structure: `id`, `tenant_id` (FK), `name`, AuditMixin, unique constraint on (`tenant_id`, `name`), index on `tenant_id`
- [x] 1.4 Register all new models in `backend/rest_api/models/__init__.py` so Alembic autogenerate detects them

## 2. Alembic Migration

- [x] 2.1 Generate Alembic migration `004_ingredients_recipes_catalogs.py` that creates tables: `ingredient_group`, `ingredient`, `sub_ingredient`, `recipe`, `recipe_ingredient`, `cooking_method`, `flavor_profile`, `texture_profile`, `cuisine_type`. Verify `down_revision` chains from the latest existing migration (003). Include all indexes and unique constraints.

## 3. Pydantic Schemas

- [x] 3.1 Create `backend/rest_api/schemas/ingredient.py` with request/response schemas: `IngredientGroupCreate`, `IngredientGroupUpdate`, `IngredientGroupOut`, `IngredientCreate`, `IngredientUpdate`, `IngredientOut`, `SubIngredientCreate`, `SubIngredientUpdate`, `SubIngredientOut`. IngredientGroupOut should include nested list of IngredientOut; IngredientOut should include nested list of SubIngredientOut.
- [x] 3.2 Create `backend/rest_api/schemas/recipe.py` with: `RecipeCreate` (includes `ingredients` list with `ingredient_id`, `quantity`, `unit`), `RecipeUpdate`, `RecipeOut` (includes nested ingredient details with name and group name), `RecipeIngredientOut`
- [x] 3.3 Create `backend/rest_api/schemas/catalog.py` with generic request/response schemas: `CatalogItemCreate`, `CatalogItemUpdate`, `CatalogItemOut` — reusable across all four catalog types

## 4. Domain Services

- [x] 4.1 Create `backend/rest_api/services/domain/ingredient_service.py` extending `BaseCRUDService` — handles IngredientGroup CRUD, Ingredient CRUD (auto-sets `tenant_id` from parent group), SubIngredient CRUD, and cascade soft-delete (group -> ingredients -> sub-ingredients). Use `safe_commit(db)`, `is_active.is_(True)` filtering, tenant isolation.
- [x] 4.2 Create `backend/rest_api/services/domain/recipe_service.py` extending `BaseCRUDService` — handles Recipe CRUD with atomic ingredient list replacement on update (delete old RecipeIngredients, insert new ones). Eagerly loads ingredient details on get. Tenant-isolated.
- [x] 4.3 Create `backend/rest_api/services/domain/catalog_service.py` — a generic/parameterized service for all four catalog models. Extends `BaseCRUDService`. Takes the model class as parameter to avoid code duplication.

## 5. Routers

- [x] 5.1 Create `backend/rest_api/routers/ingredients.py` — thin router for `/api/admin/ingredients` with nested routes for groups, ingredients, and sub-ingredients. ADMIN-only via PermissionContext. Delegates all logic to IngredientService.
- [x] 5.2 Create `backend/rest_api/routers/recipes.py` — thin router for `/api/recipes/` with KITCHEN/MANAGER/ADMIN access for read/create/update, ADMIN-only for delete. Delegates to RecipeService.
- [x] 5.3 Create `backend/rest_api/routers/catalogs.py` — thin router factory that generates four sub-routers for `/api/admin/cooking-methods`, `/api/admin/flavor-profiles`, `/api/admin/texture-profiles`, `/api/admin/cuisine-types`. ADMIN-only. Delegates to CatalogService.
- [x] 5.4 Register all new routers in `backend/rest_api/main.py`

## 6. Tests

- [x] 6.1 Create `backend/tests/test_ingredient_models.py` — unit tests for model creation, unique constraints, FK relationships, AuditMixin fields, and cascade soft-delete behavior
- [x] 6.2 Create `backend/tests/test_recipe_models.py` — unit tests for Recipe and RecipeIngredient model creation, unique constraints, Numeric quantity precision
- [x] 6.3 Create `backend/tests/test_catalog_models.py` — unit tests for all four catalog models: creation, unique constraints, tenant isolation at DB level
- [x] 6.4 Create `backend/tests/test_ingredient_service.py` — service-level tests for IngredientService: CRUD operations, cascade soft-delete, tenant isolation (user from Tenant A cannot access Tenant B data), duplicate name rejection (409)
- [x] 6.5 Create `backend/tests/test_recipe_service.py` — service-level tests for RecipeService: create with ingredients, update replaces ingredients atomically, inactive ingredient references, tenant isolation
- [x] 6.6 Create `backend/tests/test_ingredient_router.py` — integration tests for ingredient endpoints: CRUD flow, RBAC (ADMIN-only, 403 for others), tenant isolation (404 for cross-tenant), pagination
- [x] 6.7 Create `backend/tests/test_recipe_router.py` — integration tests for recipe endpoints: CRUD flow, RBAC (KITCHEN/MANAGER/ADMIN read, ADMIN-only delete), tenant isolation, nested ingredient response
- [x] 6.8 Create `backend/tests/test_catalog_router.py` — integration tests for all four catalog endpoints: CRUD flow, RBAC, tenant isolation, duplicate name handling
