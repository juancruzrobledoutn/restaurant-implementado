# e2e-critical-flow Specification

## Purpose
Playwright E2E suite that validates the full critical multi-role flow across Dashboard, pwaMenu, and pwaWaiter with all services running. Revalidates partial smokes from C-18 (task 15.4) and C-21 (task 17.4).

## Requirements

### Requirement: Playwright project structure exists at e2e/
The `e2e/` directory at monorepo root SHALL contain a `playwright.config.ts` defining 3 projects (Dashboard on port 5177, pwaMenu on port 5176, pwaWaiter on port 5178). The config SHALL set `retries: 2` in CI, `video: 'on-first-retry'`, and `screenshot: 'only-on-failure'`.

#### Scenario: Config defines all 3 app projects
- **WHEN** inspecting `e2e/playwright.config.ts`
- **THEN** it SHALL define projects for `dashboard`, `pwa-menu`, and `pwa-waiter` with their respective `baseURL` values

#### Scenario: CI retries and artifacts configured
- **WHEN** the E2E suite runs in CI (`process.env.CI` is set)
- **THEN** `retries` SHALL be 2 and failed tests SHALL produce video and screenshot artifacts

### Requirement: Auth flow spec validates JWT login for all staff roles
`e2e/tests/dashboard/auth-flow.spec.ts` SHALL verify that ADMIN, MANAGER, WAITER, and KITCHEN roles can log in via `POST /api/auth/login` and reach their respective home pages. Invalid credentials SHALL return 401.

#### Scenario: ADMIN login reaches Dashboard home
- **WHEN** an ADMIN submits valid credentials on the login page
- **THEN** the Dashboard SHALL navigate to the main page and display the branch selector

#### Scenario: Invalid credentials show error
- **WHEN** a user submits wrong password
- **THEN** the login page SHALL display an error message and stay on `/login`

#### Scenario: Access token refresh keeps session alive
- **WHEN** the access token expires (simulated via time manipulation or API mock)
- **THEN** the app SHALL silently refresh and the user SHALL remain logged in

### Requirement: Menu ordering spec revalidates C-18 partial smoke (task 15.4)
`e2e/tests/pwa-menu/menu-ordering.spec.ts` SHALL verify the complete diner flow: join table via code → register as diner → browse menu → add items to cart → propose round → all diners confirm → round submitted with status PENDING.

#### Scenario: Diner joins table and sees menu
- **WHEN** a diner navigates to pwaMenu with a valid table code and branch slug
- **THEN** the JoinTable page SHALL accept the code and navigate to the menu home

#### Scenario: Cart submit creates PENDING round
- **WHEN** a diner adds items to cart and all diners in the session confirm the round proposal
- **THEN** `POST /api/diner/rounds` SHALL return 201 with status PENDING and the cart SHALL be empty

#### Scenario: Menu respects branch slug isolation
- **WHEN** a diner joins with a branch slug
- **THEN** the menu SHALL only show products available in that branch (BranchProduct.is_available=true)

### Requirement: Kitchen flow spec validates SUBMITTED→IN_KITCHEN→READY transitions
`e2e/tests/dashboard/kitchen-flow.spec.ts` SHALL verify that a KITCHEN-role user receives a round ticket after it reaches SUBMITTED, marks it IN_KITCHEN, and then READY. The waiter SHALL receive a visual notification when the round is READY.

#### Scenario: Kitchen sees ticket after admin submits round
- **WHEN** an admin/manager transitions a round to SUBMITTED via `PATCH /api/admin/rounds/{id}`
- **THEN** the kitchen display SHALL show a new ticket with the correct table and items

#### Scenario: Kitchen marks round as READY
- **WHEN** a kitchen user patches the round to READY via `PATCH /api/kitchen/rounds/{id}`
- **THEN** the round status SHALL be READY and a ROUND_READY event SHALL be emitted

### Requirement: Waiter flow spec revalidates C-21 partial smoke (task 17.4)
`e2e/tests/pwa-waiter/waiter-flow.spec.ts` SHALL verify the complete waiter journey: login → branch assignment verification → table grid → confirm PENDING round → serve READY round → request check → close table.

#### Scenario: Waiter confirms PENDING round
- **WHEN** a waiter taps "Confirm" on a PENDING round in the table detail modal
- **THEN** `PATCH /api/waiter/rounds/{id}` SHALL respond 200 with status CONFIRMED

#### Scenario: Waiter serves READY round
- **WHEN** a waiter marks a READY round as served
- **THEN** `PATCH /api/waiter/rounds/{id}/serve` SHALL respond 200 with status SERVED

#### Scenario: Waiter closes table after full payment
- **WHEN** the check is fully paid and the waiter closes the table
- **THEN** `POST /api/waiter/tables/{id}/close` SHALL respond 200 and the table status SHALL be AVAILABLE

### Requirement: Billing flow spec validates check request through payment
`e2e/tests/pwa-menu/billing-flow.spec.ts` SHALL verify: diner requests check → `POST /api/billing/check/request` → MercadoPago preference created → MP redirect mocked via `page.route()` → payment callback → CHECK_PAID event → session status CLOSED.

#### Scenario: Diner requests check and sees MP payment link
- **WHEN** a diner navigates to the billing page and taps "Pagar con Mercado Pago"
- **THEN** the app SHALL call `POST /api/billing/mercadopago/preference` and receive a payment URL

#### Scenario: Mocked MP approval triggers CHECK_PAID
- **WHEN** the MP redirect is intercepted and the success callback URL is simulated
- **THEN** the billing page SHALL show payment approved status and the session SHALL transition to PAYING

#### Scenario: Opt-in flow works for new diner
- **WHEN** a new diner reaches the billing page without an existing customer profile
- **THEN** the opt-in form SHALL appear and submitting it SHALL create a customer record via `POST /api/customer/profile`

### Requirement: Fixtures provide isolated tenant data per spec
Each spec SHALL use a `test.beforeAll` fixture that creates a dedicated tenant, branch, sector, table, and seeded menu via API calls using `request` context. The fixture SHALL clean up (or use unique slugs) to avoid cross-spec contamination.

#### Scenario: Each spec runs independently
- **WHEN** specs are run in any order or in parallel
- **THEN** no spec SHALL depend on data created by another spec

#### Scenario: Table token generated from TABLE_TOKEN_SECRET
- **WHEN** a diner fixture needs a valid X-Table-Token
- **THEN** the fixture SHALL generate it using the same HMAC logic as the backend, reading `TABLE_TOKEN_SECRET` from the test environment

### Requirement: All 5 specs pass in CI against the Docker stack
`npx playwright test` run in the `e2e/` job SHALL exit 0 when all services are healthy. Any spec failure SHALL fail the CI job and upload test artifacts (videos, screenshots, HTML report).

#### Scenario: E2E job uploads artifacts on failure
- **WHEN** any Playwright test fails in CI
- **THEN** the GitHub Actions job SHALL upload `playwright-report/` and `test-results/` as workflow artifacts
