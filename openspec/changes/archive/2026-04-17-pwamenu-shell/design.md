## Context

pwaMenu es la PWA pública que usan los comensales cuando se sientan en una mesa. Es el **único frontend sin login** — la identidad llega embebida en un Table Token HMAC que el backend emite al activar la mesa (C-08, archivado). Ese token vive 3 horas, viaja en cada request como `X-Table-Token`, y autoriza operaciones acotadas a la sesión de esa mesa (`/api/diner/*`).

Hoy el proyecto está en el estado que dejó C-01 (`foundation-setup`, archivado):

- `pwaMenu/vite.config.ts` tiene `vite-plugin-pwa` con un Workbox mínimo (solo NetworkFirst sobre `/api/`)
- `pwaMenu/src/i18n/index.ts` carga los 3 locales de forma **eager** (import estático de `es.json`, `en.json`, `pt.json`) y solo tiene 3 keys (`app.name`, `app.loading`, `app.error`)
- `App.tsx` es un placeholder con un `<h1>` centrado
- No hay router, no hay stores, no hay cliente API, no hay páginas, no hay service worker funcional más allá del scaffold
- `package.json` ya tiene `react-i18next`, `i18next`, `i18next-browser-languagedetector`, `vite-plugin-pwa`, `zustand` y Vitest 4

Este change convierte ese scaffold en una **PWA funcional end-to-end para lectura de menú y activación de sesión**. Todo lo referido a carrito, rondas y pago es explícitamente fuera de scope (C-18, C-19).

### Stakeholders y consumidores

- **Consumidor primario**: el diner (cliente del restaurante) sentado en una mesa
- **Upstream del backend**: `/api/public/menu/{slug}` (C-04), `/api/diner/session` (C-08), validación HMAC del token (C-08)
- **Downstream en la secuencia**: C-18 (carrito + rondas) reusa `sessionStore`, el cliente API y el layout; C-19 (facturación) reusa los eventos WS que este change no toca

## Goals / Non-Goals

**Goals:**

- Activación de sesión por QR: deep link `/t/:branchSlug/:tableCode?token=...` captura el token, lo persiste y redirige al menú
- Scanner QR in-app (fallback si el comensal entra por el dominio sin deep link) en ruta `/scan`
- `sessionStore` con TTL de 8 horas sobre `localStorage` — al cargar la app, si el token venció se limpia la sesión y se redirige a `/scan`
- Cliente API centralizado que inyecta `X-Table-Token` y maneja 401 (token expirado o revocado → limpiar sesión)
- Menú público renderizado con categorías, subcategorías, productos, precios formateados en ARS, búsqueda y filtro de alérgenos
- Service worker con CacheFirst para assets estáticos (imágenes de productos, fonts, iconos) y NetworkFirst para `/api/public/*`; mutaciones explícitamente excluidas
- Fallback offline: si una imagen de producto falla, se muestra `fallback-product.svg`
- i18n es/en/pt con code-splitting: cada locale es un chunk separado que se carga bajo demanda (no se descargan los 3 bundles al arrancar)
- Validación de idioma contra whitelist al leer `localStorage` (anti-injection)
- Convenciones Zustand aplicadas estrictamente: selectores, `useShallow` donde aplica, `EMPTY_ARRAY` estable
- Mobile-first: todo container raíz con `overflow-x-hidden w-full max-w-full`, viewport meta correcto, safe-area iOS
- Tests unitarios con Vitest: `sessionStore` (expiración, persistencia), carga del menú con MSW mock, completeness de claves i18n (mismo set en es/en/pt)

**Non-Goals:**

