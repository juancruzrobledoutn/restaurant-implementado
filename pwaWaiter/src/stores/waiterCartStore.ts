/**
 * waiterCartStore — local cart for the waiter quick-order flow.
 *
 * Shape: Record<sessionId, CartItem[]>
 * The cart is ephemeral (in-memory only) and scoped per tableSession.
 * It is NOT shared with the pwaMenu diner cart.
 *
 * Rules (zustand-store-pattern skill):
 * - NEVER destructure — use named selectors
 * - useShallow for array selectors
 * - EMPTY_ARRAY stable fallback (never inline `?? []`)
 */

import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { EMPTY_ARRAY } from '@/lib/constants'
import type { CartItem } from '@/lib/cartMath'

// Re-export CartItem for consumers
export type { CartItem }

interface WaiterCartState {
  /** Map of sessionId → array of cart items */
  bySession: Record<string, CartItem[]>

  // Actions
  addItem: (sessionId: string, productId: string, quantity: number, notes?: string) => void
  updateQuantity: (sessionId: string, productId: string, quantity: number) => void
  removeItem: (sessionId: string, productId: string) => void
  clearCart: (sessionId: string) => void
  setNotes: (sessionId: string, productId: string, notes: string) => void
}

// Stable empty fallback
const EMPTY_ITEMS: CartItem[] = EMPTY_ARRAY as unknown as CartItem[]

export const useWaiterCartStore = create<WaiterCartState>()((set) => ({
  bySession: {},

  // ------------------------------------------------------------------
  // addItem — adds or increments quantity if product already in cart
  // ------------------------------------------------------------------
  addItem: (sessionId, productId, quantity, notes) =>
    set((state) => {
      const current = state.bySession[sessionId] ?? []
      const existingIdx = current.findIndex((i) => i.productId === productId)

      let next: CartItem[]
      if (existingIdx !== -1) {
        next = current.slice()
        const existing = next[existingIdx]!
        next[existingIdx] = { ...existing, quantity: existing.quantity + quantity }
      } else {
        next = [...current, { productId, quantity, notes }]
      }

      return { bySession: { ...state.bySession, [sessionId]: next } }
    }),

  // ------------------------------------------------------------------
  // updateQuantity — set exact quantity (removes item if quantity <= 0)
  // ------------------------------------------------------------------
  updateQuantity: (sessionId, productId, quantity) =>
    set((state) => {
      const current = state.bySession[sessionId] ?? []
      let next: CartItem[]
      if (quantity <= 0) {
        next = current.filter((i) => i.productId !== productId)
      } else {
        next = current.map((i) =>
          i.productId === productId ? { ...i, quantity } : i,
        )
      }
      return { bySession: { ...state.bySession, [sessionId]: next } }
    }),

  // ------------------------------------------------------------------
  // removeItem
  // ------------------------------------------------------------------
  removeItem: (sessionId, productId) =>
    set((state) => {
      const current = state.bySession[sessionId] ?? []
      const next = current.filter((i) => i.productId !== productId)
      return { bySession: { ...state.bySession, [sessionId]: next } }
    }),

  // ------------------------------------------------------------------
  // clearCart — clears all items for a session (after successful order)
  // ------------------------------------------------------------------
  clearCart: (sessionId) =>
    set((state) => ({
      bySession: { ...state.bySession, [sessionId]: EMPTY_ITEMS },
    })),

  // ------------------------------------------------------------------
  // setNotes
  // ------------------------------------------------------------------
  setNotes: (sessionId, productId, notes) =>
    set((state) => {
      const current = state.bySession[sessionId] ?? []
      const next = current.map((i) =>
        i.productId === productId ? { ...i, notes } : i,
      )
      return { bySession: { ...state.bySession, [sessionId]: next } }
    }),
}))

// ---------------------------------------------------------------------------
// Selectors — NEVER destructure
// ---------------------------------------------------------------------------

/** Cart items for a specific session — uses useShallow for stable reference. */
export function useCartItems(sessionId: string): CartItem[] {
  return useWaiterCartStore(
    useShallow((s) => s.bySession[sessionId] ?? EMPTY_ITEMS),
  )
}

/** Item count for a session (primitive — plain selector). */
export const selectCartItemCount = (sessionId: string) => (s: WaiterCartState): number =>
  (s.bySession[sessionId] ?? EMPTY_ITEMS).length

/** Total quantity across all items in a session. */
export const selectCartTotalQuantity = (sessionId: string) => (s: WaiterCartState): number =>
  (s.bySession[sessionId] ?? EMPTY_ITEMS).reduce((sum, i) => sum + i.quantity, 0)

