## MODIFIED Requirements

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