- Carrito compartido y flujo de pedidos → C-18
- Pago via Mercado Pago, solicitud de check, loyalty → C-19
- Push notifications (el diner no las necesita; son para waiter)
- WebSocket client — no se conecta a `/ws/diner` en este change (se introduce en C-18 cuando hace falta escuchar eventos de carrito/ronda)
- Personalización por tenant (tema, logo dinámico) — por ahora la sucursal se lee via `VITE_BRANCH_SLUG` y el tema es fijo (naranja `#f97316`)
- Registro del diner en la sesión (`POST /api/diner/register`) — el diner permanece anónimo en este shell; se registra cuando entra al carrito en C-18
- Service worker offline completo con cola de mutaciones (RetryQueue) — va en C-18
- Accesibilidad avanzada (lectores de pantalla completos) — se respetan semánticas básicas pero auditoría a11y queda fuera

## Decisions

### 1. Routing: `react-router-dom` v7 con lazy routes

**Decisión:** Usar `react-router-dom` v7 con `createBrowserRouter` y `React.lazy` por página.

**Alternativas consideradas:**

- TanStack Router: tipado más fuerte pero overkill para 4 rutas y un solo desarrollador de frontend por change
- Wouter: minimal pero sin `Suspense`/`lazy` integrado
- Sin router (single-page con `useState`): insuficiente porque el deep link del QR exige ruta real con parámetros

**Rationale:** Dashboard ya usa React Router v7 (decisión tomada en C-14 según `CHANGES.md` y la knowledge base). Mantener consistencia entre los 3 frontends reduce carga cognitiva. Lazy loading de cada ruta mantiene el bundle inicial chico, crítico para 3G/4G en el restaurante.

**Rutas:**

| Path | Página | Protegida |
|------|--------|-----------|
| `/` | Redirect a `/menu` si hay sesión válida, sino a `/scan` | — |
| `/scan` | `ScannerPage` — scanner QR con fallback manual | No |
| `/t/:branchSlug/:tableCode` | `SessionActivatePage` — lee `?token=`, hidrata `sessionStore`, limpia URL, redirige a `/menu` | No |
| `/menu` | `MenuPage` — lista de categorías/productos | Sí (requiere sesión válida) |
| `*` | `NotFoundPage` | — |

### 2. `sessionStore` — Zustand con TTL manual sobre `localStorage`

**Decisión:** Store Zustand sin el middleware `persist` de Zustand. Manejar serialización y expiración a mano con wrappers `readSession()` / `writeSession()` / `clearSession()` sobre `localStorage`.

**Alternativas consideradas:**

- Zustand `persist` middleware: no soporta TTL nativo; tendríamos que agregar custom storage igual
- `sessionStorage`: se limpia al cerrar la pestaña → un comensal que bloquea el teléfono y vuelve en 20 min perdería la sesión. No sirve.
- `indexedDB`: overkill para un token + 3 campos
- Cookie HttpOnly: el frontend necesita leer el token para ponerlo en el header `X-Table-Token` → una cookie normal sería legible pero agrega complejidad sin beneficio

**Rationale:** El flujo de expiración es específico (8h TTL en cliente, aunque el backend firme 3h — el extra tiempo en cliente da margen si el backend extiende o si el diner entra varias veces en la misma noche; de todas formas el backend es la autoridad final y devolverá 401 si el token está vencido). El persist middleware agrega capas sin resolver TTL. Mejor tener control explícito.

**Forma del estado:**

```typescript
type SessionState = {
  token: string | null        // Table Token HMAC
  branchSlug: string | null
  tableCode: string | null
  sessionId: string | null    // ID numérico del backend convertido a string
  expiresAt: number | null    // epoch ms (= now + 8h al activar)
  // actions
  activate(payload: ActivatePayload): void
  clear(): void
  isExpired(): boolean
}
```

**Persistencia:** al actualizar el estado, escribir `localStorage.setItem('pwamenu-session', JSON.stringify(...))`. Al montar el `RouterProvider`, un hook `useHydrateSession()` lee `localStorage`, valida expiración, y si vence → `clear()`.

**Expiración:**

- Backend firma token con TTL 3h
- Cliente considera vencido a los 8h (más permisivo) — pero el backend rechazará con 401 antes
- Si el cliente detecta 401 del backend → `clear()` + redirect a `/scan`

