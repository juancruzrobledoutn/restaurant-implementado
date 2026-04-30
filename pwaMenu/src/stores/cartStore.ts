/**
 * Cart store for pwaMenu.
 *
 * Maintains a shared cart for the current table session.
 * Items are keyed by item_id (string). Optimistic items use `tmp_<uuid>` prefix.
 * All WS events are deduplicated via a FIFO Set (capacity 200).
 *
 * Patterns:
 * - NEVER destructure from store — use selectors
 * - useShallow for object/array selectors
 * - EMPTY_ARRAY / EMPTY_RECORD as stable fallbacks
 */
import { create } from 'zustand'
import { toStringId, toNumberId } from '../utils/idConversion'
import { logger } from '../utils/logger'
import { useSessionStore } from './sessionStore'
import type { CartItem, CartWsEvent } from '../types/cart'

// --- Stable fallbacks (reference-stable) ---
// `readonly never[]` prevents accidental mutation and is assignable to `readonly T[]`.
// Use `as unknown as T[]` when the store interface requires a mutable array type.
export const EMPTY_ARRAY: readonly never[] = Object.freeze([])
export const EMPTY_RECORD: Record<string, CartItem> = {}

// --- FIFO event-id deduplication ---
const EVENT_ID_CAPACITY = 200

// --- Tmp item merge window ---
const TMP_MERGE_WINDOW_MS = 10_000 // 10 seconds

function findTmpMatch(
  items: Record<string, CartItem>,
  productId: string,
  dinerId: string,
): string | null {
  const now = Date.now()
  for (const [id, item] of Object.entries(items)) {
    if (
      id.startsWith('tmp_') &&
      item.productId === productId &&
      item.dinerId === dinerId &&
      now - new Date(item.addedAt).getTime() < TMP_MERGE_WINDOW_MS
    ) {
      return id
    }
  }
  return null
}

// --- Store state interface ---

interface CartState {
  items: Record<string, CartItem>
  /** FIFO dedup set for processed event_ids. Using Set for O(1) has() instead of O(n) includes(). */
  _processedIds: string[] // FIFO list for eviction ordering
  _processedIdsSet: Set<string> // Set for O(1) lookup

  // Selectors (exported separately below)
  // Actions
  addItem: (product: { id: string; name: string; priceCents: number }, quantity: number, notes?: string) => void
  updateItem: (itemId: string, payload: { quantity?: number; notes?: string }) => void
  removeItem: (itemId: string) => void
  clear: () => void
  applyWsEvent: (event: CartWsEvent) => void
  replaceAll: (items: CartItem[]) => void

  /** Idempotent insert: adds item only if its id is not already in the store. */
  addIfAbsent: (item: CartItem) => void
  // Internal: confirm tmp item with real id
  _confirmItem: (tmpId: string, realItem: CartItem) => void
  _revertItem: (tmpId: string) => void
}

