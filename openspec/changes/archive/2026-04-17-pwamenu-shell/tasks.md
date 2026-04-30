## 1. Dependencias y configuración base

- [ ] 1.1 Agregar dependencias a `pwaMenu/package.json`: `react-router-dom@^7`, `@zxing/browser@^0.1`, `clsx`
- [ ] 1.2 Agregar devDependencies: `babel-plugin-react-compiler`, `msw@^2`, `@testing-library/react@^16`, `@testing-library/jest-dom@^6`, `@testing-library/user-event@^14`, `jsdom` (si no está)
- [ ] 1.3 Ejecutar `npm install` y verificar que no haya conflictos de peer deps
- [ ] 1.4 Actualizar `pwaMenu/vite.config.ts`: agregar `babel-plugin-react-compiler` a la configuración del plugin `react`
- [ ] 1.5 Actualizar `pwaMenu/vite.config.ts`: reemplazar `runtimeCaching` actual por las 3 reglas (CacheFirst imágenes, NetworkFirst `/api/public/*`, CacheFirst fonts) con `cacheableResponse.statuses: [0, 200]`
- [ ] 1.6 Crear `pwaMenu/.env.example` con `VITE_API_URL=http://localhost:8000`, `VITE_WS_URL=ws://localhost:8001`, `VITE_BRANCH_SLUG=default`, `VITE_LOCALE=es-AR`, `VITE_CURRENCY=ARS`
- [ ] 1.7 Verificar que `pwaMenu/index.html` tiene `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />` (actualizar si hace falta)

## 2. Assets estáticos de fallback

- [ ] 2.1 Crear `pwaMenu/public/fallback-product.svg` — ícono genérico de plato (reutilizar el naranja `#f97316`)
- [ ] 2.2 Crear `pwaMenu/public/default-avatar.svg` — ícono genérico de usuario para futuros usos (C-18)

## 3. i18n lazy loading con es/en/pt

- [ ] 3.1 Refactorear `pwaMenu/src/i18n/index.ts`: quitar imports estáticos de locales, configurar `supportedLngs: ['es','en','pt']`, `nonExplicitSupportedLngs: false`, `partialBundledLanguages: true`, `resources: {}`
- [ ] 3.2 Configurar detector con `lookupLocalStorage: 'pwamenu-language'`, `order: ['localStorage','navigator']`, `caches: ['localStorage']`
- [ ] 3.3 Registrar handler `i18n.on('languageChanged', ...)` que haga `import('./locales/${lng}.json')` y `addResourceBundle`
- [ ] 3.4 Expandir `pwaMenu/src/i18n/locales/es.json` a ~120 keys cubriendo: `common.*` (loading, error, retry, cancel, back, etc.), `app.*`, `scanner.*` (title, instructions, manualFallback, permissionDenied, sessionExpired, invalidQr), `session.*` (activating, error, persistWarning), `menu.*` (title, search, empty, loading, filters, noResults), `product.*` (addToCart placeholder, allergens, imageAlt), `allergen.*` (title, clear, <each allergen code>), `error.*` (network, unknown, tryAgain)
- [ ] 3.5 Traducir todas las keys a `en.json` (inglés) y `pt.json` (portugués) manteniendo exactamente el mismo set de claves
- [ ] 3.6 Actualizar `main.tsx` para que el bootstrap espere a que el idioma detectado haya cargado su bundle antes de renderizar (evitar flash de keys sin traducir)

## 4. Utilidades

- [ ] 4.1 Crear `pwaMenu/src/utils/storage.ts`: funciones `readJSON<T>(key)`, `writeJSON(key, value)`, `removeKey(key)` con try/catch para `QuotaExceededError` y `SecurityError`, logging vía `logger`
- [ ] 4.2 Crear `pwaMenu/src/utils/price.ts`: `formatPrice(cents: number, locale?, currency?): string` usando `Intl.NumberFormat`, defaults desde `import.meta.env.VITE_LOCALE` y `VITE_CURRENCY`
- [ ] 4.3 Crear `pwaMenu/src/utils/idConversion.ts`: helpers `toStringId(n: number): string` y `toNumberId(s: string): number`

## 5. Tipos del dominio frontend

- [ ] 5.1 Crear `pwaMenu/src/types/session.ts` con interfaces `Session` (id, branchSlug, tableCode, status), `Diner` (id, name, color)
- [ ] 5.2 Crear `pwaMenu/src/types/menu.ts` con interfaces `Category`, `Subcategory`, `Product`, `Allergen` (todos con `id: string`, `priceCents: number` para Product)
- [ ] 5.3 Crear DTOs separados (`ProductDTO`, `CategoryDTO`, etc.) que reflejen la respuesta cruda del backend (`id: number`, `price_cents: number`)

## 6. Session store (Zustand con TTL manual)

