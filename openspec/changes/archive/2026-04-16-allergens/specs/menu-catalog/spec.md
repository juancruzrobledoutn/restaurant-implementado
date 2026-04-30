## MODIFIED Requirements

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