### 3. Table Token en URL → copiar a store → limpiar URL

**Decisión:** Cuando llega `/t/:branchSlug/:tableCode?token=XYZ`, la página `SessionActivatePage`:

1. Lee `token`, `branchSlug`, `tableCode`
2. Llama `sessionStore.activate({ token, branchSlug, tableCode, expiresAt: Date.now() + 8*60*60*1000 })`
3. Hace `GET /api/diner/session` con el token para obtener `session_id` y confirmar que el backend lo acepta
4. Si 401 → clear + redirect a `/scan` con mensaje de error
5. Si 200 → actualiza `sessionStore` con `session_id`, luego `history.replaceState(null, '', '/menu')` para borrar el token de la URL visible y el historial
6. Redirige a `/menu`

**Alternativas consideradas:**

- Dejar el token en la URL: queda en historial del navegador, en logs si el usuario comparte el link, en referrer headers → riesgo de seguridad
- Usar fragment (`#token=...`) en vez de query: mejor que query pero igual persiste en URL; además los frameworks server-side a veces no lo reciben bien
- POST en lugar de GET para la activación: el QR físico solo puede ser GET

**Rationale:** El QR es inamovible (impreso en la mesa), así que el medio de transmisión debe ser GET + query. Pero una vez leído el token, hay que sacarlo de la superficie expuesta (URL bar, history). `history.replaceState` es la técnica estándar.

### 4. Service worker: allowlist estricta + exclusión explícita de mutaciones

**Decisión:** Configurar `VitePWA` con `runtimeCaching` así:

```js
runtimeCaching: [
  // 1. Imágenes de productos y assets remotos → CacheFirst, 30 días
  {
    urlPattern: ({ url }) => url.pathname.match(/\.(png|jpg|jpeg|webp|svg|ico)$/i),
    handler: 'CacheFirst',
    options: {
      cacheName: 'pwamenu-images',
      expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
      cacheableResponse: { statuses: [0, 200] },
    },
  },
  // 2. Menú público → NetworkFirst con fallback a cache, 5 min
  {
    urlPattern: ({ url }) => url.pathname.startsWith('/api/public/'),
    handler: 'NetworkFirst',
    options: {
      cacheName: 'pwamenu-public-api',
      networkTimeoutSeconds: 3,
      expiration: { maxEntries: 50, maxAgeSeconds: 60 * 5 },
    },
  },
  // 3. Fonts → CacheFirst, 1 año
  {
    urlPattern: ({ url }) => url.pathname.match(/\.(woff2|woff|ttf)$/i),
    handler: 'CacheFirst',
    options: {
      cacheName: 'pwamenu-fonts',
      expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
    },
  },
  // NOTA: NINGÚN patrón captura /api/diner/*, /api/waiter/*, etc.
  // Estas rutas NO pasan por el service worker → siempre van a red.
]
```

**Alternativas consideradas:**

- Cachear todo lo que sea `/api/*` con NetworkFirst: **rechazado**. Cachearía respuestas de mutaciones (POST/PATCH) lo cual es peligroso; Workbox por defecto solo cachea GET, pero si alguna vez se agrega un matcher laxo puede romperse
- Cachear con StaleWhileRevalidate el menú: sirve contenido viejo incluso cuando hay red disponible → confuso cuando el restaurante cambia precios

**Rationale:** Allowlist estricta = superficie de ataque mínima. Cada patrón matchea explícitamente lo que queremos cachear. Todo lo demás pasa directo a la red, incluyendo `/api/diner/*` que es donde pueden ocurrir mutaciones en el futuro (C-18, C-19).

**Fallback offline de imágenes:** cuando una request de imagen falla completamente (sin red y sin cache), el handler `CacheFirst` devuelve error. Interceptamos eso en `<ProductCard>` con `onError={() => setSrc('/fallback-product.svg')}`.

### 5. i18n lazy loading con code-splitting por idioma

