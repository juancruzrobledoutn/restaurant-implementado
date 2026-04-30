## Context

Todos los componentes del flujo crítico están implementados (C-16 Dashboard-ops, C-19 pwaMenu-billing, C-21 pwaWaiter-ops, C-24 fixes). Los smokes manuales de C-18 (task 15.4: menu ordering) y C-21 (task 17.4: flujo multi-rol completo) quedaron marcados `[~]` por requerir múltiples servicios corriendo simultáneamente. No existe ningún test que valide el flujo end-to-end cruzando las tres apps y el backend real.

La suite E2E vive en `e2e/` en la raíz del monorepo y usa Playwright. El CI ya tiene 4 jobs paralelos definidos en `.github/workflows/ci.yml`; se agrega un 5to job `e2e` que depende de los cuatro y corre contra el stack Docker real.

## Goals / Non-Goals

**Goals:**
- Validar el flujo crítico completo con todos los servicios corriendo (no mocks)
- Revalidar los smokes parciales de C-18 y C-21 con Playwright automatizado
- Tener E2E en CI que falle el pipeline si el flujo principal se rompe
- 5 specs independientes, cada uno ejercita un slice del flujo multi-rol

**Non-Goals:**
- Tests de carga o performance
- Cobertura completa de todos los endpoints (eso es pytest)
- Tests de accesibilidad automatizados (son manuales, task 11.x de C-15)
- Reemplazar los unit tests de Vitest/pytest

## Decisions

### D-01: Un solo `e2e/` en la raíz, no uno por app

**Decisión**: Directorio único `e2e/` con subdirectorios `tests/dashboard/`, `tests/pwa-menu/`, `tests/pwa-waiter/`.

**Por qué**: El flujo crítico cruza las tres apps (diner en pwaMenu, waiter en pwaWaiter, kitchen en Dashboard). Tener un único `playwright.config.ts` con múltiples proyectos permite coordinar los 3 browsers en el mismo test con `test.step()` y `request` context.

**Alternativa descartada**: E2E por app (3 configs separadas). Fragmenta los tests multi-rol y complica el CI.

### D-02: Seed via API, no SQL directo

**Decisión**: Los fixtures crean datos a través de los endpoints de la API (`/api/admin/...`) usando `request` context de Playwright, no INSERT directo.

**Por qué**: Ejercita los endpoints de setup, no requiere acceso a la BD en el runner de CI, y falla visiblemente si un endpoint de creación se rompe.

**Alternativa descartada**: SQL seed script. Rápido, pero bypassea la lógica de negocio y oculta bugs en endpoints de creación.

### D-03: MercadoPago mock via intercept, no sandbox real

**Decisión**: En `billing-flow.spec.ts`, interceptar las llamadas a MP con `page.route()` y devolver respuesta simulada de pago aprobado.

**Por qué**: MP sandbox requiere credenciales reales, es lento (~10s por redirect) y flaky. El contrato backend↔MP ya está testeado en unit tests de C-19.

**Alternativa descartada**: MP sandbox completo. Tiene mucho valor para smoke manual pero es inapropiado para CI automatizado.

### D-04: Videos on failure, no siempre

**Decisión**: `video: 'on-first-retry'` en playwright.config.ts, screenshots `only-on-failure`.

**Por qué**: Videos siempre aumentan el tiempo de CI en ~40% y consumen espacio. On-first-retry captura el problema sin el overhead constante.

### D-05: Job E2E sequential después de los 4 paralelos

**Decisión**: Job `e2e` en CI con `needs: [backend, dashboard, pwa-menu, pwa-waiter]`.

**Por qué**: No tiene sentido correr E2E si algún job paralelo falló. El orden garantiza que unit tests y builds están OK antes de levantar el stack.

## Risks / Trade-offs

- **[Flakiness por timing de WebSocket]** → Usar `waitForEvent` y `expect.poll()` en lugar de `waitForTimeout`. Retry 2 veces en CI.
- **[Docker Compose slow start en CI]** → `wait-on` con health checks antes de correr Playwright. Timeout de 60s para que todos los servicios estén ready.
- **[Table token HMAC en fixtures]** → Exponer un endpoint de test `/api/test/table-token` solo en `ENVIRONMENT=test`, o generar el token en el fixture con la misma lógica que el backend.
- **[Datos compartidos entre specs]** → Cada spec crea su propio tenant/branch en el fixture setup. Sin dependencia de orden de ejecución.

## Migration Plan

1. Crear `e2e/` con `npm init playwright@latest` — elige TypeScript, no usa examples
2. Configurar `playwright.config.ts` con los 3 proyectos y baseURLs locales
3. Crear fixtures y helpers de autenticación
4. Implementar los 5 specs en orden de dependencia: auth → ordering → kitchen → waiter → billing
5. Agregar job `e2e` al `ci.yml` existente
6. Smoke manual local: `docker-compose up -d && cd e2e && npx playwright test`

**Rollback**: El job E2E es aditivo — si falla se puede deshabilitar con `if: false` en el yml sin afectar los 4 jobs paralelos existentes.

## Open Questions

- *(resuelto)* MercadoPago: usar mock via `page.route()` — no sandbox real en CI
- *(resuelto)* Table token: generarlo en fixture con `TABLE_TOKEN_SECRET` del `.env.test`