export const useCartStore = create<CartState>()((set, get) => ({
  items: EMPTY_RECORD,
  _processedIds: [],
  _processedIdsSet: new Set<string>(),

  addItem(product, quantity, notes = '') {
    const sessionState = useSessionStore.getState()
    const dinerId = sessionState.dinerId ?? 'unknown'
    const dinerName = sessionState.dinerName ?? 'unknown'
    const tmpId = `tmp_${crypto.randomUUID()}`
    const addedAt = new Date().toISOString()

    const optimisticItem: CartItem = {
      id: tmpId,
      productId: product.id,
      productName: product.name,
      quantity,
      notes,
      priceCentsSnapshot: product.priceCents,
      dinerId,
      dinerName,
      pending: true,
      addedAt,
    }

    set((state) => ({
      items: { ...state.items, [tmpId]: optimisticItem },
    }))

    // API call is handled by the caller (useOptimisticCart hook or component)
    // This action just inserts the optimistic entry. Confirmation/revert is done
    // via _confirmItem / _revertItem after the API responds.
  },

  updateItem(itemId, payload) {
    set((state) => {
      const item = state.items[itemId]
      if (!item) return state
      return {
        items: {
          ...state.items,
          [itemId]: { ...item, ...payload, pending: true },
        },
      }
    })
  },

  removeItem(itemId) {
    set((state) => {
      const { [itemId]: _removed, ...rest } = state.items
      return { items: rest }
    })
  },

  clear() {
    set({ items: EMPTY_RECORD })
  },

  applyWsEvent(event) {
    const { _processedIds, _processedIdsSet, items } = get()

    // Deduplication — O(1) Set lookup instead of O(n) Array.includes
    if (_processedIdsSet.has(event.event_id)) {
      logger.debug('cartStore: duplicate event_id ignored', { event_id: event.event_id })
      return
    }

    // Update FIFO dedup structures: evict oldest from both array and Set
    const nextIds = [..._processedIds]
    const nextSet = new Set(_processedIdsSet)
    if (nextIds.length >= EVENT_ID_CAPACITY) {
      const evicted = nextIds.shift()
      if (evicted !== undefined) nextSet.delete(evicted)
    }
    nextIds.push(event.event_id)
    nextSet.add(event.event_id)

    switch (event.type) {
      case 'CART_ITEM_ADDED': {
        // TypeScript narrows `event` to CartItemAddedEvent automatically here
        const realId = toStringId(event.item.item_id)
        const productId = toStringId(event.item.product_id)
        const dinerId = toStringId(event.item.diner_id)

        // Check for tmp item to merge
        const tmpId = findTmpMatch(items, productId, dinerId)

        const realItem: CartItem = {
          id: realId,
          productId,
          productName: event.item.product_name,
          quantity: event.item.quantity,
          notes: event.item.notes,
          priceCentsSnapshot: event.item.price_cents_snapshot,
          dinerId,
          dinerName: event.item.diner_name,
          pending: false,
          addedAt: event.item.added_at,
        }

        set((state) => {
          const next = { ...state.items }
          if (tmpId) delete next[tmpId]
          next[realId] = realItem
          return { items: next, _processedIds: nextIds, _processedIdsSet: nextSet }
        })
        break
      }

      case 'CART_ITEM_UPDATED': {
        // TypeScript narrows `event` to CartItemUpdatedEvent automatically here
        const itemId = toStringId(event.item.item_id)
        set((state) => {
          const existing = state.items[itemId]
          if (!existing) {
            // Item not found — apply as best-effort (create minimal entry)
            return { _processedIds: nextIds, _processedIdsSet: nextSet }
          }
          return {
            items: {
              ...state.items,
              [itemId]: {
                ...existing,
                quantity: event.item.quantity ?? existing.quantity,
                notes: event.item.notes ?? existing.notes,
                pending: false,
              },
            },
            _processedIds: nextIds,
            _processedIdsSet: nextSet,
          }
        })
        break
      }

      case 'CART_ITEM_REMOVED': {
        // TypeScript narrows `event` to CartItemRemovedEvent automatically here
        const itemId = toStringId(event.item_id)
        set((state) => {
          const { [itemId]: _removed, ...rest } = state.items
          return { items: rest, _processedIds: nextIds, _processedIdsSet: nextSet }
        })
        break
      }

      case 'CART_CLEARED': {
        set({ items: EMPTY_RECORD, _processedIds: nextIds, _processedIdsSet: nextSet })
        break
      }

      default:
        set({ _processedIds: nextIds, _processedIdsSet: nextSet })
    }
  },

  replaceAll(items) {
    const record: Record<string, CartItem> = {}
    for (const item of items) {
      record[item.id] = item
    }
    set({ items: record, _processedIds: [], _processedIdsSet: new Set<string>() })
  },

  addIfAbsent(item) {
    set((state) => {
      if (item.id in state.items) {
        // Already present — server persisted before retry ran — skip to avoid duplicate
        logger.debug('cartStore: addIfAbsent skipped — item already present', { id: item.id })
        return state
      }
      return { items: { ...state.items, [item.id]: item } }
    })
  },

  _confirmItem(tmpId, realItem) {
    set((state) => {
      const next = { ...state.items }
      delete next[tmpId]
      next[realItem.id] = realItem
      return { items: next }
    })
  },

  _revertItem(tmpId) {
    set((state) => {
      const { [tmpId]: _removed, ...rest } = state.items
      return { items: rest }
    })
  },
}))

// --- Selectors ---

export const selectItems = (s: CartState): CartItem[] =>
  Object.keys(s.items).length === 0 ? (EMPTY_ARRAY as unknown as CartItem[]) : Object.values(s.items)

export const selectItemsRecord = (s: CartState): Record<string, CartItem> => s.items

export const selectItemCount = (s: CartState): number =>
  Object.values(s.items).reduce((acc, item) => acc + item.quantity, 0)

export const selectTotalCents = (s: CartState): number =>
  Object.values(s.items).reduce(
    (acc, item) => acc + item.priceCentsSnapshot * item.quantity,
    0,
  )

export const selectConfirmedTotalCents = (s: CartState): number =>
  Object.values(s.items)
    .filter((item) => !item.pending)
    .reduce((acc, item) => acc + item.priceCentsSnapshot * item.quantity, 0)

/**
 * Factory selector: returns items belonging to the current diner.
 * Use with useShallow since it returns an array.
 */
export function selectMyItems(dinerId: string) {
  return (s: CartState): CartItem[] =>
    Object.values(s.items).filter((item) => item.dinerId === dinerId)
}

/**
 * Factory selector: returns items from other diners.
 * Use with useShallow since it returns an array.
 */
export function selectSharedItems(dinerId: string) {
  return (s: CartState): CartItem[] =>
    Object.values(s.items).filter((item) => item.dinerId !== dinerId)
}

// Re-export for external use
export { toStringId, toNumberId }
