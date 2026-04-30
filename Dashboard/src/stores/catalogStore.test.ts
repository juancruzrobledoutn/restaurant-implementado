/**
 * catalogStore unit tests — C-27.
 *
 * Covers: fetchPromotionTypesAsync happy path, idempotency, error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useCatalogStore } from './catalogStore'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/services/api', () => ({
  fetchAPI: vi.fn(),
}))

vi.mock('@/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  handleError: vi.fn((_err: unknown, ctx: string) => `error:${ctx}`),
}))

import { fetchAPI } from '@/services/api'
const mockFetchAPI = fetchAPI as ReturnType<typeof vi.fn>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  useCatalogStore.setState({
    promotion_types: [],
    isLoadingTypes: false,
    errorTypes: null,
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetStore()
  vi.clearAllMocks()
})

describe('fetchPromotionTypesAsync', () => {
  it('calls the correct endpoint and populates promotion_types with string ids', async () => {
    mockFetchAPI.mockResolvedValueOnce([
      { id: 1, name: '2x1' },
      { id: 2, name: 'Combo' },
    ])

    await useCatalogStore.getState().fetchPromotionTypesAsync()

    const { promotion_types, isLoadingTypes, errorTypes } = useCatalogStore.getState()
    expect(mockFetchAPI).toHaveBeenCalledWith('/api/admin/catalogs/promotion-types')
    expect(promotion_types).toHaveLength(2)
    expect(promotion_types[0]!.id).toBe('1')
    expect(promotion_types[0]!.name).toBe('2x1')
    expect(promotion_types[1]!.id).toBe('2')
    expect(isLoadingTypes).toBe(false)
    expect(errorTypes).toBeNull()
  })

  it('is idempotent — skips request if types already loaded', async () => {
    useCatalogStore.setState({
      promotion_types: [{ id: '1', name: 'Existing' }],
    } as Parameters<typeof useCatalogStore.setState>[0])

    await useCatalogStore.getState().fetchPromotionTypesAsync()

    expect(mockFetchAPI).not.toHaveBeenCalled()
    expect(useCatalogStore.getState().promotion_types).toHaveLength(1)
  })

  it('sets errorTypes and keeps promotion_types empty on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('Network error'))

    await useCatalogStore.getState().fetchPromotionTypesAsync()

    const { promotion_types, isLoadingTypes, errorTypes } = useCatalogStore.getState()
    expect(promotion_types).toHaveLength(0)
    expect(isLoadingTypes).toBe(false)
    expect(errorTypes).toBe('error:catalogStore.fetchPromotionTypesAsync')
  })
})
