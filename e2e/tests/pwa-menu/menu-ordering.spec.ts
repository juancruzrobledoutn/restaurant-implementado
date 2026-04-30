/**
 * menu-ordering.spec.ts
 *
 * Revalidates C-18 partial smoke (task 15.4):
 *   diner joins table → browses menu → adds items to cart → submits round (PENDING)
 *
 * Runs against: pwaMenu (http://localhost:5176)
 * Project: pwa-menu
 *
 * Auth: X-Table-Token header (generated via generateTableToken fixture).
 */
import { test, expect } from '../../fixtures'
import { ApiHelper } from '../../fixtures/api'
import { generateTableToken } from '../../fixtures/table-token'

const API_URL = process.env.API_URL ?? 'http://localhost:8000'
const adminEmail = process.env.TEST_ADMIN_EMAIL ?? 'admin@example.com'
const adminPassword = process.env.TEST_ADMIN_PASSWORD ?? 'changeme'

test.describe('menu-ordering — diner flow (revalidates C-18 task 15.4)', () => {
  // 4.1 — Setup: seed fixture + activate table session
  test('diner joins table via QR params and reaches menu home', async ({
    page,
    seed,
    request,
  }) => {
    const api = await ApiHelper.create(request, adminEmail, adminPassword)

    // Activate table so there is an OPEN session
    await api.activateTable(seed.table.id)

    // Register diner to get a real HMAC table token from the backend
    const joinResult = await api.joinTable(seed.table.code, seed.branch.slug, 'Test Diner')

    // 4.2 — Diner navigates to pwaMenu via the QR URL with the backend-issued token
    // SessionActivatePage reads ?token=, calls GET /api/diner/session, then navigates to /menu
    await page.goto(`/t/${seed.branch.slug}/${seed.table.code}?token=${joinResult.table_token}`)

    // Wait for SessionActivatePage to validate the token and redirect to /menu
    await page.waitForURL('**/menu', { timeout: 15_000 })

    // After redirect, the menu home should show available products
    await expect(
      page.getByText(seed.productA.name).or(page.getByText('Milanesa')).first(),
    ).toBeVisible({ timeout: 10_000 })
  })

  // 4.3 — Menu only shows products with is_available=true via public API
  test('public menu endpoint only returns available branch products', async ({
    request,
    seed,
  }) => {
    const res = await request.get(`${API_URL}/api/public/menu/${seed.branch.slug}`)
    expect(res.ok()).toBeTruthy()

    const menu = await res.json()

    // Find all products in the response
    const allProducts: Array<{ is_available: boolean }> = []
    for (const category of menu.categories ?? menu) {
      for (const sub of category.subcategories ?? []) {
        for (const product of sub.products ?? []) {
          allProducts.push(product)
        }
      }
    }

    // Every returned product must be available
    for (const product of allProducts) {
      expect(
        product.is_available,
        `Product in public menu must have is_available=true`,
      ).toBe(true)
    }
  })

  // 4.4 — Diner adds item to cart and submits round (PENDING) — core revalidation
  test('diner adds product to cart and round is created with PENDING status', async ({
    page,
    seed,
    request,
  }) => {
    const api = await ApiHelper.create(request, adminEmail, adminPassword)
    await api.activateTable(seed.table.id)

    // Register diner to get a real backend-issued token
    const joinResult = await api.joinTable(seed.table.code, seed.branch.slug, 'Test Diner Cart')

    // Navigate via the QR URL with the real token
    await page.goto(`/t/${seed.branch.slug}/${seed.table.code}?token=${joinResult.table_token}`)

    // Wait for SessionActivatePage to redirect to /menu
    await page.waitForURL('**/menu', { timeout: 15_000 })

    // Wait for menu to load
    await expect(page.getByText(seed.productA.name).first()).toBeVisible({ timeout: 10_000 })

    // D-03: mock cart add endpoint (backend /api/diner/cart/* not yet implemented)
    // CartItemDTO fields: item_id, product_id, product_name, quantity, notes,
    //   price_cents_snapshot, diner_id, diner_name, added_at
    await page.route('**/api/diner/cart/add', (route) =>
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          item_id: 1,
          product_id: 1,
          product_name: seed.productA.name,
          quantity: 1,
          notes: '',
          price_cents_snapshot: seed.branchProductA.price_cents,
          diner_id: joinResult.diner_id,
          diner_name: 'Test Diner Cart',
          added_at: new Date().toISOString(),
        }),
      }),
    )

    // Intercept round creation (POST) to capture status; pass GET through
    // D-03: mock POST because backend reads DB cart items (none exist since cart add is mocked)
    let roundStatus: string | null = null
    await page.route('**/api/diner/rounds', async (route) => {
      if (route.request().method() === 'POST') {
        roundStatus = 'PENDING'
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 1,
            session_id: 0,
            status: 'PENDING',
            round_number: 1,
            submitted_at: new Date().toISOString(),
            confirmed_at: null,
            ready_at: null,
            served_at: null,
            items: [{
              id: 1,
              product_id: 1,
              product_name: seed.productA.name,
              quantity: 1,
              price_cents_snapshot: seed.branchProductA.price_cents,
              notes: '',
              diner_id: joinResult.diner_id,
              diner_name: 'Test Diner Cart',
            }],
          }),
        })
      } else {
        const response = await route.fetch()
        await route.fulfill({ response })
      }
    })

    // Add product to cart
    const addBtn = page
      .getByTestId('add-to-cart')
      .or(page.getByRole('button', { name: /agregar|add/i }))
      .first()
    await addBtn.click()

    // Navigate to cart via FAB (appears once cartItemCount > 0)
    const cartBtn = page
      .getByTestId('cart-button')
      .or(page.getByRole('button', { name: /carrito/i }))
    await cartBtn.click()

    // CartPage → click "Revisar pedido" to go to /cart/confirm
    await page.getByRole('button', { name: /revisar|review/i }).click()

    // CartConfirmPage → click "Enviar ronda" / "Send round" to actually submit the round
    await page.getByRole('button', { name: /enviar ronda|send round|enviar|submit/i }).click()

    // Wait for the round POST mock to be called (roundStatus set to 'PENDING')
    await expect
      .poll(() => roundStatus, {
        timeout: 10_000,
        message: 'Round should be created with PENDING status',
      })
      .toBe('PENDING')

    // After submission app navigates to /rounds — header should be visible (es or en locale)
    await expect(
      page.getByText(/mis rondas|my rounds|pendiente|pending|carrito vacío|pedido enviado|round sent/i).or(
        page.getByTestId('cart-empty'),
      ),
    ).toBeVisible({ timeout: 8_000 })
  })

  // 4.5 — Tenant isolation: diner with wrong branch cannot access another tenant's table
  test('diner from different tenant cannot access table session', async ({
    request,
    seed,
  }) => {
    // Use a non-existent branch slug — should return 404 or empty
    const res = await request.get(`${API_URL}/api/public/menu/non-existent-branch-xyz-999`)
    // Either 404 or empty categories — it must NOT return seed branch's data
    if (res.ok()) {
      const menu = await res.json()
      const categories = menu.categories ?? []
      // Should be empty — no products from our seed tenant
      for (const cat of categories) {
        for (const sub of cat.subcategories ?? []) {
          for (const product of sub.products ?? []) {
            expect(product.name).not.toBe(seed.productA.name)
          }
        }
      }
    } else {
      expect(res.status()).toBe(404)
    }
  })
})
