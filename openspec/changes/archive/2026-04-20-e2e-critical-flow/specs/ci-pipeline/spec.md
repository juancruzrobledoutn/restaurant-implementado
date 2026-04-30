# ci-pipeline Specification (delta — C-22)

## ADDED Requirements

### Requirement: E2E job runs Playwright after all parallel jobs pass
The `.github/workflows/ci.yml` SHALL define a 5th job `e2e` that runs after the 4 existing parallel jobs complete successfully. The job SHALL use `needs: [backend, dashboard, pwa-menu, pwa-waiter]` and run on `ubuntu-latest`.

#### Scenario: E2E job is skipped if any parallel job fails
- **WHEN** any of the 4 parallel jobs (backend, dashboard, pwa-menu, pwa-waiter) fails
- **THEN** the `e2e` job SHALL be skipped (GitHub Actions `needs` semantic)

#### Scenario: E2E job starts Docker stack and waits for health
- **WHEN** the E2E job begins
- **THEN** it SHALL run `docker-compose up -d`, wait for backend health (`/api/health` returns 200) with a 60-second timeout, then run `npx playwright test` from `e2e/`

#### Scenario: E2E job uploads artifacts on failure
- **WHEN** any Playwright test fails
- **THEN** the job SHALL upload `e2e/playwright-report/` and `e2e/test-results/` as workflow artifacts with retention of 7 days

### Requirement: Playwright browsers are cached in CI
The `e2e` CI job SHALL cache Playwright browser binaries using `actions/cache` keyed on the Playwright version and OS. On cache miss it SHALL run `npx playwright install --with-deps chromium`.

#### Scenario: Browser cache hit skips install
- **WHEN** the Playwright version has not changed since the last run
- **THEN** browser installation SHALL be skipped and the cached binaries SHALL be used
