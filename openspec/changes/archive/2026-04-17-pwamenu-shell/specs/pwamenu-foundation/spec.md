## ADDED Requirements

### Requirement: pwaMenu bootstraps as a React 19 PWA with lazy routes

The pwaMenu application SHALL bootstrap from `src/main.tsx` registering the Vite PWA service worker and a lazy-loaded i18n layer, and SHALL mount a `react-router-dom` v7 `RouterProvider` exposing the routes `/` (redirect), `/scan`, `/t/:branchSlug/:tableCode`, `/menu`, and `*` (404). Each page SHALL be loaded via `React.lazy` so it is not part of the initial bundle.

#### Scenario: Bundle splits pages into lazy chunks

- **WHEN** running `npm run build` in `pwaMenu/`
- **THEN** the output under `dist/assets/` SHALL contain separate chunks for each of `ScannerPage`, `SessionActivatePage`, `MenuPage`, and `NotFoundPage` (one `.js` file per page), and the entry chunk SHALL NOT include the render logic of those pages

#### Scenario: Dev server starts on port 5176

- **WHEN** running `npm run dev` in `pwaMenu/`
- **THEN** Vite SHALL start the dev server on port 5176 without errors, and navigating to `http://localhost:5176/` SHALL render the router (either redirect to `/scan` or `/menu`)

#### Scenario: React Compiler is enabled

- **WHEN** inspecting `pwaMenu/vite.config.ts`
- **THEN** `babel-plugin-react-compiler` SHALL be configured in the Vite React plugin options, matching the Dashboard setup

#### Scenario: TypeScript compilation succeeds

- **WHEN** running `npx tsc --noEmit` inside `pwaMenu/`
- **THEN** compilation SHALL succeed with zero type errors

---

### Requirement: Session store persists Table Token with 8-hour TTL on localStorage

The `sessionStore` Zustand store SHALL hold `{ token, branchSlug, tableCode, sessionId, expiresAt }` and SHALL persist this object in `localStorage` under the key `pwamenu-session`. On app mount, a hydration hook SHALL read `localStorage`, validate `expiresAt > Date.now()`, and SHALL clear the session and key if expired. The store SHALL never be accessed via destructuring — only selectors MUST be used.

#### Scenario: Valid session survives page reload

- **WHEN** a session with `expiresAt = Date.now() + 7 * 60 * 60 * 1000` (7h in the future) is written to `localStorage`
- **AND** the app is reloaded
- **THEN** `sessionStore.getState().token` SHALL equal the persisted token
- **AND** `sessionStore.getState().isExpired()` SHALL return `false`

#### Scenario: Expired session is cleared on hydration

- **WHEN** a session with `expiresAt = Date.now() - 1000` (1s in the past) is written to `localStorage`
- **AND** the app is reloaded
- **THEN** `sessionStore.getState().token` SHALL be `null`
- **AND** `localStorage.getItem('pwamenu-session')` SHALL be `null`

#### Scenario: activate() writes to localStorage with expiresAt 8h from now

- **WHEN** `sessionStore.getState().activate({ token: 'abc', branchSlug: 'rest-1', tableCode: 'INT-05' })` is called at time `T0`
- **THEN** `localStorage.getItem('pwamenu-session')` SHALL contain a JSON object with `expiresAt` between `T0 + 7h59m` and `T0 + 8h01m`

#### Scenario: clear() wipes state and localStorage

- **GIVEN** a session is active in the store
- **WHEN** `sessionStore.getState().clear()` is called
- **THEN** `sessionStore.getState().token` SHALL be `null`
- **AND** `localStorage.getItem('pwamenu-session')` SHALL be `null`

#### Scenario: localStorage unavailable falls back to in-memory

- **WHEN** `localStorage` throws `SecurityError` on write (e.g., private browsing)
- **THEN** the store SHALL still accept the state change in memory
- **AND** the app SHALL NOT crash
- **AND** a warning SHALL be logged via `utils/logger.ts`

---

### Requirement: QR deep link activates session and sanitizes URL

The route `/t/:branchSlug/:tableCode?token=<TOKEN>` SHALL read the `token` query parameter, call `sessionStore.activate(...)`, issue a `GET /api/diner/session` request to validate the token against the backend, and on success SHALL call `history.replaceState(null, '', '/menu')` to remove the token from the visible URL and navigate to `/menu`. On backend 401 response, the page SHALL clear the session and redirect to `/scan?reason=expired`.

#### Scenario: Valid deep link activates session and cleans URL

