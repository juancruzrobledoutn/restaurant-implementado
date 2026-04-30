# dashboard-menu-pages Delta Spec

> Change: **C-15 dashboard-menu**. Introduces the six menu CRUD pages (Categories, Subcategories, Products, Allergens, Ingredients, Recipes) in the Dashboard, plus the canonical CRUD page pattern and the UI components that enable them.

## ADDED Requirements

### Requirement: Canonical CRUD page hook trio

The Dashboard SHALL provide three reusable hooks that every CRUD page uses in place of raw `useState`: `useFormModal<FormData, Entity>`, `useConfirmDialog<Entity>`, and `usePagination<T>`. These hooks live in `Dashboard/src/hooks/`. Using raw `useState` for modal state, delete-dialog state, or pagination state SHALL be prohibited in any page under `Dashboard/src/pages/`. `useFormModal` SHALL expose `{ isOpen, selectedItem, formData, setFormData, openCreate, openEdit, close }`. `useConfirmDialog` SHALL expose `{ isOpen, item, open, close }`. `usePagination` SHALL expose `{ paginatedItems, currentPage, totalPages, totalItems, itemsPerPage, setCurrentPage }`.

#### Scenario: useFormModal opens in create mode
- **WHEN** a page calls `modal.openCreate({ name: '' })`
- **THEN** `modal.isOpen` SHALL become `true`, `modal.selectedItem` SHALL be `null`, and `modal.formData.name` SHALL be `''`

#### Scenario: useFormModal opens in edit mode with mapper
- **WHEN** a page calls `modal.openEdit(item, (i) => ({ name: i.name, order: i.order }))`
- **THEN** `modal.isOpen` SHALL become `true`, `modal.selectedItem` SHALL equal `item`, and `modal.formData` SHALL be the mapper's output

#### Scenario: useConfirmDialog keeps the target item
- **WHEN** a page calls `deleteDialog.open(item)`
- **THEN** `deleteDialog.isOpen` SHALL be `true` and `deleteDialog.item` SHALL equal `item` until `close()` is called

#### Scenario: usePagination paginates client-side
- **WHEN** `usePagination` is called with an array of 125 items and default `itemsPerPage` of 10
- **THEN** `totalPages` SHALL be `13`, `totalItems` SHALL be `125`, and `paginatedItems` SHALL return the current page's slice

#### Scenario: Pagination setCurrentPage
- **WHEN** `setCurrentPage(3)` is called
- **THEN** `paginatedItems` SHALL return items with indices 20..29 and `currentPage` SHALL be `3`

### Requirement: React 19 useActionState for every form submission

Every form in a Dashboard CRUD page SHALL use React 19's `useActionState<FormState<T>, FormData>` hook with `<form action={formAction}>`. The old pattern of `onSubmit` + `preventDefault` + manual `useState` for loading/errors SHALL be forbidden. The action function SHALL validate via the centralized `validateX(data)` function from `Dashboard/src/utils/validation.ts`, call the store's `createAsync` or `updateAsync`, and return `FormState<T>` with `isSuccess` and optional `errors`, `message` fields. Modal close SHALL happen at render time via the guard `if (state.isSuccess && modal.isOpen) modal.close()`, NEVER inside the action function.

#### Scenario: Form submits valid data
- **WHEN** the user submits a valid category form
- **THEN** the action SHALL call `createAsync` or `updateAsync`, show a success toast, and return `{ isSuccess: true }`

#### Scenario: Form submits invalid data
- **WHEN** the user submits a form with a blank required field
- **THEN** the action SHALL call `validateCategory(data)`, return `{ errors: { name: 'validation.required' }, isSuccess: false }`, and the form SHALL render the translated error below the field

#### Scenario: Modal closes on success
- **WHEN** the action returns `{ isSuccess: true }`
- **THEN** the `state.isSuccess` guard SHALL call `modal.close()` at the next render

#### Scenario: isPending disables submit during request
- **WHEN** the action is in flight (`isPending === true`)
- **THEN** the submit button SHALL be disabled (`isLoading` prop) to prevent double-submit

### Requirement: PageContainer with mandatory helpContent

Every Dashboard CRUD page SHALL render inside a `<PageContainer>` that accepts a required `helpContent` prop of type `ReactNode`. The help content SHALL live in `Dashboard/src/utils/helpContent.tsx` and SHALL be referenced by page-specific key (`helpContent.categories`, `helpContent.products`, etc.). Inline help content at the page is forbidden. Every create/edit modal's form SHALL render a `<HelpButton size="sm">` as the first element inside the form body.

