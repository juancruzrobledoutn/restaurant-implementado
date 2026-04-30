## Why

The menu catalog (C-04) serves products but carries no allergen information. EU Regulation 1169/2011 mandates that food businesses declare the presence of 14 major allergens. Without the allergen system, diners with allergies cannot safely order, the restaurant is non-compliant, and the public menu endpoint is incomplete. C-05 is on the critical path — it unblocks C-15 (dashboard-menu, which needs allergen management UI) and enriches the pwaMenu filtering experience for diners.

## What Changes

- **Models**: `Allergen` (tenant-scoped, with `is_mandatory`, `severity`, `icon`, `description`), `ProductAllergen` (M:N junction with `presence_type` enum: `contains`/`may_contain`/`free_from` and `risk_level` enum: `mild`/`moderate`/`severe`/`life_threatening`), `AllergenCrossReaction` (self-referential for cross-reaction tracking, e.g., latex ↔ kiwi).
- **Domain service**: `AllergenService` extending `BaseCRUDService` (tenant-scoped, not branch-scoped). Methods for CRUD, product-allergen linking/unlinking, and cross-reaction management.
- **Admin CRUD endpoints**: `POST/GET/PUT/DELETE /api/admin/allergens` — tenant-scoped, RBAC-protected (ADMIN/MANAGER create/edit, ADMIN delete). `POST/DELETE /api/admin/products/{id}/allergens` for product-allergen linking. `POST/DELETE /api/admin/allergens/{id}/cross-reactions` for cross-reaction management.
- **Public allergen endpoint**: `GET /api/public/menu/{slug}/allergens` — returns all allergens for a branch's active products, enabling client-side filtering.
- **Public menu enrichment**: The existing `GET /api/public/menu/{slug}` response is extended to include allergens per product (with `presence_type` and `risk_level`).
- **Pydantic schemas**: Request/response models for allergen CRUD, product-allergen linking, cross-reactions, and public allergen responses.
- **Alembic migration 005**: Creates `allergen`, `product_allergen`, `allergen_cross_reaction` tables with proper FKs, indexes, and constraints.
- **Tests**: CRUD allergens, product-allergen linking, cross-reaction CRUD, public allergen endpoint, multi-tenant isolation, RBAC enforcement.

## Capabilities

### New Capabilities
- `allergen-system`: Allergen catalog (tenant-scoped CRUD), product-allergen association with presence/risk metadata, cross-reaction tracking, and public allergen endpoint for diner-facing allergy filtering.

### Modified Capabilities
- `menu-catalog`: The public menu response is extended to include allergen data per product. The Product model gains a relationship to ProductAllergen. Cache invalidation must also trigger on allergen-related mutations.

## Impact

- **Backend files created**:
  - `backend/rest_api/models/allergen.py` — Allergen, ProductAllergen, AllergenCrossReaction models
  - `backend/rest_api/services/domain/allergen_service.py` — AllergenService
  - `backend/rest_api/routers/admin_allergens.py` — admin CRUD + product linking + cross-reactions
  - `backend/rest_api/schemas/allergen.py` — Pydantic request/response schemas
  - `backend/alembic/versions/005_allergens.py` — migration for allergen tables
  - `backend/tests/test_allergens.py` — full test suite
- **Backend files modified**:
  - `backend/rest_api/models/__init__.py` — register new models
  - `backend/rest_api/models/menu.py` — add `allergens` relationship to Product
  - `backend/rest_api/routers/public_menu.py` — include allergens in public menu response + new `/allergens` endpoint
  - `backend/rest_api/schemas/menu.py` — extend PublicProductResponse with allergen data
  - `backend/rest_api/services/domain/menu_cache_service.py` — invalidate on allergen mutations
  - `backend/rest_api/main.py` — register new router
- **Infrastructure dependencies**: PostgreSQL 16 (new tables), Redis 7 (cache invalidation)
- **API surface**: ~10 new endpoints (allergen CRUD, product linking, cross-reactions, public allergen endpoint)
- **Governance**: CRITICO — allergens are food safety data; all changes require human review
- **Downstream impact**: C-15 (dashboard-menu) builds allergen management UI on these endpoints; pwaMenu diner filtering depends on the public allergen data