- [ ] 6.1 Crear `pwaMenu/src/stores/sessionStore.ts` con estado `{ token, branchSlug, tableCode, sessionId, expiresAt }` y acciones `activate(payload)`, `clear()`, `isExpired()`
- [ ] 6.2 En `activate`: setear `expiresAt = Date.now() + 8 * 60 * 60 * 1000` y persistir vía `writeJSON('pwamenu-session', state)`
- [ ] 6.3 En `clear`: resetear estado a nulls y llamar `removeKey('pwamenu-session')`
- [ ] 6.4 `isExpired()`: retornar `!expiresAt || Date.now() > expiresAt`
- [ ] 6.5 Exportar selectores estables: `selectToken`, `selectIsActive`, `selectBranchSlug`, `selectSessionId`
- [ ] 6.6 Crear hook `useHydrateSession()` en `pwaMenu/src/hooks/useHydrateSession.ts` que corre al mount del router: lee `localStorage`, si expiró → `clear()`, si no → setear estado en el store

## 7. Cliente API

- [ ] 7.1 Crear `pwaMenu/src/services/api.ts` con `ApiError` class y funciones `apiGet`, `apiPost`, `apiPatch`, `apiDelete`, `apiPut`
- [ ] 7.2 Cada función: construir URL como `${VITE_API_URL}${path}`, inyectar `X-Table-Token` desde `sessionStore.getState().token` salvo que `opts.skipAuth` sea true
- [ ] 7.3 Manejo de 401: llamar `sessionStore.getState().clear()`, `window.location.href = '/scan?reason=expired'`, lanzar `ApiError(401, 'session_expired')`
- [ ] 7.4 Manejo de errores no-OK: lanzar `ApiError(status, body)` para que las capas superiores decidan UX
- [ ] 7.5 Soporte para `AbortSignal` via `opts.signal`
- [ ] 7.6 Crear `pwaMenu/src/services/menu.ts` con `getPublicMenu(slug: string): Promise<Category[]>` que llama `apiGet(\`/api/public/menu/${slug}\`, { skipAuth: true })` y convierte DTOs → tipos del dominio (ID a string, price_cents → priceCents)
- [ ] 7.7 Crear `pwaMenu/src/services/session.ts` con `getDinerSession(): Promise<Session>` que llama `apiGet('/api/diner/session')` y convierte IDs a string

## 8. Router y páginas

- [ ] 8.1 Crear `pwaMenu/src/router.tsx` con `createBrowserRouter` y rutas: `/` (loader que redirige a `/menu` si `isActive` y no `isExpired`, sino `/scan`), `/scan`, `/t/:branchSlug/:tableCode`, `/menu`, `*` (404). Cada página con `lazy: () => import(...)`
- [ ] 8.2 Reescribir `pwaMenu/src/App.tsx` para renderizar `<RouterProvider router={router} />` dentro de un `<Suspense fallback={...}>` con un spinner localizado
- [ ] 8.3 Crear `pwaMenu/src/components/layout/AppShell.tsx` con contenedor `min-h-screen overflow-x-hidden w-full max-w-full` y padding safe-area via `pb-[env(safe-area-inset-bottom)]`
- [ ] 8.4 Crear `pwaMenu/src/pages/NotFoundPage.tsx` con mensaje `t('error.notFound')` y link a `/scan`

## 9. Scanner y activación

- [ ] 9.1 Crear `pwaMenu/src/pages/ScannerPage.tsx`: mostrar video element con `@zxing/browser` (`BrowserQRCodeReader`), al decodear un payload parsear la URL y navegar
- [ ] 9.2 Manejo de error/permiso denegado: mostrar formulario manual con 3 inputs (branchSlug, tableCode, token) y botón submit que navega a `/t/{branchSlug}/{tableCode}?token={token}`
- [ ] 9.3 Leer query `?reason=expired` y mostrar banner con `t('scanner.sessionExpired')`
- [ ] 9.4 Crear `pwaMenu/src/pages/SessionActivatePage.tsx`: en `useEffect`, leer params de URL (`branchSlug`, `tableCode`, `token` de searchParams), llamar `sessionStore.activate(...)`, luego `await getDinerSession()`
- [ ] 9.5 En activación exitosa: actualizar `sessionId` en el store, llamar `history.replaceState(null, '', '/menu')`, `navigate('/menu', { replace: true })`
- [ ] 9.6 En 401: `clear()` y `navigate('/scan?reason=expired', { replace: true })`
- [ ] 9.7 Renderizar un estado de loading con `t('session.activating')` y manejo de error con `t('session.error')`

## 10. Menú público (lectura)

- [ ] 10.1 Crear `pwaMenu/src/hooks/useRequireSession.ts` que verifica `!isExpired()`, si falla → navigate a `/scan`
- [ ] 10.2 Crear `pwaMenu/src/pages/MenuPage.tsx`: usar `useRequireSession`, llamar `getPublicMenu(VITE_BRANCH_SLUG)`, manejar estados loading/error/empty con traducciones
- [ ] 10.3 Crear `pwaMenu/src/components/menu/SearchBar.tsx` con input debounced 250ms (usar `useDeferredValue` de React 19 o un custom hook)
- [ ] 10.4 Crear `pwaMenu/src/components/menu/AllergenFilter.tsx` con chips toggleables por alérgeno
- [ ] 10.5 Crear `pwaMenu/src/components/menu/CategoryList.tsx` y `SubcategorySection.tsx` para renderizar jerarquía
- [ ] 10.6 Crear `pwaMenu/src/components/menu/ProductCard.tsx`: `<img>` con `onError` → `src = '/fallback-product.svg'`, nombre, descripción, precio formateado via `formatPrice`, chips de alérgenos si aplica
- [ ] 10.7 Aplicar filtros (search + allergens) en el componente padre con `useMemo` (o automático con React Compiler)

