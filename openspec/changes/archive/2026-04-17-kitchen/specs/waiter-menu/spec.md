## ADDED Requirements

### Requirement: Waiter menu endpoint

The system SHALL provide `GET /api/waiter/branches/{branch_id}/menu` returning a compact nested menu optimised for the waiter quick-command flow. The endpoint REQUIRES JWT authentication with role WAITER, MANAGER, or ADMIN.

The response SHALL contain categories → subcategories → products, sorted by the `order` column at each level. Each product entry SHALL include only `id`, `name`, `price_cents`, and `is_available`. The response MUST NOT include product images, allergen lists, branch metadata, descriptions, or any other fields available in the public menu.

The payload SHALL be filtered to show only:
- `Category` rows with `is_active=True` and `branch_id = :branch_id`.
- `Subcategory` rows with `is_active=True`.
- `Product` rows with `is_active=True`.
- `BranchProduct` rows with `is_active=True` and `is_available=True` for the target branch.

Products whose branch-specific `BranchProduct` does not satisfy these filters SHALL NOT appear at all (not even with `is_available=False`).

Tenant and branch scoping SHALL apply: a user without access to the target branch receives 403.

#### Scenario: Waiter fetches compact menu

- **WHEN** a WAITER with access to branch 1 calls `GET /api/waiter/branches/1/menu`
- **THEN** the response is 200 with shape `{ categories: [ { id, name, order, subcategories: [ { id, name, order, products: [ { id, name, price_cents, is_available } ] } ] } ] }`
- **AND** no product includes an `image`, `description`, or `allergens` field

#### Scenario: Inactive category excluded

- **WHEN** a category with `is_active=False` exists for branch 1 and a waiter calls the menu endpoint
- **THEN** that category is not in the response

#### Scenario: Unavailable product excluded

- **WHEN** a product has `BranchProduct.is_available=False` for branch 1 and a waiter calls the menu endpoint
- **THEN** that product is not in the response

#### Scenario: Non-existent branch returns 404

- **WHEN** a WAITER calls the endpoint with a branch id that does not exist in their tenant
- **THEN** the response is 404 Not Found

#### Scenario: Wrong-branch request forbidden

- **WHEN** a WAITER with `branch_ids=[1]` calls `GET /api/waiter/branches/2/menu`
- **THEN** the response is 403 Forbidden

#### Scenario: Unauthenticated request rejected

- **WHEN** an unauthenticated HTTP client calls `GET /api/waiter/branches/1/menu`
- **THEN** the response is 401 Unauthorized

#### Scenario: Diner Table Token rejected

- **WHEN** a diner with a valid Table Token calls `GET /api/waiter/branches/1/menu`
- **THEN** the response is 401 Unauthorized or 403 Forbidden (Table Token is not a JWT)

#### Scenario: KITCHEN role rejected

- **WHEN** a KITCHEN user calls `GET /api/waiter/branches/1/menu`
- **THEN** the response is 403 Forbidden (KITCHEN has no need for the waiter menu)

### Requirement: Waiter menu ordering and sorting

The response SHALL preserve the canonical ordering used elsewhere in the system:
- Categories sorted by `Category.order` ascending, ties broken by `Category.id` ascending.
- Subcategories within each category sorted by `Subcategory.order` ascending, ties by id ascending.
- Products within each subcategory sorted by `Product.order` if present, otherwise by `Product.name` ascending.

#### Scenario: Categories come back in order

- **WHEN** branch 1 has categories with order values [10, 20, 5] and a waiter fetches the menu
- **THEN** the response's `categories` array is ordered [order=5, order=10, order=20]
