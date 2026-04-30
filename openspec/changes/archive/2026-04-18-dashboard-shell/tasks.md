# dashboard-shell Tasks

> Implementation checklist for **C-14 dashboard-shell**.
> Reference: `proposal.md` (scope), `design.md` (how), `specs/*/spec.md` (what).
> Governance BAJO — autonomía completa si tests y linter pasan al final.

**Pre-implementation (mandatory)**: leé `.agents/SKILLS.md`, identificá TODAS las skills aplicables según estos tasks, y cargá cada `.agents/skills/<skill>/SKILL.md` antes de tocar código. Aplicá los patterns durante toda la implementación.

## 1. Dependencias, build y tooling

- [x] 1.1 Actualizar `Dashboard/package.json` con dependencias runtime: `react@19.2`, `react-dom@19.2`, `react-router@7`, `zustand@5`, `i18next`, `react-i18next`, `i18next-browser-languagedetector`, `i18next-http-backend`
- [x] 1.2 Agregar dev dependencies: `vite@7.2`, `@vitejs/plugin-react`, `babel-plugin-react-compiler`, `typescript@5.9`, `tailwindcss@4.1`, `@tailwindcss/vite`, `vitest@4`, `@vitest/ui`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`, `eslint@9`, `eslint-plugin-react-hooks@7`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`
- [x] 1.3 Configurar `Dashboard/vite.config.ts`: plugin `@vitejs/plugin-react` con `babel-plugin-react-compiler`, plugin `@tailwindcss/vite`, alias `@` → `src/`, `server.port = 5177`
- [x] 1.4 Configurar `Dashboard/tsconfig.json` estricto: `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`, paths `@/*` → `src/*`
- [x] 1.5 Configurar `Dashboard/eslint.config.js` con `eslint-plugin-react-hooks` 7.x y regla `no-restricted-syntax` que bloquea destructuring de `use*Store()`
- [x] 1.6 Crear `Dashboard/.env.development` y `.env.production.example` con `VITE_API_URL`, `VITE_WS_URL`; crear `Dashboard/src/config/env.ts` con acceso tipado a las variables

## 2. Utils base y Tailwind