#### Scenario: PageContainer requires helpContent
- **WHEN** a page renders `<PageContainer title="Categories" helpContent={helpContent.categories}>...`
- **THEN** the page SHALL display the title, a help trigger in the header, and the content area

#### Scenario: Modal form has HelpButton at the top
- **WHEN** a create/edit modal opens
- **THEN** the first element inside the `<form>` SHALL be a `<HelpButton size="sm">` with entity-specific help content

### Requirement: Categories CRUD page

The Dashboard SHALL provide a page at route `/categories` that lists active categories for the selected branch, paginated, with create/edit/delete actions. The page SHALL filter by `selectedBranchId` and show a "select a branch" fallback card when `selectedBranchId` is null. Categories SHALL show `name`, `order`, `is_active` (Badge), and actions (edit/delete). Delete SHALL open a confirm dialog with a cascade preview of affected subcategories and products. The page SHALL be lazy-loaded and registered in the router with `handle.breadcrumb = 'layout.sidebar.categories'`.

#### Scenario: Lists categories for selected branch
- **WHEN** the user navigates to `/categories` with `selectedBranchId = '1'`
- **THEN** the page SHALL render a paginated table of categories where `branch_id === '1'`, ordered by `order`

#### Scenario: Fallback when no branch selected
- **WHEN** the user navigates to `/categories` with `selectedBranchId = null`
- **THEN** the page SHALL render a `<Card>` with a "select a branch" message and a button linking to the dashboard home

#### Scenario: Create category
- **WHEN** the user clicks "New", fills name "Entradas" and order 10, and submits
- **THEN** the store SHALL call `POST /api/admin/categories` with `{ branch_id, name: 'Entradas', order: 10 }`, apply optimistic insert, show success toast, and close the modal

#### Scenario: Delete category shows cascade preview
- **WHEN** the user clicks delete on a category with 3 subcategories and 12 products
- **THEN** the confirm dialog SHALL render `<CascadePreviewList>` showing "3 subcategories and 12 products will be deleted"

#### Scenario: MANAGER sees disabled delete button
- **WHEN** a MANAGER views the page
- **THEN** the delete button column action SHALL NOT appear for any row

### Requirement: Subcategories CRUD page

The Dashboard SHALL provide a page at route `/subcategories` that lists active subcategories for the selected branch, filtered optionally by category. Fields: `name`, `order`, parent category, `is_active`. Delete cascades to products with preview.

#### Scenario: Filters subcategories by category
- **WHEN** the user selects category "Platos principales" from a filter
- **THEN** the table SHALL show only subcategories where `category_id` matches

#### Scenario: Create subcategory
- **WHEN** the user submits a new subcategory with `{ category_id, name: 'Ensaladas', order: 10 }`
- **THEN** the store SHALL call `POST /api/admin/subcategories` and apply optimistic insert

### Requirement: Products CRUD page

The Dashboard SHALL provide a page at route `/products` that lists products for the selected branch, showing `name`, `price` (formatted from cents to currency), `featured`, `popular`, linked allergens count, `is_active`. The form SHALL accept `name`, `description`, `price_cents` (integer input), `subcategory_id` (select), `image` (URL input with preview), `featured` (toggle), `popular` (toggle). The form SHALL validate image URL via `validateImageUrl` (same anti-SSRF rules as backend). Allergen linking SHALL be a separate flow via an `<AllergenLinker>` sub-modal accessible from the product row or inside the edit modal. BranchProduct availability SHALL be editable from a per-row inline toggle that calls `PUT /api/admin/branch-products/{id}` with `is_available`.

#### Scenario: Create product with valid price
- **WHEN** the user submits `{ name: 'Caesar Salad', price_cents: 12550, subcategory_id, featured: true }`
- **THEN** the store SHALL call `POST /api/admin/products`, apply optimistic insert, and close the modal

#### Scenario: Reject negative price
- **WHEN** the user enters `price_cents = -100`
- **THEN** the form SHALL display the translated error `validation.invalidPrice` under the price field and NOT submit

#### Scenario: Reject SSRF image URL
- **WHEN** the user enters image URL `http://169.254.169.254/latest/meta-data/`
- **THEN** the form SHALL display the translated error `validation.invalidImageUrl` and NOT submit

