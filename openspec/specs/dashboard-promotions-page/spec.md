# dashboard-promotions-page Specification

## Purpose
TBD - created by archiving change dashboard-promotions. Update Purpose after archive.
## Requirements
### Requirement: Promotions CRUD page

The Dashboard SHALL provide a page at route `/promotions` that lists the tenant's promotions with optional filters (status, branch, validity) and offers create/edit/delete + inline toggle actions. The page SHALL be lazy-loaded, protected by `ProtectedRoute`, registered under `MainLayout`, have `handle.breadcrumb = 'layout.breadcrumb.promotions'`, and render inside a `<PageContainer>` with mandatory `helpContent={helpContent.promotions}`. The page SHALL NOT require a `selectedBranchId` to render (promotions are tenant-scoped); when `selectedBranchId` is set, the default branch filter SHALL be pre-applied.

The page SHALL display columns: `name`, `promotion_type` (resolved label), validity range (`formatPromotionValidity`), branches (count badge), status (`is_active` Badge + computed status: `scheduled`/`active`/`expired`), and actions (edit, inline `is_active` toggle, delete). Sort by `name` ascending by default. Pagination SHALL use `usePagination` with default 10 items per page.

The page SHALL use the canonical hook trio (`useFormModal<PromotionFormData, Promotion>`, `useConfirmDialog<Promotion>`, `usePagination<Promotion>`), `useActionState<FormState<PromotionFormData>, FormData>` for form submission, and `dashboardWS` via the shared `useMenuWebSocketSync` hook.

#### Scenario: Lists tenant promotions with no filters
- **WHEN** an ADMIN navigates to `/promotions`
- **THEN** the page SHALL render a paginated table of all promotions for the tenant, sorted by `name`

#### Scenario: Pre-applies selectedBranchId to branch filter
- **WHEN** the user has `selectedBranchId = '2'` and navigates to `/promotions`
- **THEN** the branch filter select SHALL default to branch `'2'` and the list SHALL show only promotions that include branch `'2'` in `p.branches`

#### Scenario: Fallback card when store is empty and not loading
- **WHEN** `promotionStore.items` is empty and `isLoading` is false
- **THEN** the page SHALL render a `<Card>` with an empty-state message translated via `t('promotions.empty')` and a "Crear" button

#### Scenario: Loading skeleton while fetching
- **WHEN** `promotionStore.isLoading === true` and `items.length === 0`
- **THEN** the page SHALL render `<TableSkeleton>` with 10 placeholder rows instead of the empty table

#### Scenario: Route is protected
- **WHEN** a non-authenticated user navigates to `/promotions`
- **THEN** `ProtectedRoute` SHALL redirect to `/login`

#### Scenario: Only ADMIN and MANAGER see the page
- **WHEN** a KITCHEN or WAITER user is authenticated and the sidebar renders
- **THEN** the "Promotions" item SHALL NOT be visible, and direct navigation to `/promotions` SHALL render a "Forbidden" fallback

### Requirement: Create promotion form

