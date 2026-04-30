/**
 * categoryStore unit tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useCategoryStore } from './categoryStore'
import type { Category } from '@/types/menu'

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
  return { id: 1, tenant_id: 10, branch_id: 100, name: 'Comidas', order: 1, is_active: true, ...overrides }
}

const baseFormData = { name: 'Comidas', order: 1, icon: '', image: '', is_active: true, branch_id: '100' }

beforeEach(() => {
  useCategoryStore.setState({ items: [], isLoading: false, error: null, pendingTempIds: new Set() })
  vi.clearAllMocks()
})

describe('fetchAsync', () => {
  it('stores categories with string IDs', async () => {
    mockFetchAPI.mockResolvedValueOnce([makeBackend(), makeBackend({ id: 2, name: 'Bebidas' })])
    await useCategoryStore.getState().fetchAsync()
    const { items } = useCategoryStore.getState()
    expect(items).toHaveLength(2)
    expect(items[0]!.id).toBe('1')
    expect(items[0]!.branch_id).toBe('100')
  })

  it('sets error on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('net'))
    await useCategoryStore.getState().fetchAsync()
    expect(useCategoryStore.getState().error).toBe('error:categoryStore.fetchAsync')
    expect(useCategoryStore.getState().isLoading).toBe(false)
  })
})

describe('createAsync', () => {
  it('inserts optimistic item immediately, then replaces on success', async () => {
    mockFetchAPI.mockResolvedValueOnce(makeBackend({ id: 3, name: 'Comidas' }))
    const promise = useCategoryStore.getState().createAsync(baseFormData)
    expect(useCategoryStore.getState().items.some((i) => i._optimistic)).toBe(true)
    const result = await promise
    expect(result.id).toBe('3')
    expect(useCategoryStore.getState().items[0]!._optimistic).toBeUndefined()
    expect(useCategoryStore.getState().pendingTempIds.size).toBe(0)
  })

  it('rolls back and throws on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('fail'))
    await expect(useCategoryStore.getState().createAsync(baseFormData)).rejects.toThrow()
    expect(useCategoryStore.getState().items).toHaveLength(0)
    expect(useCategoryStore.getState().pendingTempIds.size).toBe(0)
  })

  it('parses branch_id as int before sending', async () => {
    mockFetchAPI.mockResolvedValueOnce(makeBackend())
    await useCategoryStore.getState().createAsync(baseFormData)
    const [, callOptions] = mockFetchAPI.mock.calls[0]!
    expect((callOptions as { body: { branch_id: unknown } }).body.branch_id).toBe(100)
  })
})

describe('updateAsync', () => {
  const existing: Category = { id: '1', tenant_id: '10', branch_id: '100', name: 'Old', order: 1, is_active: true }

  beforeEach(() => { useCategoryStore.setState({ items: [existing] }) })

  it('optimistic update then server replace', async () => {
    mockFetchAPI.mockResolvedValueOnce(makeBackend({ id: 1, name: 'New' }))
    await useCategoryStore.getState().updateAsync('1', { ...baseFormData, name: 'New' })
    expect(useCategoryStore.getState().items[0]!.name).toBe('New')
  })

  it('rolls back on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('fail'))
    try { await useCategoryStore.getState().updateAsync('1', { ...baseFormData, name: 'Changed' }) } catch { /* expected */ }
    expect(useCategoryStore.getState().items[0]!.name).toBe('Old')
  })
})

describe('deleteAsync', () => {
  const existing: Category = { id: '1', tenant_id: '10', branch_id: '100', name: 'Comidas', order: 1, is_active: true }

  beforeEach(() => { useCategoryStore.setState({ items: [existing] }) })

  it('removes optimistically, keeps on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('fail'))
    const deletePromise = useCategoryStore.getState().deleteAsync('1').catch(() => {})
    expect(useCategoryStore.getState().items).toHaveLength(0)
    await deletePromise
    expect(useCategoryStore.getState().items).toHaveLength(1)
  })

  it('removes permanently on success', async () => {
    mockFetchAPI.mockResolvedValueOnce(undefined)
    await useCategoryStore.getState().deleteAsync('1')
    expect(useCategoryStore.getState().items).toHaveLength(0)
  })
})

describe('applyWSCreated', () => {
  it('inserts new category', () => {
    useCategoryStore.getState().applyWSCreated(makeBackend({ id: 7 }))
    expect(useCategoryStore.getState().items).toHaveLength(1)
  })

  it('deduplicates by id', () => {
    const existing: Category = { id: '7', tenant_id: '10', branch_id: '100', name: 'X', order: 1, is_active: true }
    useCategoryStore.setState({ items: [existing] })
    useCategoryStore.getState().applyWSCreated(makeBackend({ id: 7 }))
    expect(useCategoryStore.getState().items).toHaveLength(1)
  })

  it('skips if id in pendingTempIds', () => {
    useCategoryStore.setState({ pendingTempIds: new Set(['7']) })
    useCategoryStore.getState().applyWSCreated(makeBackend({ id: 7 }))
    expect(useCategoryStore.getState().items).toHaveLength(0)
  })
})

describe('applyWSUpdated', () => {
  it('updates existing', () => {
    const existing: Category = { id: '1', tenant_id: '10', branch_id: '100', name: 'Old', order: 1, is_active: true }
    useCategoryStore.setState({ items: [existing] })
    useCategoryStore.getState().applyWSUpdated(makeBackend({ id: 1, name: 'WS Updated' }))
    expect(useCategoryStore.getState().items[0]!.name).toBe('WS Updated')
  })

  it('inserts if not found', () => {
    useCategoryStore.getState().applyWSUpdated(makeBackend({ id: 99 }))
    expect(useCategoryStore.getState().items).toHaveLength(1)
  })
})

describe('applyWSDeleted', () => {
  it('removes by id', () => {
    const existing: Category = { id: '1', tenant_id: '10', branch_id: '100', name: 'X', order: 1, is_active: true }
    useCategoryStore.setState({ items: [existing] })
    useCategoryStore.getState().applyWSDeleted('1')
    expect(useCategoryStore.getState().items).toHaveLength(0)
  })
})