**Decisión:** Refactor de `src/i18n/index.ts` para usar dynamic imports:

```typescript
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'es',
    supportedLngs: ['es', 'en', 'pt'],     // whitelist explícita
    nonExplicitSupportedLngs: false,        // no aceptar 'es-AR' como 'es'
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'pwamenu-language',
    },
    partialBundledLanguages: true,
    resources: {},                          // vacío al arrancar
  })

// loader que se llama cuando i18next detecta el idioma
i18n.on('languageChanged', async (lng) => {
  if (!i18n.hasResourceBundle(lng, 'translation')) {
    const mod = await import(`./locales/${lng}.json`)
    i18n.addResourceBundle(lng, 'translation', mod.default)
  }
})
```

**Alternativas consideradas:**

- Backend plugin (`i18next-http-backend`): cargaría los JSON desde `/locales/*.json` estáticos servidos por Vite. Útil si las traducciones se actualizaran sin redeploy; no es nuestro caso.
- Eager loading como está hoy: los 3 JSONs se bundlean en el entry chunk. Penaliza primer render con bytes de idiomas que nunca se van a mostrar.

**Rationale:** `import('./locales/es.json')` genera un chunk separado automáticamente (Vite code-split). Un diner hispanohablante nunca descarga `en.json` ni `pt.json`. Con ~40-60 KB por locale traducido completo, el ahorro es concreto.

**Whitelist anti-injection:** `supportedLngs: ['es', 'en', 'pt']` + `nonExplicitSupportedLngs: false` garantizan que si alguien setea `localStorage.setItem('pwamenu-language', 'xx')` i18next no lo acepta y usa fallback.

### 6. Cliente API: wrapper único con inyección automática de `X-Table-Token`

**Decisión:** Un módulo `src/services/api.ts` que expone `apiGet`, `apiPost`, etc., con este contrato:

```typescript
export async function apiGet<T>(path: string, opts?: RequestOpts): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...opts?.headers }
  const token = sessionStore.getState().token
  if (token && !opts?.skipAuth) headers['X-Table-Token'] = token

  const res = await fetch(`${import.meta.env.VITE_API_URL}${path}`, {
    method: 'GET',
    headers,
    signal: opts?.signal,
  })

  if (res.status === 401) {
    sessionStore.getState().clear()
    window.location.href = '/scan?reason=expired'
    throw new ApiError(401, 'session_expired')
  }
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.json() as Promise<T>
}
```

**Alternativas consideradas:**

- Axios con interceptors: más robusto pero 13 KB extra; `fetch` nativo alcanza para este scope
- ky o zod-fetch: zod agrega validación pero no es prioridad ahora; lo introducimos en C-18 cuando tengamos carrito

**Rationale:** Un solo wrapper, cero dependencias. El `skipAuth` permite llamar `/api/public/menu/:slug` sin token (es público). Redirección en 401 es intencional: si el token venció, el comensal debe volver a escanear.

### 7. ID conversion en el boundary, no en cada componente

**Decisión:** Las funciones `services/menu.ts` y `services/session.ts` convierten `int` → `string` al recibir respuestas del backend:

```typescript
type ProductDTO = { id: number; name: string; price_cents: number; ... }   // lo que llega
type Product    = { id: string; name: string; priceCents: number; ... }   // lo que usa la UI

function toProduct(dto: ProductDTO): Product {
  return { id: String(dto.id), name: dto.name, priceCents: dto.price_cents, ... }
}
```

**Alternativas consideradas:**

- Dejar `number` en el frontend: viola la convención del proyecto (ver `knowledge-base/05-dx/04_convenciones_y_estandares.md` §2)
- Convertir en cada componente: duplicación, fuente de bugs

**Rationale:** La convención del proyecto es clara. Centralizar la conversión en el service garantiza que ningún componente vea un `id: number`.

### 8. Formateo de precios: un solo `formatPrice` util

**Decisión:** `src/utils/price.ts` exporta:

