# dashboard-i18n Delta Spec

> Change: **C-15 dashboard-menu**. Extends the Dashboard i18n infrastructure with menu-specific keys required by the six CRUD pages and by the WebSocket sync toasts.

## Purpose

Provide comprehensive internationalization (i18n) support for the Dashboard menu system by extending locale files (`es.json`, `en.json`) with menu-specific, cascade-delete, WebSocket, and validation keys, ensuring full bidirectional key parity across languages.
## Requirements
### Requirement: Menu feature keys exist in both locales

The Dashboard locale files `es.json` and `en.json` SHALL include a `menu` namespace with keys grouped by entity. Each entity SHALL have at least the following keys: `menu.<entity>.title`, `menu.<entity>.description`, `menu.<entity>.empty`, `menu.<entity>.create`, `menu.<entity>.edit`, `menu.<entity>.delete`, `menu.<entity>.createSuccess`, `menu.<entity>.updateSuccess`, `menu.<entity>.deleteSuccess`, plus field labels for every form input (`menu.<entity>.fields.<fieldName>`). Entities covered SHALL be: `categories`, `subcategories`, `products`, `allergens`, `ingredients` (including nested `ingredients.group`, `ingredients.item`, `ingredients.sub`), `recipes`.

#### Scenario: Category keys exist
- **WHEN** inspecting `es.json` and `en.json`
- **THEN** both SHALL contain `menu.categories.title`, `menu.categories.description`, `menu.categories.empty`, `menu.categories.create`, `menu.categories.edit`, `menu.categories.delete`, and field labels `menu.categories.fields.name`, `menu.categories.fields.order`, `menu.categories.fields.image`, `menu.categories.fields.isActive`

#### Scenario: Product keys include validation messages
- **WHEN** inspecting `es.json` and `en.json`
- **THEN** both SHALL contain `menu.products.fields.name`, `menu.products.fields.description`, `menu.products.fields.priceCents`, `menu.products.fields.subcategoryId`, `menu.products.fields.image`, `menu.products.fields.featured`, `menu.products.fields.popular`

#### Scenario: Ingredient nested keys exist
- **WHEN** inspecting `es.json` and `en.json`
- **THEN** both SHALL contain keys under `menu.ingredients.group.*`, `menu.ingredients.item.*`, `menu.ingredients.sub.*` for group, ingredient, and sub-ingredient CRUD labels

### Requirement: Cascade and WebSocket notification keys

The Dashboard locale files SHALL include keys for cascade delete previews and for WebSocket event notifications. Required keys: `menu.cascadeNotified` (interpolated with `{count}`), `menu.cascadePreview.<label>` for each child entity label, `menu.websocketEvent.created`, `menu.websocketEvent.updated`, `menu.websocketEvent.deleted`, `menu.websocketEvent.cascade`.

#### Scenario: Cascade notification key supports interpolation
- **WHEN** `t('menu.cascadeNotified', { count: 15 })` is called in Spanish
- **THEN** the rendered string SHALL include the number 15 interpolated (e.g., "Se eliminaron 15 elementos relacionados")

### Requirement: Validation keys extend existing validation namespace

The Dashboard locale files SHALL include, under the existing `validation.*` namespace from C-14, new keys required by the menu validators: `validation.invalidPrice`, `validation.invalidImageUrl`, `validation.invalidNumber`, `validation.invalidSeverity`, `validation.invalidPresenceType`, `validation.invalidRiskLevel`, `validation.duplicateName`, `validation.selfReference`.

#### Scenario: Validation error for invalid image URL
- **WHEN** a form's image field receives an invalid URL and the action returns `{ errors: { image: 'validation.invalidImageUrl' } }`
- **THEN** the form SHALL render the translated text from `validation.invalidImageUrl` below the input

### Requirement: Sidebar keys for the Menu section

The Dashboard locale files SHALL include sidebar keys for the Menu section and its six pages under `layout.sidebar.menu.*`: `layout.sidebar.menu.groupLabel`, `layout.sidebar.menu.categories`, `layout.sidebar.menu.subcategories`, `layout.sidebar.menu.products`, `layout.sidebar.menu.allergens`, `layout.sidebar.menu.ingredients`, `layout.sidebar.menu.recipes`. Breadcrumb keys SHALL also be added for each page: `layout.breadcrumb.menu.<page>`.

#### Scenario: Sidebar group label
- **WHEN** the sidebar renders the Menu section
- **THEN** the group header SHALL display the translated `layout.sidebar.menu.groupLabel`

### Requirement: Translation files provide ~700 base keys organized by feature

The Dashboard SHALL provide `es.json` and `en.json` locale files with keys organized in a flat dot-separated structure by feature area. The base key categories SHALL include: `common` (save, cancel, delete, confirm, loading, error, success), `auth` (login, logout, session expired, 2FA), `layout` (sidebar labels including the `menu.*` group, breadcrumb labels including `menu.*` routes and `promotions`), `errors` (404, network error, validation), `crud` (create, edit, delete, list, search, filter, pagination), `validation` (required, invalid email, min/max length, invalidPrice, invalidImageUrl, invalidNumber, invalidSeverity, invalidPresenceType, invalidRiskLevel, duplicateName, selfReference, priceNonNegative, maxLength), `menu` (categories, subcategories, products, allergens, ingredients, recipes plus shared keys cascadeNotified, cascadePreview, websocketEvent), and `promotions` (title, description, empty, CRUD labels, toggle actions, validity, status, filters, fields, cascade). After C-27, both locale files SHALL have **full bidirectional parity** — every key in one file MUST exist in the other.

