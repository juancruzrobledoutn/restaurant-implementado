# dashboard-shell Design

> Technical design document for **C-14 dashboard-shell**.
> See `proposal.md` for motivation and scope, and `specs/*/spec.md` for the normative requirements.

## Context

El proyecto arranca desde cero. En **C-01 monorepo-scaffold** se creó una carpeta `Dashboard/` con un scaffold mínimo de Vite + React 19. No hay auth, no hay routing, no hay layout, no hay i18n. El backend **C-03 auth** ya está archivado y expone:

- `POST /api/auth/login` (body `{ email, password, totp_code? }`, rate limit 5/min por IP y por email)
- `POST /api/auth/refresh` (lee HttpOnly cookie `refresh_token`, emite nuevo access + nueva cookie — rotation + blacklist del refresh anterior, nuclear revoke si detecta reuso)
- `POST /api/auth/logout` (blacklistea el par activo)
- `GET /api/auth/me` (perfil del usuario)
- Access TTL 15 min, refresh TTL 7 días, HttpOnly + `SameSite=lax`, `Secure` en prod

**Constraint clave**: este change es la base técnica para C-15, C-16 y todo el Dashboard. Cualquier desviación de convenciones (destructuring del store, `?? []` inline, `console.*`, hardcoded strings, token en localStorage) se hereda a todas las páginas futuras. No se permite.

**Stakeholders**: ADMIN y MANAGER son los usuarios finales (login staff). Devs de Dashboard son quienes dependen del scaffold.

## Goals / Non-Goals

**Goals**:
- Entregar un Dashboard que un staff puede loguear, navegar entre el Home y una 404, cambiar idioma, y ser forzado a logout por idle timeout.
- Establecer **convenciones enforced por código y linter** (ESLint rules, estructura de carpetas, fetchAPI central) que todo change siguiente va a reutilizar.
- Tests unitarios que cubren los flujos críticos (login, refresh, logout, 401 interceptor) — son la red de seguridad del scaffold.
- Dejar el proyecto listo para que agregar una nueva página sea "crear archivo, agregar lazy route, agregar keys i18n".

**Non-Goals**:
- Ningún CRUD de dominio (productos, mesas, staff, etc.) — eso es C-15/C-16.
- Suscripción WebSocket — se introduce recién en C-15 junto con las primeras mutaciones en tiempo real.
- Feature flags, theming runtime avanzado (light/dark con persistencia compleja), system preference detection — sólo Tailwind `data-theme` listo, sin UI de toggle en esta fase.
- Sistema de componentes UI completo (DataTable, Modal, FormModal) — sólo lo mínimo para Login (Input, Button, Alert) y Layout (Sidebar, Navbar, Breadcrumbs).
- Portugués (`pt`) — exclusivo de pwaMenu.

## Decisions

### D1. Access token en memoria, refresh en HttpOnly cookie

**Decisión**: El access token vive únicamente en el closure del módulo `services/api.ts` (o en el estado del authStore, memoria volátil). El refresh token viaja automáticamente como HttpOnly cookie `SameSite=lax`.

**Alternativas consideradas**:
- *Access en localStorage*: XSS-vulnerable. Cualquier `<script>` inyectado roba la sesión completa. Rechazado.
- *Access en sessionStorage*: aún vulnerable a XSS y se pierde al abrir pestaña nueva, degradando UX. Rechazado.
- *Access en memoria + refresh en HttpOnly cookie* (elegida): XSS no puede leer el access (está en el closure); XSS no puede leer el refresh (HttpOnly). El refresh proactivo cada 14 min re-hidrata el access en memoria sin intervención del usuario.

**Rationale**: es el patrón documentado en `knowledge-base/03-seguridad/01_modelo_de_seguridad.md §1`. Mismo patrón en pwaWaiter. Consistencia.

### D2. Refresh proactivo cada 14 minutos con jitter ±2 min

**Decisión**: `setInterval` programado tras login exitoso con período `840_000 ms + random(-120_000, +120_000)`. El jitter previene thundering herd cuando múltiples pestañas o usuarios sincronizan el refresh.

