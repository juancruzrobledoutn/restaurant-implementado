# dashboard-realtime-sync Delta Spec

> Change: **C-15 dashboard-menu**. Introduces the Dashboard's first WebSocket connection to the admin gateway and the synchronization of menu stores with `ENTITY_*` and `CASCADE_DELETE` events.

## ADDED Requirements

### Requirement: dashboardWS client service

The Dashboard SHALL provide a singleton WebSocket client `dashboardWS` exported from `Dashboard/src/services/websocket.ts` that connects to `${VITE_WS_URL}/ws/admin?token=${JWT}`. The client SHALL support: `on(type | '*', cb) => unsubscribe`, `onFiltered(branchId, type | '*', cb) => unsubscribe`, `onFilteredMultiple(branchIds[], type | '*', cb) => unsubscribe`, `onThrottled(type | '*', cb, delayMs?) => unsubscribe`, `onFilteredThrottled(branchId, type | '*', cb, delayMs?) => unsubscribe`, `onConnectionChange(cb: (isConnected: boolean) => void) => unsubscribe`, `onMaxReconnect(cb: () => void) => unsubscribe`. The client SHALL implement: automatic reconnection with exponential backoff, token refresh via `setTokenRefreshCallback`, heartbeat ping every 30s with a 10s pong timeout, no-retry on close codes 4001 (auth failed), 4003 (forbidden), 4029 (rate limited), and catch-up via `GET /ws/catchup?branch_id=&since=` on reconnect.

#### Scenario: Connect with JWT
- **WHEN** `dashboardWS.connect(accessToken)` is called
- **THEN** the client SHALL open a WebSocket to `${VITE_WS_URL}/ws/admin?token=${accessToken}` and emit `isConnected = true` via `onConnectionChange`

#### Scenario: Subscribe to ENTITY_UPDATED
- **WHEN** a component calls `dashboardWS.on('ENTITY_UPDATED', callback)`
- **THEN** the client SHALL invoke `callback(event)` for every `ENTITY_UPDATED` event received, and the returned `unsubscribe()` SHALL remove the listener

#### Scenario: Filter by branch
- **WHEN** a component calls `dashboardWS.onFiltered('1', '*', cb)` and an event arrives with `branch_id !== '1'`
- **THEN** the callback SHALL NOT be invoked

#### Scenario: Reconnect fires catch-up
- **WHEN** the connection drops and reconnects successfully
- **THEN** the client SHALL call `GET /ws/catchup?branch_id=&since=<lastEventTimestamp>` and replay the events in chronological order before returning to normal operation

#### Scenario: No reconnect on 4001
- **WHEN** the server closes the connection with code 4001
- **THEN** the client SHALL NOT attempt to reconnect and SHALL call the `onMaxReconnect` callback

### Requirement: useMenuWebSocketSync hook with ref pattern

The Dashboard SHALL provide a hook `useMenuWebSocketSync()` in `Dashboard/src/hooks/useMenuWebSocketSync.ts` that is mounted exactly once in `MainLayout`. The hook SHALL subscribe to `dashboardWS.onFiltered(selectedBranchId, '*', ...)` using the **ref pattern**: two `useEffect` hooks where the first syncs a `handlerRef.current = handler` on every render (no deps) and the second subscribes once when `selectedBranchId` changes, invoking `handlerRef.current(e)` inside the callback. The subscription SHALL return its cleanup function. Adding the handler function to the dependency array of the subscribing effect SHALL be prohibited.

#### Scenario: Ref pattern prevents listener accumulation
- **WHEN** `useMenuWebSocketSync` is mounted and the component re-renders 10 times
- **THEN** `dashboardWS.onFiltered` SHALL have been called exactly once (only on initial mount or branch change), not 10 times

#### Scenario: Branch change resubscribes
- **WHEN** `selectedBranchId` changes from `'1'` to `'2'`
- **THEN** the previous subscription SHALL be cleaned up and a new subscription SHALL be created filtered to branch `'2'`

