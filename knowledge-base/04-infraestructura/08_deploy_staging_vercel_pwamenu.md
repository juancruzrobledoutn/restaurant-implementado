# 08. Deploy de Staging — pwaMenu en Vercel

## Contexto

**pwaMenu** (`pwaMenu/`) es el menu PWA que ven los comensales — entran via QR de mesa, navegan productos, hacen pedidos, pagan con MercadoPago. React 19 + TypeScript + Vite + i18next (es/en/pt) + PWA (service worker).

Este es el frontend con MAS env vars de los tres porque integra MercadoPago. Tambien es el unico con un chicken-and-egg en `VITE_MP_RETURN_URL` que hay que actualizar despues del primer deploy.

---

## Pre-requisitos

| Requisito | Detalle |
|-----------|---------|
| Repo en GitHub | mismo monorepo |
| Backend en EasyPanel deployado | necesitas URLs HTTPS y WSS |
| MercadoPago test app creada | necesitas la `public_key` (TEST) — la access_token va en el backend, NO aca |
| `vite-plugin-pwa@^1.0.0` en package.json | la 0.21.x no soporta Vite 7 (ver Issues abajo) |
| `tsconfig.app.json` en `pwaMenu/` | excluye tests del build de produccion |

---

## Configuracion del proyecto en Vercel

### 1. Importar

- `Add New... -> Project`
- Mismo repo
- Project name: `restaurant-pwamenu` (o el que quieras)

### 2. Configure Project

| Campo | Valor |
|-------|-------|
| Framework Preset | **Vite** |
| **Root Directory** | ⚠️ **`pwaMenu`** (click "Edit") |
| Build Command | `npm run build` (default) |
| Output Directory | `dist` |

### 3. Environment Variables

```
VITE_API_URL=https://<backend-host>.<id>.easypanel.host
VITE_WS_URL=wss://<ws-host>.<id>.easypanel.host
VITE_BRANCH_SLUG=demo
VITE_LOCALE=es-AR
VITE_CURRENCY=ARS
VITE_MP_PUBLIC_KEY=TEST-xxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
VITE_MP_RETURN_URL=https://temp-placeholder.vercel.app/payment/result
VITE_ENABLE_SPLIT_METHODS=false
```

**Notas criticas:**

- **`VITE_API_URL` SIN `/api` al final.** El codigo arma los paths.
- **`VITE_WS_URL` con `wss://`** (WebSocket Secure), no `ws://`. Es obligatorio: una pagina servida por HTTPS no puede abrir conexiones `ws://` sin TLS — el browser bloquea.
- **`VITE_MP_PUBLIC_KEY`**: el TEST public key de MercadoPago (formato `TEST-...` o `APP_USR-...` segun cuenta). Lo encontras en el panel de MP en "Credenciales -> Test".
  - ⚠️ NUNCA pongas la **access_token** (privada) aca — eso es backend-only.
  - Public key es safe para frontend.
- **`VITE_MP_RETURN_URL`**: chicken-and-egg. Despues del primer deploy lo actualizas (ver abajo).
- **`VITE_BRANCH_SLUG=demo`**: el slug de la sucursal seed (`Sucursal Central`, slug `demo`). Si renombraste la sucursal o estas usando otra, ajustar al slug real (verificar en `backend/rest_api/seeds/tenants.py` -> `BRANCH_SLUG`).
- **`VITE_LOCALE` y `VITE_CURRENCY`**: defaults para Argentina. Cambiarlos si el staging es para un mercado distinto.
- **`VITE_ENABLE_SPLIT_METHODS=false`**: feature flag para metodos de pago split (por consumo, custom). Off por default.

### 4. Deploy

Click `Deploy`. Tarda ~4 min (PWA build genera service worker y precache).

---

## Despues del primer deploy

### 1. Capturar URL final

Vercel te da algo como `https://restaurant-pwamenu-xyz123.vercel.app`.

### 2. Actualizar VITE_MP_RETURN_URL

Volve a Vercel -> el proyecto pwaMenu -> Settings -> Environment Variables.

Editar `VITE_MP_RETURN_URL`:

```
VITE_MP_RETURN_URL=https://restaurant-pwamenu-xyz123.vercel.app/payment/result
```

Ese path `/payment/result` es donde MP redirige al usuario despues de un cobro.

### 3. Redeploy

Vercel necesita un nuevo build para que la env var nueva quede compilada en el bundle. `Deployments -> ... del ultimo deploy -> Redeploy`.

### 4. Update CORS en EasyPanel

```
ALLOWED_ORIGINS=...,https://restaurant-pwamenu-xyz123.vercel.app
WS_ALLOWED_ORIGINS=...,https://restaurant-pwamenu-xyz123.vercel.app
```

Redeploy backend.

### 5. Configurar webhook de MP (opcional para staging)

Si queres que el backend reciba notificaciones de cambio de estado de pago (no solo el redirect), configurar en el panel de MP:

```
Webhook URL: https://<backend-host>.<id>.easypanel.host/api/billing/mercadopago/webhook
```

Sin esto, los pagos siguen funcionando — solo dependen del redirect del cliente.

---

## Issues que ya resolvimos

### Build falla con `ERESOLVE` (vite-plugin-pwa vs Vite 7)

**Sintoma**: `npm install` falla con `npm error code ERESOLVE`:

```
While resolving: vite-plugin-pwa@0.21.2
Found: vite@7.3.2
```

**Causa**: la version 0.21.x de `vite-plugin-pwa` declara peerDeps de Vite 5.x. Cuando el repo subio a Vite 7, este plugin quedo incompatible.

**Fix aplicado**: bump a `vite-plugin-pwa@^1.2.0`. Esa version declara `vite: '^3.1.0 || ^4.0.0 || ^5.0.0 || ^6.0.0 || ^7.0.0'` en peerDeps.

### Build falla con TypeScript en `session.ts`

**Sintoma**:

```
src/services/session.ts(28,5): error TS2322: Type 'string' is not assignable to type '"expired" | "active" | "closed"'.
```

**Causa**: el DTO de la API devuelve `status: string` pero el tipo del frontend espera literal union.

**Fix aplicado**: narrowing explicito con `as Session['status']`. Acceptable para staging — para prod conviene un type guard de runtime.

---

## Service Worker — caches y deploys

pwaMenu es PWA. El service worker cachea agresivamente. Despues de un deploy:

- Los browsers que ya tenian el SW pueden seguir viendo la version vieja durante un rato (hasta el proximo `skipWaiting`).
- En staging puede confundir al equipo durante testing.

**Workaround para testers**: pedirles "hard refresh" (Ctrl+Shift+R) o abrir en pestana incognita despues de cada deploy.

---

## Referencias

- `pwaMenu/package.json` — `vite-plugin-pwa: ^1.2.0`
- `pwaMenu/tsconfig.app.json` — exclusiones de tests
- `pwaMenu/.env.example` — todas las VITE_* vars
- `pwaMenu/src/services/session.ts` — narrowing de status
- Knowledge-base de payments: `02-arquitectura/05_pagos_y_cobros.md`