**Alternativas**:
- *Refresh reactivo (sólo en 401)*: simple pero deja ventanas de falla si el access expira mientras la pestaña está en background o hay requests en paralelo. Rechazado como única estrategia — lo mantenemos como fallback en el 401 interceptor.
- *Refresh por timer + reactivo* (elegida): proactivo cubre el caso normal; el interceptor 401 cubre pestañas en background donde el timer puede haberse pausado.

**Trade-off**: requiere manejo explícito del `clearInterval` en `logout()` y el guard `isLoggingOut` para evitar que un refresh en vuelo choque con el logout. Los tests cubren ambos escenarios.

### D3. Mutex en fetchAPI para el refresh silencioso

**Decisión**: Cuando llegan múltiples 401 simultáneos, un único `Promise<string>` de refresh se ejecuta y todos los requests esperan ese resultado. Implementación: variable módulo `refreshPromise: Promise<string> | null`.

**Alternativas**:
- *Refresh por request*: N requests → N refresh calls → el backend blacklistea el refresh tras el primero → los demás fallan. Observado en sistemas reales, rotura garantizada.
- *Cola de requests pendientes*: equivalente pero más código. Rechazado por simplicidad.

**Implementación**:
```ts
let refreshPromise: Promise<string> | null = null
async function ensureFreshToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => { refreshPromise = null })
  }
  return refreshPromise
}
```

### D4. `isLoggingOut` flag para prevenir el loop infinito

**Decisión**: Antes de llamar `POST /api/auth/logout`, el authStore setea `isLoggingOut = true`. El 401 interceptor consulta este flag: si `true`, NO dispara refresh y NO reintenta. El intervalo del refresh proactivo también consulta el flag antes de ejecutar.

**Rationale**: sin esto, si `/logout` devuelve 401 (token ya blacklisteado), el interceptor intenta refresh, el refresh falla, el authStore intenta logout, que vuelve a devolver 401 — loop. Es el bug clásico documentado en `knowledge-base/05-dx/03_trampas_conocidas.md`.

### D5. React Router v7 con `createBrowserRouter` + lazy routes

**Decisión**: Definir la ruta raíz y todas las páginas con `createBrowserRouter` y `React.lazy(() => import(...))`. Wrappear el tree con `<RouterProvider router={router} />`.

**Alternativas**:
- *Componentes `<Routes>` inline*: sin soporte first-class para `route.handle`, data loaders, y lazy nativo. React Router v7 favorece explícitamente el data router.

**Layout en el árbol de rutas**:
```
/               → MainLayout (ProtectedRoute)
    /           → HomePage
    *           → NotFoundPage (dentro del layout)
/login          → LoginPage (sin layout, sin protection)
*               → NotFoundPage (fuera del layout si logueado sin match)
```

El `handle: { breadcrumb: "layout.sidebar.home" }` viaja en cada route y `Breadcrumbs` lo lee con `useMatches()`.

### D6. Zustand 5 — store sin middleware `persist` para auth

**Decisión**: El authStore NO usa `persist`. El estado `isAuthenticated` se reconstruye al inicio via "silent probe": en `main.tsx` antes del primer render, se intenta un `POST /api/auth/refresh`; si responde 200, se hidrata el usuario con `GET /api/auth/me`; si 401, se deja el store en estado inicial.

**Alternativas**:
- *`persist` con localStorage*: persistiría flags de UI pero también tentaría a persistir el access token → XSS. Evitamos.
- *Probe via `/me` con el access token* (elegida cuando hay): si el access sobrevive (SPA no recargada, fue a background y volvió), saltamos el probe.

**Trade-off**: +1 roundtrip al inicio. Aceptable: el backend responde rápido, el spinner de arranque tapa la latencia.

### D7. Convenciones Zustand enforced por ESLint + lint custom

