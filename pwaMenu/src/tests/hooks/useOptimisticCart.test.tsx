/**
 * Tests for useOptimisticCart hook.
 *
 * Tests:
 * - Returns confirmed items from store when no optimistic actions pending
 * - addItem calls cartApi.add and eventually confirms or reverts
 * - removeItem calls cartApi.remove
 * - updateItem calls cartApi.update
 *
 * Note: useOptimistic (React 19) requires React transitions. These tests verify
 * the store mutation side-effects (cartStore state) rather than render state,
 * since testing useOptimistic directly requires a full React tree with transitions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// ─── Mock cartApi ─────────────────────────────────────────────────────────────
const mockCartAdd = vi.fn()
const mockCartRemove = vi.fn()
const mockCartUpdate = vi.fn()

vi.mock('../../services/dinerApi', () => ({
  cartApi: {
    add: (...args: unknown[]) => mockCartAdd(...args),
    remove: (...args: unknown[]) => mockCartRemove(...args),
    update: (...args: unknown[]) => mockCartUpdate(...args),
  },
}))

// ─── Mock sessionStore (cartStore.addItem reads dinerId internally) ───────────
vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: {
    getState: () => ({
      dinerId: 'diner-1',
      dinerName: 'Test User',
    }),
  },
  selectToken: (s: { token: string | null }) => s.token,
}))

import { useCartStore } from '../../stores/cartStore'
import { useRetryQueueStore } from '../../stores/retryQueueStore'
import { useOptimisticCart } from '../../hooks/useOptimisticCart'

const TEST_PRODUCT = { id: 'prod-42', name: 'Ensalada César', priceCents: 125050 }

describe('useOptimisticCart', () => {
  beforeEach(() => {
    mockCartAdd.mockReset()
    mockCartRemove.mockReset()
    mockCartUpdate.mockReset()
    useCartStore.setState({ items: {}, _processedIds: [] })
    useRetryQueueStore.setState({ queue: [] })
  })

  it('returns empty items array when store is empty', () => {
    mockCartAdd.mockResolvedValue({
      item_id: 1,
      product_id: 42,
      product_name: 'Test',
      quantity: 1,
      notes: '',
      price_cents_snapshot: 125050,
      diner_id: 1,
      diner_name: 'Test',
      added_at: new Date().toISOString(),
    })

    const { result } = renderHook(() => useOptimisticCart())
    expect(result.current.items).toHaveLength(0)
  })

  it('addItem calls cartApi.add with correct payload', async () => {
    mockCartAdd.mockResolvedValue({
      item_id: 101,
      product_id: 42,
      product_name: 'Ensalada César',
      quantity: 1,
      notes: '',
      price_cents_snapshot: 125050,
      diner_id: 1,
      diner_name: 'Test User',
      added_at: new Date().toISOString(),
    })

    const { result } = renderHook(() => useOptimisticCart())

    act(() => {
      result.current.addItem(TEST_PRODUCT, 1)
    })

    await waitFor(() => {
      expect(mockCartAdd).toHaveBeenCalledWith({
        product_id: 'prod-42',
        quantity: 1,
        notes: '',
      })
    })
  })

  it('addItem inserts a tmp_ item into cartStore immediately', async () => {
    mockCartAdd.mockResolvedValue({
      item_id: 101,
      product_id: 42,
      product_name: 'Ensalada César',
      quantity: 1,
      notes: '',
      price_cents_snapshot: 125050,
      diner_id: 1,
      diner_name: 'Test User',
      added_at: new Date().toISOString(),
    })

    const { result } = renderHook(() => useOptimisticCart())

    act(() => {
      result.current.addItem(TEST_PRODUCT, 1)
    })

    // A tmp_ item should be in store immediately (before API resolves)
    const storeState = useCartStore.getState()
    const allIds = Object.keys(storeState.items)
    expect(allIds.some((id) => id.startsWith('tmp_'))).toBe(true)
  })

  it('after successful API call, tmp item is confirmed with real id', async () => {
    // cartApi.add returns a CartItem (already converted from DTO at the API boundary)
    const realItem = {
      id: '101',
      productId: '42',
      productName: 'Ensalada César',
      quantity: 1,
      notes: '',
      priceCentsSnapshot: 125050,
      dinerId: '1',
      dinerName: 'Test User',
      pending: false,
      addedAt: new Date().toISOString(),
    }
    mockCartAdd.mockResolvedValue(realItem)

    const { result } = renderHook(() => useOptimisticCart())

    act(() => {
      result.current.addItem(TEST_PRODUCT, 1)
    })

    // Wait for API to resolve and tmp → real confirmation
    await waitFor(() => {
      const storeItems = Object.values(useCartStore.getState().items)
      return storeItems.length > 0 && !storeItems.some((i) => i.id.startsWith('tmp_'))
    })

    const storeItems = Object.values(useCartStore.getState().items)
    const realEntry = storeItems.find((i) => i.id === '101')
    expect(realEntry).toBeDefined()
  })

  it('after failed API call, tmp item is reverted', async () => {
    mockCartAdd.mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useOptimisticCart())

    act(() => {
      result.current.addItem(TEST_PRODUCT, 1)
    })

    // Wait for revert — store should be empty again
    await waitFor(() => {
      const storeItems = Object.values(useCartStore.getState().items)
      return storeItems.length === 0
    })

    const storeItems = Object.values(useCartStore.getState().items)
    expect(storeItems).toHaveLength(0)
  })

  it('after failed API call, operation is enqueued for retry', async () => {
    mockCartAdd.mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useOptimisticCart())

    act(() => {
      result.current.addItem(TEST_PRODUCT, 1)
    })

    // Wait for enqueue
    await waitFor(() => {
      return useRetryQueueStore.getState().queue.length > 0
    })

    const queue = useRetryQueueStore.getState().queue
    expect(queue[0].operation).toBe('cart.add')
  })

  it('removeItem calls cartApi.remove with itemId', async () => {
    mockCartRemove.mockResolvedValue(undefined)

    useCartStore.setState({
      items: {
        '55': {
          id: '55',
          productId: 'prod-42',
          productName: 'Ensalada César',
          quantity: 1,
          notes: '',
          priceCentsSnapshot: 125050,
          dinerId: 'diner-1',
          dinerName: 'Test User',
          addedAt: new Date().toISOString(),
          pending: false,
        },
      },
      _processedIds: [],
    })

    const { result } = renderHook(() => useOptimisticCart())

    act(() => {
      result.current.removeItem('55')
    })

    await waitFor(() => {
      expect(mockCartRemove).toHaveBeenCalledWith('55')
    })
  })

  it('updateItem calls cartApi.update with correct payload', async () => {
    mockCartUpdate.mockResolvedValue(undefined)

    useCartStore.setState({
      items: {
        '55': {
          id: '55',
          productId: 'prod-42',
          productName: 'Ensalada César',
          quantity: 1,
          notes: '',
          priceCentsSnapshot: 125050,
          dinerId: 'diner-1',
          dinerName: 'Test User',
          addedAt: new Date().toISOString(),
          pending: false,
        },
      },
      _processedIds: [],
    })

    const { result } = renderHook(() => useOptimisticCart())

    act(() => {
      result.current.updateItem('55', { quantity: 3 })
    })

    await waitFor(() => {
      expect(mockCartUpdate).toHaveBeenCalledWith('55', { quantity: 3 })
    })
  })
})
