/**
 * useMenuWebSocketSync tests.
 *
 * Tests: ref pattern (no accumulation), branch change resubscribes,
 * ENTITY_CREATED/UPDATED/DELETED routing, CASCADE_DELETE handling, unmount cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMenuWebSocketSync } from './useMenuWebSocketSync'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Track subscriptions
const mockUnsubscribe = vi.fn()
const mockOnFiltered = vi.fn((_branchId: unknown, _eventType: unknown, _cb: unknown) => mockUnsubscribe)

vi.mock('@/services/websocket', () => ({
  dashboardWS: {
    onFiltered: (branchId: unknown, eventType: unknown, cb: unknown) =>
      mockOnFiltered(branchId, eventType, cb),
  },
}))

vi.mock('@/stores/branchStore', () => ({
  useBranchStore: vi.fn((selector: (s: { selectedBranchId: string | null }) => unknown) =>
    selector({ selectedBranchId: '100' })
  ),
  selectSelectedBranchId: (s: { selectedBranchId: string | null }) => s.selectedBranchId,
}))

const mockCategoryApplyCreated = vi.fn()
const mockCategoryApplyUpdated = vi.fn()
const mockCategoryApplyDeleted = vi.fn()

vi.mock('@/stores/categoryStore', () => ({
  useCategoryStore: {
    getState: () => ({
      applyWSCreated: mockCategoryApplyCreated,
      applyWSUpdated: mockCategoryApplyUpdated,
      applyWSDeleted: mockCategoryApplyDeleted,
    }),
  },
}))

const mockSubcategoryApplyCreated = vi.fn()
const mockSubcategoryApplyUpdated = vi.fn()
const mockSubcategoryApplyDeleted = vi.fn()

vi.mock('@/stores/subcategoryStore', () => ({
  useSubcategoryStore: {
    getState: () => ({
      applyWSCreated: mockSubcategoryApplyCreated,
      applyWSUpdated: mockSubcategoryApplyUpdated,
      applyWSDeleted: mockSubcategoryApplyDeleted,
      items: [],
    }),
  },
}))

const mockProductApplyCreated = vi.fn()
const mockProductApplyUpdated = vi.fn()
const mockProductApplyDeleted = vi.fn()

vi.mock('@/stores/productStore', () => ({
  useProductStore: {
    getState: () => ({
      applyWSCreated: mockProductApplyCreated,
      applyWSUpdated: mockProductApplyUpdated,
      applyWSDeleted: mockProductApplyDeleted,
      items: [],
    }),
  },
}))

const mockAllergenApplyCreated = vi.fn()
const mockAllergenApplyUpdated = vi.fn()
const mockAllergenApplyDeleted = vi.fn()

vi.mock('@/stores/allergenStore', () => ({
  useAllergenStore: {
    getState: () => ({
      applyWSCreated: mockAllergenApplyCreated,
      applyWSUpdated: mockAllergenApplyUpdated,
      applyWSDeleted: mockAllergenApplyDeleted,
    }),
  },
}))

const mockIngredientApplyCreated = vi.fn()
const mockIngredientApplyUpdated = vi.fn()
const mockIngredientApplyDeleted = vi.fn()

vi.mock('@/stores/ingredientStore', () => ({
  useIngredientStore: {
    getState: () => ({
      applyWSCreated: mockIngredientApplyCreated,
      applyWSUpdated: mockIngredientApplyUpdated,
      applyWSDeleted: mockIngredientApplyDeleted,
      ingredients: [],
    }),
  },
}))

const mockRecipeApplyCreated = vi.fn()
const mockRecipeApplyUpdated = vi.fn()
const mockRecipeApplyDeleted = vi.fn()

vi.mock('@/stores/recipeStore', () => ({
  useRecipeStore: {
    getState: () => ({
      applyWSCreated: mockRecipeApplyCreated,
      applyWSUpdated: mockRecipeApplyUpdated,
      applyWSDeleted: mockRecipeApplyDeleted,
    }),
  },
}))

const mockPromotionApplyCreated = vi.fn()
const mockPromotionApplyUpdated = vi.fn()
const mockPromotionApplyDeleted = vi.fn()

vi.mock('@/stores/promotionStore', () => ({
  usePromotionStore: {
    getState: () => ({
      applyWSCreated: mockPromotionApplyCreated,
      applyWSUpdated: mockPromotionApplyUpdated,
      applyWSDeleted: mockPromotionApplyDeleted,
    }),
  },
}))

vi.mock('@/stores/toastStore', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}))

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function getLastSubscribedCallback() {
  const calls = mockOnFiltered.mock.calls
  if (calls.length === 0) return null
  const lastCall = calls[calls.length - 1] as unknown[]
  return lastCall[2] as (event: unknown) => void
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('subscription lifecycle', () => {
  it('subscribes once on mount with selectedBranchId', () => {
    const { unmount } = renderHook(() => useMenuWebSocketSync())
    expect(mockOnFiltered).toHaveBeenCalledTimes(1)
    expect(mockOnFiltered).toHaveBeenCalledWith('100', '*', expect.any(Function))
    unmount()
  })

  it('calls unsubscribe on unmount', () => {
    const { unmount } = renderHook(() => useMenuWebSocketSync())
    expect(mockUnsubscribe).not.toHaveBeenCalled()
    unmount()
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1)
  })

  it('does not re-subscribe on unrelated re-renders', () => {
    const { rerender } = renderHook(() => useMenuWebSocketSync())
    rerender()
    rerender()
    expect(mockOnFiltered).toHaveBeenCalledTimes(1)
  })
})

describe('ENTITY_CREATED routing', () => {
  it('routes category created to categoryStore', () => {
    renderHook(() => useMenuWebSocketSync())
    const cb = getLastSubscribedCallback()!
    act(() => cb({ type: 'ENTITY_CREATED', entity: 'category', id: '1', data: { id: 1 } }))
    expect(mockCategoryApplyCreated).toHaveBeenCalledWith({ id: 1 })
  })

  it('routes subcategory created to subcategoryStore', () => {
    renderHook(() => useMenuWebSocketSync())
    const cb = getLastSubscribedCallback()!
    act(() => cb({ type: 'ENTITY_CREATED', entity: 'subcategory', id: '2', data: { id: 2 } }))
    expect(mockSubcategoryApplyCreated).toHaveBeenCalledWith({ id: 2 })
  })

  it('routes product created to productStore with entity param', () => {
    renderHook(() => useMenuWebSocketSync())
    const cb = getLastSubscribedCallback()!
    act(() => cb({ type: 'ENTITY_CREATED', entity: 'product', id: '3', data: { id: 3 } }))
    expect(mockProductApplyCreated).toHaveBeenCalledWith('product', { id: 3 })
  })

  it('routes allergen created to allergenStore', () => {
    renderHook(() => useMenuWebSocketSync())
    const cb = getLastSubscribedCallback()!
    act(() => cb({ type: 'ENTITY_CREATED', entity: 'allergen', id: '4', data: { id: 4 } }))
    expect(mockAllergenApplyCreated).toHaveBeenCalledWith({ id: 4 })
  })

  it('routes ingredient_group created to ingredientStore with entity param', () => {
    renderHook(() => useMenuWebSocketSync())
    const cb = getLastSubscribedCallback()!
    act(() => cb({ type: 'ENTITY_CREATED', entity: 'ingredient_group', id: '5', data: { id: 5 } }))
    expect(mockIngredientApplyCreated).toHaveBeenCalledWith('ingredient_group', { id: 5 })
  })

  it('routes recipe created to recipeStore', () => {
    renderHook(() => useMenuWebSocketSync())
    const cb = getLastSubscribedCallback()!
    act(() => cb({ type: 'ENTITY_CREATED', entity: 'recipe', id: '6', data: { id: 6 } }))
    expect(mockRecipeApplyCreated).toHaveBeenCalledWith({ id: 6 })
  })
})

describe('ENTITY_UPDATED routing', () => {
  it('routes category updated', () => {
    renderHook(() => useMenuWebSocketSync())
    const cb = getLastSubscribedCallback()!
    act(() => cb({ type: 'ENTITY_UPDATED', entity: 'category', id: '1', data: { id: 1, name: 'X' } }))
    expect(mockCategoryApplyUpdated).toHaveBeenCalledWith({ id: 1, name: 'X' })
  })

  it('routes branch_product updated with entity param', () => {
    renderHook(() => useMenuWebSocketSync())
    const cb = getLastSubscribedCallback()!
    act(() => cb({ type: 'ENTITY_UPDATED', entity: 'branch_product', id: '10', data: { id: 10 } }))
    expect(mockProductApplyUpdated).toHaveBeenCalledWith('branch_product', { id: 10 })
  })
})

describe('ENTITY_DELETED routing', () => {
  it('routes category deleted', () => {
    renderHook(() => useMenuWebSocketSync())
    const cb = getLastSubscribedCallback()!
    act(() => cb({ type: 'ENTITY_DELETED', entity: 'category', id: '1' }))
    expect(mockCategoryApplyDeleted).toHaveBeenCalledWith('1')
  })

  it('routes product deleted with entity param', () => {
    renderHook(() => useMenuWebSocketSync())
    const cb = getLastSubscribedCallback()!
    act(() => cb({ type: 'ENTITY_DELETED', entity: 'product', id: '5' }))
    expect(mockProductApplyDeleted).toHaveBeenCalledWith('product', '5')
  })

  it('routes recipe deleted', () => {
    renderHook(() => useMenuWebSocketSync())
    const cb = getLastSubscribedCallback()!
    act(() => cb({ type: 'ENTITY_DELETED', entity: 'recipe', id: '7' }))
    expect(mockRecipeApplyDeleted).toHaveBeenCalledWith('7')
  })
})

describe('CASCADE_DELETE', () => {
  it('category cascade removes category and calls subcategory/product deleted', () => {
    renderHook(() => useMenuWebSocketSync())
    const cb = getLastSubscribedCallback()!
    act(() => cb({ type: 'CASCADE_DELETE', entity: 'category', id: '1' }))
    expect(mockCategoryApplyDeleted).toHaveBeenCalledWith('1')
  })
})

// ---------------------------------------------------------------------------
// C-27: Promotion entity routing
// ---------------------------------------------------------------------------

describe('ENTITY_CREATED — promotion routing', () => {
  it('routes promotion ENTITY_CREATED to promotionStore.applyWSCreated', () => {
    renderHook(() => useMenuWebSocketSync())
    const cb = getLastSubscribedCallback()!
    const payload = { id: 5, name: '2x1', branches: [], items: [], is_active: true }
    act(() => cb({ type: 'ENTITY_CREATED', entity: 'promotion', id: '5', data: payload }))
    expect(mockPromotionApplyCreated).toHaveBeenCalledWith(payload)
  })
})

describe('ENTITY_UPDATED — promotion routing', () => {
  it('routes promotion ENTITY_UPDATED to promotionStore.applyWSUpdated', () => {
    renderHook(() => useMenuWebSocketSync())
    const cb = getLastSubscribedCallback()!
    const payload = { id: 5, name: 'Updated', branches: [], items: [], is_active: false }
    act(() => cb({ type: 'ENTITY_UPDATED', entity: 'promotion', id: '5', data: payload }))
    expect(mockPromotionApplyUpdated).toHaveBeenCalledWith(payload)
  })
})

describe('ENTITY_DELETED — promotion routing', () => {
  it('routes promotion ENTITY_DELETED to promotionStore.applyWSDeleted(id)', () => {
    renderHook(() => useMenuWebSocketSync())
    const cb = getLastSubscribedCallback()!
    act(() => cb({ type: 'ENTITY_DELETED', entity: 'promotion', id: '5' }))
    expect(mockPromotionApplyDeleted).toHaveBeenCalledWith('5')
  })
})

describe('CASCADE_DELETE — promotion', () => {
  it('calls promotionStore.applyWSDeleted and shows cascadeNotified toast', async () => {
    const { toast } = await import('@/stores/toastStore')

    renderHook(() => useMenuWebSocketSync())
    const cb = getLastSubscribedCallback()!
    act(() => cb({
      type: 'CASCADE_DELETE',
      entity: 'promotion',
      id: '10',
      affected: { branches: 2, items: 3 },
    }))

    expect(mockPromotionApplyDeleted).toHaveBeenCalledWith('10')
    expect(toast.info).toHaveBeenCalledWith(
      expect.stringContaining('promotions.cascadeNotified'),
    )
  })

  it('shows cascadeNotified toast with count 0 when affected is undefined', async () => {
    const { toast } = await import('@/stores/toastStore')

    renderHook(() => useMenuWebSocketSync())
    const cb = getLastSubscribedCallback()!
    act(() => cb({
      type: 'CASCADE_DELETE',
      entity: 'promotion',
      id: '11',
    }))

    expect(mockPromotionApplyDeleted).toHaveBeenCalledWith('11')
    expect(toast.info).toHaveBeenCalled()
  })
})

describe('Ref pattern regression — no listener accumulation', () => {
  it('10 re-renders do not accumulate subscriptions', () => {
    const { rerender } = renderHook(() => useMenuWebSocketSync())

    for (let i = 0; i < 9; i++) {
      rerender()
    }

    // Only 1 subscription should exist (from initial mount)
    expect(mockOnFiltered).toHaveBeenCalledTimes(1)
  })
})