#### Scenario: Unmount cleans up
- **WHEN** the component unmounting triggers the effect cleanup
- **THEN** the `unsubscribe` function returned by `onFiltered` SHALL be called and the handler SHALL no longer receive events

### Requirement: ENTITY_CREATED routing to stores

When the hook receives `ENTITY_CREATED` with payload `{ entity, id, data, branch_id }`, it SHALL route to the matching store's action `applyWSCreated(data)`. The routing table SHALL be: `"category" → categoryStore`, `"subcategory" → subcategoryStore`, `"product" → productStore`, `"branch_product" → productStore` (nested), `"allergen" → allergenStore`, `"ingredient_group" → ingredientStore`, `"ingredient" → ingredientStore`, `"sub_ingredient" → ingredientStore`, `"recipe" → recipeStore`. The store SHALL deduplicate by `id` and by pending `tempId` to avoid double-inserting items already created optimistically from the same tab.

#### Scenario: Apply remote insert
- **WHEN** `ENTITY_CREATED` arrives for a category with `id: '42'` and the `categoryStore.items` has no item with `id === '42'`
- **THEN** the category SHALL be inserted into `categoryStore.items`

#### Scenario: Dedup against own optimistic insert
- **WHEN** the current tab just optimistically created a category with `tempId: 'temp-123'` and the WS replays `ENTITY_CREATED` with the real `id: '42'`
- **THEN** the store SHALL resolve the pending tempId to the real id without creating a duplicate, matching by the tempId → serverId resolution that also happens on the HTTP response

#### Scenario: Ignore events for other branches
- **WHEN** `selectedBranchId` is `'1'` and an event arrives with `branch_id: '2'`
- **THEN** the event SHALL be filtered out by `onFiltered` and NOT reach the routing layer

### Requirement: ENTITY_UPDATED routing to stores

When the hook receives `ENTITY_UPDATED` with payload `{ entity, id, data }`, it SHALL route to the matching store's `applyWSUpdated(data)` action, which merges the update into the existing item. If no item with that `id` exists in the store, the update SHALL be applied as an insert.

#### Scenario: Merge update
- **WHEN** `ENTITY_UPDATED` arrives for a product with `{ id: '10', name: 'New Name', price_cents: 15000 }` and the store already has that product
- **THEN** the store SHALL merge the incoming fields into the existing product

#### Scenario: Update arriving before initial fetch behaves as insert
- **WHEN** `ENTITY_UPDATED` arrives before the initial `fetchAsync` completed
- **THEN** the store SHALL add the item (as if it were a create), to remain consistent

### Requirement: ENTITY_DELETED routing to stores

When the hook receives `ENTITY_DELETED` with payload `{ entity, id }`, it SHALL route to the matching store's `applyWSDeleted(id)` action, which SHALL either set `is_active = false` on the item (soft delete reflected in UI via filter) or remove it entirely depending on the store's convention. The Dashboard convention SHALL be: remove it from the `items` array (simpler UX) — reloading the page refetches fresh state from the server regardless.

#### Scenario: Remove deleted item
- **WHEN** `ENTITY_DELETED` arrives for allergen `id: '5'`
- **THEN** the allergen SHALL be removed from `allergenStore.items`

### Requirement: CASCADE_DELETE handling

When the hook receives `CASCADE_DELETE` with payload `{ entity, id, affected: { Subcategory: number, Product: number, ... } }`, it SHALL: (a) remove the parent entity from its store, (b) remove or mark as inactive all items in child stores matching the cascade contract (e.g., deleting category `id=1` removes subcategories where `category_id === '1'` and products under those), (c) show a toast with `t('menu.cascadeNotified', { count })` informing the user that N child items were removed.

