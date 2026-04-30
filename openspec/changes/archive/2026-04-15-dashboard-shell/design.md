## Context

The Dashboard project was scaffolded in C-01 as a minimal Vite + React 19 + TypeScript app with Zustand and Tailwind 4.1. It currently renders a placeholder `App.tsx` with no routing, no auth, and no layout. The backend auth system (C-03) is fully implemented: JWT login, refresh with rotation, logout with blacklist, 2FA, RBAC via PermissionContext, rate limiting, and security middleware.

This change transforms the Dashboard from a placeholder into a functional admin shell that can authenticate against the C-03 backend, manage token lifecycle, and provide the layout and routing foundation for all subsequent CRUD pages (C-15, C-16).

Constraints:
- All Zustand stores MUST use selectors (never destructure). `EMPTY_ARRAY` for stable fallbacks. `useShallow` for computed arrays.
- IDs are `string` in frontend, `number` in backend — convert at the API boundary.
- `babel-plugin-react-compiler` handles memoization — no manual `useMemo`/`useCallback` unless the compiler can't infer.
- `eslint-plugin-react-hooks` 7.x enforces stricter hook rules — hooks must be called unconditionally.
- Logger via `utils/logger.ts` — never `console.*` directly.
- UI language is Spanish, code language is English.

## Goals / Non-Goals

**Goals:**
- Implement authStore with full JWT lifecycle: login (with optional TOTP), proactive refresh, logout with infinite-loop prevention
- Build a fetchAPI client that auto-attaches auth headers and silently retries on 401
- Create the main layout shell: collapsible sidebar, navbar with user info, breadcrumbs
- Set up React Router v7 with protected routes and lazy-loaded pages
- Configure i18next for Dashboard with es/en (~700 base keys)
- Implement useIdleTimeout hook (25 min warning, 30 min forced logout)
- Establish Zustand conventions (selectors, EMPTY_ARRAY, useShallow) as the pattern for all future stores
- Achieve test coverage for authStore (login, refresh, logout flows)

**Non-Goals:**
- CRUD pages or data stores — deferred to C-15 (menu) and C-16 (operations)
- WebSocket integration — deferred to C-15/C-16
- Dark mode toggle — theme CSS variables exist from C-01, but the toggle UI is deferred
- Password reset / forgot password — not in backend scope
- Multi-tab session synchronization via BroadcastChannel — deferred to a future change
- Offline support / service worker — Dashboard is not a PWA
- Role-based sidebar filtering (showing/hiding menu items by role) — deferred to C-15/C-16 when actual pages exist

## Decisions

### D-01: React Router v7 with createBrowserRouter (data router)

**Decision**: Use React Router v7's `createBrowserRouter` with `<RouterProvider>` instead of `<BrowserRouter>` with `<Routes>`.

**Alternatives considered**:
- `<BrowserRouter>` + `<Routes>` (classic): Simpler but lacks loader/action support, which C-15/C-16 will need for data fetching before render.
- TanStack Router: More type-safe, but adds a new dependency when React Router v7 is the ecosystem standard and the team is familiar with it.

**Rationale**: Data router unlocks loaders and actions for future changes without a migration. The initial setup cost is minimal (define routes as objects instead of JSX). Lazy-loading via `React.lazy` + dynamic imports keeps the bundle small.

### D-02: Proactive token refresh via setInterval (14-minute cycle)

**Decision**: After login, start a `setInterval` that calls `POST /api/auth/refresh` every 14 minutes. The access token expires at 15 minutes, so refreshing at 14 gives a 1-minute safety margin.