```typescript
export function formatPrice(cents: number, locale = 'es-AR', currency = 'ARS'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100)
}
```

El `locale` y `currency` vienen de `VITE_LOCALE` y `VITE_CURRENCY` (defaults `es-AR` / `ARS`). Esto prepara el terreno para multi-moneda en el futuro sin refactor.

### 9. React Compiler habilitado

**Decisión:** Agregar `babel-plugin-react-compiler` a `vite.config.ts` como el Dashboard. Requiere `eslint-plugin-react-hooks` 7.x (ya presente). Esto desactiva efectivamente la necesidad de `useMemo`/`useCallback` manuales.

### 10. Estructura de archivos

```
pwaMenu/src/
├── App.tsx                           # RouterProvider wrapper
├── main.tsx                          # bootstrap (SW + i18n lazy)
├── router.tsx                        # createBrowserRouter + rutas lazy
├── i18n/
│   ├── index.ts                      # init + lazy loader
│   └── locales/
│       ├── es.json                   # ~120 keys
│       ├── en.json                   # mismo set
│       └── pt.json                   # mismo set
├── stores/
│   └── sessionStore.ts               # Zustand + localStorage TTL manual
├── services/
│   ├── api.ts                        # fetch wrapper con X-Table-Token
│   ├── menu.ts                       # getPublicMenu(slug)
│   └── session.ts                    # getDinerSession()
├── pages/
│   ├── ScannerPage.tsx
│   ├── SessionActivatePage.tsx
│   ├── MenuPage.tsx
│   └── NotFoundPage.tsx
├── components/
│   ├── layout/
│   │   └── AppShell.tsx              # contenedor móvil con overflow-x-hidden
│   └── menu/
│       ├── CategoryList.tsx
│       ├── SubcategorySection.tsx
│       ├── ProductCard.tsx
│       ├── SearchBar.tsx
│       └── AllergenFilter.tsx
├── hooks/
│   ├── useHydrateSession.ts          # corre al mount del router
│   └── useRequireSession.ts          # guard para rutas protegidas
├── types/
│   ├── menu.ts                       # Product, Category, Subcategory, Allergen
│   └── session.ts                    # Session, Diner
├── utils/
│   ├── logger.ts                     # (ya existe de C-01)
│   ├── price.ts                      # formatPrice
│   └── storage.ts                    # readJSON, writeJSON, clear con manejo de errores
└── tests/
    ├── setup.ts
    ├── mocks/
    │   ├── handlers.ts               # MSW handlers
    │   └── server.ts                 # MSW setupServer
    ├── stores/
    │   └── sessionStore.test.ts
    ├── pages/
    │   └── MenuPage.test.tsx
    └── i18n/
        └── completeness.test.ts      # garantiza parity es/en/pt
```

## Risks / Trade-offs