#### Scenario: Cascade from category
- **WHEN** `CASCADE_DELETE` arrives for `entity: 'category'`, `id: '1'`, `affected: { Subcategory: 3, Product: 12 }`
- **THEN** `categoryStore` SHALL remove the category, `subcategoryStore` SHALL remove the 3 subcategories whose `category_id === '1'`, `productStore` SHALL remove the 12 products whose parent subcategory belongs to those categories, and a toast SHALL show `menu.cascadeNotified` with count 15

#### Scenario: Cascade from ingredient group
- **WHEN** `CASCADE_DELETE` arrives for `entity: 'ingredient_group'` with affected ingredients and sub-ingredients
- **THEN** `ingredientStore` SHALL remove the group and all nested ingredients and sub-ingredients, and the toast SHALL show the total count

### Requirement: Optimistic update reconciliation with WS events

Every mutate action in the six menu stores SHALL follow the optimistic-update-with-rollback pattern: apply the change locally with a `tempId` before the HTTP request; on success, replace `tempId` with the real server id; on failure, revert the local change and populate `error`. The WS handler SHALL NOT double-apply events matching a pending `tempId`. Each store SHALL maintain an internal `Set<string>` of pending tempIds to filter incoming events originating from this tab.

#### Scenario: Successful create resolves tempId
- **WHEN** the user creates a category, the optimistic item with `id: 'temp-123'` is inserted, then the server responds with real `id: '42'`
- **THEN** the store SHALL replace the tempId with the real id in a single `set` call

#### Scenario: Failed create rolls back
- **WHEN** the HTTP call fails with 400
- **THEN** the optimistic item SHALL be removed from the store and `error` SHALL be populated

#### Scenario: WS create while optimistic pending
- **WHEN** the user creates a category optimistically and before the HTTP response a `ENTITY_CREATED` event arrives for the same id
- **THEN** the store SHALL deduplicate and not insert a second item

### Requirement: branchStore minimal scaffold

The Dashboard SHALL provide a minimal `Dashboard/src/stores/branchStore.ts` with state `{ selectedBranchId: string | null }` and actions `setSelectedBranchId(id: string | null)`. `selectedBranchId` SHALL initialize from `authStore.user.default_branch_id` (converted from `number` to `string`) on first render after login, and SHALL be persisted to `localStorage` under `STORAGE_KEYS.SELECTED_BRANCH`. A selector `selectSelectedBranchId` SHALL be exported. This store is explicitly minimal for C-15 and will be extended in C-16 to fetch all branches and expose a branch switcher UI.

#### Scenario: selectedBranchId persists
- **WHEN** the user sets `selectedBranchId = '3'` and reloads the page
- **THEN** the store SHALL hydrate with `selectedBranchId = '3'` from localStorage

#### Scenario: Initial value from authStore
- **WHEN** a user logs in and `localStorage` is empty and the user has `default_branch_id: 5`
- **THEN** `selectedBranchId` SHALL become `'5'` (string)

#### Scenario: Clear on logout
- **WHEN** `authStore.logout()` is called
- **THEN** `selectedBranchId` SHALL be cleared to `null` and the localStorage entry removed

### Requirement: Toast store for mutation feedback

The Dashboard SHALL provide `Dashboard/src/stores/toastStore.ts` exposing a module-level API `toast.success(message)`, `toast.error(message)`, `toast.info(message)`. Each toast SHALL auto-dismiss after 4000ms. Mutation actions in the six menu stores SHALL emit a success toast on success and an error toast (with the error message from `handleError`) on failure. A `<ToastContainer>` component SHALL be mounted once in `MainLayout`. Error toasts SHALL use `role="alert"` and `aria-live="assertive"`; success/info toasts SHALL use `role="status"` and `aria-live="polite"`.

#### Scenario: Success toast after create
- **WHEN** `createAsync` resolves
- **THEN** `toast.success(t('crud.createdSuccess'))` SHALL be called and the toast SHALL auto-dismiss after 4s

#### Scenario: Error toast has role alert
- **WHEN** `toast.error(message)` is called
- **THEN** the rendered toast DOM element SHALL have `role="alert"` and `aria-live="assertive"`
