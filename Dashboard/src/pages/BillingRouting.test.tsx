/**
 * Billing routing tests (C-26 — task 10.5).
 *
 * Coverage:
 * - Breadcrumb handle for /checks is defined in router
 * - Breadcrumb handle for /payments is defined in router
 * - Lazy pages (ChecksPage, PaymentsPage) are registered in router
 *
 * Note: Full Suspense + lazy load testing requires E2E. These tests
 * verify structural routing config without triggering full React Router
 * data router hydration (which needs a browser-like environment).
 */

import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Structural router config tests (pure data — no rendering required)
// ---------------------------------------------------------------------------

describe('billing routing config', () => {
  it('router has /checks route with breadcrumb handle', async () => {
    // Dynamically import router to avoid side effects at module load time
    // (createBrowserRouter requires window which jsdom provides)
    const { router } = await import('@/router')

    const allRoutes = router.routes
    // Flatten all nested routes
    function flatten(routes: unknown[]): unknown[] {
      return routes.flatMap((r: unknown) => {
        const route = r as { path?: string; children?: unknown[] }
        return [route, ...(route.children ? flatten(route.children) : [])]
      })
    }

    const flat = flatten(allRoutes as unknown[]) as Array<{
      path?: string
      handle?: { breadcrumb?: string }
    }>

    const checksRoute = flat.find((r) => r.path === 'checks')
    expect(checksRoute).toBeDefined()
    expect(checksRoute?.handle?.breadcrumb).toBeDefined()
    expect(typeof checksRoute?.handle?.breadcrumb).toBe('string')
  })

  it('router has /payments route with breadcrumb handle', async () => {
    const { router } = await import('@/router')

    function flatten(routes: unknown[]): unknown[] {
      return routes.flatMap((r: unknown) => {
        const route = r as { path?: string; children?: unknown[] }
        return [route, ...(route.children ? flatten(route.children) : [])]
      })
    }

    const flat = flatten(router.routes as unknown[]) as Array<{
      path?: string
      handle?: { breadcrumb?: string }
    }>

    const paymentsRoute = flat.find((r) => r.path === 'payments')
    expect(paymentsRoute).toBeDefined()
    expect(paymentsRoute?.handle?.breadcrumb).toBeDefined()
  })

  it('router has separate routes for checks and payments', async () => {
    const { router } = await import('@/router')

    function flatten(routes: unknown[]): unknown[] {
      return routes.flatMap((r: unknown) => {
        const route = r as { path?: string; children?: unknown[] }
        return [route, ...(route.children ? flatten(route.children) : [])]
      })
    }

    const flat = flatten(router.routes as unknown[]) as Array<{ path?: string }>
    const paths = flat.map((r) => r.path).filter(Boolean)

    expect(paths).toContain('checks')
    expect(paths).toContain('payments')
  })
})
