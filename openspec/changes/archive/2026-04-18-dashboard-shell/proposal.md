# dashboard-shell Proposal

> Change ID: **C-14** | Fase: **1D — Frontends** | Governance: **BAJO**
> Dependencias archivadas requeridas: **C-03 (auth backend)**

## Why

El Dashboard es el panel de administración donde ADMIN y MANAGER operan el negocio (menú, alérgenos, mesas, personal, ventas). Antes de poder construir ninguna página funcional necesitamos el **scaffold**: el proyecto Vite configurado, el sistema de autenticación conectado al backend de C-03, el layout navegable, el routing con páginas placeholder, i18n listo para recibir keys por feature, y las convenciones Zustand enforced desde el día uno.

Este change no entrega funcionalidad de negocio — entrega la **base técnica no-negociable** sobre la que se apoyan todos los changes siguientes del Dashboard (C-15 dashboard-menu, C-16 dashboard-operations, etc.). Hacerlo bien acá significa que cada página nueva es "agregar una ruta + un store + una page" sin reinventar auth, refresh, idle timeout, o layout. Hacerlo mal significa repetir errores en cada feature.

## What Changes

- **Scaffold del proyecto Dashboard** en `Dashboard/` con Vite 7.2, TypeScript 5.9, React 19.2, Tailwind 4.1 y dependencias congeladas (`react-router@7`, `zustand@5`, `i18next`, `react-i18next`, `i18next-browser-languagedetector`).
- **Configuración de build y tooling**:
  - `vite.config.ts` con `babel-plugin-react-compiler` y alias `@` → `src/`
  - `eslint.config.js` con `eslint-plugin-react-hooks` 7.x reglas estrictas
  - `tsconfig.json` estricto (`strict`, `noUncheckedIndexedAccess`)
  - `tailwind.config.ts` con tema `orange-500` (#f97316) y modo oscuro via `data-theme`
- **`authStore` (Zustand) completo**: `login(email, password, totpCode?)`, `logout()`, `refresh()`, flag `isLoggingOut` para prevenir loops, `setInterval` proactivo cada 14 minutos, access token solo en memoria (nunca localStorage), conversión de IDs `number → string` en el boundary.
- **`services/api.ts`**: `fetchAPI` wrapper que auto-inyecta `Authorization: Bearer`, intercepta 401 con mutex para un único refresh silencioso, retry exactamente una vez, dispara logout si el retry también falla.
- **Layout principal** (`MainLayout`): sidebar colapsable con persistencia en localStorage (`sidebar-collapsed`), navbar con usuario/rol/logout/toggle de idioma, breadcrumbs derivados de `route.handle`, responsive (hamburguesa <768px).
- **Páginas base**: `LoginPage` (email + password + TOTP condicional), `HomePage` (welcome + placeholder), `NotFoundPage` (404 con link a `/`).
- **Routing con React Router v7** (`createBrowserRouter`) y `React.lazy()` para todas las páginas. `ProtectedRoute` redirige a `/login`; `/login` redirige a `/` si ya autenticado.
- **i18n con ~700 keys base** en `public/locales/es.json` y `public/locales/en.json` organizadas por feature (`common.*`, `auth.*`, `layout.*`, `errors.*`, `crud.*`, `validation.*`). Default `es`, fallback `en → es`, persistencia en localStorage.
- **`useIdleTimeout` hook**: warning modal a los 25 min de inactividad, logout automático a los 30 min; sólo activo cuando `isAuthenticated === true`.
- **Convenciones Zustand enforced**: selectores nombrados exportados, `EMPTY_ARRAY` estable como fallback, `useShallow` para objetos/arrays computados, nunca destructuring del store.
- **Tests Vitest**: `authStore` (login feliz/fallido, 2FA, refresh proactivo, logout sin loop), `fetchAPI` (interceptor 401 con retry y logout), renderizado de `MainLayout` y `LoginPage`.

**No-goals (fuera de scope)**:
- Cualquier página CRUD de dominio (categorías, productos, mesas, staff) — eso es C-15/C-16.
- Suscripción a WebSocket — llega en C-15.
- Portugués (`pt`) — sólo existe en pwaMenu.
- Sistema de design system completo de componentes UI reutilizables — sólo lo mínimo para login y layout.
- Soporte 2FA de extremo a extremo (el backend ya lo provee en C-03; acá sólo exponemos el campo TOTP condicional).

## Capabilities

### New Capabilities

Este change introduce tres capabilities frontend nuevas. Observación importante: `openspec/specs/dashboard-auth-ui/`, `dashboard-layout/` y `dashboard-i18n/` **ya existen como stubs** en el repo (creados previamente por un archive). Acá **los llenamos** con las requirements reales y dejamos el Purpose apropiado. Los trato como "new" porque la proposal es la que materializa su contenido funcional.

- `dashboard-auth-ui`: Flujo completo de autenticación del Dashboard (authStore, login page, fetchAPI con refresh silencioso, protección de rutas, idle timeout de 25/30 min).
- `dashboard-layout`: Shell navegable del Dashboard (MainLayout con sidebar colapsable, navbar con user/logout/i18n toggle, breadcrumbs desde route metadata, router v7 lazy, home y 404).
- `dashboard-i18n`: Infraestructura de internacionalización del Dashboard (i18next configurado es/en con fallback y persistencia, ~700 keys base organizadas por feature, regla "todo texto visible usa `t()`").

### Modified Capabilities

Ninguna. Este change no toca requirements existentes — construye capabilities nuevas sobre el scaffold vacío.

## Impact

**Código afectado (todo nuevo)**:
- `Dashboard/` — directorio completo:
  - `package.json`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.ts`, `eslint.config.js`, `index.html`
  - `src/main.tsx`, `src/App.tsx`, `src/index.css`
  - `src/stores/authStore.ts` (+ tests)
  - `src/services/api.ts` (+ tests)
  - `src/components/layout/MainLayout.tsx`, `Sidebar.tsx`, `Navbar.tsx`, `Breadcrumbs.tsx`
  - `src/components/auth/ProtectedRoute.tsx`
  - `src/pages/LoginPage.tsx`, `HomePage.tsx`, `NotFoundPage.tsx`
  - `src/hooks/useIdleTimeout.ts` (+ tests)
  - `src/i18n/index.ts`, `public/locales/es.json`, `public/locales/en.json`
  - `src/utils/logger.ts`, `src/utils/constants.ts` (EMPTY_ARRAY, etc.)
  - `src/config/env.ts` (lectura tipada de `VITE_API_URL`, `VITE_WS_URL`)

**APIs backend consumidas** (todas de C-03):
- `POST /api/auth/login` — body `{ email, password, totp_code? }` → `{ access_token, user, requires_2fa? }`
- `POST /api/auth/refresh` — usa cookie HttpOnly → `{ access_token }`
- `POST /api/auth/logout` — invalida tokens

**Variables de entorno nuevas** (`.env.development`, `.env.production`):
- `VITE_API_URL=http://localhost:8000` (sin `/api` — fetchAPI lo agrega)
- `VITE_WS_URL=ws://localhost:8001` (declarado pero no usado todavía)

**Dependencias npm nuevas**:
- Runtime: `react@19.2`, `react-dom@19.2`, `react-router@7`, `zustand@5`, `i18next`, `react-i18next`, `i18next-browser-languagedetector`
- Dev: `vite@7.2`, `@vitejs/plugin-react`, `babel-plugin-react-compiler`, `typescript@5.9`, `tailwindcss@4.1`, `@tailwindcss/vite`, `vitest@4`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `eslint`, `eslint-plugin-react-hooks@7`, `@typescript-eslint/*`

**Impacto en otros changes**:
- **Desbloquea**: C-15 (dashboard-menu), C-16 (dashboard-operations), C-17 (pwaMenu) en lo que refiere a convenciones compartidas de autenticación y Zustand.
- **No afecta**: backend, ws_gateway, pwaMenu, pwaWaiter.

**Gobernanza BAJO**: autonomía total si los tests pasan y el linter no reporta errores. Checkpoint sólo si se detecta desviación respecto del scope declarado en CHANGES.md.
