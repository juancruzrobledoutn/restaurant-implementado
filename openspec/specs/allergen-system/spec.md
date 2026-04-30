# allergen-system Specification

## Purpose
TBD - created by archiving change allergens. Update Purpose after archive.
## Requirements
### Requirement: Allergen CRUD
The system SHALL provide admin CRUD endpoints for allergens at `/api/admin/allergens`. Allergens are tenant-scoped: each allergen belongs to a tenant and is shared across all its branches. Allergens MUST have a `name`, `is_mandatory` (boolean, EU 1169/2011 compliance), and `severity` (one of: `mild`, `moderate`, `severe`, `life_threatening`). Optional fields: `icon` (string), `description` (string). All CRUD operations MUST require JWT authentication. Create and update MUST require ADMIN or MANAGER role. Delete MUST require ADMIN role. Delete SHALL perform soft delete (`is_active=False`). All list queries MUST filter by `tenant_id` with pagination (`?limit=50&offset=0`).

#### Scenario: Create an allergen
- **WHEN** an ADMIN sends `POST /api/admin/allergens` with `{"name": "Gluten", "is_mandatory": true, "severity": "severe"}`
- **THEN** the system creates the allergen scoped to the user's tenant, returns 201 with the created allergen, and invalidates the Redis menu cache for all branches of the tenant

#### Scenario: List allergens for tenant
- **WHEN** an authenticated user sends `GET /api/admin/allergens?limit=50&offset=0`
- **THEN** the system returns only active allergens for the user's tenant, ordered by name

#### Scenario: Update an allergen
- **WHEN** an ADMIN or MANAGER sends `PUT /api/admin/allergens/{id}` with updated fields
- **THEN** the system updates the allergen, returns 200, and invalidates the Redis menu cache for all branches of the tenant

#### Scenario: Delete an allergen with cascade
- **WHEN** an ADMIN sends `DELETE /api/admin/allergens/{id}`
- **THEN** the system soft-deletes the allergen, removes all associated ProductAllergen records, removes all associated AllergenCrossReaction records, returns 200 with an `affected` count, and invalidates the Redis menu cache

#### Scenario: MANAGER cannot delete allergens
- **WHEN** a MANAGER sends `DELETE /api/admin/allergens/{id}`
- **THEN** the system returns 403 Forbidden

