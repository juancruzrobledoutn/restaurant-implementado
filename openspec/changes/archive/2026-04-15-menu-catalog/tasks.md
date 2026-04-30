## 1. Models

- [x] 1.1 Create `backend/rest_api/models/menu.py` with `Category` model: `id` (BigInteger PK), `branch_id` (FK to branch), `name` (String 255), `icon` (String nullable), `image` (String nullable), `order` (Integer), inherits `AuditMixin`. Table name `category`. Index on `branch_id`. Relationship to `subcategories`.
- [x] 1.2 Add `Subcategory` model to `menu.py`: `id` (BigInteger PK), `category_id` (FK to category), `name` (String 255), `image` (String nullable), `order` (Integer), inherits `AuditMixin`. Table name `subcategory`. Index on `category_id`. Relationship to `products`.
- [x] 1.3 Add `Product` model to `menu.py`: `id` (BigInteger PK), `subcategory_id` (FK to subcategory), `name` (String 255), `description` (String nullable), `price` (Integer, cents), `image` (String nullable), `featured` (Boolean default False), `popular` (Boolean default False), inherits `AuditMixin`. Table name `product`. Index on `subcategory_id`. Relationship to `branch_products`.
- [x] 1.4 Add `BranchProduct` model to `menu.py`: `id` (BigInteger PK), `product_id` (FK to product), `branch_id` (FK to branch), `price_cents` (Integer), `is_available` (Boolean default True), inherits `AuditMixin`. Table name `branch_product`. UniqueConstraint on `(product_id, branch_id)`. Indexes on `product_id` and `branch_id`.
- [x] 1.5 Register all 4 models in `backend/rest_api/models/__init__.py` and add relationships to `Branch` model (categories, branch_products).

## 2. Migration

- [x] 2.1 Create Alembic migration `backend/alembic/versions/003_menu_catalog.py`: create tables `category`, `subcategory`, `product`, `branch_product` with all columns, FKs, indexes, and constraints. Verify dependency chain with previous migration. Include `upgrade()` and `downgrade()` functions.

## 3. Schemas

- [x] 3.1 Create `backend/rest_api/schemas/menu.py` with Pydantic models: `CategoryCreate`, `CategoryUpdate`, `CategoryResponse`, `SubcategoryCreate`, `SubcategoryUpdate`, `SubcategoryResponse`, `ProductCreate`, `ProductUpdate`, `ProductResponse`, `BranchProductCreate`, `BranchProductUpdate`, `BranchProductResponse`. Prices validated as positive integers. Image URLs validated via `validate_image_url()`.
- [x] 3.2 Add public menu response schemas: `PublicMenuResponse` (nested structure with branch info, categories, subcategories, products with branch pricing), `PublicProductResponse` (includes `price_cents` and `is_available` from BranchProduct).

## 4. URL Validation Utility

- [x] 4.1 Create `backend/shared/utils/url_validation.py` with `validate_image_url(url: str | None) -> str | None`: allow only `https://` scheme, reject private/loopback IPs (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, ::1), reject non-standard ports, reject URLs without valid hostname. Return url if valid, raise `ValidationError` if invalid. Accept `None` (image is optional).

## 5. Cache Service

- [x] 5.1 Create `backend/rest_api/services/domain/menu_cache_service.py` with `MenuCacheService`: `get_menu(branch_slug: str)` returns cached JSON or None, `set_menu(branch_slug: str, data: dict)` stores JSON with 5-min TTL, `invalidate(branch_slug: str)` deletes key `menu:{branch_slug}`. Use Redis connection from shared infrastructure. Silently handle Redis failures (log warning, return None on get, skip on set/invalidate).

## 6. Domain Services

