## Context

The Integrador system has a foundation (C-01), core models (C-02: Tenant, Branch, User, UserBranchRole), and authentication (C-03: JWT, 2FA, RBAC, rate limiting) already implemented. The backend follows Clean Architecture with async SQLAlchemy 2.0, `BaseCRUDService` as the generic CRUD base class, and `safe_commit()` for all database writes.

C-06 introduces the ingredient and recipe domain -- a tenant-scoped catalog system for managing ingredients in a 3-level hierarchy, recipe composition, and simple lookup tables (cooking methods, flavor profiles, etc.). This runs in parallel with C-04 (menu-catalog) and has no dependency on it.

## Goals / Non-Goals

**Goals:**
- Implement IngredientGroup > Ingredient > SubIngredient hierarchy with full CRUD
- Implement Recipe model with ingredient composition (many-to-many via RecipeIngredient with quantity/unit)
- Implement four tenant-scoped catalog tables: CookingMethod, FlavorProfile, TextureProfile, CuisineType
- Admin-only CRUD endpoints for ingredients and catalogs, kitchen/manager/admin for recipes
- Alembic migration 004 for all new tables
- Comprehensive tests for CRUD operations and tenant isolation

**Non-Goals:**
- Stock/inventory management (future change)
- Cost calculation per ingredient or recipe (future)
- Nutritional information tracking (future)
- Frontend UI for ingredient management (C-15 dashboard-menu)
- Linking recipes to products (will be done when product model exists in C-04)
- Image uploads for ingredients (future enhancement)

## Decisions

### D1: Three-level ingredient hierarchy via FK chain

**Decision**: IngredientGroup (1:N) -> Ingredient (1:N) -> SubIngredient, all tenant-scoped via `tenant_id` on IngredientGroup. Ingredient and SubIngredient inherit tenant scope through their parent FK.

**Rationale**: The knowledge-base defines this exact hierarchy. Ingredient and SubIngredient do not need their own `tenant_id` column -- tenant isolation is enforced by joining through the parent chain. However, for query efficiency and to follow the project convention of "EVERY query filters by tenant_id", we will add `tenant_id` directly to `ingredient` as well (denormalized). SubIngredient is always accessed through its parent ingredient, so no direct tenant_id needed there.

**Alternatives considered**:
- Single `ingredient` table with `parent_id` self-reference: More flexible but loses the semantic distinction between groups, ingredients, and sub-ingredients. The 3-level hierarchy is well-defined in the domain.
- `tenant_id` on all three tables: Adds redundancy on SubIngredient with no query benefit since sub-ingredients are never queried independently of their parent.

### D2: RecipeIngredient junction table with quantity and unit

**Decision**: `recipe_ingredient` table with `recipe_id`, `ingredient_id`, `quantity` (Numeric), `unit` (String enum-like). Quantities use Numeric (not float) for precision.

**Rationale**: Recipes need to track how much of each ingredient is used. Using Numeric avoids floating-point precision issues. Units are stored as strings (e.g., "g", "kg", "ml", "l", "unit", "tbsp", "tsp") -- an enum would be too rigid for diverse restaurant needs.

**Alternatives considered**:
- Integer quantities in smallest unit (like prices in cents): Would work for weight (grams) but not for volume/count. Too complex for recipe use cases where exact precision is not financial.
- JSONB ingredients array on Recipe: Loses referential integrity and makes ingredient-based queries impossible.

### D3: One domain service per logical group

**Decision**:
- `IngredientService` -- handles IngredientGroup, Ingredient, SubIngredient CRUD
- `RecipeService` -- handles Recipe and RecipeIngredient CRUD
- `CatalogService` -- generic service for all four catalog tables (CookingMethod, FlavorProfile, TextureProfile, CuisineType)

**Rationale**: IngredientService manages the full hierarchy as a cohesive unit. CatalogService uses a generic approach since all four catalog tables have identical structure (id, tenant_id, name, AuditMixin). All services extend `BaseCRUDService`.

**Alternatives considered**:
- Separate service per catalog table: Unnecessary code duplication for identical CRUD behavior.
- Single monolithic IngredientService for everything: Would violate SRP by mixing ingredient hierarchy logic with recipe composition logic.

### D4: Router structure -- one router per endpoint group

**Decision**:
- `/api/admin/ingredients` -- IngredientGroup + Ingredient + SubIngredient (nested routes)
- `/api/recipes/` -- Recipe CRUD
- `/api/admin/cooking-methods`, `/api/admin/flavor-profiles`, `/api/admin/texture-profiles`, `/api/admin/cuisine-types` -- one router per catalog

**Rationale**: Follows the admin CRUD pattern from the API spec. Recipes get their own top-level route since they are accessible by KITCHEN role (not just admin). Catalog routers are thin and can share a factory pattern for route generation.

### D5: Cascade soft delete on ingredient hierarchy

**Decision**: Soft-deleting an IngredientGroup sets `is_active=False` on all its Ingredients and their SubIngredients. Soft-deleting an Ingredient cascades to its SubIngredients. RecipeIngredient references are NOT cascade-deleted (recipe keeps the reference, but ingredient shows as inactive).

**Rationale**: Maintaining recipe history is important -- if an ingredient is deactivated, existing recipes should still show what was used, but the ingredient should not appear in new recipe creation flows.

### D6: Migration number 004

**Decision**: Alembic migration `004_ingredients_recipes_catalogs.py` creates all tables in this change. Uses `depends_on` pointing to the latest existing migration (003 from C-03 auth).

**Rationale**: Single migration for atomic schema change. All tables in this change are new with no conflicts against C-04 (which creates category/subcategory/product tables in a separate migration).

## Risks / Trade-offs

- **[Risk] Parallel migration with C-04**: Both C-04 and C-06 create migration 004. If both are applied, Alembic will detect a branch in the migration chain. **Mitigation**: At archive time, whichever change is archived second must adjust its migration `down_revision` to chain after the other. The apply agent should use `openspec` migration numbering to coordinate.

- **[Risk] Ingredient tenant isolation via parent FK join**: If IngredientGroup is accidentally created without tenant_id, all its children become orphaned from tenant scope. **Mitigation**: NOT NULL constraint on `ingredient_group.tenant_id` + the denormalized `ingredient.tenant_id` provides a safety net.

- **[Risk] RecipeIngredient references to inactive ingredients**: Could cause confusion if not handled in the UI. **Mitigation**: Service layer marks inactive ingredients clearly in recipe detail responses. Non-goal for this change to handle UI.

- **[Trade-off] Numeric vs Integer for quantities**: Numeric is more expensive to store/compute than Integer. Accepted because recipe quantities are low-volume data and precision matters more than performance here.

## Open Questions

_(none -- the domain model and API endpoints are well-defined in the knowledge base)_
