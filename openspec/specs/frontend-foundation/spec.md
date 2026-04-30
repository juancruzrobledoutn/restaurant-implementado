# frontend-foundation Specification

## Purpose
TBD - created by archiving change foundation-setup. Update Purpose after archive.
## Requirements
### Requirement: Three frontend projects use Vite + React 19 + TypeScript
Dashboard (port 5177), pwaMenu (port 5176), and pwaWaiter (port 5178) SHALL each be scaffolded as Vite 7.2 projects with React 19.2, TypeScript 5.9, Zustand 5, and Tailwind 4.1. The Dashboard project SHALL additionally include `babel-plugin-react-compiler` for automatic memoization, `eslint-plugin-react-hooks` 7.x for stricter hook rules, and path aliases (`@/` mapping to `src/`) in the Vite config.

#### Scenario: Each frontend starts with npm run dev
- **WHEN** running `npm install && npm run dev` in any of the 3 frontend directories
- **THEN** the Vite dev server SHALL start without errors on its respective port

#### Scenario: Each frontend includes Zustand as a dependency
- **WHEN** inspecting `package.json` of any frontend
- **THEN** `zustand` SHALL be listed in `dependencies` with version `^5.0.0`

#### Scenario: TypeScript compilation succeeds
- **WHEN** running `npx tsc --noEmit` in any frontend directory
- **THEN** it SHALL complete without type errors

#### Scenario: Dashboard includes React Compiler plugin
- **WHEN** inspecting Dashboard's `vite.config.ts`
- **THEN** `babel-plugin-react-compiler` SHALL be configured in the Vite React plugin options

#### Scenario: Dashboard path aliases resolve correctly
- **WHEN** importing `@/stores/authStore` in a Dashboard component
- **THEN** the import SHALL resolve to `src/stores/authStore.ts` without errors

#### Scenario: Dashboard ESLint includes react-hooks 7.x
- **WHEN** inspecting Dashboard's ESLint configuration
- **THEN** `eslint-plugin-react-hooks` version 7.x SHALL be configured with recommended rules

### Requirement: Tailwind 4.1 is configured with project theme
Each frontend SHALL use Tailwind CSS 4.1 with the project's orange primary color (#f97316) defined via CSS `@theme` directive in `src/index.css`.

#### Scenario: Primary color is defined in CSS theme
- **WHEN** inspecting `src/index.css` of any frontend
- **THEN** it SHALL contain `@import "tailwindcss"` and define `--color-primary: #f97316` within `@theme`

### Requirement: pwaMenu includes i18n setup with three languages
pwaMenu SHALL include i18n configuration using `react-i18next` with locale files for Spanish (es), English (en), and Portuguese (pt) in `src/i18n/locales/`.

#### Scenario: Locale files exist for all three languages
- **WHEN** inspecting `pwaMenu/src/i18n/locales/`
- **THEN** `es.json`, `en.json`, and `pt.json` SHALL exist with at least a base `app` key

#### Scenario: i18n initializes with Spanish as default
- **WHEN** the pwaMenu app loads without a language preference
- **THEN** the i18n system SHALL default to `es` (Spanish)

### Requirement: Each frontend has a centralized logger
Each frontend SHALL include a `src/utils/logger.ts` module. Direct use of `console.log`, `console.warn`, or `console.error` is forbidden.

#### Scenario: Logger module is importable
- **WHEN** importing from `utils/logger`
- **THEN** `logger.info()`, `logger.warn()`, and `logger.error()` SHALL be available

### Requirement: Frontends render a minimal App component
Each frontend SHALL render a minimal `App.tsx` component that displays the application name and confirms the app is running.

#### Scenario: Dashboard renders application name
- **WHEN** opening `http://localhost:5177` in a browser
- **THEN** the page SHALL display "Integrador - Dashboard" or similar identifying text

#### Scenario: pwaMenu renders application name
- **WHEN** opening `http://localhost:5176` in a browser
- **THEN** the page SHALL display "Integrador - Menu" or similar identifying text

