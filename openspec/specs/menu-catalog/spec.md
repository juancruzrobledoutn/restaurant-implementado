# menu-catalog Specification

## Purpose
TBD - created by archiving change menu-catalog. Update Purpose after archive.
## Requirements
### Requirement: Category CRUD
The system SHALL provide admin CRUD endpoints for menu categories at `/api/admin/categories`. Categories are branch-scoped: each category belongs to exactly one branch. Categories MUST have a `name`, `order` (integer for display ordering), and optional `icon` and `image` fields. All CRUD operations MUST require JWT authentication. Create and update MUST require ADMIN or MANAGER role with branch access. Delete MUST require ADMIN role. Delete SHALL perform soft delete (set `is_active=False`) and cascade to subcategories and products. All list queries MUST filter by `tenant_id` and `branch_id`, with pagination (`?limit=50&offset=0`).

#### Scenario: Create a category
- **WHEN** an ADMIN or MANAGER sends `POST /api/admin/categories` with `{"branch_id": 1, "name": "Entradas", "order": 10}`
- **THEN** the system creates the category, returns 201 with the created category, and invalidates the Redis menu cache for that branch

#### Scenario: List categories by branch
- **WHEN** an authenticated user sends `GET /api/admin/categories?branch_id=1&limit=50&offset=0`
- **THEN** the system returns only active categories for that branch within the user's tenant, ordered by `order` field

#### Scenario: Update a category
- **WHEN** an ADMIN or MANAGER sends `PUT /api/admin/categories/{id}` with updated fields
- **THEN** the system updates the category, returns 200 with the updated category, and invalidates the Redis menu cache

#### Scenario: Delete a category with cascade
- **WHEN** an ADMIN sends `DELETE /api/admin/categories/{id}`
- **THEN** the system soft-deletes the category and all its subcategories and products, returns 200 with an `affected` count, and invalidates the Redis menu cache

#### Scenario: MANAGER cannot delete
- **WHEN** a MANAGER sends `DELETE /api/admin/categories/{id}`
- **THEN** the system returns 403 Forbidden

