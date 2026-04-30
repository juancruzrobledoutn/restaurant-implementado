/**
 * Unit tests for cartStore.
 * Tests: optimistic add/remove, WS events (ADDED/UPDATED/REMOVED/CLEARED),
 * event dedup by event_id, tmp↔WS merge.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useCartStore, selectItems, selectTotalCents, selectConfirmedTotalCents, selectMyItems, selectSharedItems } from '../../stores/cartStore'
import type { CartWsEvent } from '../../types/cart'

// Mock sessionStore
vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: {
    getState: () => ({
      dinerId: '8',
      dinerName: 'Test User',
      token: 'tok',
      sessionId: '42',
    }),
  },
}))

function resetStore() {
  useCartStore.setState({ items: {}, _processedIds: [], _processedIdsSet: new Set<string>() })
}

describe('cartStore', () => {
  beforeEach(() => {
    resetStore()
  })

  describe('selectMyItems / selectSharedItems', () => {
    it('distinguishes own items from shared items', () => {
      useCartStore.setState({
        items: {
          'item-1': {
            id: 'item-1',
            productId: 'p1',
            productName: 'Pizza',
            quantity: 1,
            notes: '',
            priceCentsSnapshot: 1000,
            dinerId: '8', // mine
            dinerName: 'Test User',
            pending: false,
            addedAt: new Date().toISOString(),
          },
          'item-2': {
            id: 'item-2',
            productId: 'p2',
            productName: 'Burger',
            quantity: 2,
            notes: '',
            priceCentsSnapshot: 1500,
            dinerId: '9', // other diner
            dinerName: 'Ana',
            pending: false,
            addedAt: new Date().toISOString(),
          },
        },
        _processedIds: [],
      })

      const state = useCartStore.getState()
      const myItems = selectMyItems('8')(state)
      const sharedItems = selectSharedItems('8')(state)

      expect(myItems).toHaveLength(1)
      expect(myItems[0].dinerId).toBe('8')
      expect(sharedItems).toHaveLength(1)
      expect(sharedItems[0].dinerId).toBe('9')
    })
  })

  describe('selectItems — EMPTY_ARRAY stable reference', () => {
    it('returns the same EMPTY_ARRAY reference when no items', () => {
      const state = useCartStore.getState()
      const result1 = selectItems(state)
      const result2 = selectItems(state)
      expect(result1).toBe(result2)
      expect(result1).toHaveLength(0)
    })
  })

  describe('selectTotalCents / selectConfirmedTotalCents', () => {
    it('total includes pending; confirmedTotal excludes pending', () => {
      useCartStore.setState({
        items: {
          'confirmed-1': {
            id: 'confirmed-1',
            productId: 'p1',
            productName: 'A',
            quantity: 2,
            notes: '',
            priceCentsSnapshot: 1000,
            dinerId: '8',
            dinerName: 'Test',
            pending: false,
            addedAt: new Date().toISOString(),
          },
          'tmp-1': {
            id: 'tmp-1',
            productId: 'p2',
            productName: 'B',
            quantity: 1,
            notes: '',
            priceCentsSnapshot: 500,
            dinerId: '8',
            dinerName: 'Test',
            pending: true,
            addedAt: new Date().toISOString(),
          },
        },
        _processedIds: [],
      })

      const state = useCartStore.getState()
      expect(selectTotalCents(state)).toBe(2500)       // 2*1000 + 1*500
      expect(selectConfirmedTotalCents(state)).toBe(2000) // only non-pending
    })
  })

  describe('applyWsEvent — CART_ITEM_ADDED', () => {
    it('inserts item into store', () => {
      const event: CartWsEvent = {
        type: 'CART_ITEM_ADDED',
        event_id: 'e1',
        item: {
          item_id: 55,
          product_id: 42,
          product_name: 'Milanesa',
          quantity: 1,
          notes: '',
          price_cents_snapshot: 8000,
          diner_id: 9,
          diner_name: 'Ana',
          added_at: new Date().toISOString(),
        },
      }
      useCartStore.getState().applyWsEvent(event)

      const state = useCartStore.getState()
      expect(state.items['55']).toBeDefined()
      expect(state.items['55'].dinerName).toBe('Ana')
      expect(state.items['55'].pending).toBe(false)
    })
  })

  describe('applyWsEvent — CART_ITEM_UPDATED', () => {
    it('updates quantity of existing item', () => {
      useCartStore.setState({
        items: {
          '55': {
            id: '55',
            productId: '42',
            productName: 'Milanesa',
            quantity: 1,
            notes: '',
            priceCentsSnapshot: 8000,
            dinerId: '9',
            dinerName: 'Ana',
            pending: false,
            addedAt: new Date().toISOString(),
          },
        },
        _processedIds: [],
      })

      const event: CartWsEvent = {
        type: 'CART_ITEM_UPDATED',
        event_id: 'e2',
        item: { item_id: 55, quantity: 3 },
      }
      useCartStore.getState().applyWsEvent(event)

      expect(useCartStore.getState().items['55'].quantity).toBe(3)
    })
  })

  describe('applyWsEvent — CART_ITEM_REMOVED', () => {
    it('removes the specified item, keeps others', () => {
      useCartStore.setState({
        items: {
          '55': {
            id: '55',
            productId: '42',
            productName: 'A',
            quantity: 1,
            notes: '',
            priceCentsSnapshot: 1000,
            dinerId: '9',
            dinerName: 'Ana',
            pending: false,
            addedAt: new Date().toISOString(),
          },
          '56': {
            id: '56',
            productId: '43',
            productName: 'B',
            quantity: 1,
            notes: '',
            priceCentsSnapshot: 2000,
            dinerId: '9',
            dinerName: 'Ana',
            pending: false,
            addedAt: new Date().toISOString(),
          },
        },
        _processedIds: [],
      })

      const event: CartWsEvent = { type: 'CART_ITEM_REMOVED', event_id: 'e3', item_id: 55 }
      useCartStore.getState().applyWsEvent(event)

      const state = useCartStore.getState()
      expect(state.items['55']).toBeUndefined()
      expect(state.items['56']).toBeDefined()
    })
  })

  describe('applyWsEvent — CART_CLEARED', () => {
    it('empties the entire cart', () => {
      useCartStore.setState({
        items: {
          '1': { id: '1', productId: 'p', productName: 'x', quantity: 1, notes: '', priceCentsSnapshot: 1, dinerId: '9', dinerName: 'x', pending: false, addedAt: '' },
          '2': { id: '2', productId: 'q', productName: 'y', quantity: 1, notes: '', priceCentsSnapshot: 1, dinerId: '9', dinerName: 'y', pending: false, addedAt: '' },
          '3': { id: '3', productId: 'r', productName: 'z', quantity: 1, notes: '', priceCentsSnapshot: 1, dinerId: '9', dinerName: 'z', pending: false, addedAt: '' },
        },
        _processedIds: [],
      })

      const event: CartWsEvent = { type: 'CART_CLEARED', event_id: 'e4' }
      useCartStore.getState().applyWsEvent(event)

      expect(Object.keys(useCartStore.getState().items)).toHaveLength(0)
    })
  })

  describe('deduplication by event_id', () => {
    it('ignores duplicate events with the same event_id', () => {
      const event: CartWsEvent = {
        type: 'CART_ITEM_ADDED',
        event_id: 'e1',
        item: {
          item_id: 55,
          product_id: 42,
          product_name: 'Milanesa',
          quantity: 1,
          notes: '',
          price_cents_snapshot: 8000,
          diner_id: 9,
          diner_name: 'Ana',
          added_at: new Date().toISOString(),
        },
      }

      useCartStore.getState().applyWsEvent(event)
      const countAfterFirst = Object.keys(useCartStore.getState().items).length

      // Send duplicate
      useCartStore.getState().applyWsEvent(event)
      const countAfterDuplicate = Object.keys(useCartStore.getState().items).length

      expect(countAfterFirst).toBe(1)
      expect(countAfterDuplicate).toBe(1) // no change
    })
  })

  describe('tmp↔WS merge', () => {
    it('merges tmp item with incoming CART_ITEM_ADDED if product/diner match within 10s', () => {
      const now = new Date().toISOString()

      // Insert tmp item
      useCartStore.setState({
        items: {
          'tmp_abc': {
            id: 'tmp_abc',
            productId: '42',
            productName: 'Milanesa',
            quantity: 2,
            notes: '',
            priceCentsSnapshot: 12550,
            dinerId: '8',
            dinerName: 'Test User',
            pending: true,
            addedAt: now,
          },
        },
        _processedIds: [],
      })

      // WS event arrives for same product + diner
      const event: CartWsEvent = {
        type: 'CART_ITEM_ADDED',
        event_id: 'e-merge',
        item: {
          item_id: 101,
          product_id: 42,
          product_name: 'Milanesa',
          quantity: 2,
          notes: '',
          price_cents_snapshot: 12550,
          diner_id: 8,
          diner_name: 'Test User',
          added_at: now,
        },
      }

      useCartStore.getState().applyWsEvent(event)

      const state = useCartStore.getState()
      // tmp should be gone, real item should exist
      expect(state.items['tmp_abc']).toBeUndefined()
      expect(state.items['101']).toBeDefined()
      expect(state.items['101'].pending).toBe(false)
    })
  })

  describe('replaceAll', () => {
    it('replaces all items and clears processedIds', () => {
      useCartStore.setState({
        items: { 'old': { id: 'old', productId: 'p', productName: 'x', quantity: 1, notes: '', priceCentsSnapshot: 1, dinerId: '1', dinerName: 'x', pending: false, addedAt: '' } },
        _processedIds: ['e1', 'e2'],
      })

      useCartStore.getState().replaceAll([
        { id: 'new1', productId: 'q', productName: 'y', quantity: 1, notes: '', priceCentsSnapshot: 2, dinerId: '2', dinerName: 'y', pending: false, addedAt: '' },
      ])

      const state = useCartStore.getState()
      expect(state.items['old']).toBeUndefined()
      expect(state.items['new1']).toBeDefined()
      expect(state._processedIds).toHaveLength(0)
    })
  })
})
