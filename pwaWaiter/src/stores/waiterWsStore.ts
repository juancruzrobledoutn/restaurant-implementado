/**
 * waiterWsStore — connection state for the /ws/waiter channel.
 *
 * Extended in C-21 to track:
 * - isConnected, reconnectAttempts (from C-20)
 * - staleData: true if catchup was partial or >5 min gap
 *
 * Rules enforced (zustand-store-pattern skill):
 * - NEVER destructure — use named selectors
 * - All state values here are primitives; no useShallow needed
 */
import { create } from 'zustand'

interface WaiterWsState {
  isConnected: boolean
  reconnectAttempts: number
  /** True if last catchup was partial or the offline gap exceeded 5 minutes. */
  isStaleData: boolean

  // actions (called by waiterWsService)
  _setConnected: (connected: boolean) => void
  _incrementReconnect: () => void
  _resetReconnect: () => void
  _setStaleData: (stale: boolean) => void
}

export const useWaiterWsStore = create<WaiterWsState>()((set) => ({
  isConnected: false,
  reconnectAttempts: 0,
  isStaleData: false,

  _setConnected: (connected) => set({ isConnected: connected }),
  _incrementReconnect: () =>
    set((state) => ({ reconnectAttempts: state.reconnectAttempts + 1 })),
  _resetReconnect: () => set({ reconnectAttempts: 0 }),
  _setStaleData: (stale) => set({ isStaleData: stale }),
}))

// ---------------------------------------------------------------------------
// Selectors — NEVER destructure
// ---------------------------------------------------------------------------
export const selectIsConnected = (s: WaiterWsState) => s.isConnected
export const selectReconnectAttempts = (s: WaiterWsState) => s.reconnectAttempts
export const selectIsStaleData = (s: WaiterWsState) => s.isStaleData
export const selectSetConnected = (s: WaiterWsState) => s._setConnected
export const selectIncrementReconnect = (s: WaiterWsState) =>
  s._incrementReconnect
export const selectResetReconnect = (s: WaiterWsState) => s._resetReconnect
export const selectSetStaleData = (s: WaiterWsState) => s._setStaleData
