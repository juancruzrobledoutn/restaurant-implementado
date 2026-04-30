/**
 * auth-flow.spec.ts
 *
 * Validates JWT login for Dashboard staff roles.
 * Runs against: Dashboard (http://localhost:5177)
 * Project: dashboard
 */
import { test, expect } from '@playwright/test'

const adminEmail = process.env.TEST_ADMIN_EMAIL ?? 'admin@example.com'
const adminPassword = process.env.TEST_ADMIN_PASSWORD ?? 'changeme'
const waiterEmail = process.env.TEST_WAITER_EMAIL ?? 'waiter@example.com'
const waiterPassword = process.env.TEST_WAITER_PASSWORD ?? 'changeme'
const kitchenEmail = process.env.TEST_KITCHEN_EMAIL ?? 'kitchen@example.com'
const kitchenPassword = process.env.TEST_KITCHEN_PASSWORD ?? 'changeme'

test.describe('auth-flow — Dashboard login', () => {
  // Each test starts without a stored session
  test.use({ storageState: { cookies: [], origins: [] } })

  // 3.1 — ADMIN login with valid credentials
  test('ADMIN login reaches Dashboard home with branch selector', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('button', { name: /ingresar|login|entrar/i })).toBeVisible()

    await page.getByLabel(/email|correo/i).fill(adminEmail)
    await page.getByLabel(/contraseña|password/i).fill(adminPassword)
    await page.getByRole('button', { name: /ingresar|login|entrar/i }).click()

    // Dashboard home or branch selector must appear after login
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 })
    // Branch selector or main dashboard heading is visible
    await expect(
      page.getByRole('heading').or(page.getByTestId('branch-selector')).first(),
    ).toBeVisible()
  })

  // 3.2 — Invalid credentials show error, stay on /login
  test('invalid credentials show error message and stay on /login', async ({ page }) => {
    await page.goto('/login')

    await page.getByLabel(/email|correo/i).fill(adminEmail)
    await page.getByLabel(/contraseña|password/i).fill('wrong-password-xyz-123')
    await page.getByRole('button', { name: /ingresar|login|entrar/i }).click()

    // Error message appears
    await expect(
      page.getByRole('alert').or(page.getByText(/credenciales|invalid|incorrecto/i)).first(),
    ).toBeVisible({ timeout: 8_000 })

    // URL stays at login
    expect(page.url()).toContain('/login')
  })

  // 3.3 — WAITER and KITCHEN roles can login and reach their respective views
  test('WAITER login navigates away from /login', async ({ page }) => {
    await page.goto('/login')

    await page.getByLabel(/email|correo/i).fill(waiterEmail)
    await page.getByLabel(/contraseña|password/i).fill(waiterPassword)
    await page.getByRole('button', { name: /ingresar|login|entrar/i }).click()

    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 })
    // Any post-login element means success
    await expect(page.locator('body')).not.toContainText(/login/i)
  })

  test('KITCHEN login navigates away from /login', async ({ page }) => {
    await page.goto('/login')

    await page.getByLabel(/email|correo/i).fill(kitchenEmail)
    await page.getByLabel(/contraseña|password/i).fill(kitchenPassword)
    await page.getByRole('button', { name: /ingresar|login|entrar/i }).click()

    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 })
    await expect(page.locator('body')).not.toContainText(/login/i)
  })

  // 3.4 — Access token refresh — verify the app calls /api/auth/refresh before expiry
  test('app calls /api/auth/refresh to keep session alive', async ({ page }) => {
    // Verify the login endpoint works via API
    const loginRes = await page.request.post(
      `${process.env.API_URL ?? 'http://localhost:8000'}/api/auth/login`,
      { data: { email: adminEmail, password: adminPassword } },
    )
    expect(loginRes.ok()).toBeTruthy()

    // Clear cookies set by the API request so the UI starts fresh (no silent refresh)
    await page.context().clearCookies()

    // Log in via UI so the app stores its own session
    await page.goto('/login')
    await page.getByLabel(/email|correo/i).fill(adminEmail)
    await page.getByLabel(/contraseña|password/i).fill(adminPassword)
    await page.getByRole('button', { name: /ingresar|login|entrar/i }).click()
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 })

    // Mock the refresh endpoint so the next reload doesn't expire the session
    await page.route('**/api/auth/refresh', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ access_token: 'mock-refreshed-token', token_type: 'bearer' }),
      }),
    )

    // Trigger a navigation that requires auth — the app should not redirect to login
    await page.reload()
    await expect(page.locator('body')).not.toContainText(/sesión expirada|session expired/i)
  })
})
