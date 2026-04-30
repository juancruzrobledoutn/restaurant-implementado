## 1. Models

- [ ] 1.1 Create `backend/rest_api/models/allergen.py` with `Allergen` model: `id` (BigInteger PK), `tenant_id` (FK to app_tenant), `name` (String 255), `icon` (String nullable), `description` (String nullable), `is_mandatory` (Boolean default False), `severity` (String: mild/moderate/severe/life_threatening), inherits `AuditMixin`. Table name `allergen`. Index on `tenant_id`. Relationship to `product_allergens` and `cross_reactions`.
- [ ] 1.2 Add `ProductAllergen` model to `allergen.py`: `id` (BigInteger PK), `product_id` (FK to product), `allergen_id` (FK to allergen), `presence_type` (String: contains/may_contain/free_from), `risk_level` (String: mild/moderate/severe/life_threatening). Table name `product_allergen`. UniqueConstraint on `(product_id, allergen_id)`. Indexes on `product_id` and `allergen_id`. NO `is_active` field (ephemeral junction, hard-delete on unlink).
- [ ] 1.3 Add `AllergenCrossReaction` model to `allergen.py`: `id` (BigInteger PK), `allergen_id` (FK to allergen), `related_allergen_id` (FK to allergen). Table name `allergen_cross_reaction`. UniqueConstraint on `(allergen_id, related_allergen_id)`. Indexes on both FK columns.
- [ ] 1.4 Register all 3 models in `backend/rest_api/models/__init__.py`. Add `allergens` relationship to `Product` model in `menu.py` (via `ProductAllergen`, lazy='selectin' for public menu queries).

## 2. Migration

- [ ] 2.1 Create Alembic migration `backend/alembic/versions/005_allergens.py`: create tables `allergen`, `product_allergen`, `allergen_cross_reaction` with all columns, FKs, indexes, and constraints. Verify dependency chain with migration 004. Include `upgrade()` and `downgrade()` functions.

## 3. Schemas

- [ ] 3.1 Create `backend/rest_api/schemas/allergen.py` with Pydantic models: `AllergenCreate` (name, is_mandatory, severity, optional icon/description), `AllergenUpdate` (all optional), `AllergenResponse` (all fields + id + is_active + timestamps). Validate `severity` against allowed enum values.
- [ ] 3.2 Add product-allergen schemas: `ProductAllergenCreate` (allergen_id, presence_type, risk_level), `ProductAllergenResponse` (id, product_id, allergen_id, allergen_name, allergen_icon, presence_type, risk_level). Validate `presence_type` and `risk_level` against allowed enum values.
- [ ] 3.3 Add cross-reaction schemas: `CrossReactionCreate` (related_allergen_id), `CrossReactionResponse` (id, allergen_id, related_allergen_id, related_allergen_name).
- [ ] 3.4 Add public allergen response schemas: `PublicAllergenResponse` (id, name, icon, description, is_mandatory, severity, contains_count, may_contain_count, free_from_count), `PublicProductAllergenResponse` (id, name, icon, presence_type, risk_level) for embedding in public menu product response.

## 4. Domain Service

- [ ] 4.1 Create `backend/rest_api/services/domain/allergen_service.py` with `AllergenService` extending `BaseCRUDService[Allergen, AllergenResponse]`. Constructor takes `db`, `tenant_id`. Override `_base_query` to filter by `tenant_id` and `is_active.is_(True)`.
- [ ] 4.2 Add allergen CRUD methods: `create`, `get_by_id`, `list_all` (with pagination), `update`, `delete` (soft delete + cascade: remove linked ProductAllergen and AllergenCrossReaction records). Each mutation invalidates Redis menu cache for ALL branches of the tenant.
- [ ] 4.3 Add product-allergen linking methods: `link_product(product_id, allergen_id, presence_type, risk_level)` — validates product and allergen belong to same tenant, checks uniqueness (409 on duplicate), creates ProductAllergen record, invalidates cache for product's branch. `unlink_product(product_id, allergen_id)` — hard-deletes record, invalidates cache. `list_product_allergens(product_id)` — returns all linked allergens.
- [ ] 4.4 Add cross-reaction methods: `create_cross_reaction(allergen_id, related_allergen_id)` — validates both allergens exist and belong to same tenant, rejects self-reference (400), checks uniqueness (409), creates bidirectional records. `delete_cross_reaction(allergen_id, related_allergen_id)` — removes both direction records. `list_cross_reactions(allergen_id)` — returns related allergens.
- [ ] 4.5 Add cache invalidation helper: `_invalidate_tenant_caches()` — queries all branches for the tenant, calls `MenuCacheService.invalidate(branch.slug)` for each. `_invalidate_branch_cache(product_id)` — resolves product -> subcategory -> category -> branch chain, invalidates that branch's cache.

