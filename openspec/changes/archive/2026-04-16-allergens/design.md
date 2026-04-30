## Context

The system has a complete menu catalog (C-04) with Category, Subcategory, Product, and BranchProduct models. The public menu endpoint serves nested product data cached in Redis. Authentication (C-03) provides JWT, RBAC via `PermissionContext`, and rate limiting. The ingredients/recipes catalog (C-06) is also complete.

Allergens are tenant-scoped (shared across all branches of a restaurant), unlike categories which are branch-scoped. Products are branch-scoped (via subcategory -> category -> branch), so the `ProductAllergen` junction table bridges the tenant-scoped allergen catalog with branch-scoped products. The `AllergenCrossReaction` table is self-referential within the allergen table.

Constraints:
- Clean Architecture: thin routers, logic in domain services
- Multi-tenant: every query MUST filter by `tenant_id`
- Soft delete only (`is_active = False`)
- `BaseCRUDService[Model, Output]` is the base class for tenant-scoped services
- `PermissionContext` for RBAC enforcement
- Redis menu cache must be invalidated when allergen data changes
- Governance: CRITICO — allergens are food safety data

## Goals / Non-Goals

**Goals:**
- Implement Allergen, ProductAllergen, and AllergenCrossReaction models per the data model spec
- Provide admin CRUD endpoints for allergens with RBAC enforcement (ADMIN/MANAGER create/edit, ADMIN delete)
- Enable product-allergen linking with `presence_type` and `risk_level` metadata
- Track cross-reactions between allergens (bidirectional)
- Extend the public menu response to include allergen data per product
- Provide a dedicated public allergen endpoint for client-side filtering
- Invalidate Redis menu cache on any allergen-related mutation

**Non-Goals:**
- Allergen filtering logic in the backend (pwaMenu handles filtering client-side based on `presence_type`)
- Seed data for the 14 EU mandatory allergens (can be added as a seed script later)
- Allergen icons/images upload infrastructure (URLs only, same as Product)
- Frontend UI for allergen management (deferred to C-15 dashboard-menu)
- Ingredient-allergen association (future change: auto-derive allergens from recipe ingredients)

## Decisions

### D-01: Allergen extends BaseCRUDService, not BranchScopedService

**Decision**: `AllergenService` extends `BaseCRUDService[Allergen, AllergenResponse]` because allergens are tenant-scoped, not branch-scoped.

**Alternatives considered**:
- BranchScopedService: Would require a `branch_id` on Allergen, but the data model defines allergens as tenant-level catalogs shared across all branches.

**Rationale**: The knowledge base explicitly places Allergen at the Tenant level alongside CookingMethod, FlavorProfile, etc. A single allergen definition (e.g., "Gluten") applies uniformly across all branches. The tenant_id filter is applied in `BaseCRUDService` list/get queries.

### D-02: ProductAllergen is NOT a standalone entity with its own service

**Decision**: Product-allergen linking is managed through methods on `AllergenService` (e.g., `link_product`, `unlink_product`) rather than a separate `ProductAllergenService`.

**Alternatives considered**:
- Separate `ProductAllergenService`: More granular but adds a service class for what is essentially a junction table management operation. Overkill given the simple link/unlink semantics.

**Rationale**: The junction table has attributes (`presence_type`, `risk_level`) but no lifecycle of its own. It is created and deleted in the context of allergen-product association. The `AllergenService` is the natural home for these operations since allergen management is the primary use case.

### D-03: Cross-reactions are bidirectional but stored unidirectionally

**Decision**: `AllergenCrossReaction` stores one row per direction. When creating a cross-reaction between allergen A and allergen B, the service creates TWO rows: (A -> B) and (B -> A). This simplifies queries — looking up cross-reactions for allergen A always queries `WHERE allergen_id = A`.

**Alternatives considered**:
- Single row with OR query: Store only (A, B) where A < B. Queries need `WHERE allergen_id = X OR related_allergen_id = X`. More complex, harder to index.
- Application-level bidirectional resolution: Store one direction, resolve the reverse in code. Fragile and easy to forget.

**Rationale**: Storage cost is negligible (cross-reactions are rare, typically < 20 per tenant). The bidirectional storage eliminates OR queries and simplifies the data access pattern. A unique constraint on `(allergen_id, related_allergen_id)` prevents duplicates.

