# dashboard-store-persistence Delta Spec

> Change: **C-15 dashboard-menu**. Formalizes store versioning and migration patterns for all persisted Zustand stores in the Dashboard.

## ADDED Requirements

### Requirement: STORE_VERSIONS as single source of truth

The Dashboard SHALL export `STORE_VERSIONS` as a `const` object from `Dashboard/src/utils/constants.ts`. Every persisted Zustand store SHALL reference its version via `version: STORE_VERSIONS.<STORE_NAME>` in the `persist()` config. Hardcoded version numbers in individual stores SHALL be prohibited. The initial version for stores introduced in C-15 SHALL be `1`. `STORE_VERSIONS` SHALL include at minimum: `CATEGORY: 1`, `SUBCATEGORY: 1`, `PRODUCT: 1`, `ALLERGEN: 1`, `INGREDIENT: 1`, `RECIPE: 1`. The type of `STORE_VERSIONS` SHALL be inferred as a readonly const record.

#### Scenario: Store references STORE_VERSIONS
- **WHEN** `categoryStore` is created
- **THEN** the `persist()` config SHALL set `version: STORE_VERSIONS.CATEGORY` rather than a hardcoded number

#### Scenario: Adding a new persisted store
- **WHEN** a developer introduces a new persisted store in a future change
- **THEN** `STORE_VERSIONS` SHALL be extended with the new store's entry (initial value `1`) and the store SHALL reference it

### Requirement: STORAGE_KEYS for persisted store names

The Dashboard SHALL export `STORAGE_KEYS` from `Dashboard/src/utils/constants.ts` as a `const` object including entries for each persisted store: `CATEGORY: 'dashboard-category-store'`, `SUBCATEGORY: 'dashboard-subcategory-store'`, `PRODUCT: 'dashboard-product-store'`, `ALLERGEN: 'dashboard-allergen-store'`, `INGREDIENT: 'dashboard-ingredient-store'`, `RECIPE: 'dashboard-recipe-store'`, `SELECTED_BRANCH: 'dashboard-selected-branch'`. Stores SHALL reference `STORAGE_KEYS.XXX` as the `name` in `persist()`. Hardcoded storage key strings in individual stores SHALL be prohibited.

#### Scenario: Store uses STORAGE_KEYS
- **WHEN** `productStore` is created
- **THEN** `persist({ name: STORAGE_KEYS.PRODUCT, version: STORE_VERSIONS.PRODUCT })` SHALL be used

### Requirement: Migration contract with type guards

Every persisted store SHALL provide a `migrate(persistedState: unknown, version: number): State` function in its `persist()` config. The parameter type SHALL be `unknown` — never `any`. The function SHALL: (a) validate that `persistedState` is a non-null object, (b) validate the shape of each consumed field with a type guard, (c) return safe default state when validation fails, (d) apply version-to-version migrations in ascending order, (e) cast only the return value to `State`. Any use of `as any` inside a migration SHALL be prohibited.

#### Scenario: Invalid persisted state returns defaults
- **WHEN** `migrate(null, 0)` is called
- **THEN** the function SHALL return the store's initial state with empty arrays and default flags, not throw

#### Scenario: Missing items field returns defaults
- **WHEN** `migrate({ foo: 'bar' }, 1)` is called (object without `items`)
- **THEN** the function SHALL detect the missing `items` array via type guard and return the default state

#### Scenario: Valid state passes through
- **WHEN** `migrate({ items: [...] }, 1)` is called with a valid shape
- **THEN** the function SHALL return the state cast to the store's `State` type

#### Scenario: Forward migration between versions
- **WHEN** a future change sets `STORE_VERSIONS.CATEGORY = 2` and the persisted data is from version 1 (without a new field `tags`)
- **THEN** the `migrate` function SHALL include a branch `if (version < 2) items = items.map((i) => ({ ...i, tags: [] }))` and return the upgraded state

### Requirement: Stable EMPTY_ARRAY fallback for persisted selectors

Every persisted store SHALL use a module-level `const EMPTY_ARRAY: T[] = []` (or a shared `EMPTY_ARRAY` from `constants.ts`) for fallback selectors. Selectors SHALL NEVER use inline `?? []`. The fallback reference SHALL be stable across re-renders to prevent Zustand infinite loop bugs.

#### Scenario: Selector uses stable fallback
- **WHEN** `useCategoryStore((s) => s.items ?? EMPTY_CATEGORIES)` is called 100 times
- **THEN** the selector SHALL return the same reference each time when `items` is null, never a new `[]`

### Requirement: Six menu stores with full CRUD, optimistic updates, persist, and selectors

The Dashboard SHALL provide six Zustand stores under `Dashboard/src/stores/`: `categoryStore`, `subcategoryStore`, `productStore`, `allergenStore`, `ingredientStore`, `recipeStore`. Each store SHALL: (a) expose `items`, `isLoading`, `error` state plus domain-specific extensions (e.g., `productStore` exposes `branchProducts` and `productAllergens` as nested arrays), (b) implement `fetchAsync`, `createAsync`, `updateAsync`, `deleteAsync` actions that follow the optimistic-update-with-rollback pattern documented in `dashboard-realtime-sync`, (c) expose named selector functions (`selectItems`, `selectIsLoading`, `selectError`, domain-specific selectors like `selectProductsByBranch`, `selectIngredientGroupById`), (d) use `useShallow` for any object/array selector, (e) apply `persist()` with `STORE_VERSIONS` and `STORAGE_KEYS`, (f) implement `applyWSCreated`, `applyWSUpdated`, `applyWSDeleted` actions used by `useMenuWebSocketSync`.

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

### Requirement: IDs are strings in frontend

All entity IDs stored in Zustand state in the Dashboard SHALL be of type `string`. Backend responses SHALL be transformed at the boundary (inside `createAsync`, `fetchAsync`, etc.) to convert `number` IDs to `string`. Prices SHALL remain `integer cents` — conversion to display currency happens in the component via a formatter utility.

#### Scenario: ID converted at boundary
- **WHEN** backend returns `{ id: 42, name: 'X' }` for a category
- **THEN** the store SHALL persist `{ id: '42', name: 'X' }` with `id` as a string

#### Scenario: Price remains cents in store
- **WHEN** backend returns `{ price_cents: 12550 }` for a product
- **THEN** the store SHALL persist `price_cents: 12550` and the page SHALL format it as "$125.50" only in the JSX render