#### Scenario: Multi-tenant isolation
- **WHEN** a user from tenant A tries to access an allergen belonging to tenant B
- **THEN** the system returns 404 Not Found (the allergen does not exist in tenant A's scope)

#### Scenario: KITCHEN and WAITER cannot manage allergens
- **WHEN** a KITCHEN or WAITER user sends any POST/PUT/DELETE to `/api/admin/allergens`
- **THEN** the system returns 403 Forbidden

### Requirement: Product-Allergen Linking
The system SHALL allow linking allergens to products with metadata about presence type and risk level. Linking is managed via `POST /api/admin/products/{product_id}/allergens` and unlinking via `DELETE /api/admin/products/{product_id}/allergens/{allergen_id}`. Each link MUST include `presence_type` (one of: `contains`, `may_contain`, `free_from`) and `risk_level` (one of: `mild`, `moderate`, `severe`, `life_threatening`). A product-allergen pair MUST be unique — duplicate linking SHALL return 409 Conflict. Linking and unlinking MUST require ADMIN or MANAGER role.

#### Scenario: Link allergen to product
- **WHEN** an ADMIN sends `POST /api/admin/products/{product_id}/allergens` with `{"allergen_id": 1, "presence_type": "contains", "risk_level": "severe"}`
- **THEN** the system creates the ProductAllergen record, returns 201, and invalidates the Redis menu cache for the product's branch

#### Scenario: Duplicate link returns 409
- **WHEN** an ADMIN sends `POST /api/admin/products/{product_id}/allergens` with an allergen that is already linked
- **THEN** the system returns 409 Conflict

#### Scenario: Unlink allergen from product
- **WHEN** an ADMIN sends `DELETE /api/admin/products/{product_id}/allergens/{allergen_id}`
- **THEN** the system hard-deletes the ProductAllergen record, returns 200, and invalidates the Redis menu cache

#### Scenario: List allergens for a product
- **WHEN** an authenticated user sends `GET /api/admin/products/{product_id}/allergens`
- **THEN** the system returns all linked allergens for that product with their `presence_type` and `risk_level`

#### Scenario: Cross-tenant product-allergen linking is prevented
- **WHEN** a user tries to link an allergen from tenant A to a product from tenant B
- **THEN** the system returns 404 (allergen or product not found in the user's tenant scope)

### Requirement: Allergen Cross-Reactions
The system SHALL allow tracking cross-reactions between allergens. Cross-reactions are created via `POST /api/admin/allergens/{id}/cross-reactions` and removed via `DELETE /api/admin/allergens/{id}/cross-reactions/{related_id}`. Cross-reactions MUST be stored bidirectionally: creating a reaction from A to B also creates B to A. Removing a reaction removes both directions. Cross-reactions MUST require ADMIN or MANAGER role. A cross-reaction between the same allergen (self-reference) SHALL return 400 Bad Request.

#### Scenario: Create cross-reaction
- **WHEN** an ADMIN sends `POST /api/admin/allergens/{id}/cross-reactions` with `{"related_allergen_id": 5}`
- **THEN** the system creates two AllergenCrossReaction records (A->B and B->A), returns 201

#### Scenario: List cross-reactions for an allergen
- **WHEN** an authenticated user sends `GET /api/admin/allergens/{id}/cross-reactions`
- **THEN** the system returns all allergens that have a cross-reaction with the specified allergen

#### Scenario: Remove cross-reaction
- **WHEN** an ADMIN sends `DELETE /api/admin/allergens/{id}/cross-reactions/{related_id}`
- **THEN** the system removes both direction records (A->B and B->A), returns 200

#### Scenario: Duplicate cross-reaction returns 409
- **WHEN** a user tries to create a cross-reaction that already exists
- **THEN** the system returns 409 Conflict

#### Scenario: Self-referencing cross-reaction returns 400
- **WHEN** a user sends `POST /api/admin/allergens/{id}/cross-reactions` with `{"related_allergen_id": id}` (same allergen)
- **THEN** the system returns 400 Bad Request

### Requirement: Public Allergen Endpoint
The system SHALL provide a public endpoint `GET /api/public/menu/{slug}/allergens` that returns all allergens present in the branch's active products. This endpoint requires no authentication. The response MUST include each allergen's name, icon, description, is_mandatory, severity, and the count of products per presence_type (`contains_count`, `may_contain_count`, `free_from_count`). Only allergens linked to active products with active BranchProduct records (is_available=True) SHALL be included.

#### Scenario: Get allergens for a branch
- **WHEN** any client sends `GET /api/public/menu/{slug}/allergens`
- **THEN** the system returns a list of allergens with product counts per presence type for that branch

#### Scenario: Inactive products are excluded
- **WHEN** a product is soft-deleted or its BranchProduct is unavailable
- **THEN** allergens linked only to that product are excluded from the public response (or their counts decrease)

#### Scenario: Unknown branch slug returns 404
- **WHEN** a client sends `GET /api/public/menu/nonexistent/allergens`
- **THEN** the system returns 404 Not Found

### Requirement: Allergen Data Model
The system SHALL store allergens in the `allergen` table with columns: `id` (BigInteger PK), `tenant_id` (BigInteger FK to app_tenant), `name` (String 255), `icon` (String nullable), `description` (String nullable), `is_mandatory` (Boolean), `severity` (String: mild/moderate/severe/life_threatening), `is_active` (Boolean), plus AuditMixin fields. The `product_allergen` junction table SHALL have columns: `id` (BigInteger PK), `product_id` (BigInteger FK to product), `allergen_id` (BigInteger FK to allergen), `presence_type` (String: contains/may_contain/free_from), `risk_level` (String: mild/moderate/severe/life_threatening), with a UniqueConstraint on `(product_id, allergen_id)`. The `allergen_cross_reaction` table SHALL have columns: `id` (BigInteger PK), `allergen_id` (BigInteger FK to allergen), `related_allergen_id` (BigInteger FK to allergen), with a UniqueConstraint on `(allergen_id, related_allergen_id)`.

#### Scenario: Allergen table has correct schema
- **WHEN** the migration runs
- **THEN** the `allergen` table exists with all specified columns, FKs to `app_tenant`, and indexes on `tenant_id`

#### Scenario: ProductAllergen uniqueness enforced
- **WHEN** a duplicate `(product_id, allergen_id)` is inserted
- **THEN** the database raises an IntegrityError

#### Scenario: Cross-reaction uniqueness enforced
- **WHEN** a duplicate `(allergen_id, related_allergen_id)` is inserted
- **THEN** the database raises an IntegrityError

