/**
 * productStore unit tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useProductStore } from './productStore'
import type { Product, BranchProduct } from '@/types/menu'

vi.mock('@/services/api', () => ({ fetchAPI: vi.fn() }))
vi.mock('@/utils/logger', () => ({
  handleError: vi.fn((_e: unknown, ctx: string) => `error:${ctx}`),
}))
vi.mock('@/stores/toastStore', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import { fetchAPI } from '@/services/api'
const mockFetchAPI = fetchAPI as ReturnType<typeof vi.fn>

function makeBackendProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, tenant_id: 10, branch_id: 100, subcategory_id: 5,
    name: 'Pizza', description: 'Delicious', price_cents: 1250,
    featured: false, popular: false, is_active: true, ...overrides,
  }
}

function makeBackendBranchProduct(overrides: Record<string, unknown> = {}) {
  return { id: 1, product_id: 1, branch_id: 100, is_available: true, ...overrides }
}

const baseFormData = {
  name: 'Pizza', description: 'Delicious', price_cents: 1250, image: '',
  featured: false, popular: false, is_active: true, subcategory_id: '5', branch_id: '100',
}

beforeEach(() => {
  useProductStore.setState({
    items: [], branchProducts: [], productAllergens: [],
    isLoading: false, error: null, pendingTempIds: new Set(),
  })
  vi.clearAllMocks()
})

describe('fetchAsync', () => {
  it('loads with string IDs', async () => {
    mockFetchAPI.mockResolvedValueOnce([makeBackendProduct()])
    await useProductStore.getState().fetchAsync()
    const { items } = useProductStore.getState()
    expect(items[0]!.id).toBe('1')
    expect(items[0]!.subcategory_id).toBe('5')
    expect(items[0]!.branch_id).toBe('100')
  })

  it('sets error on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('net'))
    await useProductStore.getState().fetchAsync()
    expect(useProductStore.getState().error).toBe('error:productStore.fetchAsync')
  })
})

describe('createAsync', () => {
  it('optimistic insert then real replace', async () => {
    mockFetchAPI.mockResolvedValueOnce(makeBackendProduct({ id: 7 }))
    const promise = useProductStore.getState().createAsync(baseFormData)
    expect(useProductStore.getState().items.some((p) => p._optimistic)).toBe(true)
    const result = await promise
    expect(result.id).toBe('7')
    expect(useProductStore.getState().items[0]!._optimistic).toBeUndefined()
    expect(useProductStore.getState().pendingTempIds.size).toBe(0)
  })

  it('converts IDs to int in request body', async () => {
    mockFetchAPI.mockResolvedValueOnce(makeBackendProduct())
    await useProductStore.getState().createAsync(baseFormData)
    const [, options] = mockFetchAPI.mock.calls[0]!
    const body = (options as { body: { branch_id: unknown; subcategory_id: unknown } }).body
    expect(body.branch_id).toBe(100)
    expect(body.subcategory_id).toBe(5)
  })

  it('rollback on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('fail'))
    await expect(useProductStore.getState().createAsync(baseFormData)).rejects.toThrow()
    expect(useProductStore.getState().items).toHaveLength(0)
  })
})

describe('updateAsync', () => {
  const existing: Product = {
    id: '1', tenant_id: '10', branch_id: '100', subcategory_id: '5',
    name: 'Old', description: '', price_cents: 1000,
    featured: false, popular: false, is_active: true,
  }

  beforeEach(() => { useProductStore.setState({ items: [existing] }) })

  it('optimistic then server replace', async () => {
    mockFetchAPI.mockResolvedValueOnce(makeBackendProduct({ id: 1, name: 'New' }))
    await useProductStore.getState().updateAsync('1', { ...baseFormData, name: 'New' })
    expect(useProductStore.getState().items[0]!.name).toBe('New')
  })

  it('rollback on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('fail'))
    try { await useProductStore.getState().updateAsync('1', { ...baseFormData, name: 'X' }) } catch { /* expected */ }
    expect(useProductStore.getState().items[0]!.name).toBe('Old')
  })
})

