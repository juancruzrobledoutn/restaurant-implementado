# 09. Deploy de Staging — pwaWaiter en Vercel

## Contexto

**pwaWaiter** (`pwaWaiter/`) es la app movil del mesero — gestiona mesas, recibe llamadas de comensales, toma pedidos rapidos, marca rondas como entregadas. React 19 + TypeScript + Vite + PWA + push notifications.

Es el frontend mas simple de configurar (menos env vars, sin MercadoPago) PERO tiene una particularidad: **`VITE_API_URL` lleva `/api` al final**, distinto a Dashboard y pwaMenu.

---

## Pre-requisitos

| Requisito | Detalle |
|-----------|---------|
| Repo en GitHub | mismo monorepo |
| Backend en EasyPanel deployado | necesitas las URLs |
| `vite-plugin-pwa@^1.0.0` en package.json | mismo issue de Vite 7 que pwaMenu, mismo fix |
| `tsconfig.app.json` en `pwaWaiter/` | excluye tests del build de produccion |

---

## Configuracion del proyecto en Vercel

### 1. Importar

- `Add New... -> Project`
- Mismo repo
- Project name: `restaurant-pwawaiter`

### 2. Configure Project

| Campo | Valor |
|-------|-------|
| Framework Preset | **Vite** |
| **Root Directory** | ⚠️ **`pwaWaiter`** |
| Build Command | `npm run build` (default) |
| Output Directory | `dist` |

### 3. Environment Variables

```
VITE_API_URL=https://<backend-host>.<id>.easypanel.host/api
VITE_WS_URL=wss://<ws-host>.<id>.easypanel.host
```

**⚠️ DIFERENCIA CRITICA con Dashboard y pwaMenu:**

```
VITE_API_URL=...../api    <-- pwaWaiter SI lleva /api al final
```

Si lo poneas sin `/api`, las requests del waiter se rompen porque el codigo asume que la base URL ya incluye el prefijo.

Resumen comparativo de los 3 frontends:

| Frontend | `VITE_API_URL` ends with `/api`? |
|----------|---------------------------------|
| Dashboard | NO |
| pwaMenu | NO |
| pwaWaiter | **SI** |

### 4. Deploy

Click `Deploy`. Tarda ~3 min.

---

## Despues del deploy

### 1. Capturar URL

Tipo `https://restaurant-pwawaiter-xyz123.vercel.app`.

### 2. Update CORS en EasyPanel

```
ALLOWED_ORIGINS=...,https://restaurant-pwawaiter-xyz123.vercel.app
WS_ALLOWED_ORIGINS=...,https://restaurant-pwawaiter-xyz123.vercel.app
```

Redeploy backend.

### 3. Smoke test

Abrir el waiter, intentar login con un user de role `WAITER` creado por el seed. Verificar que:

- Login responde 200
- Tras login se conecta al WebSocket (DevTools -> Network -> WS, deberia ver `wss://...?token=...`)
- Las mesas aparecen en la lista

---

## Push notifications

pwaWaiter usa push notifications para avisar al mesero cuando un comensal llama a la mesa o cuando hay un evento que requiere atencion. Para que funcionen en staging:

### Requisitos del lado del browser

- HTTPS — Vercel ya lo da automaticamente.
- Permiso del usuario — la app pide permiso al hacer login (o despues, segun la UX).
- Service Worker registrado — automatico via vite-plugin-pwa.

### Requisitos del lado del backend

- VAPID keys configuradas (publica + privada). Sin esto, los pushes no se firman y el browser los rechaza.
- Las VAPID keys van en env vars del backend, NO en el frontend.

Si las VAPID keys del backend no estan configuradas, el resto del waiter funciona pero las notificaciones no llegan. No es bloqueante para testear flow de mesas y rondas.

---

## Issues que ya resolvimos

### `vite-plugin-pwa` vs Vite 7

Mismo problema que pwaMenu (la 0.21.x no soporta Vite 7). Fix: bump a `^1.2.0` en package.json. Ya commiteado.

### TypeScript: variable declarada y no usada en tests

**Sintoma**:

```
src/tests/pages/TableDetailPage.test.tsx(140,11): error TS6133: 'submitButton' is declared but its value is never read.
```

**Causa**: flag `noUnusedLocals` activo, test tenia un `const submitButton = ...` huerfano.

**Fix aplicado**: el `tsconfig.app.json` excluye `src/tests/**`, asi que el build de produccion no se rompe por errores en tests. El test sigue corriendo via vitest (que tiene su propio chequeo).

---

## Auto-deploy en push

Cualquier commit a `main` que toque `pwaWaiter/` (o cualquier archivo del repo) dispara auto-deploy. Vercel solo rebuildea si detecta cambios relevantes (con cache de install) — en general queda rapido.

---

## Referencias

- `pwaWaiter/package.json` — `vite-plugin-pwa: ^1.2.0`
- `pwaWaiter/tsconfig.app.json` — exclusiones de tests
- `pwaWaiter/.env.example` — convencion `/api` en VITE_API_URL
- Knowledge-base de eventos: `02-arquitectura/04_eventos_y_websocket.md`
