## ADDED Requirements

### Requirement: i18next configured with Spanish default and English fallback

The Dashboard SHALL configure `react-i18next` with `i18next-browser-languagedetector`. The default language SHALL be Spanish (`es`). The fallback language SHALL be English (`en`). The detected language preference SHALL be persisted in `localStorage`.

#### Scenario: Default language is Spanish
- **WHEN** the Dashboard loads without a language preference in localStorage
- **THEN** all UI text SHALL render in Spanish

#### Scenario: Language preference persists across sessions
- **WHEN** the user switches to English and reloads the page
- **THEN** the Dashboard SHALL load with English as the active language

#### Scenario: Missing key falls back to Spanish
- **WHEN** a translation key exists in `es.json` but not in `en.json`
- **THEN** the English locale SHALL display the Spanish translation as fallback

### Requirement: Translation files provide ~700 base keys organized by feature

The Dashboard SHALL provide `es.json` and `en.json` locale files with keys organized in a flat dot-separated structure by feature area. The base key categories SHALL include: `common` (save, cancel, delete, confirm, loading, error, success), `auth` (login, logout, session expired, 2FA), `layout` (sidebar labels, breadcrumb labels), `errors` (404, network error, validation), `crud` (create, edit, delete, list, search, filter, pagination), and `validation` (required, invalid email, min/max length).

#### Scenario: Common action keys exist in both languages
- **WHEN** inspecting `es.json` and `en.json`
- **THEN** both SHALL contain keys for `common.save`, `common.cancel`, `common.delete`, `common.confirm`, `common.loading`, `common.error`, `common.success`

#### Scenario: Auth-related keys exist
- **WHEN** inspecting locale files
- **THEN** both SHALL contain keys for `auth.login.title`, `auth.login.email`, `auth.login.password`, `auth.login.submit`, `auth.login.error`, `auth.logout`, `auth.sessionExpired`

#### Scenario: Layout navigation keys exist
- **WHEN** inspecting locale files
- **THEN** both SHALL contain keys for sidebar navigation items: `layout.sidebar.home`, `layout.sidebar.categories`, `layout.sidebar.products`, `layout.sidebar.staff`, `layout.sidebar.tables`, `layout.sidebar.kitchen`, `layout.sidebar.settings`

### Requirement: All user-visible text uses t() function

All user-visible text in Dashboard components SHALL use the `t()` function from `react-i18next`. No hardcoded strings SHALL appear in JSX for user-facing text. Code comments and developer-facing strings (e.g., logger messages) MAY remain in English.

#### Scenario: Login page uses t() for all labels
- **WHEN** inspecting the LoginPage component source
- **THEN** all user-visible text (input labels, button text, error messages) SHALL use `t("auth.login.email")` or equivalent i18n calls

#### Scenario: Layout components use t() for navigation
- **WHEN** inspecting Sidebar and Navbar components
- **THEN** all navigation labels and button text SHALL use `t()` calls