- **WHEN** the user navigates to `/t/rest-1/INT-05?token=valid-hmac-token`
- **AND** `GET /api/diner/session` returns `200` with `{ session_id: 42, ... }`
- **THEN** `sessionStore.getState().token` SHALL equal `'valid-hmac-token'`
- **AND** `sessionStore.getState().sessionId` SHALL equal `'42'` (string)
- **AND** `window.location.pathname` SHALL equal `/menu`
- **AND** `window.location.search` SHALL NOT contain `token=`

#### Scenario: Expired token redirects to scanner

- **WHEN** the user navigates to `/t/rest-1/INT-05?token=expired-token`
- **AND** `GET /api/diner/session` returns `401`
- **THEN** `sessionStore.getState().token` SHALL be `null`
- **AND** the user SHALL be redirected to `/scan?reason=expired`

#### Scenario: Missing token redirects to scanner

- **WHEN** the user navigates to `/t/rest-1/INT-05` without a `token` query parameter
- **THEN** the user SHALL be redirected to `/scan`

---

### Requirement: Scanner page supports camera scan and manual fallback

`ScannerPage` at route `/scan` SHALL attempt to use the browser's camera via `@zxing/browser` (or `BarcodeDetector` when available) to decode a QR code whose payload is a URL of the form `/t/:branchSlug/:tableCode?token=...`. When permission is denied or the API is unavailable, the page SHALL display a manual input form allowing entry of `branchSlug`, `tableCode`, and `token` as a fallback. A `reason=expired` query parameter SHALL display a localized banner explaining the previous session expired.

#### Scenario: Successful QR decode navigates to activation route

- **WHEN** the scanner decodes a payload equal to `https://example.com/t/rest-1/INT-05?token=abc`
- **THEN** the app SHALL navigate to `/t/rest-1/INT-05?token=abc`

#### Scenario: Camera permission denied shows manual form

- **WHEN** the user denies camera permission
- **THEN** the page SHALL show a manual input form with three fields (`branchSlug`, `tableCode`, `token`)
- **AND** submitting the form SHALL navigate to `/t/{branchSlug}/{tableCode}?token={token}`

#### Scenario: Expiration banner displayed

- **WHEN** the user navigates to `/scan?reason=expired`
- **THEN** a banner SHALL be visible using the translation key `scanner.sessionExpired`

---

### Requirement: Public menu page renders categories, subcategories, and products with filters

`MenuPage` at route `/menu` SHALL call `GET {VITE_API_URL}/api/public/menu/{VITE_BRANCH_SLUG}` without authentication, transform the response so that all `id` fields are `string` and prices remain in cents (`int`), and SHALL render a list of categories containing subcategories containing products. Each product SHALL display name, description, price formatted via `Intl.NumberFormat` in `ARS`, and image (falling back to `/fallback-product.svg` on error). The page SHALL provide a search input filtering by product name (case-insensitive, debounced 250ms) and an allergen filter excluding products with selected allergens. The page SHALL require a valid session — if `sessionStore.isExpired()` is `true` on mount, the user SHALL be redirected to `/scan`.

#### Scenario: Menu loads and displays categories

- **GIVEN** `GET /api/public/menu/default` returns `{ categories: [{ id: 1, name: "Entradas", subcategories: [...] }, ...] }`
- **WHEN** `MenuPage` mounts with a valid session
- **THEN** each category name SHALL be rendered in the DOM
- **AND** each `category.id` in the rendered DOM SHALL be a string (e.g., `data-category-id="1"` not `1`)

#### Scenario: Product prices are formatted in ARS

- **GIVEN** a product with `price_cents: 12550`
- **WHEN** the product is rendered
- **THEN** the displayed price text SHALL match `/\$\s*125[,\.]50/` (locale-appropriate ARS formatting)

#### Scenario: Product image fallback on error

- **GIVEN** a product whose image URL returns 404
- **WHEN** the `<img>` element fires its `onError` event
- **THEN** its `src` SHALL be updated to `/fallback-product.svg`

#### Scenario: Search filters products by name

- **GIVEN** the menu contains products "Pizza Muzzarella" and "Empanada de carne"
- **WHEN** the user types "pizza" in the search input (after 250ms debounce)
- **THEN** only "Pizza Muzzarella" SHALL be visible in the product list

#### Scenario: Allergen filter excludes matching products

- **GIVEN** a product flagged with allergen `gluten`
- **WHEN** the user toggles the `gluten` filter on
- **THEN** that product SHALL NOT be visible in the product list

#### Scenario: No session redirects to scanner

