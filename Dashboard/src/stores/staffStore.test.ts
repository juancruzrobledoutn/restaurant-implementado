/**
 * staffStore unit tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useStaffStore } from './staffStore'
import type { StaffUser } from '@/types/operations'

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
    id: 1,
    email: 'juan@test.com',
    first_name: 'Juan',
    last_name: 'Garcia',
    is_active: true,
    assignments: [],
    ...overrides,
  }
}

const existingUser: StaffUser = {
  id: '1',
  email: 'juan@test.com',
  first_name: 'Juan',
  last_name: 'Garcia',
  is_active: true,
  assignments: [],
}

const baseFormData = {
  email: 'new@test.com',
  first_name: 'Maria',
  last_name: 'Lopez',
  password: 'secret123',
  is_active: true,
}

beforeEach(() => {
  useStaffStore.setState({ items: [], isLoading: false, error: null })
  vi.clearAllMocks()
})

describe('fetchAll', () => {
  it('stores staff with string IDs', async () => {
    mockFetchAPI.mockResolvedValueOnce([makeBackend(), makeBackend({ id: 2, email: 'b@test.com' })])
    await useStaffStore.getState().fetchAll()
    const { items } = useStaffStore.getState()
    expect(items).toHaveLength(2)
    expect(items[0]!.id).toBe('1')
  })

  it('sets error on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('net'))
    await useStaffStore.getState().fetchAll()
    expect(useStaffStore.getState().error).toBe('error:staffStore.fetchAll')
  })
})

describe('createStaffAsync', () => {
  it('adds user to list', async () => {
    mockFetchAPI.mockResolvedValueOnce(makeBackend({ id: 5, email: 'new@test.com' }))
    await useStaffStore.getState().createStaffAsync(baseFormData)
    expect(useStaffStore.getState().items).toHaveLength(1)
    expect(useStaffStore.getState().items[0]!.email).toBe('new@test.com')
  })

  it('throws on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('409 duplicate'))
    await expect(useStaffStore.getState().createStaffAsync(baseFormData)).rejects.toThrow()
  })
})

describe('updateStaffAsync', () => {
  beforeEach(() => { useStaffStore.setState({ items: [existingUser] }) })

  it('replaces user on success', async () => {
    mockFetchAPI.mockResolvedValueOnce(makeBackend({ first_name: 'Updated' }))
    await useStaffStore.getState().updateStaffAsync('1', { first_name: 'Updated' })
    expect(useStaffStore.getState().items[0]!.first_name).toBe('Updated')
  })

  it('rolls back on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('fail'))
    await expect(useStaffStore.getState().updateStaffAsync('1', {})).rejects.toThrow()
    expect(useStaffStore.getState().items[0]!.first_name).toBe('Juan')
  })
})

describe('deleteStaffAsync', () => {
  beforeEach(() => { useStaffStore.setState({ items: [existingUser] }) })

  it('removes user on success', async () => {
    mockFetchAPI.mockResolvedValueOnce(undefined)
    await useStaffStore.getState().deleteStaffAsync('1')
    expect(useStaffStore.getState().items).toHaveLength(0)
  })

  it('rolls back on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('fail'))
    await expect(useStaffStore.getState().deleteStaffAsync('1')).rejects.toThrow()
    expect(useStaffStore.getState().items).toHaveLength(1)
  })
})

describe('migrate_from_v1_noop', () => {
  it('items is always an array', () => {
    expect(Array.isArray(useStaffStore.getState().items)).toBe(true)
  })
})