#### Scenario: Toggle product availability per branch
- **WHEN** the user toggles `is_available` for a BranchProduct row
- **THEN** the store SHALL call `PUT /api/admin/branch-products/{id}` with `{ is_available: false }` and apply optimistic update

#### Scenario: Link allergen to product
- **WHEN** the user opens the allergen linker for a product, selects "Gluten" with presence "contains" and risk "severe"
- **THEN** the store SHALL call `POST /api/admin/products/{id}/allergens` with the payload

### Requirement: Allergens CRUD page

The Dashboard SHALL provide a page at route `/allergens` that lists tenant-scoped allergens. Fields: `name`, `severity` (Badge with color per severity), `is_mandatory`, `icon` (URL or preset), `description`, `is_active`. The page SHALL support creating cross-reactions between allergens via a separate modal.

#### Scenario: Create allergen
- **WHEN** the user submits `{ name: 'Gluten', is_mandatory: true, severity: 'severe' }`
- **THEN** the store SHALL call `POST /api/admin/allergens` and apply optimistic insert

#### Scenario: Create cross-reaction
- **WHEN** the user opens the cross-reactions modal for allergen "Wheat" and links it to "Gluten"
- **THEN** the store SHALL call `POST /api/admin/allergens/{id}/cross-reactions` with `{ related_allergen_id }` and the UI SHALL show the reaction bidirectionally

#### Scenario: Reject self-reference
- **WHEN** the user tries to link an allergen to itself
- **THEN** the form SHALL show validation error before calling the backend

### Requirement: Ingredients CRUD page

The Dashboard SHALL provide a page at route `/ingredients` that exposes the three-level hierarchy `IngredientGroup → Ingredient → SubIngredient`. The page SHALL render groups as collapsible sections, each containing its ingredients, each containing its sub-ingredients. Create/edit/delete actions SHALL be available at every level. Delete on a group cascades to its ingredients and their sub-ingredients with preview.

#### Scenario: Create ingredient group
- **WHEN** the user submits `{ name: 'Dairy' }`
- **THEN** the store SHALL call `POST /api/admin/ingredients` and apply optimistic insert

#### Scenario: Create ingredient under group
- **WHEN** the user clicks "add ingredient" under group "Dairy" and submits `{ name: 'Whole Milk' }`
- **THEN** the store SHALL call `POST /api/admin/ingredients/{group_id}/items`

#### Scenario: Delete group cascades
- **WHEN** the user deletes group "Dairy" which has 4 ingredients with 7 sub-ingredients total
- **THEN** the confirm dialog SHALL show "4 ingredients and 7 sub-ingredients will be removed" and on confirm call `DELETE /api/admin/ingredients/{group_id}`

#### Scenario: KITCHEN cannot manage ingredients
- **WHEN** a KITCHEN user loads the page
- **THEN** the page SHALL render read-only without create/edit/delete buttons

### Requirement: Recipes CRUD page

The Dashboard SHALL provide a page at route `/recipes` that lists recipes (tenant-scoped) with fields `name`, linked product, ingredient count, `is_active`. The form SHALL allow associating a product, managing the list of ingredients with quantities, and saving.

#### Scenario: Create recipe
- **WHEN** the user submits a recipe with `product_id`, `name`, and a list of `ingredient_id` with quantities
- **THEN** the store SHALL call `POST /api/recipes` and apply optimistic insert

#### Scenario: List recipes
- **WHEN** an authenticated K/M/A user loads the page
- **THEN** the table SHALL show recipes for the tenant with their linked product names

### Requirement: Mandatory UI components

The Dashboard SHALL provide the following UI components in `Dashboard/src/components/ui/` to support CRUD pages: `Modal`, `ConfirmDialog`, `Table`, `TableSkeleton`, `Pagination`, `Badge`, `Card`, `PageContainer`, `HelpButton`, `Input`, `Toggle`, `Select`, `ImagePreview`, `CascadePreviewList`, `ToastContainer`. All components SHALL meet accessibility requirements: `aria-label` on icon-only buttons, `aria-hidden="true"` on decorative icons, `role="dialog"` and `aria-modal="true"` on modals, focus trap inside modal and confirm dialog, and `<span className="sr-only">` prefix for screen-reader-only context in Badges.

