/**
 * Touch target regression tests — WCAG 2.5.5 AA (min 44x44 px)
 *
 * Context: CartItem buttons were 28px (w-7 h-7) before C-24.
 * Fixed to min-w-[44px] min-h-[44px]. This suite guards against regression.
 *
 * Strategy: start on /scan (no auth guard), inject stores via window.__* (exposed in DEV),
 * then navigate to /cart via React Router without page reload to bypass auth redirect timing.
 *
 * Run against: pwaMenu dev server (http://localhost:5176)
 * Viewport: mobile 375x667
 */
import { test, expect } from '@playwright/test'

const MIN_TOUCH_PX = 44

test.use({ viewport: { width: 375, height: 667 } })

test.describe('CartItem touch targets (WCAG 2.5.5 AA)', () => {
  test.beforeEach(async ({ page }) => {
    // Mock /api/diner/session so the 401 from a fake token doesn't trigger
    // the API client's global 401 handler (clear session + redirect to /scan).
    // Shape must match DinerSessionView from GET /api/diner/session.
    await page.route('**/api/diner/session', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session: { id: 1, status: 'OPEN' },
          table: { code: '1', status: 'OPEN', capacity: 4 },
          branch_slug: 'demo',
          diners: [],
          my_cart_items: [],
        }),
      }),
    )

    // 1. Start on /scan — no auth guard on this route
    await page.goto('http://localhost:5176/scan')

    // 2. Wait for DEV stores to be exposed by bootstrap()
    await page.waitForFunction(
      () => !!(window as unknown as Record<string, unknown>).__cartStore &&
             !!(window as unknown as Record<string, unknown>).__sessionStore &&
             !!(window as unknown as Record<string, unknown>).__router,
      { timeout: 8000 },
    )

    // 3. Inject session + cart state directly into Zustand stores
    await page.evaluate(() => {
      type StoreApi = { setState: (patch: unknown) => void }
      type RouterApi = { navigate: (path: string) => void }
      const w = window as unknown as {
        __sessionStore: StoreApi
        __cartStore: StoreApi
        __router: RouterApi
      }

      w.__sessionStore.setState({
        token: 'test-token-hmac',
        branchSlug: 'demo',
        tableCode: '1',
        sessionId: 'session-1',
        dinerId: 'diner-1',
        dinerName: 'Test Diner',
        tableStatus: 'OPEN',
        expiresAt: Date.now() + 8 * 60 * 60 * 1000,
      })

      w.__cartStore.setState({
        items: {
          'test-item-1': {
            id: 'test-item-1',
            productId: 'prod-1',
            productName: 'Test Product',
            priceCentsSnapshot: 1000,
            quantity: 2,
            notes: null,
            dinerId: 'diner-1',
            dinerName: 'Test Diner',
            pending: false,
            addedAt: new Date().toISOString(),
          },
        },
      })

      // 4. SPA-navigate to /cart — no page reload, store state persists
      w.__router.navigate('/cart')
    })

    // 5. Wait for CartItem to be visible
    await page.waitForSelector('[data-testid="cart-item-minus"]', { timeout: 8000 })
  })

  test('minus button meets 44x44 minimum touch target', async ({ page }) => {
    const minusBtn = page.locator('[data-testid="cart-item-minus"]').first()
    await minusBtn.waitFor({ state: 'visible', timeout: 5000 })
    const box = await minusBtn.boundingBox()
    expect(box, 'minus button bounding box should exist').not.toBeNull()
    expect(box!.width, `minus button width ${box!.width}px < ${MIN_TOUCH_PX}px`).toBeGreaterThanOrEqual(MIN_TOUCH_PX)
    expect(box!.height, `minus button height ${box!.height}px < ${MIN_TOUCH_PX}px`).toBeGreaterThanOrEqual(MIN_TOUCH_PX)
  })

  test('plus button meets 44x44 minimum touch target', async ({ page }) => {
    const plusBtn = page.locator('[data-testid="cart-item-plus"]').first()
    await plusBtn.waitFor({ state: 'visible', timeout: 5000 })
    const box = await plusBtn.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThanOrEqual(MIN_TOUCH_PX)
    expect(box!.height).toBeGreaterThanOrEqual(MIN_TOUCH_PX)
  })

  test('remove button meets 44x44 minimum touch target', async ({ page }) => {
    const removeBtn = page.locator('[data-testid="cart-item-remove"]').first()
    await removeBtn.waitFor({ state: 'visible', timeout: 5000 })
    const box = await removeBtn.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThanOrEqual(MIN_TOUCH_PX)
    expect(box!.height).toBeGreaterThanOrEqual(MIN_TOUCH_PX)
  })
})
