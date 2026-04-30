## Context

The system has core models (Tenant, Branch, User, UserBranchRole) from C-02 and a complete auth stack (JWT, 2FA, rate limiting, RBAC) from C-03. The next layer needed is the product catalog that powers every customer-facing feature. Categories are branch-scoped (each branch can have its own menu structure). Products belong to subcategories but can be sold at branch-specific prices via BranchProduct.

Constraints:
- Clean Architecture: routers are thin HTTP handlers, all logic in domain services
- Multi-tenant: every query MUST filter by tenant_id (via branch -> tenant chain)
- Prices in cents (int), never float
- Soft delete only (is_active = False)
- Redis is available (deployed in C-01)
- `BaseCRUDService` and `BranchScopedService` exist from C-02 as base classes
- `PermissionContext` exists from C-03 for authorization

## Goals / Non-Goals

**Goals:**
- Implement the 4 menu catalog models with proper relationships and constraints
- Provide admin CRUD endpoints for all 4 entities with RBAC enforcement
- Deliver a public menu endpoint that returns the full nested menu for a branch, cached in Redis
- Ensure cache invalidation is automatic and reliable on any CRUD mutation
- Validate image URLs against SSRF attacks
- Support per-branch pricing via BranchProduct with `is_available` (runtime toggle) distinct from `is_active` (soft delete)

**Non-Goals:**
- Allergen association with products -- deferred to C-05
- Product customizations/options -- deferred to a later change
- Image upload/storage -- this change only stores URLs; upload infrastructure is separate
- Frontend pages for menu management -- deferred to C-15 (dashboard-menu)
- Menu search/filtering beyond category hierarchy -- not in MVP scope
- Recipe/ingredient linkage to products -- deferred to C-06

## Decisions

### D-01: Category is branch-scoped, not tenant-scoped

**Decision**: Categories belong directly to a branch (`category.branch_id`), not to a tenant.

**Alternatives considered**:
- Tenant-scoped categories shared across branches: Simpler model but prevents branches from having independent menu structures. A restaurant chain might have different menus per location (e.g., a beach branch vs. downtown branch).

**Rationale**: The data model in the knowledge base explicitly defines Category with `branch_id`. Each branch curates its own menu. This allows maximum flexibility while maintaining tenant isolation through the branch -> tenant FK chain.

### D-02: Product stores base price, BranchProduct overrides per branch

**Decision**: `Product.price` holds the base price in cents. `BranchProduct.price_cents` holds the branch-specific override. If no BranchProduct exists for a branch, the product is not available at that branch.

**Alternatives considered**:
- No base price on Product, only BranchProduct prices: Forces creating a BranchProduct for every branch, even if the price is the same. More data, more maintenance.
- Inheritance/fallback logic (use base price if no override): Adds complexity to every price lookup. The explicit BranchProduct model is cleaner -- if a product is sold at a branch, it has a BranchProduct record.

**Rationale**: BranchProduct serves a dual purpose: it defines both the price AND the availability at a specific branch. `is_available` toggles runtime visibility (e.g., "86'd" / out of stock) without soft-deleting the record. The public menu endpoint only includes products that have an active BranchProduct with `is_available=True`.

### D-03: Redis cache key pattern `menu:{branch_slug}`

**Decision**: Cache the full serialized menu JSON under key `menu:{branch_slug}` with a 5-minute TTL. Invalidation is key-specific: any CRUD on category/subcategory/product/branch_product triggers `DELETE menu:{branch_slug}` for the affected branch(es).

**Alternatives considered**:
- Cache per-category or per-product: More granular invalidation but dramatically increases cache complexity and the number of Redis round-trips to assemble a full menu.
- Cache with tags/patterns: Redis doesn't natively support tag-based invalidation without Lua scripts or key scanning.
- No cache (query on every request): The public menu is a read-heavy endpoint (every diner hits it). Without caching, N diners = N complex queries with joins.

**Rationale**: The full menu for a branch is a single read-heavy payload that changes infrequently (only on admin CRUD). Caching the entire response as a single key is simple, fast to serve, and trivial to invalidate. The 5-minute TTL is a safety net -- even if invalidation fails, stale data is at most 5 minutes old.

### D-04: Domain services extend BranchScopedService

**Decision**: `CategoryService`, `SubcategoryService`, and `ProductService` extend `BranchScopedService[Model, Output]`. Each overrides `_after_create`, `_after_update`, `_after_delete` hooks to trigger cache invalidation.

**Alternatives considered**:
- Standalone services without base class: More code duplication for CRUD operations.
- Event-driven invalidation (publish event, separate consumer invalidates): Adds eventual consistency complexity. Overkill when the service can invalidate synchronously.

**Rationale**: The Template Method hooks in `BranchScopedService` are designed exactly for this use case -- side effects after mutations. Cache invalidation is synchronous and fast (single Redis DELETE). No need for event-driven complexity.

### D-05: Image URL anti-SSRF validation

