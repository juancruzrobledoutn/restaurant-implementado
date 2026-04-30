/**
 * recipeStore unit tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useRecipeStore } from './recipeStore'
import type { Recipe } from '@/types/menu'

vi.mock('@/services/api', () => ({ fetchAPI: vi.fn() }))
vi.mock('@/utils/logger', () => ({
  handleError: vi.fn((_e: unknown, ctx: string) => `error:${ctx}`),
}))
vi.mock('@/stores/toastStore', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import { fetchAPI } from '@/services/api'
const mockFetchAPI = fetchAPI as ReturnType<typeof vi.fn>

function makeBackend(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, tenant_id: 10, product_id: 5, name: 'Pizza Recipe',
    ingredients: [{ ingredient_id: 20, quantity: 200, unit: 'g' }],
    is_active: true, ...overrides,
  }
}

const baseFormData = {
  name: 'Pizza Recipe', product_id: '5', is_active: true,
  ingredients: [{ ingredient_id: '20', quantity: 200, unit: 'g' }],
}

beforeEach(() => {
  useRecipeStore.setState({ items: [], isLoading: false, error: null, pendingTempIds: new Set() })
  vi.clearAllMocks()
})

describe('fetchAsync', () => {
  it('loads with string IDs and converted ingredients', async () => {
    mockFetchAPI.mockResolvedValueOnce([makeBackend()])
    await useRecipeStore.getState().fetchAsync()
    const { items } = useRecipeStore.getState()
    expect(items).toHaveLength(1)
    expect(items[0]!.id).toBe('1')
    expect(items[0]!.product_id).toBe('5')
    expect(items[0]!.ingredients[0]!.ingredient_id).toBe('20')
  })

  it('sets error on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('net'))
    await useRecipeStore.getState().fetchAsync()
    expect(useRecipeStore.getState().error).toBe('error:recipeStore.fetchAsync')
  })
})

describe('createAsync', () => {
  it('optimistic insert then real replace', async () => {
    mockFetchAPI.mockResolvedValueOnce(makeBackend({ id: 9 }))
    const promise = useRecipeStore.getState().createAsync(baseFormData)
    expect(useRecipeStore.getState().items.some((r) => r._optimistic)).toBe(true)
    const result = await promise
    expect(result.id).toBe('9')
    expect(useRecipeStore.getState().items[0]!._optimistic).toBeUndefined()
  })

  it('converts product_id and ingredient_id to int in body', async () => {
    mockFetchAPI.mockResolvedValueOnce(makeBackend())
    await useRecipeStore.getState().createAsync(baseFormData)
    const [, options] = mockFetchAPI.mock.calls[0]!
    const body = (options as { body: { product_id: unknown; ingredients: Array<{ ingredient_id: unknown }> } }).body
    expect(body.product_id).toBe(5)
    expect(body.ingredients[0]!.ingredient_id).toBe(20)
  })

  it('rollback on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('fail'))
    await expect(useRecipeStore.getState().createAsync(baseFormData)).rejects.toThrow()
    expect(useRecipeStore.getState().items).toHaveLength(0)
  })
})

describe('updateAsync', () => {
  const existing: Recipe = {
    id: '1', tenant_id: '10', product_id: '5', name: 'Old',
    ingredients: [], is_active: true,
  }

  beforeEach(() => { useRecipeStore.setState({ items: [existing] }) })

  it('optimistic update + server replace', async () => {
    mockFetchAPI.mockResolvedValueOnce(makeBackend({ id: 1, name: 'Updated' }))
    await useRecipeStore.getState().updateAsync('1', { ...baseFormData, name: 'Updated' })
    expect(useRecipeStore.getState().items[0]!.name).toBe('Updated')
  })

  it('rollback on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('fail'))
    try { await useRecipeStore.getState().updateAsync('1', { ...baseFormData, name: 'X' }) } catch { /* expected */ }
    expect(useRecipeStore.getState().items[0]!.name).toBe('Old')
  })
})

describe('deleteAsync', () => {
  const existing: Recipe = {
    id: '1', tenant_id: '10', product_id: '5', name: 'Pizza Recipe',
    ingredients: [], is_active: true,
  }

  beforeEach(() => { useRecipeStore.setState({ items: [existing] }) })

  it('removes on success', async () => {
    mockFetchAPI.mockResolvedValueOnce(undefined)
    await useRecipeStore.getState().deleteAsync('1')
    expect(useRecipeStore.getState().items).toHaveLength(0)
  })

  it('restores on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('fail'))
    try { await useRecipeStore.getState().deleteAsync('1') } catch { /* expected */ }
    expect(useRecipeStore.getState().items).toHaveLength(1)
  })
})

describe('applyWS*', () => {
  it('applyWSCreated inserts', () => {
    useRecipeStore.getState().applyWSCreated(makeBackend({ id: 42 }))
    expect(useRecipeStore.getState().items).toHaveLength(1)
    expect(useRecipeStore.getState().items[0]!.id).toBe('42')
  })

  it('applyWSCreated deduplicates', () => {
    const existing: Recipe = {
      id: '42', tenant_id: '10', product_id: '5', name: 'X', ingredients: [], is_active: true,
    }
    useRecipeStore.setState({ items: [existing] })
    useRecipeStore.getState().applyWSCreated(makeBackend({ id: 42 }))
    expect(useRecipeStore.getState().items).toHaveLength(1)
  })

  it('applyWSCreated skips pendingTempIds', () => {
    useRecipeStore.setState({ pendingTempIds: new Set(['42']) })
    useRecipeStore.getState().applyWSCreated(makeBackend({ id: 42 }))
    expect(useRecipeStore.getState().items).toHaveLength(0)
  })

  it('applyWSUpdated merges', () => {
    const existing: Recipe = {
      id: '1', tenant_id: '10', product_id: '5', name: 'Old', ingredients: [], is_active: true,
    }
    useRecipeStore.setState({ items: [existing] })
    useRecipeStore.getState().applyWSUpdated(makeBackend({ id: 1, name: 'WS Updated' }))
    expect(useRecipeStore.getState().items[0]!.name).toBe('WS Updated')
  })

  it('applyWSUpdated inserts if not found', () => {
    useRecipeStore.getState().applyWSUpdated(makeBackend({ id: 99 }))
    expect(useRecipeStore.getState().items).toHaveLength(1)
  })

  it('applyWSDeleted removes', () => {
    const existing: Recipe = {
      id: '1', tenant_id: '10', product_id: '5', name: 'X', ingredients: [], is_active: true,
    }
    useRecipeStore.setState({ items: [existing] })
    useRecipeStore.getState().applyWSDeleted('1')
    expect(useRecipeStore.getState().items).toHaveLength(0)
  })
})