## 11. Testing setup

- [ ] 11.1 Crear `pwaMenu/src/tests/setup.ts` con `@testing-library/jest-dom` import y `beforeAll`/`afterEach`/`afterAll` para MSW server
- [ ] 11.2 Actualizar `pwaMenu/vite.config.ts` con `test.setupFiles: ['src/tests/setup.ts']` y `test.environment: 'jsdom'`
- [ ] 11.3 Crear `pwaMenu/src/tests/mocks/handlers.ts` con handlers MSW para `GET /api/public/menu/:slug` y `GET /api/diner/session`
- [ ] 11.4 Crear `pwaMenu/src/tests/mocks/server.ts` con `setupServer(...handlers)`

## 12. Tests unitarios

- [ ] 12.1 `pwaMenu/src/tests/stores/sessionStore.test.ts`: test "valid session survives reload" (mock localStorage con `expiresAt` futuro, instanciar store, verificar token presente)
- [ ] 12.2 Mismo archivo: test "expired session clears on hydrate" (mock con `expiresAt` pasado, verificar token null y `localStorage` removido)
- [ ] 12.3 Mismo archivo: test "localStorage unavailable fallback" (stub `localStorage.setItem` para throw `SecurityError`, verificar que el store acepta el cambio en memoria y loguea warning)
- [ ] 12.4 Mismo archivo: test "activate() sets expiresAt ~8h in the future" (capturar `Date.now()` antes, verificar `expiresAt` en ventana de ±1 minuto)
- [ ] 12.5 Mismo archivo: test "clear() wipes localStorage" (activar, clear, verificar `localStorage.getItem('pwamenu-session') === null`)
- [ ] 12.6 `pwaMenu/src/tests/pages/MenuPage.test.tsx`: test "renders categories from public menu endpoint" con MSW mock, `render(<MenuPage />)` dentro de MemoryRouter, `await findByText('Entradas')`
- [ ] 12.7 Mismo archivo: test "redirects to /scan when no session" (sin token en store, verificar navegación)
- [ ] 12.8 Mismo archivo: test "product image fallback on error" (disparar `img.onerror`, verificar `src === '/fallback-product.svg'`)
- [ ] 12.9 `pwaMenu/src/tests/i18n/completeness.test.ts`: importar los 3 JSON, función recursiva para extraer todas las keys (paths con dot), comparar sets y fallar si hay diferencia
- [ ] 12.10 `pwaMenu/src/tests/services/api.test.ts`: test "injects X-Table-Token when token present", "omits header with skipAuth", "401 clears session and redirects" (stub `window.location` o usar `history` mock)

## 13. Integración y verificación local

- [ ] 13.1 Ejecutar `npm run test:run` en `pwaMenu/` y verificar que todos los tests pasan
- [ ] 13.2 Ejecutar `npx tsc --noEmit` en `pwaMenu/` y verificar cero errores de tipos
- [ ] 13.3 Ejecutar `npm run lint` en `pwaMenu/` y verificar cero errores (corregir si hay algún violación de `eslint-plugin-react-hooks` 7.x)
- [ ] 13.4 Ejecutar `npm run build` en `pwaMenu/` y verificar que el output incluye chunks separados para `es.json`, `en.json`, `pt.json` y cada página (inspección en `dist/assets/`)
- [ ] 13.5 Ejecutar `npm run dev` y probar manualmente: navegar a `/scan` (ver input manual), completar con slug/code/token inventados, verificar redirect a `/t/...?token=...`, ver que `SessionActivatePage` intenta llamar al backend (si el backend está corriendo, confirmar activación)
- [ ] 13.6 Con el dev server corriendo, abrir DevTools → Application → Service Workers y verificar que el SW se registró y que las imágenes aparecen en el cache `pwamenu-images`
- [ ] 13.7 Probar offline: tras cargar el menú al menos una vez, activar throttle offline en DevTools y confirmar que el menú (servido vía NetworkFirst fallback) aparece desde cache

## 14. Documentación y validación final

- [ ] 14.1 Correr `openspec validate pwamenu-shell --strict` y resolver cualquier hallazgo
- [ ] 14.2 Correr `openspec status --change pwamenu-shell` y confirmar `isComplete: true` para apply
- [ ] 14.3 Actualizar `openspec/CHANGES.md`: marcar C-17 como `[x]` (solo al archivar, **no** ahora; este task se hace durante `/opsx:archive`)
