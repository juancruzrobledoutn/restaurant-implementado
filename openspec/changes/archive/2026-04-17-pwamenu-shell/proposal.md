## Why

pwaMenu necesita un **shell funcional** que permita a un comensal (diner) sentarse en la mesa, escanear el QR, ver el menú en su idioma y navegar la carta — ANTES de poder implementar carrito compartido, pedidos y pago (C-18, C-19). Hoy el proyecto tiene solo el scaffold Vite/React/PWA de C-01: App vacío, `i18n/index.ts` con 3 keys y ninguna integración con backend. Este change es el bloque mínimo sobre el cual se construye toda la experiencia del comensal: autenticación por Table Token HMAC, sesión con TTL de 8h en `localStorage`, menú público con imágenes y filtros, service worker con estrategias diferenciadas para assets vs API, y traducciones reales es/en/pt. Sin este shell, el resto de la PWA no puede existir.

## What Changes

- **Auth del comensal por Table Token** (HMAC, 3h, `X-Table-Token` header) — cliente API con envío automático del token y manejo de 401/expiración
- **Flujo de activación por QR**: ruta `/t/:branchSlug/:tableCode?token=...` que extrae y persiste el Table Token en `sessionStore`
- **Escáner QR in-app** como fallback (ruta `/scan`) usando `@zxing/browser` o API `BarcodeDetector` nativa
- **`sessionStore` (Zustand) con TTL de 8h** sobre `localStorage`: token, diner info, branch slug, `expiresAt`. Verificación de expiración al cargar la app y auto-clear si venció.
- **Menú público**: página `/menu` que llama `GET /api/public/menu/{VITE_BRANCH_SLUG}`, renderiza categorías → subcategorías → productos, con filtros (búsqueda por nombre, filtro por alérgenos) y precios en centavos formateados
- **Service worker robusto**: `CacheFirst` para assets estáticos (imágenes, iconos, fonts), `NetworkFirst` para rutas `/api/public/*`, exclusión explícita de `/api/diner/*` (mutaciones nunca se cachean), fallback offline (`fallback-product.svg`, `default-avatar.svg`)
- **i18n real es/en/pt con lazy loading**: separar `locales/{es,en,pt}.json` en bundles lazy (code-split por idioma), detector que valida el idioma contra whitelist (anti-injection), ~120 keys iniciales cubriendo `common`, `app`, `menu`, `session`, `scanner`, `error`
- **`babel-plugin-react-compiler`** habilitado en `vite.config.ts` (como Dashboard) para memoización automática
- **Cliente API centralizado** (`src/services/api.ts`): inyecta `X-Table-Token`, maneja errores 401 (limpia sesión + redirige a `/scan`), convierte IDs int→string en el boundary, convierte precios cents→dollars
- **Layout móvil estricto**: `overflow-x-hidden w-full max-w-full` en contenedores raíz, safe-area insets para iOS
- **Tests con Vitest**: `sessionStore` (TTL vencido limpia, TTL vigente conserva, expiresAt se persiste), carga de menú con MSW mock, i18n completeness check (todas las keys presentes en es/en/pt)
- **Variables de entorno** (`.env.example`): `VITE_API_URL`, `VITE_WS_URL`, `VITE_BRANCH_SLUG` (fallback para desarrollo, no se usa en producción — se deriva del QR)

Governance: **BAJO** — ningún flujo crítico (pagos, alérgenos, auth staff) toca este change; el Table Token lo emite el backend en C-08 que ya está archivado.

## Capabilities

### New Capabilities
- `pwamenu-foundation`: Shell de la PWA del comensal. Cubre bootstrap del proyecto con PWA service worker (CacheFirst/NetworkFirst), i18n es/en/pt con lazy loading, `sessionStore` con TTL de 8h sobre `localStorage`, cliente API con Table Token HMAC, flujo de activación por QR (deep link + scanner in-app), visualización del menú público, layout móvil y testing base.

### Modified Capabilities

Ninguna. `frontend-foundation` describe convenciones generales de los 3 frontends (ya cumplidas por C-01) y no necesita modificarse — las reglas específicas de pwaMenu son **adicionales** (i18n completa, Table Token, overflow móvil) y viven en la nueva capability.

## Impact

- **Afectado**: `pwaMenu/` completo
  - `pwaMenu/src/App.tsx` — reescribir con React Router + lazy routes
  - `pwaMenu/src/main.tsx` — registrar service worker, cargar i18n lazy
  - `pwaMenu/src/i18n/` — expandir con lazy chunks y ~120 keys en es/en/pt
  - `pwaMenu/src/stores/sessionStore.ts` — nuevo
  - `pwaMenu/src/services/api.ts` — nuevo (cliente REST con Table Token)
  - `pwaMenu/src/services/menu.ts` — nuevo (wrapper de `/api/public/menu/:slug`)
  - `pwaMenu/src/pages/{ScannerPage,MenuPage,SessionActivatePage,NotFoundPage}.tsx` — nuevas
  - `pwaMenu/src/components/menu/{CategoryList,ProductCard,SearchBar,AllergenFilter}.tsx` — nuevos
  - `pwaMenu/src/types/{menu,session}.ts` — interfaces de dominio del frontend
  - `pwaMenu/vite.config.ts` — actualizar Workbox runtimeCaching (CacheFirst assets + NetworkFirst API) y agregar `babel-plugin-react-compiler`
  - `pwaMenu/public/{fallback-product.svg,default-avatar.svg}` — nuevos assets
  - `pwaMenu/.env.example` — nuevas variables
  - `pwaMenu/package.json` — nuevas deps: `react-router-dom` (v7), `@zxing/browser`, `babel-plugin-react-compiler`, `msw` (dev)
  - `pwaMenu/src/tests/` — tests de sessionStore, MenuPage, i18n completeness
- **Dependencias backend (ya archivadas, solo consumir)**:
  - `GET /api/public/menu/{slug}` (C-04 menu-catalog)
  - `POST /api/waiter/tables/{id}/activate` → emite Table Token (C-08 table-sessions, consumido indirectamente: el QR pegado en la mesa embebe el token ya emitido)
  - `GET /api/diner/session` (C-08, para validar el token cargado al refrescar)
  - Header `X-Table-Token` validado por backend (C-08 middleware ya existente)
- **Sin cambios backend** — este change es 100% frontend, consume APIs ya archivadas
- **Sin migraciones** — pwaMenu no toca la base de datos
- **Riesgos**:
  - Service worker mal configurado puede cachear mutaciones → mitigación: allowlist explícita de rutas `/api/public/*` en runtimeCaching + exclusión de otras
  - Table Token en URL como query param es sensible a logs de navegador → mitigación: copiar el token a `sessionStore` y limpiar la URL via `history.replaceState` inmediatamente después de la activación
  - Scanner QR requiere HTTPS en producción (permisos de cámara) — dev OK con `localhost`
  - `localStorage` puede estar deshabilitado (modo privado iOS) → fallback a estado en memoria con warning al usuario
