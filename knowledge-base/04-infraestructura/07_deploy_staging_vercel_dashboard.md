# 07. Deploy de Staging — Dashboard en Vercel

## Contexto

El **Dashboard** (`Dashboard/`) es el panel admin del sistema (gestion de productos, orders, billing, settings, etc.). React 19 + TypeScript + Vite. Despliega en Vercel apuntando al backend de EasyPanel.

Este documento captura la configuracion correcta despues de resolver los issues iniciales.

---

## Pre-requisitos

| Requisito | Detalle |
|-----------|---------|
| Repo en GitHub | mismo repo que el monorepo (es un Vite app dentro de `Dashboard/`) |
| Backend ya deployado en EasyPanel | necesitas las URLs HTTPS y WSS del backend |
| Cuenta de Vercel conectada al GitHub | OAuth, una sola vez |
| `tsconfig.app.json` en `Dashboard/` | excluye tests del build de produccion |
| `package.json` con `"build": "tsc -p tsconfig.app.json && vite build"` | ya commiteado |

---

## Configuracion del proyecto en Vercel

### 1. Importar el repo

- En Vercel: `Add New... -> Project`.
- Importar `<tu-usuario>/<tu-repo>`.
- Project name: `restaurant-dashboard` (o el que prefieras — esto define la URL `<name>-<hash>.vercel.app`).

### 2. Configure Project

| Campo | Valor |
|-------|-------|
| Framework Preset | **Vite** (Vercel lo detecta solo) |
| **Root Directory** | ⚠️ **`Dashboard`** (click "Edit" — Vercel default es la raiz del repo, hay que indicarle el subfolder) |
| Build Command | `npm run build` (default — usa el script de package.json) |
| Output Directory | `dist` |
| Install Command | `npm install` (default) |

### 3. Environment Variables

```
VITE_API_URL=https://<backend-host>.<id>.easypanel.host
VITE_WS_URL=wss://<ws-host>.<id>.easypanel.host
```

**Convencion del Dashboard**: `VITE_API_URL` **NO termina en `/api`** (los paths los pone el codigo en cada call). El backend escucha en root `/api/...` pero el Dashboard arma las URLs con prefijo en el codigo.

Comparacion con los otros frontends:

| Frontend | `VITE_API_URL` |
|----------|----------------|
| Dashboard | sin `/api` |
| pwaMenu | sin `/api` |
| pwaWaiter | **con `/api`** |

### 4. Deploy

Click `Deploy`. Vercel hace:

1. `git clone`
2. Cambia a `Dashboard/`
3. `npm install` (~60s)
4. `npm run build` que ejecuta `tsc -p tsconfig.app.json && vite build`
5. Sirve el `dist/` por CDN

Tarda ~3 min en primera vez.

---

## Issues que ya resolvimos (no deberias tropezarte)

### `tsc` falla con errores en archivos de tests

**Sintoma**: el build de Vercel falla con muchos errores tipo `Object is possibly 'undefined'` en `*.test.tsx`.

**Causa**: el `tsconfig.json` original incluye `src/` completo y tiene flags estrictos (`noUncheckedIndexedAccess`, `noUnusedLocals`). Vercel corre `tsc -b` que tipa-checka los tests tambien. Los tests con `array[0].payload` fallan porque `array[0]` puede ser `undefined`.

**Fix aplicado**: nuevo `Dashboard/tsconfig.app.json` que extiende el base y excluye tests:

```json
{
  "extends": "./tsconfig.json",
  "exclude": [
    "node_modules", "dist", "build",
    "src/**/*.test.ts", "src/**/*.test.tsx",
    "src/**/*.spec.ts", "src/**/*.spec.tsx",
    "src/**/__mocks__/**", "src/**/__tests__/**", "src/tests/**"
  ]
}
```

Y el `package.json` build script cambia a:

```json
"build": "tsc -p tsconfig.app.json && vite build"
```

`npm run type-check` (sin `-p`) sigue revisando todo, asi que en CI o local podes seguir validando types de los tests. Vercel solo corre la version filtrada.

### Errores de TS en source files

Se resolvieron en commits previos. Patrones idiomaticos aplicados:

- **Casts unsafe `Record<string, unknown> -> Foo`**: `as unknown as Foo` (silencia el warning haciendo la unsafety explicita).
- **`Type 'X | undefined' not assignable to 'X'`**: early guard al principio del bloque (`if (!id) return;`) en lugar de 7 patches con `!`.
- **`null` no asignable a `SetStateAction<T>`**: extract a variable local antes del callback (TS no narrow optional chaining dentro de `startTransition`).
- **`ref` prop sin `forwardRef`**: wrap el componente con `React.forwardRef`.

NUNCA usar `as any` o `!` blindly.

---

## Despues del deploy

### 1. Anota la URL final

Vercel te da algo tipo `https://restaurant-dashboard-xyz123.vercel.app`. Copiala.

### 2. Update CORS en EasyPanel

Volve al backend (panel de EasyPanel) y suma esta URL al ALLOWED_ORIGINS:

```
ALLOWED_ORIGINS=https://restaurant-dashboard-xyz123.vercel.app,...
WS_ALLOWED_ORIGINS=https://restaurant-dashboard-xyz123.vercel.app,...
```

Redeploy del backend para que tome los cambios.

### 3. Smoke test

Abrir el Dashboard, intentar login (si tenes user creado por el seed: `admin@admin.com` / `admin123` o similar — verificar el seed).

Si el browser bloquea con error CORS:
- Abrir DevTools -> Console
- Ver el mensaje exacto de CORS
- Verificar que la URL de Vercel este EXACTAMENTE en `ALLOWED_ORIGINS` (incluyendo `https://`, sin slash al final)

---

## Auto-deploy en push

Por default Vercel hace auto-deploy en cada push a `main`. Cada commit que toque `Dashboard/` (o cualquier archivo) dispara un nuevo build automaticamente. Si tu pipeline quiere deployar en una rama distinta, configurar en `Settings -> Git`.

---

## Referencias

- `Dashboard/package.json` — build script
- `Dashboard/tsconfig.app.json` — config para build de produccion
- `Dashboard/tsconfig.json` — config base (incluye tests, usado por `type-check`)
- `Dashboard/.env.example` — vars que el frontend espera
