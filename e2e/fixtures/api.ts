/**
 * ApiHelper — wraps Playwright's APIRequestContext to call the backend.
 *
 * All methods use the admin JWT obtained at construction. Each spec's seed
 * fixture creates its own ApiHelper so tokens never bleed across specs.
 *
 * Auth model: staff use `Authorization: Bearer <jwt>`.
 * Prices: always in centavos (int). Never float.
 */
import type { APIRequestContext } from '@playwright/test'

const API_URL = process.env.API_URL ?? 'http://localhost:8000'

export class ApiHelper {
  private token: string
  private readonly request: APIRequestContext

  // Module-level token cache — each email logs in only once per test suite run.
  // JWTs are valid for 15 minutes; suites complete in < 10 min, so no refresh needed.
  private static readonly tokenCache = new Map<string, string>()

  constructor(request: APIRequestContext, token: string) {
    this.request = request
    this.token = token
  }

  // ── Auth ─────────────────────────────────────────────────────────────────

  static async create(
    request: APIRequestContext,
    email: string,
    password: string,
    retries = 3,
  ): Promise<ApiHelper> {
    // Reuse cached token if available (avoids re-login and rate limit pressure)
    if (ApiHelper.tokenCache.has(email)) {
      return new ApiHelper(request, ApiHelper.tokenCache.get(email)!)
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
      const res = await request.post(`${API_URL}/api/auth/login`, {
        data: { email, password },
      })
      if (res.status() === 429 && attempt < retries) {
        // Rate limit: wait for the 60s window to reset then retry
        await new Promise((r) => setTimeout(r, 65_000))
        continue
      }
      if (!res.ok()) {
        const body = await res.text()
        throw new Error(`ApiHelper.login failed for ${email}: ${res.status()} — ${body}`)
      }
      const json = await res.json()
      ApiHelper.tokenCache.set(email, json.access_token)
      return new ApiHelper(request, json.access_token)
    }
    throw new Error(`ApiHelper.login failed for ${email} after ${retries} attempts`)
  }

  login(email: string, password: string): Promise<ApiHelper> {
    return ApiHelper.create(this.request, email, password)
  }

  getToken(): string {
    return this.token
  }

  private authHeaders() {
    return { Authorization: `Bearer ${this.token}` }
  }

  private async post<T>(path: string, data: unknown): Promise<T> {
    const res = await this.request.post(`${API_URL}${path}`, {
      data,
      headers: this.authHeaders(),
    })
    if (!res.ok()) {
      const body = await res.text()
      throw new Error(`POST ${path} → ${res.status()}: ${body}`)
    }
    return res.json() as Promise<T>
  }

  private async patch<T>(path: string, data: unknown): Promise<T> {
    const res = await this.request.patch(`${API_URL}${path}`, {
      data,
      headers: this.authHeaders(),
    })
    if (!res.ok()) {
      const body = await res.text()
      throw new Error(`PATCH ${path} → ${res.status()}: ${body}`)
    }
    return res.json() as Promise<T>
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.request.get(`${API_URL}${path}`, {
      headers: this.authHeaders(),
    })
    if (!res.ok()) {
      const body = await res.text()
      throw new Error(`GET ${path} → ${res.status()}: ${body}`)
    }
    return res.json() as Promise<T>
  }

  // ── Auth / Identity ───────────────────────────────────────────────────────

  getMe(): Promise<{ id: number; tenant_id: number; branch_ids: number[]; email: string; roles: string[] }> {
    return this.get('/api/auth/me')
  }

  // ── Tenant / Branch ───────────────────────────────────────────────────────

  getPublicBranches(): Promise<Array<{ id: number; name: string; address: string; slug: string }>> {
    // No auth required
    return this.get('/api/public/branches')
  }

  // ── Sectors / Tables ──────────────────────────────────────────────────────

  createSector(
    branchId: number,
    name: string,
  ): Promise<{ id: number; name: string; branch_id: number }> {
    return this.post('/api/admin/sectors', { branch_id: branchId, name })
  }

  createTable(
    sectorId: number,
    branchId: number,
    data: { code: string; number: number; capacity?: number },
  ): Promise<{ id: number; code: string; number: number; branch_id: number; sector_id: number }> {
    return this.post('/api/admin/tables', {
      sector_id: sectorId,
      branch_id: branchId,
      capacity: data.capacity ?? 4,
      code: data.code,
      number: data.number,
    })
  }

