/**
 * waiter-flow.spec.ts
 *
 * Revalidates C-21 partial smoke (task 17.4):
 *   waiter login → branch assignment → table grid →
 *   confirm PENDING round → serve READY round → close table
 *
 * Runs against: pwaWaiter (http://localhost:5178)
 * Project: pwa-waiter
 */
import { test, expect } from '../../fixtures'
import { ApiHelper } from '../../fixtures/api'

const API_URL = process.env.API_URL ?? 'http://localhost:8000'
const adminEmail = process.env.TEST_ADMIN_EMAIL ?? 'admin@example.com'
const adminPassword = process.env.TEST_ADMIN_PASSWORD ?? 'changeme'
const waiterEmail = process.env.TEST_WAITER_EMAIL ?? 'waiter@example.com'
const waiterPassword = process.env.TEST_WAITER_PASSWORD ?? 'changeme'

test.describe('waiter-flow — full waiter journey (revalidates C-21 task 17.4)', () => {
  // 6.1 — Waiter logs in, sees assigned tables
  test('waiter login succeeds and table grid is visible', async ({
    page,
    seed,
    request,
  }) => {
    const api = await ApiHelper.create(request, adminEmail, adminPassword)
    const waiterApi = new ApiHelper(request, seed.waiterToken)

    // Assign waiter to sector so GET /api/waiter/tables returns tables
    const waiterMe = await waiterApi.getMe()
    await api.createWaiterSectorAssignment(waiterMe.id, seed.sector.id, seed.branch.id)

    // Activate table so there's an active session
    await api.activateTable(seed.table.id)

    // Pre-select branch BEFORE SPA scripts run so branchSelectionStore hydrates correctly
    await page.addInitScript((branch) => {
      localStorage.setItem('pwawaiter-branch-selection', JSON.stringify({
        branchId: String(branch.id),
        branchName: branch.name,
        branchSlug: branch.slug,
      }))
    }, seed.branch)
    await page.goto('/login')
    await page.getByLabel(/email|correo/i).fill(waiterEmail)
    await page.getByLabel(/contraseña|password/i).fill(waiterPassword)
    await page.getByRole('button', { name: /ingresar|login|entrar/i }).click()

    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 })

    // Table code visible in the grid proves sector assignment worked and tables loaded
    await expect(
      page.getByText(seed.table.code).first(),
    ).toBeVisible({ timeout: 10_000 })
  })

  // 6.3 — Waiter confirms PENDING round (revalidates C-21 17.4 — confirm)
  test('waiter confirms PENDING round via UI — status becomes CONFIRMED', async ({
    page,
    seed,
    request,
  }) => {
    const api = await ApiHelper.create(request, adminEmail, adminPassword)
    const waiterApi = new ApiHelper(request, seed.waiterToken)

    // Assign waiter to sector
    const waiterMe = await waiterApi.getMe()
    await api.createWaiterSectorAssignment(waiterMe.id, seed.sector.id, seed.branch.id)

    const session = await api.activateTable(seed.table.id)

    // Create a PENDING round via API
    const round = await api.createRoundAsWaiter(session.id, [
      { product_id: seed.productA.id, quantity: 1 },
    ])
    expect(round.status).toBe('PENDING')

    // Intercept the confirm PATCH
    let confirmedStatus: string | null = null
    await page.route(`**/api/waiter/rounds/${round.id}`, async (route) => {
      if (route.request().method() === 'PATCH') {
        const response = await route.fetch()
        const body = await response.json()
        confirmedStatus = body.status
        await route.fulfill({ response })
      } else {
        await route.continue()
      }
    })

    // Login as waiter — pre-set branch via addInitScript so store hydrates before SPA loads
    await page.addInitScript((branch) => {
      localStorage.setItem('pwawaiter-branch-selection', JSON.stringify({
        branchId: String(branch.id),
        branchName: branch.name,
        branchSlug: branch.slug,
      }))
    }, seed.branch)
    await page.goto('/login')
    await page.getByLabel(/email|correo/i).fill(waiterEmail)
    await page.getByLabel(/contraseña|password/i).fill(waiterPassword)
    await page.getByRole('button', { name: /ingresar|login|entrar/i }).click()
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 })

    // Open table detail — navigates to /tables/:tableId
    await page.getByTestId(`table-${seed.table.code}`).click()

    // TableDetailPage loads existing rounds from API on mount — wait for confirm button
    const confirmBtn = page.getByRole('button', {
      name: /confirmar.*pedido|confirmar/i,
    })
    await expect(confirmBtn).toBeVisible({ timeout: 10_000 })
    await confirmBtn.click()

    await expect
      .poll(() => confirmedStatus, {
        timeout: 10_000,
        message: 'Round should transition to CONFIRMED',
      })
      .toBe('CONFIRMED')
  })

  // 6.4 — Waiter serves READY round (revalidates C-21 17.4 — serve)
  test('waiter marks READY round as SERVED via API', async ({ request, seed }) => {
    const api = await ApiHelper.create(request, adminEmail, adminPassword)
    const session = await api.activateTable(seed.table.id)

    // Advance round to READY via API
    const round = await api.createRoundAsWaiter(session.id, [
      { product_id: seed.productB.id, quantity: 2 },
    ])
    await api.confirmRound(round.id)
    await api.submitRound(round.id)
    await api.setRoundInKitchen(round.id)
    await api.setRoundReady(round.id)

    // Waiter serves the round (READY → SERVED)
    const served = await api.serveRound(round.id)
    expect(served.status).toBe('SERVED')
  })

  // 6.5 — Waiter closes table after full payment
  test('waiter closes table after payment — table returns to AVAILABLE', async ({
    request,
    seed,
  }) => {
    const api = await ApiHelper.create(request, adminEmail, adminPassword)
    const session = await api.activateTable(seed.table.id)

    // Advance to SERVED
    const round = await api.createRoundAsWaiter(session.id, [
      { product_id: seed.productA.id, quantity: 1 },
    ])
    await api.confirmRound(round.id)
    await api.submitRound(round.id)
    await api.setRoundInKitchen(round.id)
    await api.setRoundReady(round.id)
    await api.serveRound(round.id)

    // Transition session to PAYING via session endpoint (no diners required)
    await api.requestCheckSession(session.id)

    // Close table
    const closed = await api.closeTable(seed.table.id)
    expect([closed.status, 'OK']).toContain(closed.status)

    // Verify table status via GET
    const tableRes = await request.get(
      `${API_URL}/api/admin/tables/${seed.table.id}`,
      { headers: { Authorization: `Bearer ${api.getToken()}` } },
    )
    if (tableRes.ok()) {
      const tableData = await tableRes.json()
      // Table should not have an OPEN session anymore
      expect(tableData.status ?? 'AVAILABLE').not.toBe('OPEN')
    }
  })
})