### D-04: Cache invalidation strategy for allergen mutations

**Decision**: When an allergen or product-allergen association is created/updated/deleted, invalidate the Redis menu cache for ALL branches of the tenant (not just one specific branch).

**Alternatives considered**:
- Invalidate only affected branches: Would require querying which branches have products linked to the modified allergen. Adds complexity and a DB query for cache invalidation.
- No cache invalidation (rely on TTL): 5-minute stale data for allergen changes is unacceptable for food safety.

**Rationale**: Allergens are tenant-scoped, so a change potentially affects all branches. The cost of invalidating multiple cache keys (`menu:{slug}` for each branch) is minimal (one Redis DELETE per branch). Branch count per tenant is small (typically < 20).

### D-05: Public allergen endpoint returns flat list, not nested

**Decision**: `GET /api/public/menu/{slug}/allergens` returns a flat list of all allergens present in the branch's active products, with counts per presence_type. This is separate from the nested menu response (which includes allergens inline per product).

**Alternatives considered**:
- Only include allergens in the nested menu response: Forces the client to parse the entire menu to build a filter UI. Wasteful for the common case of just showing allergen filter checkboxes.
- Return allergens grouped by product: Same as the nested menu, just restructured. No benefit over the existing nested response.

**Rationale**: The pwaMenu needs two things: (1) a list of allergens for the filter UI (this endpoint), and (2) per-product allergen data for rendering (already in the nested menu). Separate endpoints serve separate UI needs efficiently.

### D-06: Migration numbering is 005, not 003

**Decision**: The migration is `005_allergens.py` because 003 (menu-catalog) and 004 (ingredients-recipes) already exist.

**Rationale**: The CHANGES.md originally referenced 003 before other changes were implemented. The actual migration chain is sequential.

## Risks / Trade-offs

- **[Risk] Allergen data integrity** — Allergens are food safety data (CRITICO governance). A bug that hides an allergen or shows wrong `presence_type` could cause an allergic reaction. Mitigation: comprehensive test coverage for all presence types, cross-reactions, and the public endpoint. All changes require human review.

- **[Risk] Cache invalidation scope** — Invalidating ALL branch caches on any allergen mutation could cause brief cache stampedes if a tenant has many branches. Mitigation: acceptable at expected scale (< 20 branches per tenant). Redis DELETE is sub-millisecond.

- **[Trade-off] No ingredient-allergen auto-derivation** — Currently allergens are manually linked to products. In the future, when recipes link products to ingredients, allergens could be auto-derived from ingredient composition. Trade-off: manual process now, but simpler and more predictable. Auto-derivation is a future enhancement.

- **[Trade-off] Bidirectional cross-reaction storage** — Doubles the rows for cross-reactions. Trade-off: negligible storage cost for dramatically simpler queries. Cross-reaction count per tenant is small.

- **[Trade-off] Flat ProductAllergen table instead of enum columns** — `presence_type` and `risk_level` are strings, not PostgreSQL enums. Trade-off: easier migration and no ALTER TYPE needed for future values, but no DB-level validation. Validation happens in Pydantic schemas.

## File Structure

```
backend/
  rest_api/
    models/
      allergen.py           -- Allergen, ProductAllergen, AllergenCrossReaction
    routers/
      admin_allergens.py    -- Admin CRUD + product linking + cross-reactions
    services/
      domain/
        allergen_service.py -- AllergenService (extends BaseCRUDService)
    schemas/
      allergen.py           -- Pydantic request/response models
  alembic/
    versions/
      005_allergens.py      -- Migration: allergen, product_allergen, allergen_cross_reaction
  tests/
    test_allergens.py       -- Full test suite
```

## Open Questions

- **Q1**: Should `ProductAllergen` include `is_active` for soft delete, or should unlinking always hard-delete the junction row? Leaning hard-delete — the junction has no audit lifecycle, and re-linking creates a new row. This is an ephemeral record pattern.
- **Q2**: Should the 14 EU mandatory allergens be seeded in the migration or left to a separate seed script? Leaning separate seed script — the migration should only create tables, and tenants may customize their allergen catalog.