**Decision**: Validate image URLs before persisting: allow only `https://` scheme, reject private/loopback IPs (10.x, 172.16-31.x, 192.168.x, 127.x, ::1), reject non-standard ports. Implemented as a shared utility in `shared/utils/url_validation.py`.

**Alternatives considered**:
- No validation (trust admin input): Admins are authenticated but SSRF is still a risk if they paste a URL from an untrusted source.
- Server-side fetch and re-host: Most secure (eliminates SSRF entirely) but requires image storage infrastructure.
- Allowlist of specific domains: Too restrictive -- restaurants may host images on various CDNs.

**Rationale**: URL validation is a practical middle ground. It blocks the most common SSRF vectors (internal network probing) without requiring image hosting infrastructure. The validation utility is shared so future changes (C-05, C-13) can reuse it.

### D-06: Public menu response structure

**Decision**: The public menu endpoint returns a nested JSON structure: `{ branch: {...}, categories: [{ ..., subcategories: [{ ..., products: [{ ..., price_cents, is_available }] }] }] }`. Products include the BranchProduct `price_cents` and `is_available` fields. Only active categories, subcategories, products, and available BranchProducts are included.

**Alternatives considered**:
- Flat structure with IDs: Requires multiple round-trips from the client to assemble the menu.
- GraphQL: Flexible but adds infrastructure complexity. REST with a well-designed response is sufficient.

**Rationale**: A single nested response minimizes round-trips. The pwaMenu fetches one endpoint and has everything needed to render the full menu. The response is cached, so the query cost is amortized.

### D-07: Cascade soft delete for categories

**Decision**: Deleting a category soft-deletes all its subcategories and their products. The `_after_delete` hook in `CategoryService` uses `cascade_soft_delete()` from C-02. Similarly, deleting a subcategory cascades to its products.

**Alternatives considered**:
- No cascade (orphan subcategories/products): Leaves dangling data.
- Hard cascade via DB (ON DELETE CASCADE): Violates the soft-delete-only rule.

**Rationale**: `cascade_soft_delete()` already exists and handles the recursive deactivation with audit fields. The delete endpoint returns an `affected` count preview (matching the pattern from the API docs).

## Risks / Trade-offs

- **[Risk] Cache stampede on invalidation** -- If many diners hit `/api/public/menu/{slug}` simultaneously right after cache invalidation, all requests hit the DB. Mitigation: acceptable at expected scale (restaurants, not millions of users). If needed later, add a cache lock pattern (set a short-TTL "computing" key, only one request rebuilds).

- **[Risk] BranchProduct orphans** -- If a product is soft-deleted but BranchProduct records remain active, they reference inactive products. Mitigation: cascade soft delete from Product to BranchProduct. The public menu query joins through active products only.

- **[Trade-off] No image upload** -- Admins must provide external URLs. Trade-off: simpler implementation now, but admin UX is worse. Image upload can be added later as a standalone feature.

- **[Trade-off] Full menu in single response** -- For branches with very large menus (hundreds of products), the response payload could be large. Trade-off: acceptable for restaurant menus (typically < 200 products). If needed, add pagination to the public endpoint later.

- **[Trade-off] Synchronous cache invalidation** -- Cache invalidation happens in the same request as the CRUD operation. If Redis is slow/down, the CRUD request is slower. Mitigation: Redis operations are sub-millisecond typically. If Redis is down, the invalidation fails silently (cache will expire via TTL anyway).

## File Structure

```
backend/
  rest_api/
    models/
      menu.py             -- Category, Subcategory, Product, BranchProduct
    routers/
      admin_menu.py       -- Admin CRUD for all 4 entities
      public_menu.py      -- GET /api/public/menu/{slug}
    services/
      domain/
        category_service.py     -- CategoryService (extends BranchScopedService)
        subcategory_service.py  -- SubcategoryService (extends BranchScopedService)
        product_service.py      -- ProductService (extends BranchScopedService)
        menu_cache_service.py   -- MenuCacheService (Redis get/set/invalidate)
    schemas/
      menu.py             -- Pydantic request/response models
  shared/
    utils/
      url_validation.py   -- validate_image_url() anti-SSRF
  alembic/
    versions/
      003_menu_catalog.py -- Migration: category, subcategory, product, branch_product
  tests/
    test_menu_crud.py     -- CRUD operations + multi-tenant isolation
    test_public_menu.py   -- Public menu endpoint + cache behavior
    test_url_validation.py -- Image URL anti-SSRF validation
```

## Open Questions

- **Q1**: Should the `order` field on Category and Subcategory use a gap-based approach (10, 20, 30...) to allow insertions without reordering? Leaning yes -- simpler than fractional ordering and gaps can be compacted periodically.
- **Q2**: Should BranchProduct include a `stock_quantity` field for inventory tracking? Leaning no -- C-04 scope is catalog only. Stock tracking can be added in a future change when the round submission flow (C-10) needs it.
