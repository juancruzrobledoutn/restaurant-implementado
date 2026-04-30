## Why

The system has authentication and authorization (C-03) but no product catalog. Every customer-facing feature (ordering, billing, kitchen display) depends on a structured menu: categories, subcategories, products, and per-branch pricing. Without the menu catalog, there is no data for diners to browse, no items for rounds to reference, and no prices to calculate charges. C-04 is on the critical path -- it unblocks C-05 (allergens), C-07 (sectors-tables), C-15 (dashboard-menu), and C-17 (pwaMenu-shell).

## What Changes

- **Models**: `Category` (branch-scoped, ordered), `Subcategory` (category child, ordered), `Product` (subcategory child, price in cents, featured/popular flags), `BranchProduct` (per-branch pricing override and availability toggle via `is_available` distinct from `is_active` soft delete).
- **Domain services**: `CategoryService`, `SubcategoryService`, `ProductService` extending `BranchScopedService` with validation hooks and cache invalidation side effects.
- **Admin CRUD endpoints**: `POST/GET/PUT/DELETE /api/admin/categories`, `/api/admin/subcategories`, `/api/admin/products`, `/api/admin/branch-products` -- all branch-scoped, paginated (`?limit=50&offset=0`), protected by JWT + `PermissionContext` (ADMIN/MANAGER create/edit, ADMIN delete).
- **Public menu endpoint**: `GET /api/public/menu/{slug}` -- returns the full nested menu (categories -> subcategories -> products with branch-specific pricing) for a branch identified by slug. Cached in Redis with 5-minute TTL, automatically invalidated on any CRUD operation affecting the branch's menu.
- **Image URL validation**: Anti-SSRF validation on image URLs (allowlist of schemes + hostname checks) before persisting.
- **Pydantic schemas**: Request/response models for all CRUD operations and the public menu response.
- **Alembic migration**: Creates `category`, `subcategory`, `product`, `branch_product` tables with proper FKs, indexes, and constraints.
- **Tests**: CRUD operations, multi-tenant isolation, Redis cache invalidation, public menu endpoint, image URL validation.

## Capabilities

### New Capabilities
- `menu-catalog`: Full menu catalog system covering Category/Subcategory/Product/BranchProduct models, admin CRUD endpoints, public menu endpoint with Redis caching, and image URL anti-SSRF validation.

### Modified Capabilities
_(none -- no existing specs are modified by this change)_

## Impact

- **Backend files created**:
  - `backend/rest_api/models/menu.py` -- Category, Subcategory, Product, BranchProduct models
  - `backend/rest_api/services/domain/category_service.py` -- CategoryService
  - `backend/rest_api/services/domain/subcategory_service.py` -- SubcategoryService
  - `backend/rest_api/services/domain/product_service.py` -- ProductService
  - `backend/rest_api/routers/admin_menu.py` -- admin CRUD router (categories, subcategories, products, branch-products)
  - `backend/rest_api/routers/public_menu.py` -- public menu endpoint
  - `backend/rest_api/schemas/menu.py` -- Pydantic request/response schemas
  - `backend/rest_api/services/domain/menu_cache_service.py` -- Redis cache get/set/invalidate for public menu
  - `backend/shared/utils/url_validation.py` -- image URL anti-SSRF validation
  - `backend/alembic/versions/003_menu_catalog.py` -- migration for menu tables
- **Backend files modified**:
  - `backend/rest_api/models/__init__.py` -- register new models
  - `backend/rest_api/main.py` -- register new routers
- **Infrastructure dependencies**: Redis 7 (menu cache), PostgreSQL 16
- **API surface**: 16+ new endpoints (4 CRUD x 4 entities + 1 public)
- **Downstream impact**: C-05 (allergens) adds ProductAllergen to Product; C-07 (sectors-tables) depends on branch structure; C-15 (dashboard-menu) builds UI on these endpoints; C-17 (pwaMenu-shell) consumes the public menu endpoint
