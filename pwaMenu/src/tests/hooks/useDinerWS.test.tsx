/**
 * Tests for useDinerWS hook.
 *
 * Tests:
 * - rerender with same token does NOT reconnect (no new WS)
 * - cleanup (unmount) calls disconnect()
 * - different token causes reconnect
 * - wildcard handler receives dispatched events
 * - cleanup unsubscribes wildcard handler
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// ─── Mock dinerWS singleton ───────────────────────────────────────────────────
const mockConnect = vi.fn()
const mockDisconnect = vi.fn()
const mockOn = vi.fn()
let wildcardHandler: ((event: unknown) => void) | null = null

vi.mock('../../services/ws/dinerWS', () => ({
  dinerWS: {
    connect: (...args: unknown[]) => mockConnect(...args),
    disconnect: (...args: unknown[]) => mockDisconnect(...args),
    on: (type: string, handler: (event: unknown) => void) => {
      if (type === '*') {
        wildcardHandler = handler
      }
      mockOn(type, handler)
      return () => {
        wildcardHandler = null
      }
    },
  },
}))

// ─── Mock sessionStore ────────────────────────────────────────────────────────
let mockToken: string | null = 'test-token'

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: (selector: (s: { token: string | null }) => unknown) =>
    selector({ token: mockToken }),
  selectToken: (s: { token: string | null }) => s.token,
}))

import { useDinerWS } from '../../hooks/useDinerWS'

describe('useDinerWS', () => {
  beforeEach(() => {
    mockToken = 'test-token'
    mockConnect.mockReset()
    mockDisconnect.mockReset()
    mockOn.mockReset()
    wildcardHandler = null
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('connects with token on mount', () => {
    renderHook(() => useDinerWS())
    expect(mockConnect).toHaveBeenCalledWith('test-token')
  })

  it('rerender with same token does NOT reconnect', () => {
    const { rerender } = renderHook(() => useDinerWS())
    expect(mockConnect).toHaveBeenCalledTimes(1)

    rerender()
    rerender()

    // connect() should NOT be called again — token didn't change
    expect(mockConnect).toHaveBeenCalledTimes(1)
  })

  it('unmount calls disconnect()', () => {
    const { unmount } = renderHook(() => useDinerWS())
    expect(mockDisconnect).not.toHaveBeenCalled()

    unmount()
    expect(mockDisconnect).toHaveBeenCalledOnce()
  })

  it('subscribes wildcard handler on mount', () => {
    renderHook(() => useDinerWS())
    expect(mockOn).toHaveBeenCalledWith('*', expect.any(Function))
  })

  it('cleanup unsubscribes wildcard handler (wildcardHandler set to null)', () => {
    const { unmount } = renderHook(() => useDinerWS())
    // Handler should be set
    expect(wildcardHandler).not.toBeNull()

    unmount()
    // The unsubscribe returned by on() sets wildcardHandler to null
    expect(wildcardHandler).toBeNull()
  })

  it('dispatches CART_ITEM_ADDED events to onCartAdded handler', () => {
    const onCartAdded = vi.fn()
    renderHook(() => useDinerWS({ onCartAdded }))

    act(() => {
      wildcardHandler?.({ type: 'CART_ITEM_ADDED', event_id: 'ev-1' })
    })

    expect(onCartAdded).toHaveBeenCalledWith({ type: 'CART_ITEM_ADDED', event_id: 'ev-1' })
  })

  it('dispatches ROUND_READY event to onRoundEvent handler', () => {
    const onRoundEvent = vi.fn()
    renderHook(() => useDinerWS({ onRoundEvent }))

    act(() => {
      wildcardHandler?.({ type: 'ROUND_READY', event_id: 'ev-2' })
    })

    expect(onRoundEvent).toHaveBeenCalledWith({ type: 'ROUND_READY', event_id: 'ev-2' })
  })

  it('dispatches TABLE_STATUS_CHANGED to onTableStatusChanged handler', () => {
    const onTableStatusChanged = vi.fn()
    renderHook(() => useDinerWS({ onTableStatusChanged }))

    act(() => {
      wildcardHandler?.({ type: 'TABLE_STATUS_CHANGED', event_id: 'ev-3', status: 'PAYING' })
    })

    expect(onTableStatusChanged).toHaveBeenCalledWith({
      type: 'TABLE_STATUS_CHANGED',
      event_id: 'ev-3',
      status: 'PAYING',
    })
  })

  it('does not connect when token is null', () => {
    mockToken = null
    renderHook(() => useDinerWS())
    expect(mockConnect).not.toHaveBeenCalled()
  })
})
