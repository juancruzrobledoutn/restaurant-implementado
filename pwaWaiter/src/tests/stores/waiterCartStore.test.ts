/**
 * waiterCartStore tests — add/update/remove/clear, sessionId isolation.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useWaiterCartStore } from '@/stores/waiterCartStore'

describe('waiterCartStore', () => {
  beforeEach(() => {
    useWaiterCartStore.setState({ bySession: {} })
  })

  it('addItem adds a new item to the session cart', () => {
    const { addItem } = useWaiterCartStore.getState()
    addItem('session-1', 'product-100', 2)

    const items = useWaiterCartStore.getState().bySession['session-1'] ?? []
    expect(items).toHaveLength(1)
    expect(items[0]?.productId).toBe('product-100')
    expect(items[0]?.quantity).toBe(2)
  })

  it('addItem increments quantity if product already exists', () => {
    const { addItem } = useWaiterCartStore.getState()
    addItem('session-1', 'product-100', 1)
    addItem('session-1', 'product-100', 3)

    const items = useWaiterCartStore.getState().bySession['session-1'] ?? []
    expect(items).toHaveLength(1)
    expect(items[0]?.quantity).toBe(4)
  })

  it('updateQuantity sets exact quantity', () => {
    const { addItem, updateQuantity } = useWaiterCartStore.getState()
    addItem('session-1', 'product-100', 5)
    updateQuantity('session-1', 'product-100', 2)

    const items = useWaiterCartStore.getState().bySession['session-1'] ?? []
    expect(items[0]?.quantity).toBe(2)
  })

  it('updateQuantity removes item when quantity <= 0', () => {
    const { addItem, updateQuantity } = useWaiterCartStore.getState()
    addItem('session-1', 'product-100', 1)
    updateQuantity('session-1', 'product-100', 0)

    const items = useWaiterCartStore.getState().bySession['session-1'] ?? []
    expect(items).toHaveLength(0)
  })

  it('removeItem removes the specific product', () => {
    const { addItem, removeItem } = useWaiterCartStore.getState()
    addItem('session-1', 'product-100', 1)
    addItem('session-1', 'product-101', 2)
    removeItem('session-1', 'product-100')

    const items = useWaiterCartStore.getState().bySession['session-1'] ?? []
    expect(items).toHaveLength(1)
    expect(items[0]?.productId).toBe('product-101')
  })

  it('clearCart empties items for the session', () => {
    const { addItem, clearCart } = useWaiterCartStore.getState()
    addItem('session-1', 'product-100', 3)
    clearCart('session-1')

    const items = useWaiterCartStore.getState().bySession['session-1'] ?? []
    expect(items).toHaveLength(0)
  })

  it('sessions are isolated — one cart does not affect another', () => {
    const { addItem } = useWaiterCartStore.getState()
    addItem('session-1', 'product-A', 1)
    addItem('session-2', 'product-B', 2)

    const s1 = useWaiterCartStore.getState().bySession['session-1'] ?? []
    const s2 = useWaiterCartStore.getState().bySession['session-2'] ?? []

    expect(s1).toHaveLength(1)
    expect(s2).toHaveLength(1)
    expect(s1[0]?.productId).toBe('product-A')
    expect(s2[0]?.productId).toBe('product-B')
  })

  it('setNotes updates the notes of an existing item', () => {
    const { addItem, setNotes } = useWaiterCartStore.getState()
    addItem('session-1', 'product-100', 1)
    setNotes('session-1', 'product-100', 'Sin sal')

    const items = useWaiterCartStore.getState().bySession['session-1'] ?? []
    expect(items[0]?.notes).toBe('Sin sal')
  })
})
