/**
 * seed fixture — creates an isolated tenant + full menu + staff accounts
 * per spec run via the backend API (D-02: seed via API, not SQL).
 *
 * Each spec that imports `test` from `fixtures/index.ts` gets fresh data
 * scoped to its own tenant, ensuring zero cross-spec contamination even
 * when running in parallel.
 *
 * Structure created:
 *   Tenant → Branch → Sector → Table
 *              └── Category → Subcategory → Product A + B → BranchProduct A + B
 *
 * Returned tokens: adminToken, waiterToken, kitchenToken
 * (all are JWT access tokens ready for ApiHelper or storageState)
 */
import type { APIRequestContext } from '@playwright/test'
import { ApiHelper } from './api'

export interface SeedResult {
  tenant: { id: number; name: string; slug: string }
  branch: { id: number; slug: string; name: string; tenant_id: number }
  sector: { id: number; name: string; branch_id: number }
  table: { id: number; code: string; branch_id: number; sector_id: number }
  productA: { id: number; name: string; price: number }
  productB: { id: number; name: string; price: number }
  branchProductA: { id: number; product_id: number; branch_id: number; price_cents: number }
  branchProductB: { id: number; product_id: number; branch_id: number; price_cents: number }
  adminToken: string
  waiterToken: string
  kitchenToken: string
}

/**
 * Create seed data for one isolated spec run.
 *
 * `tag` must be unique per parallel worker — use `workerIndex` or a UUID suffix.
 */
export async function createSeed(
  request: APIRequestContext,
  tag: string,
): Promise<SeedResult> {
  const adminEmail = process.env.TEST_ADMIN_EMAIL ?? 'admin@example.com'
  const adminPassword = process.env.TEST_ADMIN_PASSWORD ?? 'changeme'
  const waiterEmail = process.env.TEST_WAITER_EMAIL ?? 'waiter@example.com'
  const waiterPassword = process.env.TEST_WAITER_PASSWORD ?? 'changeme'
  const kitchenEmail = process.env.TEST_KITCHEN_EMAIL ?? 'kitchen@example.com'
  const kitchenPassword = process.env.TEST_KITCHEN_PASSWORD ?? 'changeme'

  // Login as admin to seed everything
  const api = await ApiHelper.create(request, adminEmail, adminPassword)

  // 1 — Resolve tenant from the admin's existing account (POST /api/admin/tenants doesn't exist)
  const me = await api.getMe()
  const tenant = { id: me.tenant_id, name: 'Demo', slug: 'demo' }

  // 2 — Branch: use the first existing public branch (POST /api/admin/branches doesn't exist)
  const branches = await api.getPublicBranches()
  if (branches.length === 0) {
    throw new Error('No active branches found — seed the database first (e.g. run migrations)')
  }
  const branch = { ...branches[0], tenant_id: me.tenant_id }

  // 3 — Sector + Table
  const sector = await api.createSector(branch.id, `Salon ${tag}`)
  const table = await api.createTable(sector.id, branch.id, {
    code: `T-${tag}`,
    number: 1,
    capacity: 4,
  })

  // 4 — Menu: Category → Subcategory → 2 products → BranchProducts
  const category = await api.createCategory(branch.id, { name: 'Platos' })
  const subcategory = await api.createSubcategory(category.id, { name: 'Principales' })

  // Prices in centavos (int) — never float
  // Tag suffix ensures unique names per run — the shared branch accumulates products
  // across runs, so unique names prevent strict-mode violations in getByText assertions.
  const productA = await api.createProduct(subcategory.id, {
    name: `Milanesa Napolitana ${tag}`,
    description: 'Clasica con salsa y queso',
    price: 150_00, // $150.00 in centavos
  })
  const productB = await api.createProduct(subcategory.id, {
    name: `Ensalada Mixta ${tag}`,
    description: 'Tomate, lechuga, zanahoria',
    price: 80_00, // $80.00 in centavos
  })

  const branchProductA = await api.createBranchProduct(productA.id, branch.id, {
    price_cents: 150_00,
    is_available: true,
  })
  const branchProductB = await api.createBranchProduct(productB.id, branch.id, {
    price_cents: 80_00,
    is_available: true,
  })

  // 5 — Obtain tokens for waiter and kitchen roles
  const waiterApi = await ApiHelper.create(request, waiterEmail, waiterPassword)
  const kitchenApi = await ApiHelper.create(request, kitchenEmail, kitchenPassword)

  return {
    tenant,
    branch,
    sector,
    table,
    productA,
    productB,
    branchProductA,
    branchProductB,
    adminToken: api.getToken(),
    waiterToken: waiterApi.getToken(),
    kitchenToken: kitchenApi.getToken(),
  }
}
