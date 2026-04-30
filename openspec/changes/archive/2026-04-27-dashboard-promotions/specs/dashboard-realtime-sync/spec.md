# dashboard-realtime-sync Delta Spec

> Change: **C-27 dashboard-promotions**. Extends the existing `useMenuWebSocketSync` hook to route `entity="promotion"` events to `promotionStore.applyWS*` actions. The ref pattern, branch filtering, cascade handling, and optimistic reconciliation remain identical — this is a pure addition to the routing table.

## MODIFIED Requirements

### Requirement: ENTITY_CREATED routing to stores

When the hook receives `ENTITY_CREATED` with payload `{ entity, id, data, branch_id }`, it SHALL route to the matching store's action `applyWSCreated(data)`. The routing table SHALL be: `"category" → categoryStore`, `"subcategory" → subcategoryStore`, `"product" → productStore`, `"branch_product" → productStore` (nested), `"allergen" → allergenStore`, `"ingredient_group" → ingredientStore`, `"ingredient" → ingredientStore`, `"sub_ingredient" → ingredientStore`, `"recipe" → recipeStore`, `"promotion" → promotionStore`. The store SHALL deduplicate by `id` and by pending `tempId` to avoid double-inserting items already created optimistically from the same tab.

#### Scenario: Apply remote insert
- **WHEN** `ENTITY_CREATED` arrives for a category with `id: '42'` and the `categoryStore.items` has no item with `id === '42'`
- **THEN** the category SHALL be inserted into `categoryStore.items`

#### Scenario: Dedup against own optimistic insert
- **WHEN** the current tab just optimistically created a category with `tempId: 'temp-123'` and the WS replays `ENTITY_CREATED` with the real `id: '42'`
- **THEN** the store SHALL resolve the pending tempId to the real id without creating a duplicate, matching by the tempId → serverId resolution that also happens on the HTTP response

#### Scenario: Ignore events for other branches
- **WHEN** `selectedBranchId` is `'1'` and an event arrives with `branch_id: '2'`
- **THEN** the event SHALL be filtered out by `onFiltered` and NOT reach the routing layer

#### Scenario: Promotion create routes to promotionStore
- **WHEN** `ENTITY_CREATED` arrives with `entity: 'promotion'` and a promotion payload
- **THEN** `promotionStore.applyWSCreated(promotion)` SHALL be called, and the store SHALL insert if no item with the same `id` already exists

### Requirement: ENTITY_UPDATED routing to stores

When the hook receives `ENTITY_UPDATED` with payload `{ entity, id, data }`, it SHALL route to the matching store's `applyWSUpdated(data)` action, which merges the update into the existing item. If no item with that `id` exists in the store, the update SHALL be applied as an insert. The routing table SHALL include `"promotion" → promotionStore.applyWSUpdated` in addition to the existing entries for menu entities.

#### Scenario: Merge update
- **WHEN** `ENTITY_UPDATED` arrives for a product with `{ id: '10', name: 'New Name', price_cents: 15000 }` and the store already has that product
- **THEN** the store SHALL merge the incoming fields into the existing product

#### Scenario: Update arriving before initial fetch behaves as insert
- **WHEN** `ENTITY_UPDATED` arrives before the initial `fetchAsync` completed
- **THEN** the store SHALL add the item (as if it were a create), to remain consistent

#### Scenario: Promotion update merges branches and items
- **WHEN** `ENTITY_UPDATED` arrives for a promotion with updated `branches` and `items` arrays
- **THEN** `promotionStore.applyWSUpdated(promotion)` SHALL replace the item's `branches` and `items` fields entirely (not merge element-wise), preserving the top-level metadata from the payload

### Requirement: ENTITY_DELETED routing to stores

When the hook receives `ENTITY_DELETED` with payload `{ entity, id }`, it SHALL route to the matching store's `applyWSDeleted(id)` action, which SHALL either set `is_active = false` on the item (soft delete reflected in UI via filter) or remove it entirely depending on the store's convention. The Dashboard convention SHALL be: remove it from the `items` array (simpler UX) — reloading the page refetches fresh state from the server regardless. The routing table SHALL include `"promotion" → promotionStore.applyWSDeleted`.

#### Scenario: Remove deleted item
- **WHEN** `ENTITY_DELETED` arrives for allergen `id: '5'`
- **THEN** the allergen SHALL be removed from `allergenStore.items`

#### Scenario: Promotion delete removes item
- **WHEN** `ENTITY_DELETED` arrives with `entity: 'promotion'` and `id: '7'`
- **THEN** the promotion SHALL be removed from `promotionStore.items`

### Requirement: CASCADE_DELETE handling

When the hook receives `CASCADE_DELETE` with payload `{ entity, id, affected: { Subcategory: number, Product: number, PromotionBranch: number, PromotionItem: number, ... } }`, it SHALL: (a) remove the parent entity from its store, (b) remove or mark as inactive all items in child stores matching the cascade contract (e.g., deleting category `id=1` removes subcategories where `category_id === '1'` and products under those; deleting promotion `id=7` simply removes the promotion from `promotionStore` since its relations are embedded in the same entity), (c) show a toast with `t('menu.cascadeNotified', { count })` — or `t('promotions.cascadeNotified', { count })` when `entity === 'promotion'` — informing the user that N child items were removed.

#### Scenario: Cascade from category
- **WHEN** `CASCADE_DELETE` arrives for `entity: 'category'`, `id: '1'`, `affected: { Subcategory: 3, Product: 12 }`
- **THEN** `categoryStore` SHALL remove the category, `subcategoryStore` SHALL remove the 3 subcategories whose `category_id === '1'`, `productStore` SHALL remove the 12 products whose parent subcategory belongs to those categories, and a toast SHALL show `menu.cascadeNotified` with count 15

#### Scenario: Cascade from ingredient group
- **WHEN** `CASCADE_DELETE` arrives for `entity: 'ingredient_group'` with affected ingredients and sub-ingredients
- **THEN** `ingredientStore` SHALL remove the group and all nested ingredients and sub-ingredients, and the toast SHALL show the total count

#### Scenario: Cascade from promotion
- **WHEN** `CASCADE_DELETE` arrives for `entity: 'promotion'`, `id: '7'`, `affected: { PromotionBranch: 2, PromotionItem: 3 }`
- **THEN** `promotionStore` SHALL remove the promotion with id `'7'` and a toast SHALL show `t('promotions.cascadeNotified', { count: 5 })`