**Decisión**:
- Regla `no-restricted-syntax` bloquea destructuring en llamadas a `use*Store()` (regex AST).
- `EMPTY_ARRAY` y `EMPTY_OBJECT` exportados desde `src/utils/constants.ts`; código que use `?? []` inline falla code review.
- Todos los selectores se exportan nombrados (`selectUser`, `selectIsAuthenticated`, etc.) desde el archivo del store.

**Rationale**: hacer inevitable lo correcto. En C-15 cuando se agreguen 10 stores más, la disciplina ya está en el linter.

### D8. i18n: `i18next-browser-languagedetector` + lazy backend HTTP

**Decisión**: `i18next-browser-languagedetector` para detectar localStorage → navigator → fallback a `es`. Los archivos `es.json` y `en.json` se cargan desde `public/locales/` vía `i18next-http-backend` para permitir hot-swap sin rebuild.

**Alternativas**:
- *Importar JSONs directos en `i18n/index.ts`*: los incrusta en el bundle JS. Funciona pero infla el bundle cuando crezcan a miles de keys. Rechazado para escalar.
- *HTTP backend* (elegida): los JSON se cargan on demand; el Service Worker eventualmente los puede cachear.

**Estructura de keys** (flat, dot-separated):
```
common.{save,cancel,delete,confirm,loading,error,success,...}
auth.{login.title,login.email,login.password,login.submit,logout,sessionExpired,...}
layout.sidebar.{home,menu,products,staff,tables,kitchen,settings,logout}
layout.navbar.{user,roles,language,logout}
errors.{notFound,networkError,unauthorized,forbidden,serverError}
crud.{create,edit,delete,list,search,filter,pagination.next,...}
validation.{required,invalidEmail,minLength,maxLength,...}
```

Target ~700 keys por archivo para cubrir features futuras sin tener que editar 20 componentes cuando agregamos una key. Las keys no usadas hoy simplemente no se renderizan.

### D9. `useIdleTimeout` — dos temporizadores con reset compartido

**Decisión**: Un `useRef` con `{ warnTimer, logoutTimer }`. Los listeners de `mousemove`, `keydown`, `touchstart`, `click` llaman a un `resetTimers()` throttleado a 1s (sino cualquier movimiento del mouse spamea `setTimeout`). `warnTimer` = 25 min → abre modal; `logoutTimer` = 30 min → llama `logout()`.

**Trade-off**: el throttle de 1s introduce hasta 1s de imprecisión. Aceptable cuando la ventana total es 25-30 min.

**Guard**: sólo se suscribe a eventos cuando `isAuthenticated === true`. Cleanup en el `useEffect` remueve listeners y limpia timers.

### D10. Tailwind 4.1 con `@tailwindcss/vite` plugin

**Decisión**: Tailwind 4.1 adopta CSS-first config. Se define la paleta `orange` como color primario directamente en `src/index.css` con `@theme`:
```css
@import "tailwindcss";
@theme {
  --color-primary: oklch(70% 0.17 45); /* ≈ #f97316 */
  --color-primary-foreground: white;
}
```

Dark mode vía `[data-theme="dark"]` en `<html>`. Se aplica ya la estructura aunque el toggle de tema explícito queda para un change futuro.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| El refresh proactivo corre en todas las pestañas abiertas y dispara N refreshes en paralelo si el access expiró | `BroadcastChannel` está fuera de scope; aceptamos que el primer refresh de cada pestaña gane. El backend con rotación sobrevive porque blacklistea el anterior. Jitter ±2 min reduce colisiones. |
| Si el usuario vuelve tras 30+ min de idle con la pestaña en background, el timer de idle pudo pausar pero el access ya expiró | El 401 interceptor cubre: el próximo request fallará, pedirá refresh, y si éste también falla (refresh expiró), logout normal → redirect a `/login`. |
| 700 keys de i18n hardcodeadas al día uno se vuelven obsoletas | Las keys son de infraestructura (common, auth, layout, errors, crud, validation). No representan features concretas — son el vocabulario base. C-15 y siguientes agregarán sus propias keys. |
| `babel-plugin-react-compiler` todavía es experimental y puede introducir bugs silenciosos | Lo activamos porque el proyecto entero lo usa (pwaMenu, pwaWaiter) y queremos consistencia. Los tests Vitest y las reglas estrictas de `eslint-plugin-react-hooks` 7.x son la red de seguridad. |
| El probe de auth en `main.tsx` agrega latencia al arranque | Se muestra un splash/skeleton durante el probe. Un usuario ya autenticado lo ve <300 ms; un usuario nuevo lo ve nada (el 401 resuelve el probe instantáneo). |
| Idle timeout al 25/30 min puede ser demasiado agresivo para ciertos MANAGERs que trabajan intermitentemente | Aceptamos el trade-off por seguridad. Ajustable en un change futuro si surge feedback. No va en `.env` todavía — mantener fuera del API pública hasta validar. |