  activateTable(tableId: number): Promise<{ id: number; status: string }> {
    return this.post(`/api/waiter/tables/${tableId}/activate`, {})
  }

  closeTable(tableId: number): Promise<{ id: number; status: string }> {
    return this.post(`/api/waiter/tables/${tableId}/close`, {})
  }

  // ── Menu ──────────────────────────────────────────────────────────────────

  createCategory(
    branchId: number,
    data: { name: string },
  ): Promise<{ id: number; name: string }> {
    return this.post('/api/admin/categories', { branch_id: branchId, ...data })
  }

  createSubcategory(
    categoryId: number,
    data: { name: string },
  ): Promise<{ id: number; name: string; category_id: number }> {
    return this.post('/api/admin/subcategories', { category_id: categoryId, ...data })
  }

  createProduct(
    subcategoryId: number,
    data: { name: string; description?: string; price: number },
  ): Promise<{ id: number; name: string; price: number }> {
    return this.post('/api/admin/products', {
      subcategory_id: subcategoryId,
      description: data.description ?? '',
      ...data,
    })
  }

  createBranchProduct(
    productId: number,
    branchId: number,
    data: { price_cents: number; is_available?: boolean },
  ): Promise<{ id: number; product_id: number; branch_id: number; price_cents: number }> {
    return this.post('/api/admin/branch-products', {
      product_id: productId,
      branch_id: branchId,
      is_available: data.is_available ?? true,
      price_cents: data.price_cents,
    })
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  getTableSessionByCode(
    code: string,
    branchSlug: string,
  ): Promise<{ id: number; status: string; table_id: number }> {
    return this.get(`/api/tables/code/${code}/session?branch_slug=${branchSlug}`)
  }

  // ── Rounds ────────────────────────────────────────────────────────────────

  createRoundAsWaiter(
    sessionId: number,
    items: Array<{ product_id: number; quantity: number }>,
  ): Promise<{ id: number; status: string }> {
    return this.post(`/api/waiter/sessions/${sessionId}/rounds`, { items })
  }

  confirmRound(roundId: number): Promise<{ id: number; status: string }> {
    return this.patch(`/api/waiter/rounds/${roundId}`, { status: 'CONFIRMED' })
  }

  submitRound(roundId: number): Promise<{ id: number; status: string }> {
    return this.patch(`/api/admin/rounds/${roundId}`, { status: 'SUBMITTED' })
  }

  setRoundInKitchen(roundId: number): Promise<{ id: number; status: string }> {
    return this.patch(`/api/kitchen/rounds/${roundId}`, { status: 'IN_KITCHEN' })
  }

  setRoundReady(roundId: number): Promise<{ id: number; status: string }> {
    return this.patch(`/api/kitchen/rounds/${roundId}`, { status: 'READY' })
  }

  serveRound(roundId: number): Promise<{ id: number; status: string }> {
    return this.patch(`/api/waiter/rounds/${roundId}/serve`, {})
  }

  // ── Public (unauthenticated) ──────────────────────────────────────────────

  async joinTable(
    code: string,
    branchSlug: string,
    name: string,
  ): Promise<{ table_token: string; session_id: number; diner_id: number }> {
    const res = await this.request.post(
      `${API_URL}/api/public/tables/code/${encodeURIComponent(code)}/join?branch_slug=${encodeURIComponent(branchSlug)}`,
      { data: { name } },
    )
    if (!res.ok()) {
      const body = await res.text()
      throw new Error(`joinTable failed: ${res.status()} — ${body}`)
    }
    return res.json()
  }

  // ── Billing ───────────────────────────────────────────────────────────────

  requestCheck(sessionId: number): Promise<{ id: number; status: string }> {
    return this.post(`/api/waiter/sessions/${sessionId}/check`, {})
  }

  requestCheckSession(sessionId: number): Promise<{ id: number; status: string }> {
    return this.patch(`/api/waiter/sessions/${sessionId}/request-check`, {})
  }

  // ── Staff ─────────────────────────────────────────────────────────────────

  createWaiterSectorAssignment(
    userId: number,
    sectorId: number,
    branchId: number,
  ): Promise<{ id: number }> {
    const today = new Date().toISOString().split('T')[0]
    return this.post('/api/admin/waiter-assignments', {
      user_id: userId,
      sector_id: sectorId,
      branch_id: branchId,
      date: today,
    })
  }
}