describe('deleteAsync', () => {
  const product: Product = {
    id: '1', tenant_id: '10', branch_id: '100', subcategory_id: '5',
    name: 'Pizza', description: '', price_cents: 1250,
    featured: false, popular: false, is_active: true,
  }
  const branchProduct: BranchProduct = { id: '10', product_id: '1', branch_id: '100', is_available: true }

  beforeEach(() => {
    useProductStore.setState({
      items: [product],
      branchProducts: [branchProduct],
      productAllergens: [{ id: '20', product_id: '1', allergen_id: '5', presence_type: 'contains', risk_level: 'high' }],
    })
  })

  it('removes product and children optimistically', () => {
    mockFetchAPI.mockResolvedValueOnce(undefined)
    void useProductStore.getState().deleteAsync('1')
    const state = useProductStore.getState()
    expect(state.items).toHaveLength(0)
    expect(state.branchProducts).toHaveLength(0)
    expect(state.productAllergens).toHaveLength(0)
  })

  it('restores all on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('fail'))
    try { await useProductStore.getState().deleteAsync('1') } catch { /* expected */ }
    const state = useProductStore.getState()
    expect(state.items).toHaveLength(1)
    expect(state.branchProducts).toHaveLength(1)
    expect(state.productAllergens).toHaveLength(1)
  })
})

describe('toggleAvailabilityAsync', () => {
  const bp: BranchProduct = { id: '10', product_id: '1', branch_id: '100', is_available: true }

  beforeEach(() => { useProductStore.setState({ branchProducts: [bp] }) })

  it('flips availability optimistically', () => {
    mockFetchAPI.mockResolvedValueOnce(makeBackendBranchProduct({ id: 10, is_available: false }))
    void useProductStore.getState().toggleAvailabilityAsync('10', false)
    expect(useProductStore.getState().branchProducts[0]!.is_available).toBe(false)
  })

  it('restores on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('fail'))
    try { await useProductStore.getState().toggleAvailabilityAsync('10', false) } catch { /* expected */ }
    expect(useProductStore.getState().branchProducts[0]!.is_available).toBe(true)
  })
})

describe('applyWS*', () => {
  it('applyWSCreated product entity inserts', () => {
    useProductStore.getState().applyWSCreated('product', makeBackendProduct({ id: 50 }))
    expect(useProductStore.getState().items).toHaveLength(1)
  })

  it('applyWSCreated deduplicates product', () => {
    const existing: Product = {
      id: '50', tenant_id: '10', branch_id: '100', subcategory_id: '5',
      name: 'X', description: '', price_cents: 0, featured: false, popular: false, is_active: true,
    }
    useProductStore.setState({ items: [existing] })
    useProductStore.getState().applyWSCreated('product', makeBackendProduct({ id: 50 }))
    expect(useProductStore.getState().items).toHaveLength(1)
  })

  it('applyWSCreated branch_product entity inserts', () => {
    useProductStore.getState().applyWSCreated('branch_product', makeBackendBranchProduct({ id: 200 }))
    expect(useProductStore.getState().branchProducts).toHaveLength(1)
  })

  it('applyWSUpdated product merges', () => {
    const existing: Product = {
      id: '1', tenant_id: '10', branch_id: '100', subcategory_id: '5',
      name: 'Old', description: '', price_cents: 0, featured: false, popular: false, is_active: true,
    }
    useProductStore.setState({ items: [existing] })
    useProductStore.getState().applyWSUpdated('product', makeBackendProduct({ id: 1, name: 'WS Updated' }))
    expect(useProductStore.getState().items[0]!.name).toBe('WS Updated')
  })

  it('applyWSDeleted product removes product and children', () => {
    const p: Product = {
      id: '1', tenant_id: '10', branch_id: '100', subcategory_id: '5',
      name: 'X', description: '', price_cents: 0, featured: false, popular: false, is_active: true,
    }
    useProductStore.setState({
      items: [p],
      branchProducts: [{ id: '10', product_id: '1', branch_id: '100', is_available: true }],
      productAllergens: [{ id: '20', product_id: '1', allergen_id: '5', presence_type: 'contains', risk_level: 'high' }],
    })
    useProductStore.getState().applyWSDeleted('product', '1')
    expect(useProductStore.getState().items).toHaveLength(0)
    expect(useProductStore.getState().branchProducts).toHaveLength(0)
    expect(useProductStore.getState().productAllergens).toHaveLength(0)
  })
})