- **WHEN** `MenuPage` mounts and `sessionStore.getState().token` is `null`
- **THEN** the user SHALL be redirected to `/scan`

---

### Requirement: API client injects X-Table-Token header and handles 401

The module `src/services/api.ts` SHALL expose `apiGet`, `apiPost`, `apiPatch`, `apiDelete`, and `apiPut` functions that SHALL read the current token from `sessionStore` and inject it as the `X-Table-Token` request header unless `skipAuth: true` is passed in the options. On a 401 response, the client SHALL call `sessionStore.getState().clear()`, navigate the browser to `/scan?reason=expired`, and throw `ApiError(401, 'session_expired')`. The base URL SHALL be `import.meta.env.VITE_API_URL`. Response IDs SHALL NOT be converted here — conversion to `string` IDs belongs in domain services (`services/menu.ts`, `services/session.ts`).

#### Scenario: Authenticated GET sends X-Table-Token header

- **GIVEN** `sessionStore.getState().token` equals `'table-xyz'`
- **WHEN** `apiGet('/api/diner/session')` is invoked
- **THEN** the outgoing request SHALL include the header `X-Table-Token: table-xyz`

#### Scenario: skipAuth omits token

- **GIVEN** `sessionStore.getState().token` is non-null
- **WHEN** `apiGet('/api/public/menu/default', { skipAuth: true })` is invoked
- **THEN** the outgoing request SHALL NOT include an `X-Table-Token` header

#### Scenario: 401 clears session and redirects

- **GIVEN** the backend returns HTTP 401 to any request
- **WHEN** the client receives the response
- **THEN** `sessionStore.getState().token` SHALL become `null`
- **AND** the browser SHALL navigate to `/scan?reason=expired`

#### Scenario: Request uses VITE_API_URL as base

- **GIVEN** `import.meta.env.VITE_API_URL` equals `http://localhost:8000`
- **WHEN** `apiGet('/api/public/menu/default')` is invoked
- **THEN** the outgoing request URL SHALL be `http://localhost:8000/api/public/menu/default`

---

### Requirement: Service worker caches assets CacheFirst and public API NetworkFirst

The Vite PWA plugin configuration SHALL declare runtime caching rules so that: (a) requests whose pathname matches `/\.(png|jpg|jpeg|webp|svg|ico)$/i` use `CacheFirst` with cache name `pwamenu-images`, max 200 entries, max age 30 days; (b) requests whose pathname starts with `/api/public/` use `NetworkFirst` with cache name `pwamenu-public-api`, `networkTimeoutSeconds: 3`, max 50 entries, max age 5 minutes; (c) fonts (`.woff2`, `.woff`, `.ttf`) use `CacheFirst` with 1-year expiration. The configuration SHALL NOT include any rule matching `/api/diner/*`, `/api/waiter/*`, or other mutation paths. The `cacheableResponse` option SHALL restrict caching to statuses `[0, 200]`. The registration type SHALL be `autoUpdate`.

#### Scenario: Image requests hit CacheFirst rule

- **WHEN** inspecting `pwaMenu/vite.config.ts`
- **THEN** a `runtimeCaching` entry SHALL match image URL patterns with `handler: 'CacheFirst'` and `cacheName: 'pwamenu-images'`

#### Scenario: Public menu endpoint hits NetworkFirst rule

- **WHEN** inspecting `pwaMenu/vite.config.ts`
- **THEN** a `runtimeCaching` entry SHALL match paths under `/api/public/` with `handler: 'NetworkFirst'` and `networkTimeoutSeconds: 3`

#### Scenario: No runtime rule captures diner mutation endpoints

- **WHEN** inspecting `pwaMenu/vite.config.ts`
- **THEN** no `urlPattern` in `runtimeCaching` SHALL match pathnames starting with `/api/diner/` or `/api/waiter/`

#### Scenario: Only 200 and 0 responses are cached

- **WHEN** inspecting any `runtimeCaching` entry in `pwaMenu/vite.config.ts`
- **THEN** its `cacheableResponse.statuses` SHALL be `[0, 200]`

---

### Requirement: i18n supports es, en, pt with lazy loading and whitelist validation

The i18n layer SHALL initialize with `supportedLngs: ['es', 'en', 'pt']`, `fallbackLng: 'es'`, `nonExplicitSupportedLngs: false`, and `partialBundledLanguages: true`. Each locale SHALL be imported via dynamic `import()` so each file produces a separate Vite chunk. The `languageChanged` event SHALL trigger loading the requested locale on demand. The detector SHALL read from `localStorage` under key `pwamenu-language` and from `navigator.language`, and SHALL reject any stored value not in the whitelist. All three locale files SHALL contain the same set of translation keys — a completeness test SHALL enforce this. Every user-visible string in the application SHALL be rendered via `t()` — zero hardcoded strings.

