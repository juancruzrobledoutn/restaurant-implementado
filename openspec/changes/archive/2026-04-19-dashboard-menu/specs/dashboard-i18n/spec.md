# dashboard-i18n Delta Spec

> Change: **C-15 dashboard-menu**. Extends the Dashboard i18n infrastructure with menu-specific keys required by the six CRUD pages and by the WebSocket sync toasts.

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Translation files provide ~700 base keys organized by feature

The Dashboard SHALL provide `es.json` and `en.json` locale files with keys organized in a flat dot-separated structure by feature area. The base key categories SHALL include: `common` (save, cancel, delete, confirm, loading, error, success), `auth` (login, logout, session expired, 2FA), `layout` (sidebar labels including the `menu.*` group, breadcrumb labels including `menu.*` routes), `errors` (404, network error, validation), `crud` (create, edit, delete, list, search, filter, pagination), `validation` (required, invalid email, min/max length, invalidPrice, invalidImageUrl, invalidNumber, invalidSeverity, invalidPresenceType, invalidRiskLevel, duplicateName, selfReference), and `menu` (categories, subcategories, products, allergens, ingredients, recipes plus shared keys cascadeNotified, cascadePreview, websocketEvent). After C-15, both locale files SHALL have **full bidirectional parity** — every key in one file MUST exist in the other.

#### Scenario: Common action keys exist in both languages
- **WHEN** inspecting `es.json` and `en.json`
- **THEN** both SHALL contain keys for `common.save`, `common.cancel`, `common.delete`, `common.confirm`, `common.loading`, `common.error`, `common.success`

#### Scenario: Auth-related keys exist
- **WHEN** inspecting locale files
- **THEN** both SHALL contain keys for `auth.login.title`, `auth.login.email`, `auth.login.password`, `auth.login.submit`, `auth.login.error`, `auth.logout`, `auth.sessionExpired`

#### Scenario: Layout navigation keys exist
- **WHEN** inspecting locale files
- **THEN** both SHALL contain keys for sidebar navigation items: `layout.sidebar.home`, `layout.sidebar.menu.groupLabel`, `layout.sidebar.menu.categories`, `layout.sidebar.menu.subcategories`, `layout.sidebar.menu.products`, `layout.sidebar.menu.allergens`, `layout.sidebar.menu.ingredients`, `layout.sidebar.menu.recipes`, `layout.sidebar.staff`, `layout.sidebar.tables`, `layout.sidebar.kitchen`, `layout.sidebar.settings`

#### Scenario: Menu namespace exists
- **WHEN** inspecting locale files
- **THEN** both SHALL contain the `menu.categories.*`, `menu.subcategories.*`, `menu.products.*`, `menu.allergens.*`, `menu.ingredients.*`, `menu.recipes.*`, `menu.cascadeNotified`, `menu.cascadePreview.*`, `menu.websocketEvent.*` key groups

#### Scenario: Parity test passes after C-15
- **WHEN** the existing `i18n.test.ts` parity test runs
- **THEN** it SHALL pass with zero orphan keys in either direction (every key in `es.json` exists in `en.json` and vice versa)
