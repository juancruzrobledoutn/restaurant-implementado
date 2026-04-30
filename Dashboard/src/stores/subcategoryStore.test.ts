/**
 * subcategoryStore unit tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSubcategoryStore } from './subcategoryStore'
import type { Subcategory } from '@/types/menu'

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
    id: 1, tenant_id: 10, branch_id: 100, category_id: 5,
    name: 'Pastas', order: 1, is_active: true, ...overrides,
  }
}

const baseFormData = {
  name: 'Pastas', order: 1, image: '', is_active: true,
  category_id: '5', branch_id: '100',
}

beforeEach(() => {
  useSubcategoryStore.setState({ items: [], isLoading: false, error: null, pendingTempIds: new Set() })
  vi.clearAllMocks()
})

describe('fetchAsync', () => {
  it('loads with string IDs', async () => {
    mockFetchAPI.mockResolvedValueOnce([makeBackend(), makeBackend({ id: 2 })])
    await useSubcategoryStore.getState().fetchAsync()
    const { items } = useSubcategoryStore.getState()
    expect(items).toHaveLength(2)
    expect(items[0]!.id).toBe('1')
    expect(items[0]!.category_id).toBe('5')
    expect(items[0]!.branch_id).toBe('100')
  })

  it('sets error on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('net'))
    await useSubcategoryStore.getState().fetchAsync()
    expect(useSubcategoryStore.getState().error).toBe('error:subcategoryStore.fetchAsync')
  })
})

describe('createAsync', () => {
  it('optimistic insert then real replace', async () => {
    mockFetchAPI.mockResolvedValueOnce(makeBackend({ id: 9 }))
    const promise = useSubcategoryStore.getState().createAsync(baseFormData)
    expect(useSubcategoryStore.getState().items.some((i) => i._optimistic)).toBe(true)
    const result = await promise
    expect(result.id).toBe('9')
    expect(useSubcategoryStore.getState().items[0]!._optimistic).toBeUndefined()
  })

  it('rollback on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('fail'))
    await expect(useSubcategoryStore.getState().createAsync(baseFormData)).rejects.toThrow()
    expect(useSubcategoryStore.getState().items).toHaveLength(0)
  })
})

describe('updateAsync', () => {
  const existing: Subcategory = {
    id: '1', tenant_id: '10', branch_id: '100', category_id: '5',
    name: 'Old', order: 1, is_active: true,
  }

  beforeEach(() => { useSubcategoryStore.setState({ items: [existing] }) })

  it('optimistic update + server replace', async () => {
    mockFetchAPI.mockResolvedValueOnce(makeBackend({ id: 1, name: 'New Name' }))
    await useSubcategoryStore.getState().updateAsync('1', { ...baseFormData, name: 'New Name' })
    expect(useSubcategoryStore.getState().items[0]!.name).toBe('New Name')
  })

  it('rollback on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('fail'))
    try { await useSubcategoryStore.getState().updateAsync('1', { ...baseFormData, name: 'X' }) } catch { /* expected */ }
    expect(useSubcategoryStore.getState().items[0]!.name).toBe('Old')
  })
})

describe('deleteAsync', () => {
  const existing: Subcategory = {
    id: '1', tenant_id: '10', branch_id: '100', category_id: '5',
    name: 'Pastas', order: 1, is_active: true,
  }

  beforeEach(() => { useSubcategoryStore.setState({ items: [existing] }) })

  it('removes on success', async () => {
    mockFetchAPI.mockResolvedValueOnce(undefined)
    await useSubcategoryStore.getState().deleteAsync('1')
    expect(useSubcategoryStore.getState().items).toHaveLength(0)
  })

  it('restores on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('fail'))
    try { await useSubcategoryStore.getState().deleteAsync('1') } catch { /* expected */ }
    expect(useSubcategoryStore.getState().items).toHaveLength(1)
  })
})

describe('applyWS*', () => {
  it('applyWSCreated inserts', () => {
    useSubcategoryStore.getState().applyWSCreated(makeBackend({ id: 20 }))
    expect(useSubcategoryStore.getState().items).toHaveLength(1)
  })

  it('applyWSCreated deduplicates', () => {
    const existing: Subcategory = {
      id: '20', tenant_id: '10', branch_id: '100', category_id: '5',
      name: 'X', order: 1, is_active: true,
    }
    useSubcategoryStore.setState({ items: [existing] })
    useSubcategoryStore.getState().applyWSCreated(makeBackend({ id: 20 }))
    expect(useSubcategoryStore.getState().items).toHaveLength(1)
  })

  it('applyWSUpdated updates existing', () => {
    const existing: Subcategory = {
      id: '1', tenant_id: '10', branch_id: '100', category_id: '5',
      name: 'Old', order: 1, is_active: true,
    }
    useSubcategoryStore.setState({ items: [existing] })
    useSubcategoryStore.getState().applyWSUpdated(makeBackend({ id: 1, name: 'WS' }))
    expect(useSubcategoryStore.getState().items[0]!.name).toBe('WS')
  })

  it('applyWSDeleted removes', () => {
    const existing: Subcategory = {
      id: '1', tenant_id: '10', branch_id: '100', category_id: '5',
      name: 'X', order: 1, is_active: true,
    }
    useSubcategoryStore.setState({ items: [existing] })
    useSubcategoryStore.getState().applyWSDeleted('1')
    expect(useSubcategoryStore.getState().items).toHaveLength(0)
  })
})
