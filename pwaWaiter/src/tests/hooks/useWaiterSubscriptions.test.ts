/**
 * useWaiterSubscriptions tests — ref pattern validation.
 *
 * Coverage (task 10.5):
 * - useGlobalWaiterSubscriptions: re-render does NOT duplicate subscriptions
 * - useTableSubscriptions: unmount cleans up subscriptions
 * - useTableSubscriptions: returns early (no-op) when sessionId is null
 *
 * We spy on waiterWsService.on / off to count registrations without
 * requiring a real WebSocket connection.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import * as waiterWsModule from '@/services/waiterWs'
import { useGlobalWaiterSubscriptions, useTableSubscriptions } from '@/hooks/useWaiterSubscriptions'

describe('useGlobalWaiterSubscriptions', () => {
  beforeEach(() => {
    // Reset service state
    waiterWsModule.waiterWsService.__reset()
  })

  it('subscribes on mount and cleans up on unmount', () => {
    const onSpy = vi.spyOn(waiterWsModule.waiterWsService, 'on')
    const mockUnsub = vi.fn()
    onSpy.mockReturnValue(mockUnsub)

    const { unmount } = renderHook(() => useGlobalWaiterSubscriptions())

    // Called once for each subscribed event type
    expect(onSpy).toHaveBeenCalled()
    const callCount = onSpy.mock.calls.length

    // unmount — all returned unsub functions should be called
    unmount()
    expect(mockUnsub).toHaveBeenCalledTimes(callCount)

    onSpy.mockRestore()
  })

  it('does NOT add duplicate subscriptions on re-render', () => {
    const onSpy = vi.spyOn(waiterWsModule.waiterWsService, 'on')
    const mockUnsub = vi.fn()
    onSpy.mockReturnValue(mockUnsub)

    const { rerender } = renderHook(() => useGlobalWaiterSubscriptions())

    const callsAfterMount = onSpy.mock.calls.length

    // Re-render multiple times
    rerender()
    rerender()
    rerender()

    // on() should NOT have been called again after mount
    // (Effect B has dep `[]` so it only runs once)
    expect(onSpy.mock.calls.length).toBe(callsAfterMount)

    onSpy.mockRestore()
  })
})

describe('useTableSubscriptions', () => {
  beforeEach(() => {
    waiterWsModule.waiterWsService.__reset()
  })

  it('subscribes when sessionId is provided and unsubscribes on unmount', () => {
    const onSpy = vi.spyOn(waiterWsModule.waiterWsService, 'on')
    const mockUnsub = vi.fn()
    onSpy.mockReturnValue(mockUnsub)

    const { unmount } = renderHook(() =>
      useTableSubscriptions('t-1', 'sess-42'),
    )

    expect(onSpy).toHaveBeenCalled()
    const callCount = onSpy.mock.calls.length

    unmount()
    expect(mockUnsub).toHaveBeenCalledTimes(callCount)

    onSpy.mockRestore()
  })

  it('does NOT subscribe when sessionId is null', () => {
    const onSpy = vi.spyOn(waiterWsModule.waiterWsService, 'on')

    renderHook(() => useTableSubscriptions('t-1', null))

    // Effect B has early return when sessionId is null
    expect(onSpy).not.toHaveBeenCalled()

    onSpy.mockRestore()
  })

  it('re-subscribes when sessionId changes', () => {
    const onSpy = vi.spyOn(waiterWsModule.waiterWsService, 'on')
    const mockUnsub = vi.fn()
    onSpy.mockReturnValue(mockUnsub)

    const { rerender } = renderHook(
      ({ sessionId }: { sessionId: string | null }) =>
        useTableSubscriptions('t-1', sessionId),
      { initialProps: { sessionId: 'sess-1' } },
    )

    const callsAfterMount = onSpy.mock.calls.length
    expect(callsAfterMount).toBeGreaterThan(0)

    // Prev unsubs called, new subs registered
    rerender({ sessionId: 'sess-2' })
    expect(mockUnsub).toHaveBeenCalled()
    expect(onSpy.mock.calls.length).toBeGreaterThan(callsAfterMount)

    onSpy.mockRestore()
  })
})