## 5. Admin Router

- [ ] 5.1 Create `backend/rest_api/routers/admin_allergens.py` with allergen CRUD endpoints: `POST /api/admin/allergens`, `GET /api/admin/allergens` (with pagination), `GET /api/admin/allergens/{id}`, `PUT /api/admin/allergens/{id}`, `DELETE /api/admin/allergens/{id}`. Use `current_user` dependency + `PermissionContext`. Create/update require ADMIN/MANAGER. Delete requires ADMIN.
- [ ] 5.2 Add product-allergen linking endpoints: `POST /api/admin/products/{product_id}/allergens`, `GET /api/admin/products/{product_id}/allergens`, `DELETE /api/admin/products/{product_id}/allergens/{allergen_id}`. Require ADMIN/MANAGER role.
- [ ] 5.3 Add cross-reaction endpoints: `POST /api/admin/allergens/{id}/cross-reactions`, `GET /api/admin/allergens/{id}/cross-reactions`, `DELETE /api/admin/allergens/{id}/cross-reactions/{related_id}`. Require ADMIN/MANAGER role.

## 6. Public Endpoint

- [ ] 6.1 Add `GET /api/public/menu/{slug}/allergens` to `backend/rest_api/routers/public_menu.py`: query all allergens linked to active products with active BranchProducts (is_available=True) for the branch. Aggregate counts per presence_type. Return 404 for unknown/inactive branch slug.
- [ ] 6.2 Extend the existing `GET /api/public/menu/{slug}` response to include allergens per product: modify the public menu query to eagerly load `product.product_allergens` -> `allergen`. Add `allergens` array to each product in the nested response. Update `PublicProductResponse` schema in `backend/rest_api/schemas/menu.py`.

## 7. Router Registration

- [ ] 7.1 Register `admin_allergens` router in `backend/rest_api/main.py` with prefix `/api/admin` and appropriate tags.
- [ ] 7.2 Update `backend/rest_api/services/domain/__init__.py` to export `AllergenService`.

## 8. Tests

- [ ] 8.1 Create `backend/tests/test_allergens.py`: test allergen CRUD (create, read, update, soft delete with cascade to ProductAllergen and CrossReaction records).
- [ ] 8.2 Add product-allergen linking tests: create link, duplicate returns 409, unlink (hard delete), list allergens for product, cross-tenant linking prevented.
- [ ] 8.3 Add cross-reaction tests: create bidirectional, duplicate returns 409, self-reference returns 400, delete removes both directions, list cross-reactions.
- [ ] 8.4 Add multi-tenant isolation tests: tenant A cannot see/modify tenant B's allergens.
- [ ] 8.5 Add RBAC tests: MANAGER can create/edit but not delete allergens, KITCHEN/WAITER get 403 on all admin allergen endpoints.
- [ ] 8.6 Add public endpoint tests: `GET /api/public/menu/{slug}/allergens` returns correct counts, excludes inactive products, returns 404 for unknown slug. Verify public menu response includes allergens per product.
- [ ] 8.7 Add cache invalidation tests: verify Redis menu cache is invalidated on allergen CRUD, product-allergen link/unlink, and that the public menu response reflects changes after invalidation.
