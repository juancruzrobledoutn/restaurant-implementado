## 1. Scaffolding y configuración Playwright

- [x] 1.1 Crear `e2e/` en la raíz del monorepo: `npm init playwright@latest` — TypeScript, no example tests, no GitHub Actions (se configura a mano)
- [x] 1.2 Ajustar `e2e/package.json`: agregar `@playwright/test`, `dotenv`. Agregar scripts: `test`, `test:headed`, `test:debug`, `test:report`
- [x] 1.3 Escribir `e2e/playwright.config.ts`: 3 proyectos (dashboard :5177, pwa-menu :5176, pwa-waiter :5178), `retries: process.env.CI ? 2 : 0`, `video: 'on-first-retry'`, `screenshot: 'only-on-failure'`, `timeout: 30_000`
- [~] 1.4 Crear `e2e/.env.test` (no commitear): requiere valores reales del entorno local. Ver `.env.test.example` como plantilla.
- [x] 1.5 Crear `e2e/.env.test.example` (sí commitear) con los mismos keys pero sin valores reales. Agregar `e2e/.env.test` al `.gitignore` raíz

## 2. Fixtures y helpers

- [x] 2.1 Crear `e2e/fixtures/api.ts`: clase `ApiHelper` que hace POST/PATCH/GET contra `API_URL` con `Authorization: Bearer <admin_token>`. Métodos: `login(email, password)`, `createTenant(name)`, `createBranch(tenantId, data)`, `createCategory(branchId, data)`, `createProduct(subcatId, data)`, `createBranchProduct(productId, branchId, data)`, `activateTable(tableId)`, `createSector(branchId, name)`, `createTable(sectorId, branchId, data)`
- [x] 2.2 Crear `e2e/fixtures/table-token.ts`: función `generateTableToken(sessionId, dinerId, tenantId, tableCode, branchSlug, secret)` que replica el HMAC del backend usando `crypto` de Node. Leer `TABLE_TOKEN_SECRET` del env.
- [x] 2.3 Crear `e2e/fixtures/seed.ts`: fixture `test.beforeAll` que crea un tenant aislado + branch + sector + table + category + subcategory + 2 products + BranchProduct via `ApiHelper`. Devuelve `{ tenant, branch, sector, table, product_a, product_b, adminToken, waiterToken, kitchenToken }`.
- [x] 2.4 Crear `e2e/fixtures/index.ts`: exporta `test` extendido con el fixture `seed` usando `test.extend<{ seed: SeedResult }>({ seed: [seedFixture, { scope: 'test' }] })`

## 3. Spec: auth-flow

- [x] 3.1 Crear `e2e/tests/dashboard/auth-flow.spec.ts`. Test: ADMIN login con credenciales válidas → navega a `/` → ve branch selector. Usar `page.goto('/login')`, `page.fill`, `page.click`, `page.waitForURL`
- [x] 3.2 Test: credenciales inválidas → mensaje de error visible en la página, URL permanece `/login`
- [x] 3.3 Test: WAITER login → navega a MainPage de pwaWaiter (puerto 5178). KITCHEN login → navega a kitchen view
- [x] 3.4 Test: access token refresh — mockear respuesta de `/api/auth/refresh` con `page.route()` para verificar que la app llama al endpoint antes del vencimiento

## 4. Spec: menu-ordering (revalida C-18 task 15.4)

- [x] 4.1 Crear `e2e/tests/pwa-menu/menu-ordering.spec.ts`. Setup: usar fixture `seed` + crear tabla session via `POST /api/tables/code/{code}/session` con el `ApiHelper`
- [x] 4.2 Test: diner navega a pwaMenu con `?branch={slug}&table={code}` → JoinTable acepta el código → diner es redirigido al menú home
- [x] 4.3 Test: diner agrega un producto al carrito → `POST /api/diner/cart` exitoso → item aparece en el cart UI. Verificar que `GET /api/public/menu/{slug}` solo devuelve productos con `is_available=true`
- [x] 4.4 Test: diner hace submit del carrito → `POST /api/diner/rounds` devuelve 201 con `status: "PENDING"` → carrito queda vacío en la UI. (Revalida C-18 task 15.4)
- [x] 4.5 Test: diner de otro tenant no puede usar el mismo table code (tenant isolation)

## 5. Spec: kitchen-flow

