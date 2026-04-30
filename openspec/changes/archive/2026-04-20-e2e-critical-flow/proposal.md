## Why

Con C-16, C-19, C-21 y C-24 completos, el sistema tiene todas las piezas del flujo crítico implementadas pero nunca validadas end-to-end: ningún test ejercita el camino real login → mesa → QR → pedido → cocina → pago con todos los servicios corriendo. Los smokes manuales de C-18 (task 15.4) y C-21 (task 17.4) quedaron parciales y deben revalidarse de forma automatizada.

## What Changes

- Suite Playwright en `e2e/` con 5 specs que cubren el flujo multi-rol completo
  - `auth-flow.spec.ts`: login JWT staff (ADMIN/MANAGER/WAITER/KITCHEN), refresh token, 401 sin credenciales
  - `menu-ordering.spec.ts`: join de mesa via QR → carrito compartido → propuesta de ronda → submit (revalida C-18 task 15.4)
  - `kitchen-flow.spec.ts`: login cocina → recibe ticket SUBMITTED → marca IN_KITCHEN → READY
  - `waiter-flow.spec.ts`: login mozo → grilla de mesas → confirmar ronda PENDING → servir READY → cerrar mesa (revalida C-21 task 17.4)
  - `billing-flow.spec.ts`: solicitud de cuenta → pago MercadoPago mock → CHECK_PAID → TABLE_CLEARED
- `e2e/playwright.config.ts`: 3 proyectos (Dashboard :5177, pwaMenu :5176, pwaWaiter :5178), baseURL, retries, video on failure
- `e2e/fixtures/` y `e2e/helpers/`: auth helpers, table token factory, API seed helpers
- Job `e2e` en `.github/workflows/ci.yml`: corre con `docker-compose up -d`, `playwright install`, depende de los 4 jobs paralelos existentes

## Capabilities

### New Capabilities
- `e2e-critical-flow`: Suite Playwright que valida el flujo completo multi-rol (diner → waiter → kitchen → admin/manager → billing) con todos los servicios levantados

### Modified Capabilities
- `ci-pipeline`: Se agrega job `e2e` que depende de los 4 jobs paralelos actuales (backend, Dashboard, pwaMenu, pwaWaiter) y corre la suite Playwright contra el stack real en Docker Compose

## Impact

- `e2e/` — directorio nuevo en la raíz del monorepo (Playwright, Node 22)
- `.github/workflows/ci.yml` — nuevo job `e2e` con servicios Docker
- `docker-compose.yml` — sin cambios (se usa tal cual para CI)
- No afecta código de producción ni migraciones
