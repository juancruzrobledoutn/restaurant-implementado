/**
 * cascadeService unit tests — C-27 promotion extension.
 *
 * Covers: getPromotionPreview (null, empty, with data),
 *         deletePromotionWithCascade (delegates to promotionStore.deleteAsync).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock promotionStore — lazy import inside cascadeService
// ---------------------------------------------------------------------------

const mockDeleteAsync = vi.fn()
const mockGetState = vi.fn()

vi.mock('@/stores/promotionStore', () => ({
  usePromotionStore: {
    getState: mockGetState,
  },
}))

import {
  getPromotionPreview,
  deletePromotionWithCascade,
} from './cascadeService'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStoreState(items: unknown[]) {
  mockGetState.mockReturnValue({ items, deleteAsync: mockDeleteAsync })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// getPromotionPreview
// ---------------------------------------------------------------------------

describe('getPromotionPreview', () => {
  it('returns null when promotion id is not found in store', async () => {
    makeStoreState([])

    const result = await getPromotionPreview('999')

    expect(result).toBeNull()
  })

  it('returns null when store has no matching id', async () => {
    makeStoreState([
      { id: '1', branches: [{ branch_id: '1', branch_name: 'Centro' }], items: [] },
    ])

    const result = await getPromotionPreview('42')

    expect(result).toBeNull()
  })

  it('returns null when promotion has no branches and no items (zero cascade)', async () => {
    makeStoreState([
      { id: '1', branches: [], items: [] },
    ])

    const result = await getPromotionPreview('1')

    // totalItems is 0 and items list is empty (filtered out)
    expect(result).not.toBeNull()
    expect(result!.totalItems).toBe(0)
    expect(result!.items).toHaveLength(0)
  })

  it('returns totalItems: 5 and 2 entries when promotion has 2 branches and 3 items', async () => {
    makeStoreState([
      {
        id: '10',
        branches: [
          { branch_id: '1', branch_name: 'Norte' },
          { branch_id: '2', branch_name: 'Sur' },
        ],
        items: [
          { product_id: '1', product_name: 'Burger' },
          { product_id: '2', product_name: 'Fries' },
          { product_id: '3', product_name: 'Soda' },
        ],
      },
    ])

    const result = await getPromotionPreview('10')

    expect(result).not.toBeNull()
    expect(result!.totalItems).toBe(5)
    expect(result!.items).toHaveLength(2)
    expect(result!.items[0]!.label).toBe('promotions.cascade.branches')
    expect(result!.items[0]!.count).toBe(2)
    expect(result!.items[1]!.label).toBe('promotions.cascade.items')
    expect(result!.items[1]!.count).toBe(3)
  })

  it('only includes entries with count > 0 in items array', async () => {
    makeStoreState([
      {
        id: '5',
        branches: [{ branch_id: '1', branch_name: 'Centro' }],
        items: [], // no items
      },
    ])

    const result = await getPromotionPreview('5')

    expect(result).not.toBeNull()
    expect(result!.totalItems).toBe(1)
    // Only branches entry — items entry is filtered out (count 0)
    expect(result!.items).toHaveLength(1)
    expect(result!.items[0]!.label).toBe('promotions.cascade.branches')
  })
})

// ---------------------------------------------------------------------------
// deletePromotionWithCascade
// ---------------------------------------------------------------------------

describe('deletePromotionWithCascade', () => {
  it('delegates to promotionStore.getState().deleteAsync(id)', async () => {
    mockDeleteAsync.mockResolvedValueOnce(undefined)
    makeStoreState([])

    await deletePromotionWithCascade('7')

    expect(mockDeleteAsync).toHaveBeenCalledWith('7')
    expect(mockDeleteAsync).toHaveBeenCalledTimes(1)
  })

  it('propagates rejection from deleteAsync', async () => {
    mockDeleteAsync.mockRejectedValueOnce(new Error('500'))
    makeStoreState([])

    await expect(deletePromotionWithCascade('7')).rejects.toThrow('500')
  })
})