- [x] 6.1 Create `backend/rest_api/services/domain/category_service.py` with `CategoryService` extending `BranchScopedService[Category, CategoryResponse]`. Override `_validate_create` to check branch exists and belongs to tenant. Override `_after_create`, `_after_update`, `_after_delete` to invalidate menu cache for the category's branch slug. Override `_after_delete` to also cascade soft delete to subcategories and their products.
- [x] 6.2 Create `backend/rest_api/services/domain/subcategory_service.py` with `SubcategoryService` extending `BranchScopedService[Subcategory, SubcategoryResponse]`. Validate that parent category exists and is active. Cache invalidation via branch slug lookup. Cascade soft delete to products on delete.
- [x] 6.3 Create `backend/rest_api/services/domain/product_service.py` with `ProductService` extending `BranchScopedService[Product, ProductResponse]`. Validate subcategory exists and is active. Validate image URL via `validate_image_url()`. Validate price is positive integer. Cache invalidation via branch slug lookup through subcategory -> category -> branch chain.
- [x] 6.4 Add BranchProduct management methods to `ProductService` (or create a standalone `BranchProductService`): create BranchProduct with uniqueness check (409 on duplicate), update `price_cents` and `is_available`, soft delete. Each mutation invalidates the menu cache for the affected branch.

## 7. Admin Router

- [x] 7.1 Create `backend/rest_api/routers/admin_menu.py` with admin CRUD endpoints for categories: `POST /api/admin/categories`, `GET /api/admin/categories` (with `branch_id` query param, pagination), `GET /api/admin/categories/{id}`, `PUT /api/admin/categories/{id}`, `DELETE /api/admin/categories/{id}`. Use `current_user` dependency + `PermissionContext`. Create/update require ADMIN/MANAGER + branch access. Delete requires ADMIN.
- [x] 7.2 Add subcategory CRUD endpoints to `admin_menu.py`: same pattern as categories but filtered by `category_id`.
- [x] 7.3 Add product CRUD endpoints to `admin_menu.py`: same pattern, filtered by `subcategory_id`.
- [x] 7.4 Add branch-product endpoints to `admin_menu.py`: `POST /api/admin/branch-products`, `GET /api/admin/branch-products` (with `branch_id` query param), `PUT /api/admin/branch-products/{id}`, `DELETE /api/admin/branch-products/{id}`.

## 8. Public Menu Router

- [x] 8.1 Create `backend/rest_api/routers/public_menu.py` with `GET /api/public/menu/{slug}`: look up branch by slug, check cache first, if miss then query categories -> subcategories -> products -> branch_products with eager loading (`selectinload`), filter active + available, serialize to nested JSON, cache result, return 200. Return 404 if branch not found or inactive.

## 9. Router Registration

- [x] 9.1 Register `admin_menu` router in `backend/rest_api/main.py` with prefix `/api/admin` and appropriate tags.
- [x] 9.2 Register `public_menu` router in `backend/rest_api/main.py` with prefix `/api/public` and appropriate tags.

## 10. Tests

- [x] 10.1 Create `backend/tests/test_menu_crud.py`: test Category CRUD (create, read, update, delete with cascade), test Subcategory CRUD, test Product CRUD (price validation, image URL validation), test BranchProduct CRUD (duplicate prevention, availability toggle).
- [x] 10.2 Add multi-tenant isolation tests to `test_menu_crud.py`: verify tenant A cannot see/modify tenant B's categories/products.
- [x] 10.3 Add RBAC tests to `test_menu_crud.py`: verify MANAGER can create/edit but not delete, KITCHEN/WAITER get 403 on all admin endpoints.
- [x] 10.4 Create `backend/tests/test_public_menu.py`: test full menu response structure (nested categories/subcategories/products), test cache hit (second request doesn't query DB), test cache invalidation on CRUD, test 404 for unknown slug, test 404 for inactive branch, test products with `is_available=False` excluded.
- [x] 10.5 Create `backend/tests/test_url_validation.py`: test reject HTTP scheme, test reject private IPs, test reject loopback, test reject non-standard ports, test accept valid HTTPS URLs, test accept None.
