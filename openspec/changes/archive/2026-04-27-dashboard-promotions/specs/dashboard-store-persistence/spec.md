# dashboard-store-persistence Delta Spec

> Change: **C-27 dashboard-promotions**. Extends `STORE_VERSIONS` and `STORAGE_KEYS` with an entry for the new `promotionStore`, without changing the migration contract, EMPTY_ARRAY rule, id-string rule, or price-in-cents rule. The promotion store joins the existing pool of persisted stores under the same contract.

## MODIFIED Requirements

### Requirement: STORE_VERSIONS as single source of truth

The Dashboard SHALL export `STORE_VERSIONS` as a `const` object from `Dashboard/src/utils/constants.ts`. Every persisted Zustand store SHALL reference its version via `version: STORE_VERSIONS.<STORE_NAME>` in the `persist()` config. Hardcoded version numbers in individual stores SHALL be prohibited. The initial version for stores introduced in C-15 SHALL be `1`, and the initial version for the promotion store introduced in C-27 SHALL also be `1`. `STORE_VERSIONS` SHALL include at minimum: `CATEGORY: 1`, `SUBCATEGORY: 1`, `PRODUCT: 1`, `ALLERGEN: 1`, `INGREDIENT: 1`, `RECIPE: 1`, `PROMOTION: 1`. The type of `STORE_VERSIONS` SHALL be inferred as a readonly const record.

#### Scenario: Store references STORE_VERSIONS
- **WHEN** `categoryStore` is created
- **THEN** the `persist()` config SHALL set `version: STORE_VERSIONS.CATEGORY` rather than a hardcoded number

#### Scenario: Adding a new persisted store
- **WHEN** a developer introduces a new persisted store in a future change
- **THEN** `STORE_VERSIONS` SHALL be extended with the new store's entry (initial value `1`) and the store SHALL reference it

#### Scenario: Promotion store references STORE_VERSIONS.PROMOTION
- **WHEN** `promotionStore` is created
- **THEN** the `persist()` config SHALL set `version: STORE_VERSIONS.PROMOTION` (initial value `1`) rather than a hardcoded number

### Requirement: STORAGE_KEYS for persisted store names

The Dashboard SHALL export `STORAGE_KEYS` from `Dashboard/src/utils/constants.ts` as a `const` object including entries for each persisted store: `CATEGORY: 'dashboard-category-store'`, `SUBCATEGORY: 'dashboard-subcategory-store'`, `PRODUCT: 'dashboard-product-store'`, `ALLERGEN: 'dashboard-allergen-store'`, `INGREDIENT: 'dashboard-ingredient-store'`, `RECIPE: 'dashboard-recipe-store'`, `PROMOTION: 'dashboard-promotion-store'`, `SELECTED_BRANCH: 'dashboard-selected-branch'`. Stores SHALL reference `STORAGE_KEYS.XXX` as the `name` in `persist()`. Hardcoded storage key strings in individual stores SHALL be prohibited.

#### Scenario: Store uses STORAGE_KEYS
- **WHEN** `productStore` is created
- **THEN** `persist({ name: STORAGE_KEYS.PRODUCT, version: STORE_VERSIONS.PRODUCT })` SHALL be used

#### Scenario: Promotion store uses STORAGE_KEYS.PROMOTION
- **WHEN** `promotionStore` is created
- **THEN** `persist({ name: STORAGE_KEYS.PROMOTION, version: STORE_VERSIONS.PROMOTION })` SHALL be used

### Requirement: Six menu stores with full CRUD, optimistic updates, persist, and selectors

The Dashboard SHALL provide six Zustand stores under `Dashboard/src/stores/`: `categoryStore`, `subcategoryStore`, `productStore`, `allergenStore`, `ingredientStore`, `recipeStore`. Each store SHALL: (a) expose `items`, `isLoading`, `error` state plus domain-specific extensions (e.g., `productStore` exposes `branchProducts` and `productAllergens` as nested arrays), (b) implement `fetchAsync`, `createAsync`, `updateAsync`, `deleteAsync` actions that follow the optimistic-update-with-rollback pattern documented in `dashboard-realtime-sync`, (c) expose named selector functions (`selectItems`, `selectIsLoading`, `selectError`, domain-specific selectors like `selectProductsByBranch`, `selectIngredientGroupById`), (d) use `useShallow` for any object/array selector, (e) apply `persist()` with `STORE_VERSIONS` and `STORAGE_KEYS`, (f) implement `applyWSCreated`, `applyWSUpdated`, `applyWSDeleted` actions used by `useMenuWebSocketSync`. The same contract SHALL apply to `promotionStore` introduced in C-27, with additional domain-specific actions (`toggleActiveAsync`, `linkBranchAsync`, `unlinkBranchAsync`, `linkProductAsync`, `unlinkProductAsync`) that also follow the optimistic-with-rollback pattern.

#### Scenario: Fetch populates items
- **WHEN** `categoryStore.fetchAsync()` is called
- **THEN** `isLoading` SHALL become `true`, the store SHALL call `GET /api/admin/categories`, store the response, and set `isLoading` back to `false`

#### Scenario: Optimistic create on failure
- **WHEN** `categoryStore.createAsync(data)` is called and the backend returns 400
- **THEN** the optimistic item SHALL be removed from `items` and `error` SHALL contain the backend message

#### Scenario: Optimistic create on success
- **WHEN** `createAsync(data)` succeeds
- **THEN** the optimistic item's `tempId` SHALL be replaced by the real id from the response

#### Scenario: Named selectors returned
- **WHEN** a component calls `useCategoryStore(selectItems)`
- **THEN** it SHALL receive the `items` array without destructuring

#### Scenario: Zustand destructuring forbidden
- **WHEN** a developer writes `const { items } = useCategoryStore()` in a component
- **THEN** the ESLint rule `no-restricted-syntax` from C-14 SHALL fail the lint

#### Scenario: Promotion store follows same contract
- **WHEN** `promotionStore` is consumed in the Promotions page
- **THEN** it SHALL expose `selectPromotions`, `selectIsLoading`, `selectError`, and all mutation actions SHALL follow the optimistic-with-rollback pattern — including domain-specific actions `toggleActiveAsync`, `linkBranchAsync`, `unlinkBranchAsync`, `linkProductAsync`, `unlinkProductAsync`