#### Scenario: Modal traps focus
- **WHEN** a modal opens
- **THEN** focus SHALL move to the first focusable element inside the modal, and Tab SHALL cycle within the modal until closed; on close, focus SHALL return to the triggering element

#### Scenario: Icon-only button has aria-label
- **WHEN** a delete icon button renders in a table row for entity "Entradas"
- **THEN** the button SHALL have `aria-label="Eliminar Entradas"` (or the translated equivalent)

#### Scenario: Badge announces context
- **WHEN** a Badge renders with text "Activo"
- **THEN** the DOM SHALL contain `<span className="sr-only">Estado:</span> Activo` so screen readers announce "Estado: Activo"

#### Scenario: TableSkeleton shown while loading
- **WHEN** the store's `isLoading` is `true`
- **THEN** the page SHALL render `<TableSkeleton>` rows instead of an empty table

### Requirement: Validation utilities and form types

The Dashboard SHALL provide `Dashboard/src/utils/validation.ts` with one validator function per entity (`validateCategory`, `validateSubcategory`, `validateProduct`, `validateAllergen`, `validateIngredientGroup`, `validateIngredient`, `validateSubIngredient`, `validateRecipe`) plus shared helpers (`isValidNumber`, `isPositiveNumber`, `isNonNegativeNumber`, `validateImageUrl`). All validators SHALL return `{ isValid: boolean, errors: Partial<Record<keyof T, string>> }` where each error value is an i18n key (e.g., `validation.required`, `validation.invalidPrice`). The Dashboard SHALL provide `Dashboard/src/types/form.ts` exporting `FormState<T> = { errors?, message?, isSuccess? }` and `ValidationErrors<T> = Partial<Record<keyof T, string>>`. Form components SHALL import these from that file; redefining them inline is prohibited.

#### Scenario: Required field missing
- **WHEN** `validateCategory({ name: '', order: 0 })` is called
- **THEN** it SHALL return `{ isValid: false, errors: { name: 'validation.required' } }`

#### Scenario: Image URL anti-SSRF
- **WHEN** `validateImageUrl('http://192.168.1.1/image.png')` is called
- **THEN** it SHALL return `false` (rejected: non-HTTPS and private IP)

#### Scenario: Valid HTTPS CDN URL
- **WHEN** `validateImageUrl('https://cdn.example.com/photo.jpg')` is called
- **THEN** it SHALL return `true`

### Requirement: Cascade service for client-side delete preview

The Dashboard SHALL provide `Dashboard/src/services/cascadeService.ts` with functions `getCategoryPreview(categoryId): CascadePreview | null`, `getSubcategoryPreview`, `getIngredientGroupPreview`, `getAllergenPreview`, each returning a preview object with the counts of affected child entities. It SHALL also provide wrapper delete functions `deleteCategoryWithCascade(id)`, `deleteSubcategoryWithCascade(id)`, `deleteIngredientGroupWithCascade(id)`, `deleteAllergenWithCascade(id)` that call the store's `deleteAsync` and rely on the server to execute the cascade. The preview SHALL be computed from already-hydrated stores (no extra backend request).

#### Scenario: Preview computed from store
- **WHEN** `getCategoryPreview('1')` is called and the store has 3 subcategories and 12 products referencing `category_id === '1'`
- **THEN** it SHALL return `{ totalItems: 15, items: [{ label: 'Subcategories', count: 3 }, { label: 'Products', count: 12 }] }`

#### Scenario: Null preview when no children
- **WHEN** `getCategoryPreview('999')` is called for a category with no children
- **THEN** it SHALL return `null` or an object with `totalItems: 0` so the confirm dialog can skip rendering `<CascadePreviewList>`

### Requirement: Sidebar extended with Menu section

The Dashboard sidebar SHALL include a "Menu" navigation section containing links to the six CRUD pages: Categories, Subcategories, Products, Allergens, Ingredients, Recipes. All labels SHALL be translated via `t('layout.sidebar.<key>')`. Each item SHALL have a lucide-react icon and be `aria-current="page"` when active.

#### Scenario: Menu items render
- **WHEN** the authenticated user views the sidebar
- **THEN** it SHALL display a "Menu" group with six navigation items, each with an icon and translated label

#### Scenario: Active route highlighted
- **WHEN** the user is on `/products`
- **THEN** the "Products" item SHALL have `aria-current="page"` and the active visual state
