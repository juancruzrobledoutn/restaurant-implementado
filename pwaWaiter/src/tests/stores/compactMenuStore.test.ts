/**
 * compactMenuStore tests — fetch, cache hit, error.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import {
  useCompactMenuStore,
  selectMenuStatus,
  selectAllProducts,
  selectProductById,
} from '@/stores/compactMenuStore'

const API = 'http://localhost:8000'

const MENU_RESPONSE = {
  branch_id: 1,
  categories: [
    {
      id: 10,
      name: 'Bebidas',
      order: 1,
      subcategories: [
        {
          id: 10,
          name: 'Bebidas',
          order: 1,
          products: [
            { id: 100, name: 'Agua', price_cents: 500, subcategory_id: 10, is_available: true },
            { id: 101, name: 'Gaseosa', price_cents: 800, subcategory_id: 10, is_available: true },
          ],
        },
      ],
    },
  ],
}

describe('compactMenuStore', () => {
  beforeEach(() => {
    useCompactMenuStore.getState().reset()
  })

  it('loadMenu fetches and populates products', async () => {
    server.use(
      http.get(`${API}/api/waiter/branches/1/menu`, () => HttpResponse.json(MENU_RESPONSE)),
    )

    expect(selectMenuStatus(useCompactMenuStore.getState())).toBe('idle')

    await useCompactMenuStore.getState().loadMenu('1')

    expect(selectMenuStatus(useCompactMenuStore.getState())).toBe('ready')
    const products = selectAllProducts(useCompactMenuStore.getState())
    expect(products).toHaveLength(2)
    expect(products[0]?.id).toBe('100')
    expect(products[0]?.priceCents).toBe(500)
  })

  it('cache hit: skips second fetch when branchId + status=ready match', async () => {
    let fetchCount = 0
    server.use(
      http.get(`${API}/api/waiter/branches/1/menu`, () => {
        fetchCount++
        return HttpResponse.json(MENU_RESPONSE)
      }),
    )

    await useCompactMenuStore.getState().loadMenu('1')
    await useCompactMenuStore.getState().loadMenu('1') // second call

    expect(fetchCount).toBe(1) // only one request made
  })

  it('sets status=error on network error (without enqueuing)', async () => {
    server.use(
      http.get(`${API}/api/waiter/branches/1/menu`, () =>
        HttpResponse.json({ detail: 'Server error' }, { status: 500 }),
      ),
    )

    await useCompactMenuStore.getState().loadMenu('1')

    expect(selectMenuStatus(useCompactMenuStore.getState())).toBe('error')
    expect(useCompactMenuStore.getState().error).toBeDefined()
    expect(selectAllProducts(useCompactMenuStore.getState())).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// subcategory filter — task 5.1
// ---------------------------------------------------------------------------

describe('compactMenuStore — subcategory filtering', () => {
  beforeEach(() => {
    useCompactMenuStore.getState().reset()
  })

  it('selectProductById returns product with matching ID', async () => {
    server.use(
      http.get(`${API}/api/waiter/branches/1/menu`, () => HttpResponse.json(MENU_RESPONSE)),
    )
    await useCompactMenuStore.getState().loadMenu('1')

    const product = selectProductById('100')(useCompactMenuStore.getState())
    expect(product).toBeDefined()
    expect(product?.name).toBe('Agua')
    expect(product?.id).toBe('100')
  })

  it('selectProductById returns undefined for unknown ID', async () => {
    server.use(
      http.get(`${API}/api/waiter/branches/1/menu`, () => HttpResponse.json(MENU_RESPONSE)),
    )
    await useCompactMenuStore.getState().loadMenu('1')

    const product = selectProductById('9999')(useCompactMenuStore.getState())
    expect(product).toBeUndefined()
  })

  it('products with subcategory_id 10 are returned only for subcategoryId 10', async () => {
    // Build a menu with two subcategories having the same ID as another category
    // to test that filtering is by subcategory_id, NOT by category.id
    const menuWithMixedSubcats = {
      branch_id: 1,
      categories: [
        {
          id: 20, // different from subcategory id
          name: 'Comidas',
          order: 1,
          subcategories: [
            {
              id: 10,
              name: 'Entradas',
              order: 1,
              products: [
                { id: 200, name: 'Milanesa', price_cents: 1500, subcategory_id: 10, is_available: true },
              ],
            },
            {
              id: 30,
              name: 'Principales',
              order: 2,
              products: [
                { id: 300, name: 'Asado', price_cents: 3000, subcategory_id: 30, is_available: true },
              ],
            },
          ],
        },
      ],
    }
    server.use(
      http.get(`${API}/api/waiter/branches/2/menu`, () => HttpResponse.json(menuWithMixedSubcats)),
    )
    await useCompactMenuStore.getState().loadMenu('2')

    const allProducts = selectAllProducts(useCompactMenuStore.getState())
    // subcategoryId 10 → only Milanesa (subcategory_id: 10), NOT Asado (subcategory_id: 30)
    // and NOT the category id 20 confused with a subcategory
    const withSubcat10 = allProducts.filter((p) => p.subcategoryId === '10')
    expect(withSubcat10).toHaveLength(1)
    expect(withSubcat10[0]?.name).toBe('Milanesa')
  })
})