- [x] 2.1 Crear `Dashboard/src/utils/constants.ts` con `EMPTY_ARRAY`, `EMPTY_OBJECT`, `EMPTY_STRING` (inmutables, `as const` + `Object.freeze`) y constantes de storage keys (`SIDEBAR_COLLAPSED_KEY`, `LANG_KEY`)
- [x] 2.2 Crear `Dashboard/src/utils/logger.ts` con niveles `debug/info/warn/error`, gated por `import.meta.env.DEV`, con prefijo `[Dashboard]`
- [x] 2.3 Crear `Dashboard/src/index.css` con `@import "tailwindcss"` y bloque `@theme` definiendo la paleta `primary` (oklch ≈ #f97316) y soporte `[data-theme="dark"]`
- [x] 2.4 Escribir test `constants.test.ts` verificando que `EMPTY_ARRAY` y `EMPTY_OBJECT` son congelados y que la misma referencia se devuelve siempre

## 3. services/api.ts con fetchAPI e interceptor 401

- [x] 3.1 Implementar `Dashboard/src/services/api.ts` con `fetchAPI(path, init?)`: auto-inyecta `Authorization: Bearer` desde token en memoria, serializa body JSON, parsea respuesta, hace throw con `response.detail` en errores no-401
- [x] 3.2 Agregar mutex `refreshPromise: Promise<string> | null` para compartir un único refresh entre requests concurrentes; implementar `ensureFreshToken()` que de-duplica
- [x] 3.3 Implementar flujo 401: si `isLoggingOut === false`, llamar mutex → setear nuevo access → reintentar request una vez; si el retry también devuelve 401, disparar `authStore.logout()`
- [x] 3.4 Exponer setter `setAccessToken(token | null)` y getter para el authStore; `accessToken` vive en el closure del módulo (nunca localStorage)
- [x] 3.5 Tests Vitest para `api.test.ts`: (a) request autenticado incluye header Bearer; (b) 401 dispara refresh único + retry; (c) concurrent 401s comparten un solo refresh; (d) segundo 401 dispara logout y no hace tercer retry; (e) `isLoggingOut=true` hace skip del interceptor

## 4. authStore con Zustand 5

- [x] 4.1 Implementar `Dashboard/src/stores/authStore.ts` con estado `{ isAuthenticated, user, requires2fa, isLoading, error, isLoggingOut }` y selectores nombrados exportados (`selectUser`, `selectIsAuthenticated`, `selectIsLoading`, `selectError`, `selectRequires2fa`)
- [x] 4.2 Implementar acción `login(email, password, totpCode?)`: POST `/api/auth/login`, manejo de `requires_2fa`, conversión `number→string` de IDs en boundary, `setAccessToken`, arrancar `startRefreshInterval()`
- [x] 4.3 Implementar acción `logout()`: setear `isLoggingOut=true`, POST `/api/auth/logout` (tolerar errores), `setAccessToken(null)`, `clearInterval`, reset completo del estado, redirect a `/login` (usar navegador o callback inyectado)
- [x] 4.4 Implementar `refresh()` y `startRefreshInterval()`: intervalo 840_000 ms + jitter ±120_000 ms, callback chequea `isLoggingOut` antes de ejecutar; en fallo llama `logout()`
- [x] 4.5 Tests `authStore.test.ts`: (a) estado inicial; (b) login feliz sin 2FA; (c) login con `requires_2fa`; (d) login con totp_code; (e) login con 401 setea error; (f) login con 429 setea mensaje de rate limit; (g) refresh exitoso reemplaza token; (h) refresh 401 dispara logout; (i) logout limpia interval y estado; (j) logout con `isLoggingOut` no dispara refresh

## 5. i18n — config + locales es/en con ~700 keys

- [x] 5.1 Crear `Dashboard/src/i18n/index.ts` inicializando `i18next` + `react-i18next` + `i18next-browser-languagedetector` + `i18next-http-backend`; fallback `en→es`, default `es`, persistir en localStorage key `LANG_KEY`
- [x] 5.2 Crear `Dashboard/public/locales/es.json` con ≥350 keys organizadas bajo `common`, `auth`, `layout.sidebar`, `layout.navbar`, `layout.breadcrumb`, `errors`, `crud`, `validation`, `idleTimeout`
- [x] 5.3 Crear `Dashboard/public/locales/en.json` espejo de `es.json` con las mismas keys traducidas
- [x] 5.4 Verificar con un script de test (`i18n.test.ts`) que toda key presente en `es.json` existe también en `en.json` y viceversa (sin huérfanas)

## 6. Componentes de layout: MainLayout, Sidebar, Navbar, Breadcrumbs

- [x] 6.1 Crear `Dashboard/src/components/layout/Sidebar.tsx` con estado colapsado persistido en localStorage, items de navegación con `t()` + iconos, responsive <768px como overlay con backdrop
- [x] 6.2 Crear `Dashboard/src/components/layout/Navbar.tsx` con user info desde `selectUser`, toggle de idioma (`es⇄en`) con persistencia, botón logout (llama `authStore.logout()`), botón hamburger en mobile
- [x] 6.3 Crear `Dashboard/src/components/layout/Breadcrumbs.tsx` usando `useMatches()` + `route.handle.breadcrumb` + `t()`; links clickeables para niveles intermedios
- [x] 6.4 Crear `Dashboard/src/components/layout/MainLayout.tsx` componiendo Sidebar + Navbar + Breadcrumbs + `<Outlet />`; montar `useIdleTimeout()` acá
- [x] 6.5 Tests `MainLayout.test.tsx`: render completo con user autenticado, sidebar se colapsa al clic y persiste, toggle de idioma cambia textos

## 7. useIdleTimeout hook

- [x] 7.1 Crear `Dashboard/src/hooks/useIdleTimeout.ts` con dos timers (`warnTimer` 25 min, `logoutTimer` 30 min), listeners throttleados a 1s sobre `mousemove`, `keydown`, `touchstart`, `click`
- [x] 7.2 Integrar modal de warning (componente simple inline con `t('idleTimeout.warning')`) y acción "seguir activo" que resetea timers
- [x] 7.3 Cleanup completo en `useEffect` (remove listeners, clear timers); hook no se suscribe a eventos si `isAuthenticated === false`
- [x] 7.4 Tests `useIdleTimeout.test.tsx` con `vi.useFakeTimers()`: warning a los 25 min, logout a los 30 min, actividad resetea, hook inactivo cuando `isAuthenticated=false`

## 8. ProtectedRoute y páginas base

- [x] 8.1 Crear `Dashboard/src/components/auth/ProtectedRoute.tsx` que lee `selectIsAuthenticated` y redirige a `/login` preservando `location.pathname` en state; si está autenticado renderiza `<Outlet />`
- [x] 8.2 Crear `Dashboard/src/pages/LoginPage.tsx` con form email+password, campo TOTP condicional (gated por `selectRequires2fa`), render de `error` desde authStore, redirect a `/` en éxito; todas las labels vía `t()`
- [x] 8.3 Crear `Dashboard/src/pages/HomePage.tsx` con welcome `t('layout.home.welcome', { name: user.fullName })` y placeholder de contenido futuro
- [x] 8.4 Crear `Dashboard/src/pages/NotFoundPage.tsx` con mensaje `t('errors.notFound')` y link a `/`
- [x] 8.5 Tests `LoginPage.test.tsx`: renderiza inputs, muestra TOTP cuando `requires2fa=true`, muestra error, navega a `/` tras login exitoso

## 9. Router, App y bootstrap

- [x] 9.1 Crear `Dashboard/src/router.tsx` con `createBrowserRouter`: ruta `/` protegida con `MainLayout` (index → `HomePage`, catch-all → `NotFoundPage`), ruta `/login` sin protección (con redirect a `/` si ya autenticado), ruta `*` top-level a `NotFoundPage`; todas las páginas con `React.lazy`
- [x] 9.2 Reemplazar `Dashboard/src/App.tsx` por `<RouterProvider router={router} />` envuelto en `<Suspense>` con fallback de loading
- [x] 9.3 Actualizar `Dashboard/src/main.tsx`: inicializar i18n, correr silent probe de auth (`/api/auth/refresh` → `/api/auth/me`) antes del primer render, luego hidratar authStore y montar `<App />`
- [x] 9.4 Verificar que `Dashboard/index.html` carga la fuente y tiene `<html lang="es" data-theme="light">`; script root en `src/main.tsx`

## 10. Cierre: lint, typecheck y suite de tests

- [x] 10.1 Ejecutar `pnpm --filter dashboard lint` y corregir todo warning/error
- [x] 10.2 Ejecutar `pnpm --filter dashboard typecheck` (tsc --noEmit) y resolver todo error de tipos
- [x] 10.3 Ejecutar `pnpm --filter dashboard test` — todas las suites Vitest deben pasar (authStore, api, useIdleTimeout, MainLayout, LoginPage, i18n parity, constants)
- [x] 10.4 Smoke test manual: `pnpm --filter dashboard dev`, abrir `http://localhost:5177`, verificar redirect a `/login`, login contra backend (o mock MSW), landing en `/`, toggle de idioma, logout