**Alternatives considered**:
- Reactive refresh (on 401): Simpler but causes a visible delay on the first expired-token request. Multiple concurrent requests can race to refresh.
- Axios interceptor queue: Adds Axios as a dependency. Solves the concurrency problem but introduces a library we don't need otherwise.
- Proactive + reactive (belt and suspenders): Proactive handles the happy path; the fetchAPI 401 interceptor handles edge cases (e.g., tab was suspended and interval didn't fire).

**Rationale**: Proactive refresh is the standard approach for admin dashboards where session continuity matters. Combined with a single-retry 401 interceptor in fetchAPI, it covers both the happy path and edge cases. The interval is cleared on logout and page unload.

### D-03: fetchAPI as a thin wrapper around native fetch (no Axios)

**Decision**: Build `api.ts` with a `fetchAPI` function wrapping the native `fetch` API.

**Alternatives considered**:
- Axios: Mature, interceptors built-in. But it's 13KB+ and the only feature we need (interceptors) can be implemented in ~50 lines with native fetch.
- ky: Smaller than Axios, better API. Still an unnecessary dependency for our needs.

**Rationale**: Native fetch is standard, tree-shakeable (it's a browser API), and sufficient. Our interceptor logic is simple: attach Bearer token, retry once on 401 after silent refresh. No need for request/response transforms or complex retry logic.

### D-04: i18next with JSON namespace files (es/en only for Dashboard)

**Decision**: Use `react-i18next` with `i18next-browser-languagedetector`. Two locale files: `es.json` (default) and `en.json`. Flat JSON structure with dot-separated keys organized by feature area (e.g., `auth.login.title`, `layout.sidebar.home`, `common.save`).

**Alternatives considered**:
- No i18n (hardcoded Spanish): Simpler but inconsistent with pwaMenu (which has full i18n). Adding it later requires touching every component.
- Namespace-per-page: More modular loading. Overkill when the Dashboard has ~700 keys total and lazy loading is handled at the route level.

**Rationale**: Setting up i18n from the start means every new page in C-15/C-16 uses `t()` from day one. The cost is minimal (one setup file + two JSON files). Spanish is the default with English as fallback — the reverse of pwaMenu's chain.

### D-05: Collapsible sidebar with localStorage persistence

**Decision**: Sidebar collapses to icon-only mode. Collapse state persists in `localStorage`. On screens < 768px, sidebar is hidden by default and toggled via hamburger menu.

**Alternatives considered**:
- Always-visible sidebar: Wastes space on small screens. Dashboard will have 10+ menu items eventually.
- Zustand for sidebar state: Overkill for a single boolean. localStorage is simpler and survives page reload without hydration.

**Rationale**: Icon-only collapsed mode is the standard admin pattern (think AWS Console, Vercel Dashboard). localStorage persistence is trivial and avoids the sidebar "jumping" on page load.

### D-06: useIdleTimeout with activity listeners on document

**Decision**: Custom hook that listens for `mousemove`, `keydown`, `touchstart`, and `click` on `document`. Debounced to avoid performance impact. Uses `setTimeout` chains, not `setInterval`, to avoid drift.

**Alternatives considered**:
- `idle-timer` npm package: Well-tested but adds a dependency for ~30 lines of code.
- Web Locks API / requestIdleCallback: Not designed for user activity detection.

**Rationale**: The implementation is trivial: reset a timer on activity, show warning modal at 25 min, force logout at 30 min. No need for a dependency. The warning modal gives the user 5 minutes to move the mouse and stay logged in.

### D-07: Infinite-loop prevention in authStore logout

**Decision**: The `logout` action in authStore sets an `isLoggingOut` flag before making the API call. The refresh interval and 401 interceptor both check this flag and skip their logic if true. The flag is cleared after logout completes or on the next login.

**Alternatives considered**:
- AbortController on refresh requests: Cancels in-flight refreshes but doesn't prevent the 401 interceptor from re-triggering.
- Separate `authState` enum (AUTHENTICATED, REFRESHING, LOGGING_OUT): More explicit but overengineered for a boolean check.

**Rationale**: The infinite loop scenario: logout triggers 401 on the logout request itself (expired token) → interceptor tries to refresh → refresh fails → interceptor retries → loop. A simple `isLoggingOut` guard breaks the cycle at the cheapest cost.

## Risks / Trade-offs

- **[Risk] Proactive refresh fires while tab is backgrounded** — Browsers throttle timers in background tabs. The 14-minute interval may not fire on time. Mitigation: The 401 interceptor in fetchAPI acts as a safety net. When the user returns to the tab and makes a request, the interceptor will refresh the token.

- **[Risk] i18n key count bloat** — Starting with ~700 keys (navigation, common, auth, errors, CRUD verbs) may feel over-engineered for 3 pages. Mitigation: These keys will be consumed immediately by C-15 (6+ CRUD pages with 50+ keys each). Front-loading the common keys avoids duplication later.

- **[Trade-off] No role-based sidebar filtering** — All sidebar items are visible to all roles. KITCHEN and WAITER users will see menu items they can't access. Mitigation: Deferred to C-15/C-16 when pages exist. Protected routes still block unauthorized access at the route level.

- **[Trade-off] No dark mode toggle in this change** — CSS variables for dark mode exist from C-01 but the toggle is not implemented. Mitigation: Adding a toggle later is a small UI task (localStorage boolean + `data-theme` attribute).

- **[Trade-off] No multi-tab logout sync** — Logging out in one tab doesn't propagate to others. Mitigation: The 15-minute token expiry naturally logs out stale tabs. BroadcastChannel can be added in a future change without architectural changes.

## File Structure

```
Dashboard/
  src/
    config/
      env.ts                 -- typed VITE_API_URL, VITE_WS_URL access
    i18n/
      index.ts               -- i18next init config (es default, en fallback)
      locales/
        es.json              -- Spanish translations (~700 keys)
        en.json              -- English translations (~700 keys)
    services/
      api.ts                 -- fetchAPI: auth header, 401 interceptor, silent refresh
    stores/
      authStore.ts           -- login, logout, refresh, user state, selectors
      authStore.test.ts      -- Vitest: login, refresh cycle, logout, idle
    hooks/
      useIdleTimeout.ts      -- 25min warning, 30min logout
    components/
      layout/
        MainLayout.tsx       -- sidebar + navbar + outlet
        Sidebar.tsx          -- collapsible nav, localStorage persistence
        Navbar.tsx            -- user info, logout button, language toggle
        Breadcrumbs.tsx      -- route-derived breadcrumb trail
      auth/
        ProtectedRoute.tsx   -- redirects to /login if not authenticated
        LoginForm.tsx        -- email + password + optional TOTP
    pages/
      LoginPage.tsx          -- full-page login
      HomePage.tsx           -- empty dashboard placeholder
      NotFoundPage.tsx       -- 404
    router.tsx               -- createBrowserRouter route definitions
    App.tsx                  -- RouterProvider wrapper
    types/
      auth.ts                -- User, LoginRequest, LoginResponse interfaces
  package.json               -- new deps: react-router, i18next, react-i18next,
                                i18next-browser-languagedetector
  vite.config.ts             -- path aliases (@/ → src/), react-compiler plugin
  eslint.config.js           -- eslint-plugin-react-hooks 7.x
```

## Open Questions

_(none — all decisions are clear from the proposal and project conventions)_