## Migration Plan

No aplica **migración de datos** (no hay datos previos). La migración es puramente de código:

1. Verificar que `Dashboard/` de C-01 existe y tiene el scaffold mínimo de Vite.
2. Actualizar `package.json` con las dependencias nuevas (se listan en `tasks.md`).
3. Crear los archivos y directorios en el orden: `config → utils/logger → services/api → stores/authStore → hooks/useIdleTimeout → components → pages → router → App/main`.
4. Copiar locales base `es.json` y `en.json`.
5. `pnpm install && pnpm dev` — verificar que el dashboard arranca en `http://localhost:5177`.
6. Ejecutar `pnpm test` para validar las suites Vitest.
7. Ejecutar `pnpm lint` y `pnpm typecheck`.

**Rollback**: borrar `Dashboard/` y revertir el commit. Ningún otro componente depende operacionalmente de este change — es un frontend nuevo, aislado.

## Open Questions

- **Ninguna bloqueante para el apply.** El alcance y las decisiones están claros.
- ¿Agregamos un toggle explícito de tema light/dark en el Navbar? → Decidido: no en este change. La estructura está lista (atributo `data-theme` en `<html>`), pero la UI del toggle se pospone hasta tener un `<DropdownMenu>` reutilizable en un change de UI kit futuro.
- ¿Multi-tenant awareness en el UI (mostrar qué tenant/branch tengo activo)? → No en este change. Se agrega con C-15 cuando aparecen las primeras queries tenant-scoped visibles.

## Architecture Diagram (texto)

```
main.tsx
 ├─ i18n/index.ts        (init i18next, load es/en)
 ├─ silent auth probe     (GET /me con access en memoria si existe; sino POST /refresh)
 └─ <RouterProvider router={router}>
      │
      router.tsx
       ├─ "/"         → <ProtectedRoute><MainLayout/></ProtectedRoute>
       │    ├─ index  → <HomePage/>          (lazy)
       │    └─ "*"    → <NotFoundPage/>      (lazy, dentro del layout)
       ├─ "/login"    → <LoginPage/>          (lazy, sin ProtectedRoute)
       └─ "*"         → <NotFoundPage/>      (lazy, sin layout si no logueado)

  MainLayout.tsx
   ├─ Sidebar         (collapsed state from localStorage, nav items con t())
   ├─ Navbar          (user info, lang toggle, logout button)
   ├─ Breadcrumbs     (useMatches() + route.handle.breadcrumb + t())
   ├─ <Outlet/>        (la página actual)
   └─ useIdleTimeout() (warning 25m, logout 30m)

  services/api.ts       fetchAPI(path, init?) → Response
   ├─ attach Authorization: Bearer
   ├─ on 401 + !isLoggingOut → mutex refresh → retry una vez
   └─ on 2nd 401 → authStore.logout()

  stores/authStore.ts
   ├─ state: { isAuthenticated, user, requires2fa, isLoading, error, isLoggingOut }
   ├─ actions: login, logout, refresh, clearError
   ├─ selectors: selectIsAuthenticated, selectUser, selectIsLoading, selectError, selectRequires2fa
   └─ refreshIntervalId en closure del módulo
```
