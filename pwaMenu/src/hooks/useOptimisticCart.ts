/**
 * useOptimisticCart — React 19 useOptimistic wrapper for cart operations.
 *
 * Combines confirmed items from cartStore with in-flight optimistic items.
 * The store is the source of truth; useOptimistic adds render-local immediacy.
 */
import { useOptimistic, useCallback, useMemo } from 'react'
import { useCartStore, selectItemsRecord, EMPTY_ARRAY } from '../stores/cartStore'
import { cartApi } from '../services/dinerApi'
import { useRetryQueueStore } from '../stores/retryQueueStore'
import { logger } from '../utils/logger'
import type { CartItem } from '../types/cart'

type OptimisticAction =
  | { type: 'add'; item: CartItem }
  | { type: 'remove'; id: string }
  | { type: 'update'; id: string; quantity?: number; notes?: string }

function applyOptimisticAction(
  current: CartItem[],
  action: OptimisticAction,
): CartItem[] {
  switch (action.type) {
    case 'add':
      return [...current, action.item]
    case 'remove':
      return current.filter((i) => i.id !== action.id)
    case 'update':
      return current.map((i) =>
        i.id === action.id
          ? {
              ...i,
              quantity: action.quantity ?? i.quantity,
              notes: action.notes ?? i.notes,
              pending: true,
            }
          : i,
      )
  }
}

export interface UseOptimisticCartResult {
  items: CartItem[]
  addItem: (product: { id: string; name: string; priceCents: number }, quantity: number, notes?: string) => void
  removeItem: (itemId: string) => void
  updateItem: (itemId: string, payload: { quantity?: number; notes?: string }) => void
}

export function useOptimisticCart(): UseOptimisticCartResult {
  // Use record selector (stable reference when items don't change) to avoid
  // infinite loops with useOptimistic's useSyncExternalStore internals.
  const itemsRecord = useCartStore(selectItemsRecord)
  const confirmedItems = useMemo(
    () => (Object.keys(itemsRecord).length === 0 ? EMPTY_ARRAY : Object.values(itemsRecord)),
    [itemsRecord],
  )
  const { _confirmItem, _revertItem } = useCartStore.getState()
  const enqueue = useRetryQueueStore((s) => s.enqueue)

  const [optimisticItems, dispatchOptimistic] = useOptimistic<CartItem[], OptimisticAction>(
    confirmedItems as CartItem[],
    applyOptimisticAction,
  )

  const addItem = useCallback(
    (product: { id: string; name: string; priceCents: number }, quantity: number, notes = '') => {
      // Insert optimistic item into the store
      useCartStore.getState().addItem(product, quantity, notes)

      // Find the tmp item just inserted
      const allItems = useCartStore.getState().items
      const tmpEntry = Object.entries(allItems).find(
        ([id, item]) =>
          id.startsWith('tmp_') &&
          item.productId === product.id &&
          item.pending,
      )
      if (!tmpEntry) return
      const [tmpId, tmpItem] = tmpEntry

      // Also show it via useOptimistic for instant render
      dispatchOptimistic({ type: 'add', item: tmpItem })

      // Fire API call
      cartApi
        .add({ product_id: product.id, quantity, notes })
        .then((realItem) => {
          _confirmItem(tmpId, realItem)
        })
        .catch((err) => {
          logger.error('useOptimisticCart: add failed', err)
          _revertItem(tmpId)
          enqueue('cart.add', { product_id: product.id, quantity, notes })
        })
    },
    [dispatchOptimistic, _confirmItem, _revertItem, enqueue],
  )

  const removeItem = useCallback(
    (itemId: string) => {
      dispatchOptimistic({ type: 'remove', id: itemId })
      useCartStore.getState().removeItem(itemId)

      cartApi.remove(itemId).catch((err) => {
        logger.error('useOptimisticCart: remove failed', err)
        enqueue('cart.remove', { itemId })
      })
    },
    [dispatchOptimistic, enqueue],
  )

  const updateItem = useCallback(
    (itemId: string, payload: { quantity?: number; notes?: string }) => {
      dispatchOptimistic({ type: 'update', id: itemId, ...payload })
      useCartStore.getState().updateItem(itemId, payload)

      cartApi.update(itemId, payload).catch((err) => {
        logger.error('useOptimisticCart: update failed', err)
        enqueue('cart.update', { itemId, ...payload })
      })
    },
    [dispatchOptimistic, enqueue],
  )

  return { items: optimisticItems, addItem, removeItem, updateItem }
}
