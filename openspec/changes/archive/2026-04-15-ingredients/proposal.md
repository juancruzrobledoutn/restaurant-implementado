## Why

The restaurant system needs a structured ingredient catalog and recipe management system so that kitchen staff can reference preparation instructions, and so the admin can maintain a hierarchical ingredient taxonomy (groups > ingredients > sub-ingredients). This is a prerequisite for the Dashboard menu management (C-15) and enables future features like stock control, cost calculation, and nutritional information. Runs in parallel with C-04 (menu-catalog) since it only depends on C-03 (auth).

## What Changes

- **New models**: `IngredientGroup`, `Ingredient`, `SubIngredient` as a 3-level tenant-scoped hierarchy
- **New model**: `Recipe` linked to tenant, with a many-to-many relationship to `Ingredient` via `RecipeIngredient` junction table (includes quantity and unit)
- **New catalog models**: `CookingMethod`, `FlavorProfile`, `TextureProfile`, `CuisineType` as simple tenant-scoped lookup tables
- **New admin endpoints**: Full CRUD at `/api/admin/ingredients` (groups, ingredients, sub-ingredients) restricted to ADMIN role
- **New recipe endpoints**: CRUD at `/api/recipes/` accessible by KITCHEN, MANAGER, and ADMIN roles
- **New catalog endpoints**: CRUD for each tenant-scoped catalog (`/api/admin/cooking-methods`, `/api/admin/flavor-profiles`, `/api/admin/texture-profiles`, `/api/admin/cuisine-types`)
- **New Alembic migration 004**: Creates all ingredient, recipe, and catalog tables
- **Domain services**: `IngredientService`, `RecipeService`, `CatalogService` following Clean Architecture (no business logic in routers)
- **Pydantic schemas**: Request/response models for all new entities
- **Tests**: CRUD operations, tenant isolation, cascade soft-delete behavior

## Capabilities

### New Capabilities
- `ingredient-catalog`: Hierarchical ingredient management (IngredientGroup > Ingredient > SubIngredient) with tenant-scoped CRUD, admin-only access, and soft delete
- `recipe-management`: Recipe CRUD with ingredient composition (quantities + units), accessible by kitchen/manager/admin roles
- `tenant-catalogs`: Simple tenant-scoped lookup tables (CookingMethod, FlavorProfile, TextureProfile, CuisineType) with admin CRUD

### Modified Capabilities
_(none -- this change introduces new capabilities only, no existing spec requirements change)_

## Impact

- **Database**: Migration 004 adds 8+ tables (ingredient_group, ingredient, sub_ingredient, recipe, recipe_ingredient, cooking_method, flavor_profile, texture_profile, cuisine_type)
- **Backend API**: New router files under `rest_api/routers/` for ingredients, recipes, and catalogs
- **Backend services**: New domain services under `rest_api/services/` following BaseCRUDService pattern
- **Auth/RBAC**: Leverages existing JWT auth and permission system from C-03; ingredients restricted to ADMIN, recipes to KITCHEN/MANAGER/ADMIN
- **Dependencies**: Requires C-03 (auth) completed. No frontend impact in this change.
- **Downstream**: C-15 (dashboard-menu) depends on this change for ingredient/recipe management UI
