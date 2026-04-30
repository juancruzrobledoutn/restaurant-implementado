/**
 * Unit tests for customerStore (C-19 / Task 6.6).
 *
 * Tests:
 *   - load(): happy path sets profile + history + preferences
 *   - load(): 404 on profile → profile=null (graceful, not an error)
 *   - no localStorage persistence (spy on localStorage.setItem)
 *   - setProfile updates profile
 *   - reset() clears all state
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  useCustomerStore,
  selectCustomerProfile,
  selectIsCustomerLoading,
  selectVisitHistory,
  selectPreferences,
  selectOptedIn,
} from '../../stores/customerStore'
import type { CustomerProfile, VisitEntry, PreferenceEntry } from '../../types/billing'

// Mock customerApi
vi.mock('../../services/customerApi', () => ({
  customerApi: {
    getProfile: vi.fn(),
    getHistory: vi.fn(),
    getPreferences: vi.fn(),
  },
  CustomerNotFoundError: class CustomerNotFoundError extends Error {
    constructor() {
      super('customer_not_found')
      this.name = 'CustomerNotFoundError'
    }
  },
}))

const mockProfile: CustomerProfile = {
  id: '55',
  deviceHint: 'dev-abc',
  name: null,
  email: null,
  optedIn: false,
  consentVersion: null,
}

const mockHistory: VisitEntry[] = [
  { sessionId: '100', branchId: '1', status: 'CLOSED', visitedAt: '2026-01-01T12:00:00Z' },
]

const mockPreferences: PreferenceEntry[] = [
  { productId: '10', productName: 'Pizza', totalQuantity: 5 },
]

function resetStore() {
  useCustomerStore.setState({
    profile: null,
    visitHistory: [],
    preferences: [],
    isLoading: false,
    loadedAt: null,
    error: null,
  })
}

describe('customerStore', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('load()', () => {
    it('happy path: sets profile, history, preferences', async () => {
      const { customerApi } = await import('../../services/customerApi')
      vi.mocked(customerApi.getProfile).mockResolvedValue(mockProfile)
      vi.mocked(customerApi.getHistory).mockResolvedValue(mockHistory)
      vi.mocked(customerApi.getPreferences).mockResolvedValue(mockPreferences)

      await useCustomerStore.getState().load()

      const state = useCustomerStore.getState()
      expect(selectCustomerProfile(state)).toEqual(mockProfile)
      expect(selectVisitHistory(state)).toHaveLength(1)
      expect(selectPreferences(state)).toHaveLength(1)
      expect(selectIsCustomerLoading(state)).toBe(false)
      expect(state.loadedAt).toBeGreaterThan(0)
    })

    it('404 on profile → profile=null (graceful, not an error)', async () => {
      const { customerApi, CustomerNotFoundError } = await import('../../services/customerApi')
      vi.mocked(customerApi.getProfile).mockRejectedValue(new CustomerNotFoundError())
      vi.mocked(customerApi.getHistory).mockResolvedValue([])
      vi.mocked(customerApi.getPreferences).mockResolvedValue([])

      await useCustomerStore.getState().load()

      const state = useCustomerStore.getState()
      expect(selectCustomerProfile(state)).toBeNull()
      expect(selectIsCustomerLoading(state)).toBe(false)
      // 404 should NOT set error field
      expect(state.error).toBeNull()
    })

    it('non-404 profile error → sets error message', async () => {
      const { customerApi } = await import('../../services/customerApi')
      vi.mocked(customerApi.getProfile).mockRejectedValue(
        Object.assign(new Error('Network error'), { status: 500 }),
      )
      vi.mocked(customerApi.getHistory).mockResolvedValue([])
      vi.mocked(customerApi.getPreferences).mockResolvedValue([])

      await useCustomerStore.getState().load()

      const state = useCustomerStore.getState()
      expect(state.error).toBeTruthy()
      expect(selectIsCustomerLoading(state)).toBe(false)
    })

    it('history failure is non-fatal — returns empty array', async () => {
      const { customerApi } = await import('../../services/customerApi')
      vi.mocked(customerApi.getProfile).mockResolvedValue(mockProfile)
      vi.mocked(customerApi.getHistory).mockRejectedValue(new Error('History failed'))
      vi.mocked(customerApi.getPreferences).mockResolvedValue(mockPreferences)

      await useCustomerStore.getState().load()

      const state = useCustomerStore.getState()
      expect(selectCustomerProfile(state)).toEqual(mockProfile)
      expect(selectVisitHistory(state)).toHaveLength(0)
      expect(selectPreferences(state)).toHaveLength(1)
    })
  })

  describe('no localStorage persistence', () => {
    it('does NOT call localStorage.setItem during load', async () => {
      const { customerApi } = await import('../../services/customerApi')
      vi.mocked(customerApi.getProfile).mockResolvedValue(mockProfile)
      vi.mocked(customerApi.getHistory).mockResolvedValue([])
      vi.mocked(customerApi.getPreferences).mockResolvedValue([])

      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

      await useCustomerStore.getState().load()

      // Verify setItem was NOT called for customer data
      const customerCalls = setItemSpy.mock.calls.filter(
        ([key]) => String(key).includes('customer'),
      )
      expect(customerCalls).toHaveLength(0)

      setItemSpy.mockRestore()
    })
  })

  describe('setProfile', () => {
    it('updates profile directly', () => {
      const optedInProfile: CustomerProfile = {
        ...mockProfile,
        name: 'Ana',
        email: 'ana@example.com',
        optedIn: true,
        consentVersion: 'v1',
      }

      useCustomerStore.getState().setProfile(optedInProfile)

      const state = useCustomerStore.getState()
      expect(selectCustomerProfile(state)?.name).toBe('Ana')
      expect(selectOptedIn(state)).toBe(true)
    })
  })

  describe('reset()', () => {
    it('clears all state', async () => {
      const { customerApi } = await import('../../services/customerApi')
      vi.mocked(customerApi.getProfile).mockResolvedValue(mockProfile)
      vi.mocked(customerApi.getHistory).mockResolvedValue(mockHistory)
      vi.mocked(customerApi.getPreferences).mockResolvedValue(mockPreferences)

      await useCustomerStore.getState().load()

      useCustomerStore.getState().reset()

      const state = useCustomerStore.getState()
      expect(selectCustomerProfile(state)).toBeNull()
      expect(selectVisitHistory(state)).toHaveLength(0)
      expect(selectPreferences(state)).toHaveLength(0)
      expect(selectIsCustomerLoading(state)).toBe(false)
      expect(state.loadedAt).toBeNull()
    })
  })
})
