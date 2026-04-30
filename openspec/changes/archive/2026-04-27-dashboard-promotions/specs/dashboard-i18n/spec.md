# dashboard-i18n Delta Spec

> Change: **C-27 dashboard-promotions**. Adds ~30 new keys under `promotions.*` to both Spanish and English locale files, plus two new sidebar/breadcrumb keys for the Promotions route. Extends the validation namespace with promotion-specific validation keys. Parity between `es` and `en` remains mandatory.

## ADDED Requirements

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

## MODIFIED Requirements

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