#### Scenario: Common action keys exist in both languages
- **WHEN** inspecting `es.json` and `en.json`
- **THEN** both SHALL contain keys for `common.save`, `common.cancel`, `common.delete`, `common.confirm`, `common.loading`, `common.error`, `common.success`

#### Scenario: Auth-related keys exist
- **WHEN** inspecting locale files
- **THEN** both SHALL contain keys for `auth.login.title`, `auth.login.email`, `auth.login.password`, `auth.login.submit`, `auth.login.error`, `auth.logout`, `auth.sessionExpired`

#### Scenario: Layout navigation keys exist
- **WHEN** inspecting locale files
- **THEN** both SHALL contain keys for sidebar navigation items: `layout.sidebar.home`, `layout.sidebar.menu.groupLabel`, `layout.sidebar.menu.categories`, `layout.sidebar.menu.subcategories`, `layout.sidebar.menu.products`, `layout.sidebar.menu.allergens`, `layout.sidebar.menu.ingredients`, `layout.sidebar.menu.recipes`, `layout.sidebar.menu.promotions`, `layout.sidebar.staff`, `layout.sidebar.tables`, `layout.sidebar.kitchen`, `layout.sidebar.settings`

#### Scenario: Menu namespace exists
- **WHEN** inspecting locale files
- **THEN** both SHALL contain the `menu.categories.*`, `menu.subcategories.*`, `menu.products.*`, `menu.allergens.*`, `menu.ingredients.*`, `menu.recipes.*`, `menu.cascadeNotified`, `menu.cascadePreview.*`, `menu.websocketEvent.*` key groups

#### Scenario: Promotions namespace exists
- **WHEN** inspecting locale files
- **THEN** both SHALL contain the `promotions.*` key group (title, description, empty, CRUD labels, toggle, filters, fields, status, cascade)

#### Scenario: Validation namespace extended
- **WHEN** inspecting locale files
- **THEN** both SHALL contain `validation.priceNonNegative` and `validation.maxLength` in addition to the prior validation keys

#### Scenario: Parity test passes after C-27
- **WHEN** the existing `i18n.test.ts` parity test runs
- **THEN** it SHALL pass with zero orphan keys in either direction (every key in `es.json` exists in `en.json` and vice versa, including all C-27 additions under `promotions.*`)

### Requirement: Promotions feature keys exist in both locales

The Dashboard locale files `es.json` and `en.json` SHALL include a `promotions` namespace with the following keys at minimum: `promotions.title`, `promotions.description`, `promotions.empty`, `promotions.create`, `promotions.edit`, `promotions.delete`, `promotions.createSuccess`, `promotions.updateSuccess`, `promotions.deleteSuccess`, `promotions.createFailed`, `promotions.updateFailed`, `promotions.deleteFailed`, `promotions.toggleActive`, `promotions.toggleSuccess`, `promotions.toggleFailed`, `promotions.cascadeNotified`, `promotions.endBeforeStart`, `promotions.noBranchesSelected`, `promotions.status.scheduled`, `promotions.status.active`, `promotions.status.expired`, `promotions.cascade.branches`, `promotions.cascade.items`, `promotions.filters.status`, `promotions.filters.validity`, `promotions.filters.branch`, `promotions.fields.name`, `promotions.fields.description`, `promotions.fields.price`, `promotions.fields.startDate`, `promotions.fields.startTime`, `promotions.fields.endDate`, `promotions.fields.endTime`, `promotions.fields.promotionType`, `promotions.fields.branches`, `promotions.fields.products`, `promotions.fields.isActive`. Both locales SHALL have full bidirectional parity — every key in `es.json` MUST exist in `en.json` and vice versa.

#### Scenario: Promotion title and description keys exist
- **WHEN** inspecting `es.json` and `en.json`
- **THEN** both SHALL contain `promotions.title` and `promotions.description`

#### Scenario: Promotion field labels exist
- **WHEN** inspecting locale files
- **THEN** both SHALL contain all keys under `promotions.fields.*` (`name`, `description`, `price`, `startDate`, `startTime`, `endDate`, `endTime`, `promotionType`, `branches`, `products`, `isActive`)

#### Scenario: Promotion status labels exist
- **WHEN** inspecting locale files
- **THEN** both SHALL contain `promotions.status.scheduled`, `promotions.status.active`, `promotions.status.expired`

#### Scenario: Cascade notification key supports interpolation
- **WHEN** `t('promotions.cascadeNotified', { count: 5 })` is called in Spanish
- **THEN** the rendered string SHALL include the number 5 interpolated (e.g., "Se eliminaron 5 vinculos de la promocion")

#### Scenario: Toggle aria-label supports interpolation
- **WHEN** `t('promotions.toggleActive', { name: '2x1 Martes' })` is called
- **THEN** the rendered string SHALL include the name interpolated (e.g., "Activar promocion 2x1 Martes")

#### Scenario: Parity test passes after C-27
- **WHEN** the existing `i18n.test.ts` parity test runs
- **THEN** it SHALL pass with zero orphan keys in either direction including all new `promotions.*` keys

### Requirement: Sidebar and breadcrumb keys for Promotions route

The Dashboard locale files SHALL include sidebar keys `layout.sidebar.menu.promotions` (used by the sidebar item under the Menu group) and `layout.breadcrumb.promotions` (used by the breadcrumbs on `/promotions`). These keys SHALL exist in both `es.json` and `en.json`.

#### Scenario: Sidebar promotions label exists
- **WHEN** inspecting locale files
- **THEN** both SHALL contain `layout.sidebar.menu.promotions` (e.g., "Promociones" in Spanish, "Promotions" in English)

#### Scenario: Breadcrumb promotions label exists
- **WHEN** inspecting locale files
- **THEN** both SHALL contain `layout.breadcrumb.promotions`

