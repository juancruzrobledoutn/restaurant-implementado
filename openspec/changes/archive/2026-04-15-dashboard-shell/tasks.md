## 1. Project Configuration and Dependencies

- [x] 1.1 Install new dependencies: `react-router` (v7), `react-i18next`, `i18next`, `i18next-browser-languagedetector`, `babel-plugin-react-compiler`, `eslint-plugin-react-hooks` (7.x), `lucide-react` (icons)
- [x] 1.2 Update `vite.config.ts`: add path alias `@/` → `src/`, configure `babel-plugin-react-compiler` in the React plugin options
- [x] 1.3 Update `tsconfig.json`: add path alias `@/*` → `src/*` to match Vite config
- [x] 1.4 Update ESLint config: add `eslint-plugin-react-hooks` 7.x with recommended rules
- [x] 1.5 Create `src/config/env.ts`: typed access to `VITE_API_URL` and `VITE_WS_URL` environment variables

## 2. i18n Setup

- [x] 2.1 Create `src/i18n/index.ts`: configure i18next with `i18next-browser-languagedetector`, Spanish default, English fallback, localStorage persistence
- [x] 2.2 Create `src/i18n/locales/es.json`: Spanish translations (~700 keys) organized by feature area (`common`, `auth`, `layout`, `errors`, `crud`, `validation`)
- [x] 2.3 Create `src/i18n/locales/en.json`: English translations matching all keys from `es.json`
- [x] 2.4 Import i18n initialization in `src/main.tsx` before app render

## 3. Types and Constants

- [x] 3.1 Create `src/types/auth.ts`: `User` interface (id: string, email: string, fullName: string, tenantId: string, branchIds: string[], roles: string[]), `LoginRequest`, `LoginResponse` interfaces
- [x] 3.2 Create `src/utils/constants.ts`: `EMPTY_ARRAY` stable fallback, `REFRESH_INTERVAL_MS` (840000), `IDLE_WARNING_MS` (1500000), `IDLE_LOGOUT_MS` (1800000)

## 4. API Client

- [x] 4.1 Create `src/services/api.ts`: `fetchAPI` function wrapping native `fetch` — auto-attaches `Authorization: Bearer` header, JSON content-type, base URL from `env.ts`
- [x] 4.2 Implement 401 interceptor in `fetchAPI`: on 401 response, attempt single silent refresh via `POST /api/auth/refresh`, retry original request; on second 401, trigger logout
- [x] 4.3 Implement `isLoggingOut` check in interceptor: skip refresh if authStore `isLoggingOut` is true

## 5. Auth Store

- [x] 5.1 Create `src/stores/authStore.ts`: Zustand store with state (`isAuthenticated`, `user`, `isLoading`, `error`, `requires2fa`, `isLoggingOut`), named selectors for each property
- [x] 5.2 Implement `login(email, password, totpCode?)` action: POST to `/api/auth/login`, handle success (set user, start refresh interval), handle `requires_2fa` response, handle errors (401, 429)
- [x] 5.3 Implement proactive refresh: `setInterval` every 14 minutes calling `POST /api/auth/refresh`, update in-memory access token on success, trigger logout on failure
- [x] 5.4 Implement `logout()` action: set `isLoggingOut` flag, POST to `/api/auth/logout`, clear all auth state, clear refresh interval, clear `isLoggingOut`
- [x] 5.5 Implement `getAccessToken()` getter for use by `fetchAPI` (in-memory token, not in state to avoid re-renders)

## 6. Routing

- [x] 6.1 Create `src/router.tsx`: define routes with `createBrowserRouter` — `/login` (public), `/` with MainLayout (protected, children: HomePage, catch-all 404)
- [x] 6.2 Create `src/components/auth/ProtectedRoute.tsx`: check `isAuthenticated` from authStore, redirect to `/login` if false, redirect authenticated users away from `/login`
- [x] 6.3 Update `src/App.tsx`: replace placeholder with `<RouterProvider router={router} />`
- [x] 6.4 Add `React.lazy()` dynamic imports for all page components with `<Suspense>` loading fallback

## 7. Layout Components

- [x] 7.1 Create `src/components/layout/Sidebar.tsx`: navigation items with icons (lucide-react), collapsible to icon-only mode, localStorage persistence of collapse state, responsive (hidden on mobile < 768px)
- [x] 7.2 Create `src/components/layout/Navbar.tsx`: user fullName and role display, language toggle (es/en), logout button, hamburger menu button for mobile sidebar
- [x] 7.3 Create `src/components/layout/Breadcrumbs.tsx`: derive breadcrumb trail from React Router `useMatches()` + route `handle` metadata, translate labels via `t()`
- [x] 7.4 Create `src/components/layout/MainLayout.tsx`: compose Sidebar + Navbar + Breadcrumbs + `<Outlet>`, handle sidebar collapse state and mobile overlay

## 8. Pages

- [x] 8.1 Create `src/pages/LoginPage.tsx`: email + password form, optional TOTP field (shown when `requires2fa` is true), error display, redirect to `/` on success, all text via `t()`
- [x] 8.2 Create `src/pages/HomePage.tsx`: welcome message with user name, placeholder content for future dashboard widgets
- [x] 8.3 Create `src/pages/NotFoundPage.tsx`: 404 message with link back to `/`

## 9. Idle Timeout Hook

- [x] 9.1 Create `src/hooks/useIdleTimeout.ts`: listen to `mousemove`, `keydown`, `touchstart`, `click` on document (debounced), `setTimeout` chain for warning at 25 min and logout at 30 min
- [x] 9.2 Implement warning modal component: display countdown, dismiss on activity
- [x] 9.3 Integrate `useIdleTimeout` into `MainLayout` (only active when authenticated)

## 10. Tests

- [x] 10.1 Create `src/stores/authStore.test.ts`: test login success, login with 2FA, login failure, refresh cycle, logout clears state, `isLoggingOut` prevents refresh
- [x] 10.2 Create `src/services/api.test.ts`: test Bearer header attachment, 401 interceptor with retry, second 401 triggers logout, non-401 errors thrown
- [x] 10.3 Create `src/components/layout/MainLayout.test.tsx`: test layout renders sidebar + navbar + outlet, sidebar collapse toggle, breadcrumb rendering
- [x] 10.4 Create `src/hooks/useIdleTimeout.test.ts`: test warning fires after timeout, activity resets timer, logout fires after extended inactivity
