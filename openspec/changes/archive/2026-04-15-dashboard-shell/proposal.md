## Why

The Dashboard frontend (React 19 at port 5177) was scaffolded in C-01 as a minimal Vite app with no routing, no auth, and no layout. The backend auth system (C-03) is complete — JWT login, refresh, logout, 2FA, RBAC — but there is no frontend to consume it. Every subsequent Dashboard change (C-15 menu management, C-16 operations) needs authenticated routing, a main layout with sidebar navigation, and a Zustand authStore that handles token lifecycle. Without this shell, no admin can log in, no page can be protected, and no CRUD feature can be built. This is the frontend gate for all Dashboard development.

## What Changes

- **Vite + Tailwind 4.1 config**: Verify and extend the existing C-01 scaffold — add `babel-plugin-react-compiler`, `eslint-plugin-react-hooks` 7.x, path aliases (`@/` → `src/`)
- **React Router v7**: File-based routing with `<RouterProvider>`, protected route wrapper that checks authStore, lazy-loaded pages
- **i18next (es/en)**: Dashboard i18n setup with ~700 base translation keys (navigation, common labels, auth messages, error messages, CRUD verbs), Spanish default with English fallback
- **authStore (Zustand)**: `login(email, password, totpCode?)`, `logout()`, proactive token refresh every 14 minutes via `setInterval`, `isAuthenticated` state, `user` object (id, email, fullName, tenantId, branchIds, roles), infinite-loop prevention on logout (guard against refresh triggering re-login)
- **api.ts (fetchAPI)**: Centralized HTTP client wrapping `fetch` — auto-attaches `Authorization: Bearer` header, intercepts 401 responses with silent refresh retry (single retry, no loop), JSON serialization/deserialization, base URL from `VITE_API_URL`
- **Main layout**: Collapsible sidebar (icon-only mode), top navbar with user info and logout, breadcrumbs derived from route hierarchy, responsive (sidebar auto-collapses on mobile)
- **Pages**: Login page (email + password + optional TOTP field), Home (empty dashboard placeholder), 404 Not Found
- **useIdleTimeout hook**: Monitors user activity (mouse, keyboard, touch), shows warning modal at 25 minutes of inactivity, forces logout at 30 minutes
- **Zustand conventions enforced**: All stores export named selectors, `EMPTY_ARRAY` stable fallback constants, `useShallow` for computed/filtered arrays
- **Logger**: Extend the existing `utils/logger.ts` from C-01 for consistent usage across all new modules
- **Tests (Vitest)**: authStore unit tests (login flow, refresh cycle, logout, idle timeout), layout rendering tests

## Capabilities

### New Capabilities
- `dashboard-auth-ui`: Login page, authStore with JWT lifecycle (login, proactive refresh, logout, idle timeout), protected route guard, fetchAPI with 401 interceptor
- `dashboard-layout`: Main layout shell with collapsible sidebar, navbar, breadcrumbs, responsive behavior, and page routing via React Router v7
- `dashboard-i18n`: i18next configuration for Dashboard with es/en locales, ~700 base translation keys, and t() usage convention

### Modified Capabilities
- `frontend-foundation`: Adding babel-plugin-react-compiler, eslint-plugin-react-hooks 7.x, path aliases, and React Router v7 to the Dashboard project scaffolded in C-01

## Impact

- **Dashboard files created**:
  - `src/stores/authStore.ts` — auth state, login/logout/refresh actions, selectors
  - `src/services/api.ts` — fetchAPI with auth interceptor and silent refresh
  - `src/hooks/useIdleTimeout.ts` — inactivity detection with warning + forced logout
  - `src/components/layout/MainLayout.tsx` — sidebar + navbar + breadcrumbs shell
  - `src/components/layout/Sidebar.tsx` — collapsible navigation sidebar
  - `src/components/layout/Navbar.tsx` — top bar with user info
  - `src/components/layout/Breadcrumbs.tsx` — route-derived breadcrumbs
  - `src/components/auth/ProtectedRoute.tsx` — route guard checking authStore
  - `src/pages/LoginPage.tsx` — login form with optional TOTP
  - `src/pages/HomePage.tsx` — empty dashboard placeholder
  - `src/pages/NotFoundPage.tsx` — 404 page
  - `src/i18n/` — i18next config + es.json + en.json (~700 keys each)
  - `src/router.tsx` — React Router v7 route definitions
  - `src/config/env.ts` — typed environment variable access (VITE_API_URL, VITE_WS_URL)
- **Dashboard files modified**:
  - `package.json` — new dependencies (react-router, i18next, react-i18next, i18next-browser-languagedetector)
  - `vite.config.ts` — path aliases, react-compiler plugin
  - `src/App.tsx` — replaced with RouterProvider
  - `src/index.css` — verify Tailwind 4.1 theme with orange primary
  - `.eslintrc` / `eslint.config.js` — eslint-plugin-react-hooks 7.x
- **Dependencies on backend**: Consumes `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/auth/me` from C-03
- **No backend changes**: This is a pure frontend change
- **Downstream**: C-15 (dashboard-menu) and C-16 (dashboard-operations) build directly on top of this shell