#### Scenario: Locales produce separate chunks

- **WHEN** running `npm run build`
- **THEN** `dist/assets/` SHALL contain distinct chunk files for `es`, `en`, and `pt` locale JSON modules

#### Scenario: Unsupported language in localStorage falls back to es

- **GIVEN** `localStorage.setItem('pwamenu-language', 'xx')`
- **WHEN** the app initializes
- **THEN** `i18n.language` SHALL be `'es'` (fallback)

#### Scenario: Locale files share the same key set

- **WHEN** running the i18n completeness test
- **THEN** the set of keys in `es.json`, `en.json`, and `pt.json` SHALL be identical (no orphan keys in any file)

#### Scenario: App.tsx uses t() for all visible text

- **WHEN** grepping `pwaMenu/src/` for JSX content
- **THEN** every visible string in `.tsx` files under `pages/` and `components/` SHALL be rendered via `t('...')` or a variable derived from `t()` — no literal Spanish/English/Portuguese strings in JSX children

---

### Requirement: Mobile-first layout with overflow guard and safe-area support

Every top-level page container SHALL apply the Tailwind classes `overflow-x-hidden w-full max-w-full` to prevent horizontal scroll on mobile devices. The `index.html` viewport meta SHALL be `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />` and CSS SHALL reserve safe-area insets for iOS notch devices using `env(safe-area-inset-*)`.

#### Scenario: Page containers include overflow guard

- **WHEN** inspecting any page under `pwaMenu/src/pages/`
- **THEN** its root container SHALL include the class `overflow-x-hidden`
- **AND** SHALL include `w-full max-w-full`

#### Scenario: Viewport meta includes viewport-fit=cover

- **WHEN** inspecting `pwaMenu/index.html`
- **THEN** the `<meta name="viewport">` tag SHALL include `viewport-fit=cover`

---

### Requirement: Environment variables documented and consumed via Vite

`pwaMenu/.env.example` SHALL declare `VITE_API_URL`, `VITE_WS_URL`, `VITE_BRANCH_SLUG`, and optional `VITE_LOCALE` and `VITE_CURRENCY`. The application SHALL read these only through `import.meta.env.*` and SHALL NOT access `process.env`. `VITE_API_URL` SHALL be treated as a bare origin (no trailing `/api` suffix).

#### Scenario: .env.example exists with required variables

- **WHEN** inspecting `pwaMenu/.env.example`
- **THEN** it SHALL contain the keys `VITE_API_URL`, `VITE_WS_URL`, and `VITE_BRANCH_SLUG`

#### Scenario: No process.env references

- **WHEN** grepping `pwaMenu/src/` for `process.env`
- **THEN** there SHALL be zero matches

#### Scenario: VITE_API_URL does not include /api suffix in example

- **WHEN** inspecting `pwaMenu/.env.example`
- **THEN** the `VITE_API_URL` example value SHALL NOT end in `/api` (e.g., it SHALL be `http://localhost:8000`, not `http://localhost:8000/api`)

---

### Requirement: Vitest test suite covers session, menu, and i18n

A Vitest suite SHALL exist under `pwaMenu/src/tests/` and SHALL cover at minimum: (a) `sessionStore` TTL behavior (valid survives, expired clears, localStorage unavailable falls back), (b) `MenuPage` rendering with MSW mock of `/api/public/menu/:slug`, (c) i18n key parity across `es`, `en`, `pt`. The script `npm run test:run` SHALL execute all tests and exit 0 on success.

#### Scenario: Session tests cover all TTL paths

- **WHEN** running `npm run test:run`
- **THEN** tests named to cover "valid session survives", "expired session clears", and "localStorage unavailable fallback" SHALL all pass

#### Scenario: MenuPage renders with MSW mock

- **WHEN** running `npm run test:run`
- **THEN** at least one test SHALL render `MenuPage` with `@testing-library/react`, mock `/api/public/menu/:slug` via MSW, and assert the rendered category names

#### Scenario: i18n completeness test passes

- **WHEN** running `npm run test:run`
- **THEN** a test SHALL compute the set of translation keys in `es.json`, `en.json`, and `pt.json` and assert they are equal; the test SHALL pass

#### Scenario: Test script exits 0 on clean suite

- **WHEN** running `npm run test:run` with no intentional failures
- **THEN** the process exit code SHALL be `0`