The create modal SHALL contain: `Input` (name, required, max 120), `Textarea` (description, optional, max 500), `Input type="number"` (price in cents with live preview via `formatPrice`, required, `>= 0`), `Select` (promotion type, optional, populated from `catalogStore.promotion_types`), `DateRangePicker` (start date+time and end date+time, both required, validated `end >= start`), `MultiSelect` of branches (at least one required, options from the user's accessible branches), and an inline items table with "Agregar producto" that opens a sub-selector. The first element inside the form SHALL be a `<HelpButton size="sm">` with entity-specific help content.

Submit SHALL call `promotionStore.createAsync(data)` which POSTs to `/api/admin/promotions` with `{ name, description, price, start_date, start_time, end_date, end_time, promotion_type_id, branch_ids, product_ids }`. The modal SHALL close at render time via `if (state.isSuccess && modal.isOpen) modal.close()`, never inside the action.

#### Scenario: Submits valid create
- **WHEN** the user fills name "2x1 Martes", price 12000, start 2026-06-15 18:00, end 2026-06-15 22:00, selects branches ["1","2"], selects products ["10","11"], and submits
- **THEN** `promotionStore.createAsync` SHALL be called, `POST /api/admin/promotions` SHALL receive the payload with integers `price: 12000`, `branch_ids: [1,2]`, `product_ids: [10,11]`, the UI SHALL apply an optimistic insert, a success toast SHALL show `t('promotions.createSuccess')`, and the modal SHALL close

#### Scenario: Validation blocks submit when name is blank
- **WHEN** the user submits the form with an empty name
- **THEN** the action SHALL return `{ errors: { name: 'validation.required' }, isSuccess: false }`, the form SHALL remain open, and the input SHALL render the translated error below it

#### Scenario: Validation blocks submit when price is negative
- **WHEN** the user enters price `-100` and submits
- **THEN** the action SHALL return `{ errors: { price: 'validation.priceNonNegative' }, isSuccess: false }`

#### Scenario: Validation blocks submit when end is before start
- **WHEN** the user sets start 2026-06-15 22:00 and end 2026-06-15 18:00 and submits
- **THEN** the action SHALL return `{ errors: { end_date: 'promotions.endBeforeStart' }, isSuccess: false }` and the `DateRangePicker` SHALL show the error

#### Scenario: Validation blocks submit when no branches selected
- **WHEN** the user leaves the branches multi-select empty and submits
- **THEN** the action SHALL return `{ errors: { branch_ids: 'promotions.noBranchesSelected' }, isSuccess: false }`

#### Scenario: isPending disables submit during request
- **WHEN** `isPending === true` from `useActionState`
- **THEN** the submit button SHALL be disabled (`isLoading` prop) to prevent double-submit

#### Scenario: HelpButton is first element in form
- **WHEN** the create modal opens
- **THEN** the first element inside the `<form>` SHALL be a `<HelpButton size="sm">` with promotion-specific help content

### Requirement: Edit promotion form

The edit modal SHALL reuse the create form's shape but pre-populate fields from the selected promotion via `modal.openEdit(item, mapPromotionToFormData)`. Submit SHALL call `promotionStore.updateAsync(id, data)` which PATCHes `/api/admin/promotions/{id}` with only the changed metadata fields (name, description, price, dates, times, type). Branch and product links SHALL be reconciled via `linkBranchAsync`/`unlinkBranchAsync`/`linkProductAsync`/`unlinkProductAsync` calls for each diff between the form's selection and the persisted item's relations.

#### Scenario: Pre-populates form with current values
- **WHEN** the user clicks edit on a promotion named "2x1 Martes" with price 12000
- **THEN** the modal opens with `name = "2x1 Martes"`, `price = 12000` (displayed as "$120.00"), all dates/times filled, and the selected branches and products checked

#### Scenario: Diff-based branch reconciliation
- **WHEN** the user edits a promotion initially linked to branches ["1","2"] and changes selection to ["2","3"]
- **THEN** `unlinkBranchAsync(id, "1")` SHALL be called and `linkBranchAsync(id, "3")` SHALL be called, with no call for branch "2"

#### Scenario: Metadata PATCH payload contains only changed fields
- **WHEN** the user only changes the price from 12000 to 15000 and submits
- **THEN** `PATCH /api/admin/promotions/{id}` SHALL be called with body `{ "price": 15000 }` (other fields omitted)

### Requirement: Inline is_active toggle

Each row in the promotions table SHALL render a `<Toggle>` in the "Estado" column bound to `is_active`. Clicking the toggle SHALL call `promotionStore.toggleActiveAsync(id)` which applies an optimistic flip, then PATCHes `/api/admin/promotions/{id}` with `{ is_active: !previous }`. On success, a toast SHALL show `t('promotions.toggleSuccess')`; on failure, the flip SHALL be rolled back and a toast SHALL show `t('promotions.toggleFailed')`. The toggle SHALL have an `aria-label` describing the action in context.

#### Scenario: Toggle activates inactive promotion
- **WHEN** the user clicks the toggle on a promotion with `is_active: false`
- **THEN** the UI SHALL immediately show the toggle as on, `PATCH /api/admin/promotions/{id}` SHALL be sent with `{ is_active: true }`, and on response the store SHALL merge the server truth

#### Scenario: Toggle rolls back on failure
- **WHEN** the PATCH request returns 500 during `toggleActiveAsync`
- **THEN** the store SHALL restore `is_active` to its previous value and `toast.error(t('promotions.toggleFailed'))` SHALL be shown

#### Scenario: Toggle has accessible label
- **WHEN** the toggle renders for a promotion named "2x1 Martes" currently inactive
- **THEN** the `aria-label` SHALL translate to `t('promotions.toggleActive', { name: '2x1 Martes' })` with text indicating the action will activate the promotion

### Requirement: Delete promotion with cascade preview

Clicking the delete icon SHALL open a `<ConfirmDialog>` that shows a `<CascadePreviewList>` with `{ PromotionBranch: N, PromotionItem: M }` computed by `cascadeService.getPromotionPreview(id)`. On confirm, `deletePromotionWithCascade(id)` SHALL call `DELETE /api/admin/promotions/{id}`. ADMIN-only: the delete button SHALL NOT render for MANAGER users (`canDeletePromotion = isAdmin`). If the backend returns 403, a toast SHALL show `t('permissions.deleteForbidden')` and no rollback SHALL be required (no optimistic change occurred).

#### Scenario: Preview shows branches and items counts
- **WHEN** a promotion with 2 branches and 5 items is about to be deleted
- **THEN** the dialog body SHALL include a `<CascadePreviewList>` with items `[{ label: 'promotions.cascade.branches', count: 2 }, { label: 'promotions.cascade.items', count: 5 }]` and a total of 7

#### Scenario: Preview hidden when no relations
- **WHEN** the promotion has zero branches and zero items
- **THEN** the `ConfirmDialog` SHALL NOT render the `<CascadePreviewList>`, only the generic confirmation text

#### Scenario: Confirm removes promotion from store
- **WHEN** the user clicks "Eliminar" and the DELETE returns 204
- **THEN** the promotion SHALL be removed from `promotionStore.items` and a toast SHALL show `t('promotions.deleteSuccess')`

#### Scenario: MANAGER does not see delete button
- **WHEN** a user with role MANAGER views the promotions table
- **THEN** the delete icon in the actions column SHALL NOT render for any row

#### Scenario: Forbidden response rolls back silently
- **WHEN** somehow DELETE returns 403 (stale cache or edge race)
- **THEN** the store SHALL NOT remove the item and `toast.error(t('permissions.deleteForbidden'))` SHALL display

### Requirement: Validity and branch filters

The page SHALL render three filter controls above the table: status (`todas` | `activas` | `inactivas`), validity (`todas` | `vigentes` | `proximas` | `expiradas`), branch (`todas` | one per accessible branch). Filters SHALL be combinable and applied client-side via `useMemo`. The "validity" filter SHALL use `getPromotionStatus(p, now)` where `now` is captured once at render time (constant local value) for consistency across the table.

#### Scenario: Filter by active status
- **WHEN** the user selects status `activas`
- **THEN** the table SHALL show only rows where `is_active === true`

#### Scenario: Filter by validity "vigentes"
- **WHEN** the user selects validity `vigentes` and `now` is between a promotion's start and end datetimes
- **THEN** the table SHALL include that promotion; promotions whose status is `scheduled` or `expired` SHALL be excluded

#### Scenario: Filter by branch
- **WHEN** the user selects branch `'2'`
- **THEN** the table SHALL show only promotions where `p.branches.some((b) => b.branch_id === '2')`

#### Scenario: Combined filters are intersected
- **WHEN** the user selects status `activas` AND validity `vigentes` AND branch `'2'`
- **THEN** the table SHALL show only promotions matching all three conditions

### Requirement: promotionStore with optimistic CRUD

The Dashboard SHALL provide `Dashboard/src/stores/promotionStore.ts`, a tenant-scoped persisted Zustand store. State: `{ items: Promotion[], isLoading: boolean, error: string | null, pendingTempIds: Set<string> }`. Actions: `fetchAsync`, `createAsync`, `updateAsync`, `deleteAsync`, `toggleActiveAsync`, `linkBranchAsync`, `unlinkBranchAsync`, `linkProductAsync`, `unlinkProductAsync`, `applyWSCreated`, `applyWSUpdated`, `applyWSDeleted`. All mutations SHALL follow the optimistic-update-with-rollback pattern (snapshot previous state, apply locally, call API, rollback on error and populate `error`). Named selectors SHALL include `selectPromotions`, `selectIsLoading`, `selectError`, `selectPromotionById(id)`, `useActivePromotions()` (with `useShallow`), `usePromotionsForBranch(branchId)` (with `useShallow`), `usePromotionActions()` (grouped actions with `useShallow`). The store SHALL be persisted via `persist()` using `STORAGE_KEYS.PROMOTION` and `STORE_VERSIONS.PROMOTION` with a `migrate(persistedState: unknown, version: number)` function using type guards (never `any`).

#### Scenario: Named selectors returned
- **WHEN** a component imports from `promotionStore`
- **THEN** named selectors `selectPromotions`, `selectIsLoading`, `selectError`, `selectPromotionById`, `useActivePromotions`, `usePromotionsForBranch`, `usePromotionActions` SHALL be available

#### Scenario: Destructuring the store is forbidden
- **WHEN** a component writes `const { items } = usePromotionStore()`
- **THEN** the ESLint rule SHALL flag this pattern as an error — consumers must use selectors

#### Scenario: Optimistic create on success
- **WHEN** `createAsync(data)` is called and the API returns a valid promotion with `id: '42'`
- **THEN** the store SHALL insert with `tempId` before the request, replace it with the real `id: '42'` on response, remove `tempId` from `pendingTempIds`, and emit `toast.success(t('promotions.createSuccess'))`

#### Scenario: Optimistic create on failure rolls back
- **WHEN** `createAsync(data)` receives a 500 from the API
- **THEN** the store SHALL remove the optimistic item (by `tempId`), set `state.error`, emit `toast.error(t('promotions.createFailed'))`, and re-throw the error

#### Scenario: Optimistic update rolls back on failure
- **WHEN** `updateAsync(id, data)` fails
- **THEN** the previous item SHALL be restored in `items`, `state.error` SHALL be populated, and a toast error SHALL display

#### Scenario: Optimistic delete rolls back on failure
- **WHEN** `deleteAsync(id)` fails
- **THEN** the previously removed item SHALL be re-inserted in its original position (by index snapshot) and an error toast SHALL display

#### Scenario: linkBranchAsync optimistically appends branch
- **WHEN** `linkBranchAsync(promotionId, branchId)` is called
- **THEN** the store SHALL add `{ branch_id, branch_name }` to the target promotion's `branches` array before the request and rollback on failure

#### Scenario: applyWSCreated deduplicates by id
- **WHEN** `applyWSCreated(promotion)` is called with a promotion whose `id` already exists in `items`
- **THEN** the store SHALL NOT duplicate — the existing item remains untouched

#### Scenario: IDs converted at boundary
- **WHEN** the backend returns `{ id: 42, tenant_id: 1, ... }` in a POST/GET response
- **THEN** the store SHALL convert numeric IDs to strings (`"42"`, `"1"`) before inserting into state

#### Scenario: Price stays in cents
- **WHEN** a promotion with `price: 12550` enters the store
- **THEN** the store SHALL preserve the integer `12550` in cents; display conversion to `"$125.50"` happens only at render time via `formatPrice`

### Requirement: DateRangePicker reusable UI component

The Dashboard SHALL provide `Dashboard/src/components/ui/DateRangePicker.tsx` exporting a controlled React component with the interface `{ startDate: string; startTime: string; endDate: string; endTime: string; onChange(value): void; error?: string; labelStart?: string; labelEnd?: string; disabled?: boolean }`. The component SHALL render two groups of `<input type="date">` + `<input type="time">` using native HTML elements (no external lib). Values SHALL be ISO strings: `"YYYY-MM-DD"` for date, `"HH:mm"` for time. The component SHALL emit `onChange` whenever any of the four inputs changes. When `error` is set, the component SHALL render a `<p role="alert">` with the error message. The inputs SHALL expose `aria-invalid` and `aria-describedby` when `error` is present.

#### Scenario: Emits onChange on date change
- **WHEN** the user changes the start date from `"2026-06-15"` to `"2026-06-16"`
- **THEN** `onChange({ startDate: "2026-06-16", startTime: previous, endDate: previous, endTime: previous })` SHALL fire

#### Scenario: Renders error with role alert
- **WHEN** `error` prop is `"promotions.endBeforeStart"` and the component renders
- **THEN** a `<p role="alert">` SHALL appear with the translated text below the inputs, and each input SHALL have `aria-invalid="true"`

#### Scenario: Disabled propagates
- **WHEN** `disabled={true}`
- **THEN** all four inputs SHALL be disabled

### Requirement: MultiSelect reusable UI component

The Dashboard SHALL provide `Dashboard/src/components/ui/MultiSelect.tsx` exporting a controlled React component with the interface `{ label: string; options: { value: string; label: string; disabled?: boolean }[]; selected: string[]; onChange(selected: string[]): void; placeholder?: string; error?: string; disabled?: boolean; name?: string }`. The component SHALL render a trigger `<button>` showing either the placeholder or a count summary (`{n} seleccionadas`) and, on click, a dropdown `<ul role="listbox" aria-multiselectable="true">` of items with `role="option" aria-selected`. Keyboard: `Enter`/`Space` toggles, `ArrowUp/Down` navigates, `Home/End` jumps, `Escape` closes. Clicking outside SHALL close the dropdown. When `error` is set, the trigger SHALL have `aria-invalid="true"` and a `<p role="alert">` below it SHALL show the translated error.

#### Scenario: Toggles selection on click
- **WHEN** the user clicks an unselected option
- **THEN** `onChange([...selected, option.value])` SHALL fire

#### Scenario: Deselects on second click
- **WHEN** the user clicks a selected option
- **THEN** `onChange(selected.filter((v) => v !== option.value))` SHALL fire

#### Scenario: Keyboard Enter toggles focused option
- **WHEN** the dropdown is open, the user pressed ArrowDown twice, and presses Enter
- **THEN** the third option SHALL toggle its selection state

#### Scenario: Escape closes dropdown
- **WHEN** the dropdown is open and Escape is pressed
- **THEN** the dropdown SHALL close and focus SHALL return to the trigger button

#### Scenario: Summary in trigger when selections exist
- **WHEN** `selected = ["1", "2", "3"]` and the dropdown is closed
- **THEN** the trigger button SHALL display a summary like `"3 seleccionadas"` translated via i18n

#### Scenario: Accessible error
- **WHEN** `error = "promotions.noBranchesSelected"`
- **THEN** the trigger SHALL have `aria-invalid="true"` and a `<p role="alert">` SHALL render the translated message below it

### Requirement: Promotion validators

The Dashboard SHALL extend `Dashboard/src/utils/validation.ts` with `validatePromotion(data: PromotionFormData): { isValid: boolean; errors: Partial<Record<keyof PromotionFormData, string>> }`. Rules: `name` required after trim and max 120 characters (`'validation.required'` | `'validation.maxLength'`); `description` max 500 when present (`'validation.maxLength'`); `price` is a valid non-negative integer (`'validation.required'` | `'validation.priceNonNegative'`); `start_date`, `start_time`, `end_date`, `end_time` all required (`'validation.required'`); combined `end_datetime >= start_datetime` (`'promotions.endBeforeStart'` on `end_date`); `branch_ids.length >= 1` (`'promotions.noBranchesSelected'`). Errors SHALL be i18n keys, never translated strings.

#### Scenario: Valid payload passes
- **WHEN** `validatePromotion({ name: 'X', price: 1000, start_date: '2026-01-01', start_time: '10:00', end_date: '2026-01-02', end_time: '10:00', branch_ids: ['1'], ... })` is called
- **THEN** it SHALL return `{ isValid: true, errors: {} }`

#### Scenario: Blank name returns required error
- **WHEN** `validatePromotion({ name: '   ', ... })` is called
- **THEN** it SHALL return `{ isValid: false, errors: { name: 'validation.required' } }`

#### Scenario: Name over 120 chars returns maxLength
- **WHEN** name has 121 characters
- **THEN** the error SHALL be `'validation.maxLength'`

#### Scenario: Negative price returns priceNonNegative
- **WHEN** `price: -1` is supplied
- **THEN** the error SHALL be `{ price: 'validation.priceNonNegative' }`

#### Scenario: Reversed datetime range returns endBeforeStart
- **WHEN** `start_date: '2026-06-15'`, `start_time: '22:00'`, `end_date: '2026-06-15'`, `end_time: '18:00'`
- **THEN** the error SHALL be `{ end_date: 'promotions.endBeforeStart' }`

#### Scenario: Empty branch list returns noBranchesSelected
- **WHEN** `branch_ids: []`
- **THEN** the error SHALL be `{ branch_ids: 'promotions.noBranchesSelected' }`

### Requirement: Promotion formatters for validity and status

The Dashboard SHALL extend `Dashboard/src/utils/formatters.ts` with three pure helpers: `formatPromotionValidity(p)` returns a string `"DD/MM HH:mm → DD/MM HH:mm"`; `getPromotionStatus(p, now?)` returns `'scheduled' | 'active' | 'expired'` by comparing `now` with the combined `start_datetime` and `end_datetime`; `isPromotionActiveNow(p, now?)` returns a boolean equivalent of `getPromotionStatus(p, now) === 'active'`. The `now` parameter SHALL default to `new Date()` and SHALL be accepted to make the helpers deterministic for tests.

#### Scenario: formatPromotionValidity returns readable string
- **WHEN** `formatPromotionValidity({ start_date: '2026-06-15', start_time: '18:00:00', end_date: '2026-06-15', end_time: '22:00:00' })` is called
- **THEN** it SHALL return `"15/06 18:00 → 15/06 22:00"`

#### Scenario: getPromotionStatus returns scheduled before start
- **WHEN** `now` is before `start_datetime`
- **THEN** the function SHALL return `'scheduled'`

#### Scenario: getPromotionStatus returns active inside range
- **WHEN** `now` is between `start_datetime` and `end_datetime` (inclusive of start, exclusive of end)
- **THEN** the function SHALL return `'active'`

#### Scenario: getPromotionStatus returns expired after end
- **WHEN** `now` is after `end_datetime`
- **THEN** the function SHALL return `'expired'`

#### Scenario: isPromotionActiveNow delegates to getPromotionStatus
- **WHEN** `isPromotionActiveNow(p, now)` is called
- **THEN** it SHALL return `true` if and only if `getPromotionStatus(p, now) === 'active'`

### Requirement: Cascade service supports promotions

The Dashboard SHALL extend `Dashboard/src/services/cascadeService.ts` with `getPromotionPreview(id: string): CascadePreview | null` and `deletePromotionWithCascade(id: string): Promise<void>`. `getPromotionPreview` SHALL read the hydrated `promotionStore` and compute `{ totalItems, items }` where `items` include entries for non-zero `PromotionBranch` and `PromotionItem` counts. `deletePromotionWithCascade` SHALL call `promotionStore.getState().deleteAsync(id)` — the backend handles the cascade automatically.

#### Scenario: Preview returns null when promotion not found
- **WHEN** `getPromotionPreview('999')` is called and no promotion with that id exists
- **THEN** the function SHALL return `null`

#### Scenario: Preview returns zero totalItems when no relations
- **WHEN** the promotion has `branches: []` and `items: []`
- **THEN** `getPromotionPreview` SHALL return `{ totalItems: 0, items: [] }`

#### Scenario: Preview computes non-zero counts
- **WHEN** the promotion has 2 branches and 3 items
- **THEN** `getPromotionPreview` SHALL return `{ totalItems: 5, items: [{ label: 'promotions.cascade.branches', count: 2 }, { label: 'promotions.cascade.items', count: 3 }] }`

### Requirement: Permissions derive canManagePromotions and canDeletePromotion

The Dashboard SHALL extend `Dashboard/src/hooks/useAuthPermissions.ts` to derive `canManagePromotions: boolean = isAdmin || isManager` and `canDeletePromotion: boolean = isAdmin`. These flags SHALL gate the sidebar item visibility and the delete button visibility in the page respectively.

#### Scenario: ADMIN has both permissions
- **WHEN** the authenticated user has role ADMIN
- **THEN** `canManagePromotions === true` and `canDeletePromotion === true`

#### Scenario: MANAGER has manage but not delete
- **WHEN** the authenticated user has role MANAGER
- **THEN** `canManagePromotions === true` and `canDeletePromotion === false`

#### Scenario: KITCHEN and WAITER have neither
- **WHEN** the authenticated user has role KITCHEN or WAITER
- **THEN** both flags SHALL be `false`

### Requirement: helpContent entry for promotions

The Dashboard SHALL extend `Dashboard/src/utils/helpContent.tsx` with a `promotions` entry that SHALL explain the page's purpose, CRUD actions, validity rules, price-in-cents convention, branch linking, and include a note tip about local-time evaluation. The entry SHALL follow the existing JSX structure (title + intro + feature list + tip box). Inline page-level help in `Promotions.tsx` SHALL be forbidden.

#### Scenario: helpContent.promotions is defined
- **WHEN** a consumer imports `helpContent` from `Dashboard/src/utils/helpContent.tsx`
- **THEN** the object SHALL contain a `promotions` key whose value is a ReactNode following the page structure template

#### Scenario: PageContainer uses helpContent.promotions
- **WHEN** the Promotions page renders
- **THEN** `<PageContainer helpContent={helpContent.promotions}>` SHALL be used (never an inline JSX node)

### Requirement: Promotion types fetched from catalogStore

The Dashboard SHALL extend `catalogStore` (or create it if not present from prior changes) with `promotion_types: PromotionType[]` state and `fetchPromotionTypesAsync()` action consuming `GET /api/admin/catalogs/promotion-types`. Selectors: `selectPromotionTypes`, `selectPromotionTypeById(id)`. The Promotions page SHALL trigger `fetchPromotionTypesAsync()` on mount (idempotent — skip if already loaded) and pass the fetched list as options to the `promotion_type_id` Select.

#### Scenario: Fetch populates types
- **WHEN** `fetchPromotionTypesAsync()` is called and the API returns a list
- **THEN** `catalogStore.promotion_types` SHALL be populated with string IDs

#### Scenario: Idempotent on mount
- **WHEN** the Promotions page mounts and `catalogStore.promotion_types` is already non-empty
- **THEN** `fetchPromotionTypesAsync` SHALL return early without triggering a request

#### Scenario: Select shows "Sin tipo" when empty
- **WHEN** no promotion_type is selected in the form
- **THEN** the select SHALL offer a "Sin tipo" option mapped to `null` / unset

