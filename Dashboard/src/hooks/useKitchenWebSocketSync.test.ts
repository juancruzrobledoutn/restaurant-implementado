/**
 * useKitchenWebSocketSync tests.
 *
 * Tests:
 * - onFiltered is called with branchId and '*'
 * - onConnectionChange is registered
 * - ROUND_SUBMITTED event updates kitchenDisplayStore
 * - onConnectionChange(true) triggers fetchSnapshot
 * - Cleanup (unsubscribe) is invoked on unmount
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useKitchenWebSocketSync } from './useKitchenWebSocketSync'
import type { WSEvent } from '@/types/menu'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUnsubscribeFiltered = vi.fn()
const mockUnsubscribeConnection = vi.fn()
const mockOnFiltered = vi.fn(() => mockUnsubscribeFiltered)
const mockOnConnectionChange = vi.fn(() => mockUnsubscribeConnection)

vi.mock('@/services/websocket', () => ({
  dashboardWS: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onFiltered: (...args: any[]) => (mockOnFiltered as (...a: any[]) => unknown)(...args),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onConnectionChange: (...args: any[]) => (mockOnConnectionChange as (...a: any[]) => unknown)(...args),
  },
}))

const mockHandleRoundSubmitted = vi.fn()
const mockHandleRoundInKitchen = vi.fn()
const mockHandleRoundReady = vi.fn()
const mockHandleRoundCanceled = vi.fn()
const mockFetchSnapshot = vi.fn()

vi.mock('@/stores/kitchenDisplayStore', () => ({
  useKitchenDisplayStore: {
    getState: () => ({
      handleRoundSubmitted: mockHandleRoundSubmitted,
      handleRoundInKitchen: mockHandleRoundInKitchen,
      handleRoundReady: mockHandleRoundReady,
      handleRoundCanceled: mockHandleRoundCanceled,
      fetchSnapshot: mockFetchSnapshot,
    }),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useKitchenWebSocketSync', () => {
  it('calls onFiltered with correct branchId and wildcard type', () => {
    renderHook(() => useKitchenWebSocketSync('100'))
    expect(mockOnFiltered).toHaveBeenCalledWith('100', '*', expect.any(Function))
  })

  it('calls onConnectionChange to subscribe to reconnect', () => {
    renderHook(() => useKitchenWebSocketSync('100'))
    expect(mockOnConnectionChange).toHaveBeenCalledWith(expect.any(Function))
  })

  it('does not subscribe when branchId is null', () => {
    renderHook(() => useKitchenWebSocketSync(null))
    expect(mockOnFiltered).not.toHaveBeenCalled()
    expect(mockOnConnectionChange).not.toHaveBeenCalled()
  })

  it('routes ROUND_SUBMITTED to handleRoundSubmitted', () => {
    renderHook(() => useKitchenWebSocketSync('100'))

    // Get the callback passed to onFiltered
    const eventCallback = (mockOnFiltered.mock.calls[0] as unknown[])[2] as (e: WSEvent) => void

    const event = { type: 'ROUND_SUBMITTED', data: { id: 1 } } as unknown as WSEvent
    act(() => { eventCallback(event) })

    expect(mockHandleRoundSubmitted).toHaveBeenCalledWith(event)
  })

  it('routes ROUND_CANCELED to handleRoundCanceled', () => {
    renderHook(() => useKitchenWebSocketSync('100'))
    const eventCallback = (mockOnFiltered.mock.calls[0] as unknown[])[2] as (e: WSEvent) => void

    const event = { type: 'ROUND_CANCELED', data: { id: 1 } } as unknown as WSEvent
    act(() => { eventCallback(event) })

    expect(mockHandleRoundCanceled).toHaveBeenCalledWith(event)
  })

  it('ignores non-round events', () => {
    renderHook(() => useKitchenWebSocketSync('100'))
    const eventCallback = (mockOnFiltered.mock.calls[0] as unknown[])[2] as (e: WSEvent) => void

    const event = { type: 'ENTITY_UPDATED', data: {} } as unknown as WSEvent
    act(() => { eventCallback(event) })

    expect(mockHandleRoundSubmitted).not.toHaveBeenCalled()
    expect(mockHandleRoundCanceled).not.toHaveBeenCalled()
  })

  it('calls fetchSnapshot when onConnectionChange fires with true', () => {
    renderHook(() => useKitchenWebSocketSync('100'))

    // Get the connection change callback
    const connectionCallback = (mockOnConnectionChange.mock.calls[0] as unknown[])[0] as (b: boolean) => void

    act(() => { connectionCallback(true) })
    expect(mockFetchSnapshot).toHaveBeenCalledWith('100')
  })

  it('does not call fetchSnapshot when connection is lost (false)', () => {
    renderHook(() => useKitchenWebSocketSync('100'))
    const connectionCallback = (mockOnConnectionChange.mock.calls[0] as unknown[])[0] as (b: boolean) => void

    act(() => { connectionCallback(false) })
    expect(mockFetchSnapshot).not.toHaveBeenCalled()
  })

  it('calls unsubscribe functions on unmount', () => {
    const { unmount } = renderHook(() => useKitchenWebSocketSync('100'))
    unmount()
    expect(mockUnsubscribeFiltered).toHaveBeenCalled()
    expect(mockUnsubscribeConnection).toHaveBeenCalled()
  })

  it('resubscribes when branchId changes', () => {
    const { rerender } = renderHook(
      ({ id }: { id: string }) => useKitchenWebSocketSync(id),
      { initialProps: { id: '100' } },
    )

    expect(mockOnFiltered).toHaveBeenCalledTimes(1)

    rerender({ id: '200' })
    // Old subscription unsubscribed, new one created
    expect(mockUnsubscribeFiltered).toHaveBeenCalledTimes(1)
    expect(mockOnFiltered).toHaveBeenCalledWith('200', '*', expect.any(Function))
  })
})