- **[Riesgo] Token en URL visible en historial antes del `replaceState`** → Mitigación: el `replaceState` se ejecuta en el primer `useEffect` de `SessionActivatePage`, antes de renderizar contenido. La ventana de exposición es < 100ms. No hay manera de eliminarla sin salir del modelo "QR estático en la mesa".
- **[Riesgo] `localStorage` no disponible (modo privado iOS antiguo, Tor, Safari con cookies bloqueadas)** → Mitigación: wrappers `readJSON`/`writeJSON` en `utils/storage.ts` capturan `QuotaExceededError` y `SecurityError`. Si falla, el store trabaja en memoria y se muestra un banner `session.persistWarning` al usuario. La sesión dura lo que dura la pestaña; el comensal debe re-escanear al volver.
- **[Riesgo] Service worker cachea por error una respuesta con error 500 o 401 como si fuera válida** → Mitigación: `cacheableResponse: { statuses: [0, 200] }` en cada runtimeCaching. Status 0 es para requests cross-origin sin CORS expuesto (imágenes externas), status 200 es la única respuesta exitosa que cacheamos.
- **[Riesgo] El idioma por defecto del dispositivo es uno no soportado (`fr`, `de`, `ja`)** → Mitigación: `supportedLngs` + `fallbackLng: 'es'` garantizan que si el detector propone un idioma fuera de la whitelist, i18next usa español.
- **[Riesgo] Drift de claves entre `es.json` / `en.json` / `pt.json` (un dev agrega una key solo en español)** → Mitigación: test automático `i18n/completeness.test.ts` que compara los 3 locales y falla si alguna key existe en uno pero no en los otros. Corre en CI.
- **[Riesgo] El scanner QR requiere HTTPS y permisos de cámara → el usuario los deniega** → Mitigación: `ScannerPage` muestra un input manual de `branchSlug` + `tableCode` como fallback, y un CTA "pedile al mozo el link" con explicación.
- **[Riesgo] El primer load del SW no precachea todo y el usuario queda sin red antes de que termine** → Mitigación: `registerType: 'autoUpdate'` + `globPatterns` que incluye los assets críticos. En la primera visita en red, Workbox precachea todo el build. Visitas offline posteriores funcionan.
- **[Trade-off] No se conecta WebSocket en este shell** → C-18 introducirá `/ws/diner` cuando haya carrito. Este shell renderiza contenido estático y eso está bien para un lector de menú. Aceptamos el trade-off para mantener el change chico.
- **[Trade-off] El TTL de 8h en cliente es más largo que el TTL real de 3h del backend** → Puede generar una "impresión" de sesión válida que al hacer la primera request devuelve 401. El manejo de 401 en `api.ts` limpia el estado y redirige a `/scan`, así que el UX se degrada pero no se rompe. El mensaje muestra "tu sesión expiró, volvé a escanear".

## Migration Plan

- **No hay migración de datos**: este change solo agrega código frontend; cero impacto en DB, cero cambios de API, cero migraciones Alembic
- **Deploy**: build estándar `npm run build` en `pwaMenu/`; nginx sirve `dist/` con SPA fallback a `index.html`
- **Rollback**: revertir el commit y redeploy del bundle anterior — la sesión en `localStorage` del usuario no depende de versiones (el esquema es simple: token + expiresAt)
- **Variables de entorno nuevas** a agregar en `.env` de producción:
  - `VITE_API_URL=https://api.buensabor.com`
  - `VITE_WS_URL=wss://ws.buensabor.com`  (declarada aunque no se consuma en este change, evita confusión en C-18)
  - `VITE_BRANCH_SLUG=default` (solo fallback para dev; en producción el slug viene del QR)
  - `VITE_LOCALE=es-AR`, `VITE_CURRENCY=ARS` (opcionales)

## Open Questions

- **Imágenes de productos**: ¿viven en S3/CDN externo o en el mismo host del backend? → Afecta el `urlPattern` del CacheFirst. **Decisión pendiente: asumimos URLs absolutas a un CDN o al backend, el `urlPattern` matchea por extensión, no por host. Si el backend sirve imágenes desde `/static/`, el patrón las cubre igual.**
- **Fuente del idioma inicial para diners recurrentes**: ¿usamos el idioma del último escaneo, el del navegador, o preguntamos? → **Decisión: detector estándar (localStorage > navigator > fallback es). No agregamos UI de selección en este change; se introduce un selector en C-18 cuando el menú tenga más superficie.**
- **¿Debería `/menu` funcionar sin sesión?** (comensal curioso que entra al dominio de la sucursal) → **Decisión: NO en este change. Sin sesión, redirect a `/scan`. Si el restaurante quiere un menú "vitrina" público pre-sesión, es un requerimiento nuevo y va a otro change.**
- **Manejo de actualización del SW cuando hay una versión nueva**: `autoUpdate` reloadea al siguiente navegación. ¿Mostramos un toast "nueva versión disponible, tocá para actualizar"? → **Decisión: por ahora auto-update silencioso (aceptable para un menú público). Si aparece una mejor UX en feedback real, se ajusta en un change posterior.**
