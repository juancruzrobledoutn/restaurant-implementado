# tenant-catalogs Specification

## Purpose
TBD - created by archiving change ingredients. Update Purpose after archive.
## Requirements
### Requirement: CookingMethod model is a tenant-scoped catalog

The `CookingMethod` model SHALL map to table `cooking_method` with columns: `id` (BigInteger PK autoincrement), `tenant_id` (BigInteger FK to `app_tenant.id`, NOT NULL), `name` (String(255), NOT NULL). It SHALL include `AuditMixin` fields. There SHALL be a B-tree index on `tenant_id`. The combination (`tenant_id`, `name`) SHALL be unique.

#### Scenario: Create a valid cooking method
- **WHEN** a CookingMethod is created with `tenant_id=1`, `name="Grill"`
- **THEN** it SHALL be persisted with `is_active=True` and timestamp fields populated

#### Scenario: Reject duplicate name within same tenant
- **WHEN** a CookingMethod is created with a `name` that already exists for the same `tenant_id`
- **THEN** the system SHALL return a 409 Conflict error

### Requirement: FlavorProfile model is a tenant-scoped catalog

The `FlavorProfile` model SHALL map to table `flavor_profile` with columns: `id` (BigInteger PK autoincrement), `tenant_id` (BigInteger FK to `app_tenant.id`, NOT NULL), `name` (String(255), NOT NULL). It SHALL include `AuditMixin` fields. There SHALL be a B-tree index on `tenant_id`. The combination (`tenant_id`, `name`) SHALL be unique.

#### Scenario: Create a valid flavor profile
- **WHEN** a FlavorProfile is created with `tenant_id=1`, `name="Sweet"`
- **THEN** it SHALL be persisted with `is_active=True` and timestamp fields populated

#### Scenario: Reject duplicate name within same tenant
- **WHEN** a FlavorProfile is created with a `name` that already exists for the same `tenant_id`
- **THEN** the system SHALL return a 409 Conflict error

### Requirement: TextureProfile model is a tenant-scoped catalog

The `TextureProfile` model SHALL map to table `texture_profile` with columns: `id` (BigInteger PK autoincrement), `tenant_id` (BigInteger FK to `app_tenant.id`, NOT NULL), `name` (String(255), NOT NULL). It SHALL include `AuditMixin` fields. There SHALL be a B-tree index on `tenant_id`. The combination (`tenant_id`, `name`) SHALL be unique.

#### Scenario: Create a valid texture profile
- **WHEN** a TextureProfile is created with `tenant_id=1`, `name="Crispy"`
- **THEN** it SHALL be persisted with `is_active=True` and timestamp fields populated

#### Scenario: Reject duplicate name within same tenant
- **WHEN** a TextureProfile is created with a `name` that already exists for the same `tenant_id`
- **THEN** the system SHALL return a 409 Conflict error

### Requirement: CuisineType model is a tenant-scoped catalog

The `CuisineType` model SHALL map to table `cuisine_type` with columns: `id` (BigInteger PK autoincrement), `tenant_id` (BigInteger FK to `app_tenant.id`, NOT NULL), `name` (String(255), NOT NULL). It SHALL include `AuditMixin` fields. There SHALL be a B-tree index on `tenant_id`. The combination (`tenant_id`, `name`) SHALL be unique.

#### Scenario: Create a valid cuisine type
- **WHEN** a CuisineType is created with `tenant_id=1`, `name="Italian"`
- **THEN** it SHALL be persisted with `is_active=True` and timestamp fields populated

#### Scenario: Reject duplicate name within same tenant
- **WHEN** a CuisineType is created with a `name` that already exists for the same `tenant_id`
- **THEN** the system SHALL return a 409 Conflict error

### Requirement: Catalog CRUD endpoints under /api/admin/

The system SHALL expose CRUD endpoints for each catalog type. All endpoints SHALL require JWT authentication with ADMIN role.

| Catalog | Base Path |
|---------|-----------|
| CookingMethod | `/api/admin/cooking-methods` |
| FlavorProfile | `/api/admin/flavor-profiles` |
| TextureProfile | `/api/admin/texture-profiles` |
| CuisineType | `/api/admin/cuisine-types` |

Each catalog SHALL support: `GET /` (list with pagination), `GET /{id}` (detail), `POST /` (create), `PUT /{id}` (update), `DELETE /{id}` (soft delete).

#### Scenario: List catalog items with pagination
- **WHEN** an ADMIN user sends `GET /api/admin/cooking-methods?limit=50&offset=0`
- **THEN** the system SHALL return a paginated list of active CookingMethod records for the user's tenant

#### Scenario: Create a catalog item
- **WHEN** an ADMIN user sends `POST /api/admin/flavor-profiles` with `{"name": "Umami"}`
- **THEN** the system SHALL create a FlavorProfile scoped to the user's tenant and return it with status 201

#### Scenario: Update a catalog item
- **WHEN** an ADMIN user sends `PUT /api/admin/texture-profiles/{id}` with `{"name": "Crunchy"}`
- **THEN** the system SHALL update the name and return the updated entity

#### Scenario: Soft delete a catalog item
- **WHEN** an ADMIN user sends `DELETE /api/admin/cuisine-types/{id}`
- **THEN** the system SHALL set `is_active=False` and return status 204

#### Scenario: Reject non-ADMIN access to catalog endpoints
- **WHEN** a user with MANAGER, KITCHEN, or WAITER role sends any request to catalog endpoints
- **THEN** the system SHALL return 403 Forbidden

### Requirement: Catalog queries are tenant-isolated

All catalog queries SHALL filter by the authenticated user's `tenant_id`. A user SHALL never see or modify catalog items belonging to a different tenant.

#### Scenario: Tenant A cannot see Tenant B catalog items
- **WHEN** a user from Tenant A sends `GET /api/admin/cooking-methods`
- **THEN** the response SHALL contain only CookingMethod records where `tenant_id` matches Tenant A

#### Scenario: Cross-tenant catalog modification returns 404
- **WHEN** a user from Tenant A sends `PUT /api/admin/flavor-profiles/{id}` where `{id}` belongs to Tenant B
- **THEN** the system SHALL return 404 Not Found