- [x] 5.1 Crear `e2e/tests/dashboard/kitchen-flow.spec.ts`. Setup: crear ronda en CONFIRMED via `ApiHelper` (crear sesión → crear ronda waiter → confirmar)
- [x] 5.2 Test: admin hace PATCH a `SUBMITTED` → `PATCH /api/admin/rounds/{id}` con `{status:"SUBMITTED"}` → ronda en SUBMITTED, outbox event existe
- [x] 5.3 Test: kitchen user ve el ticket → login KITCHEN en pwaWaiter/Dashboard → espera evento WS `ROUND_SUBMITTED` → ticket aparece en kitchen display. Usar `page.waitForResponse` o `expect.poll`
- [x] 5.4 Test: kitchen marca IN_KITCHEN → `PATCH /api/kitchen/rounds/{id}` con `{status:"IN_KITCHEN"}` → status actualizado
- [x] 5.5 Test: kitchen marca READY → `PATCH /api/kitchen/rounds/{id}` con `{status:"READY"}` → status READY, outbox event `ROUND_READY` existe

## 6. Spec: waiter-flow (revalida C-21 task 17.4)

- [x] 6.1 Crear `e2e/tests/pwa-waiter/waiter-flow.spec.ts`. Setup: crear ronda en PENDING via `ApiHelper`. Crear asignación de sector para el waiter del día actual.
- [x] 6.2 Test: waiter login → `GET /api/waiter/verify-branch-assignment` exitoso → MainPage carga con grilla de mesas
- [x] 6.3 Test: waiter confirma ronda PENDING → toca la mesa → TableDetailModal muestra ronda → toca "Confirmar" → `PATCH /api/waiter/rounds/{id}` 200 con status CONFIRMED. (Revalida C-21 task 17.4 — parte confirm)
- [x] 6.4 Test: waiter sirve ronda READY → setup ronda en READY via API → waiter toca "Servido" → `PATCH /api/waiter/rounds/{id}/serve` 200 con status SERVED. (Revalida C-21 task 17.4 — parte serve)
- [x] 6.5 Test: waiter cierra mesa → solicitar check via API → pagar via API → waiter toca "Cerrar mesa" → `POST /api/waiter/tables/{id}/close` 200 → mesa vuelve a AVAILABLE

## 7. Spec: billing-flow

- [x] 7.1 Crear `e2e/tests/pwa-menu/billing-flow.spec.ts`. Setup: sesión con ronda SERVED via `ApiHelper`. Diner con `table_token` generado por `generateTableToken`.
- [x] 7.2 Test: diner solicita cuenta → `POST /api/billing/check/request` → sesión pasa a PAYING → UI de billing muestra el monto total correcto
- [x] 7.3 Test: diner toca "Pagar con Mercado Pago" → app llama `POST /api/billing/mercadopago/preference` → interceptar redirect con `page.route('**/mercadopago.com/**', ...)` → simular callback de pago aprobado
- [x] 7.4 Test: opt-in flow — diner sin customer profile llega a billing → `OptInForm` visible → submit → `POST /api/customer/profile` exitoso → customer.opted_in = true
- [x] 7.5 Test: pago rechazado — mockear callback MP con `status=rejected` → UI muestra mensaje de error con CTA de reintento

## 8. CI integration

- [x] 8.1 Agregar job `e2e` en `.github/workflows/ci.yml`:
  ```yaml
  e2e:
    needs: [backend, dashboard, pwa-menu, pwa-waiter]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - name: Cache Playwright browsers
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ hashFiles('e2e/package-lock.json') }}
      - run: npm ci
        working-directory: e2e
      - run: npx playwright install --with-deps chromium
        working-directory: e2e
      - name: Start stack
        run: docker-compose up -d
      - name: Wait for backend
        run: npx wait-on http://localhost:8000/api/health --timeout 60000
      - name: Run E2E tests
        run: npx playwright test
        working-directory: e2e
        env:
          CI: true
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: e2e/playwright-report/
          retention-days: 7
  ```
- [x] 8.2 Instalar `wait-on` en `e2e/package.json` como devDependency. Verificar que `npx wait-on` funciona contra `/api/health`.
- [~] 8.3 Verificar que `docker-compose.yml` expone los puertos correctos (8000, 8001, 5432, 6380) — verificación manual al correr el stack localmente.
- [x] 8.4 Agregar variables de entorno de test en el job `e2e` del ci.yml: `TABLE_TOKEN_SECRET`, `API_URL`, `BASE_URL_*`

## 9. Validación local y documentación

- [~] 9.1 Smoke local: `docker-compose up -d && cd e2e && npm install && npx playwright test --headed` — todos los specs pasan en browser visible
- [~] 9.2 Verificar que `npx playwright test --reporter=html && npx playwright show-report` genera reporte navegable con resultados de los 5 specs
- [x] 9.3 Actualizar `openspec/CHANGES.md`: marcar C-22 como `[x]` en la tabla de resumen
- [ ] 9.4 Ejecutar `/opsx:archive e2e-critical-flow` para sync de specs a main y archivar el change