#### Scenario: Multi-tenant isolation
- **WHEN** a user from tenant A tries to access a category belonging to tenant B
- **THEN** the system returns 404 (category not found within the user's tenant)

### Requirement: Subcategory CRUD
The system SHALL provide admin CRUD endpoints for subcategories at `/api/admin/subcategories`. Subcategories belong to a category. They MUST have a `name`, `order` (integer), and optional `image` field. Authorization rules follow the same pattern as categories. Delete SHALL cascade soft delete to products.

#### Scenario: Create a subcategory
- **WHEN** an ADMIN or MANAGER sends `POST /api/admin/subcategories` with `{"category_id": 1, "name": "Ensaladas", "order": 10}`
- **THEN** the system creates the subcategory, returns 201, and invalidates the menu cache for the parent category's branch

#### Scenario: List subcategories by category
- **WHEN** an authenticated user sends `GET /api/admin/subcategories?category_id=1`
- **THEN** the system returns only active subcategories for that category, ordered by `order` field

#### Scenario: Delete cascades to products
- **WHEN** an ADMIN deletes a subcategory that has 5 active products
- **THEN** all 5 products are soft-deleted, and the response includes `{"affected": {"Product": 5}}`

### Requirement: Product CRUD
The system SHALL provide admin CRUD endpoints for products at `/api/admin/products`. Products belong to a subcategory. They MUST have `name`, `price` (integer in cents), and optional `description`, `image`, `featured` (boolean), `popular` (boolean) fields. Price MUST be a positive integer representing cents. Image URLs MUST pass anti-SSRF validation before being stored.

#### Scenario: Create a product with valid price
- **WHEN** an ADMIN or MANAGER sends `POST /api/admin/products` with `{"subcategory_id": 1, "name": "Caesar Salad", "price": 12550, "featured": true}`
- **THEN** the system creates the product with price stored as 12550 cents, returns 201, and invalidates the menu cache

#### Scenario: Reject negative price
- **WHEN** a user sends `POST /api/admin/products` with `{"price": -100}`
- **THEN** the system returns 422 with a validation error

#### Scenario: Reject SSRF image URL
- **WHEN** a user sends `POST /api/admin/products` with `{"image": "http://169.254.169.254/latest/meta-data/"}`
- **THEN** the system returns 422 with a validation error indicating the image URL is not allowed

#### Scenario: Accept valid HTTPS image URL
- **WHEN** a user sends `POST /api/admin/products` with `{"image": "https://cdn.example.com/salad.jpg"}`
- **THEN** the system accepts the URL and stores it

### Requirement: BranchProduct management
The system SHALL provide admin endpoints at `/api/admin/branch-products` to manage per-branch product availability and pricing. BranchProduct links a product to a branch with a `price_cents` (integer, branch-specific price) and `is_available` (boolean, runtime availability toggle). `is_available` is distinct from `is_active` (soft delete). A product is visible in a branch's menu only when it has a BranchProduct record where both `is_active` is True and `is_available` is True.

#### Scenario: Create branch product pricing
- **WHEN** an ADMIN or MANAGER sends `POST /api/admin/branch-products` with `{"product_id": 1, "branch_id": 1, "price_cents": 13000, "is_available": true}`
- **THEN** the system creates the BranchProduct record and invalidates the menu cache for that branch

#### Scenario: Toggle product availability
- **WHEN** an ADMIN or MANAGER sends `PUT /api/admin/branch-products/{id}` with `{"is_available": false}`
- **THEN** the system sets `is_available=False` (product hidden from public menu but record preserved), and invalidates the menu cache

#### Scenario: Prevent duplicate branch-product
- **WHEN** a user tries to create a BranchProduct for a product that already has one in the same branch
- **THEN** the system returns 409 Conflict

### Requirement: Public menu endpoint
The system SHALL provide a public endpoint `GET /api/public/menu/{slug}` that returns the complete nested menu for a branch identified by its slug. No authentication is required. The response MUST include the branch info plus all active categories, their active subcategories, and their active products with branch-specific pricing. Products without a BranchProduct record for this branch, or with `is_available=False`, MUST be excluded. Each product in the response MUST include an `allergens` array containing all linked allergens with their `presence_type` and `risk_level`. Products with no linked allergens MUST include an empty `allergens` array.

#### Scenario: Fetch full menu by slug
- **WHEN** any client sends `GET /api/public/menu/centro`
- **THEN** the system returns a nested JSON with branch info, categories (ordered), subcategories (ordered), and products with `price_cents` from BranchProduct

#### Scenario: Menu served from cache
- **WHEN** the menu for slug `centro` was fetched within the last 5 minutes and no CRUD operations occurred
- **THEN** the response is served from Redis cache without hitting the database

#### Scenario: Cache invalidated on CRUD
- **WHEN** an admin creates/updates/deletes a category, subcategory, product, branch-product, or allergen-related record for the branch with slug `centro`
- **THEN** the Redis cache key `menu:centro` is deleted, and the next request rebuilds from the database

#### Scenario: Unknown slug
- **WHEN** a client sends `GET /api/public/menu/nonexistent`
- **THEN** the system returns 404

#### Scenario: Inactive branch
- **WHEN** a client sends `GET /api/public/menu/{slug}` for a branch where `is_active=False`
- **THEN** the system returns 404

#### Scenario: Products include allergen data
- **WHEN** a product has linked allergens (e.g., Gluten with presence_type=contains, risk_level=severe)
- **THEN** the product in the menu response includes `"allergens": [{"id": 1, "name": "Gluten", "icon": "...", "presence_type": "contains", "risk_level": "severe"}]`

#### Scenario: Products without allergens include empty array
- **WHEN** a product has no linked allergens
- **THEN** the product in the menu response includes `"allergens": []`

### Requirement: Image URL anti-SSRF validation
The system SHALL validate all image URLs submitted via product and category endpoints. Validation MUST reject: non-HTTPS schemes (http, ftp, file, data), private/loopback IP addresses (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, ::1), non-standard ports, and URLs without a valid hostname. Validation MUST allow: HTTPS URLs pointing to public hostnames.

#### Scenario: Reject HTTP scheme
- **WHEN** an image URL with `http://` scheme is submitted
- **THEN** the system rejects it with a 422 validation error

#### Scenario: Reject private IP
- **WHEN** an image URL pointing to `https://192.168.1.1/image.png` is submitted
- **THEN** the system rejects it with a 422 validation error

#### Scenario: Reject loopback
- **WHEN** an image URL pointing to `https://127.0.0.1/image.png` is submitted
- **THEN** the system rejects it with a 422 validation error

#### Scenario: Allow valid CDN URL
- **WHEN** an image URL `https://images.unsplash.com/photo-123.jpg` is submitted
- **THEN** the system accepts it

#### Scenario: Null image is valid
- **WHEN** no image URL is provided (null/omitted)
- **THEN** the system accepts it (image is optional)

### Requirement: Menu catalog database migration
The system SHALL include an Alembic migration that creates the `category`, `subcategory`, `product`, and `branch_product` tables. The migration MUST include proper foreign keys, indexes on `branch_id` and `tenant_id` lookup paths, a unique constraint on `(product_id, branch_id)` for `branch_product`, and `is_active` default True on all tables. The migration MUST depend on the previous migration chain.

#### Scenario: Migration creates all tables
- **WHEN** `alembic upgrade head` is executed
- **THEN** tables `category`, `subcategory`, `product`, `branch_product` exist with all columns and constraints

#### Scenario: Migration is reversible
- **WHEN** `alembic downgrade -1` is executed after running the migration
- **THEN** the 4 tables are dropped cleanly

### Requirement: Pagination on admin list endpoints
All admin list endpoints (`/api/admin/categories`, `/api/admin/subcategories`, `/api/admin/products`, `/api/admin/branch-products`) MUST support pagination via query parameters `limit` (default 50, max 100) and `offset` (default 0). Results MUST be ordered consistently (by `order` for categories/subcategories, by `id` for products/branch-products).

#### Scenario: Default pagination
- **WHEN** a user sends `GET /api/admin/categories?branch_id=1` without limit/offset
- **THEN** the system returns up to 50 results starting from offset 0

#### Scenario: Custom pagination
- **WHEN** a user sends `GET /api/admin/products?subcategory_id=1&limit=10&offset=20`
- **THEN** the system returns up to 10 results starting from offset 20

#### Scenario: Limit capped at 100
- **WHEN** a user sends `GET /api/admin/products?limit=500`
- **THEN** the system caps the limit to 100 results

