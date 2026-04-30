/**
 * useSalesWebSocketRefresh hook tests (C-30).
 *
 * Skills: ws-frontend-subscription, test-driven-development
 *
 * Covers:
 * - Throttle: leading + trailing, max 2 fetches in a burst of 10 events in <3s
 * - Filtering: only ROUND_SUBMITTED/SERVED/CANCELED and CHECK_PAID trigger fetch
 * - ROUND_IN_KITCHEN does NOT trigger a fetch
 * - Cleanup: returns unsubscribe on unmount
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { act } from 'react'

// Mock dashboardWS
const mockOnFiltered = vi.fn()
const mockUnsubscribe = vi.fn()

vi.mock('@/services/websocket', () => ({
  dashboardWS: {
    onFiltered: (...args: unknown[]) => {
      mockOnFiltered(...args)
      return mockUnsubscribe
    },
  },
}))

// Mock salesStore
const mockFetchDaily = vi.fn()

vi.mock('@/stores/salesStore', () => ({
  useSalesStore: {
    getState: () => ({ fetchDaily: mockFetchDaily }),
  },
}))

import { useSalesWebSocketRefresh } from './useSalesWebSocketRefresh'

type WSHandler = (event: { type: string; branch_id?: string }) => void

function getRegisteredHandler(): WSHandler {
  // The third argument to onFiltered is the handler
  const lastCall = mockOnFiltered.mock.calls[mockOnFiltered.mock.calls.length - 1]
  return lastCall![2] as WSHandler
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('subscription', () => {
  it('subscribes to dashboardWS.onFiltered with the given branchId', () => {
    renderHook(() => useSalesWebSocketRefresh('branch-1', '2026-04-21'))
    expect(mockOnFiltered).toHaveBeenCalledWith('branch-1', '*', expect.any(Function))
  })

  it('does NOT subscribe when branchId is null', () => {
    renderHook(() => useSalesWebSocketRefresh(null, '2026-04-21'))
    expect(mockOnFiltered).not.toHaveBeenCalled()
  })

  it('calls unsubscribe on unmount', () => {
    const { unmount } = renderHook(() => useSalesWebSocketRefresh('branch-1', '2026-04-21'))
    unmount()
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1)
  })

  it('re-subscribes when branchId changes', () => {
    const { rerender } = renderHook(
      ({ branchId }: { branchId: string | null }) =>
        useSalesWebSocketRefresh(branchId, '2026-04-21'),
      { initialProps: { branchId: 'branch-1' as string | null } },
    )

    expect(mockOnFiltered).toHaveBeenCalledTimes(1)

    rerender({ branchId: 'branch-2' })

    // Old subscription cleaned up, new one created
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1)
    expect(mockOnFiltered).toHaveBeenCalledTimes(2)
    expect(mockOnFiltered).toHaveBeenLastCalledWith('branch-2', '*', expect.any(Function))
  })
})

describe('event filtering', () => {
  const FINANCIAL_EVENTS = [
    'ROUND_SUBMITTED',
    'ROUND_SERVED',
    'ROUND_CANCELED',
    'CHECK_PAID',
  ]

  const NON_FINANCIAL_EVENTS = [
    'ROUND_IN_KITCHEN',
    'TABLE_STATUS_CHANGED',
    'TABLE_SESSION_STARTED',
    'TABLE_CLEARED',
    'MENU_UPDATED',
  ]

  FINANCIAL_EVENTS.forEach((eventType) => {
    it(`fires fetchDaily on ${eventType}`, () => {
      renderHook(() => useSalesWebSocketRefresh('branch-1', '2026-04-21'))
      const handler = getRegisteredHandler()

      act(() => {
        handler({ type: eventType, branch_id: 'branch-1' })
      })

      expect(mockFetchDaily).toHaveBeenCalledTimes(1)
      expect(mockFetchDaily).toHaveBeenCalledWith('branch-1', '2026-04-21')
    })
  })

  NON_FINANCIAL_EVENTS.forEach((eventType) => {
    it(`does NOT fire fetchDaily on ${eventType}`, () => {
      renderHook(() => useSalesWebSocketRefresh('branch-1', '2026-04-21'))
      const handler = getRegisteredHandler()

      act(() => {
        handler({ type: eventType, branch_id: 'branch-1' })
      })

      expect(mockFetchDaily).not.toHaveBeenCalled()
    })
  })
})

describe('throttle — burst of 10 events in <3s yields max 2 fetches', () => {
  it('fires only leading + 1 trailing fetch for a rapid burst', () => {
    renderHook(() => useSalesWebSocketRefresh('branch-1', '2026-04-21'))
    const handler = getRegisteredHandler()

    act(() => {
      for (let i = 0; i < 10; i++) {
        handler({ type: 'ROUND_SUBMITTED', branch_id: 'branch-1' })
      }
    })

    // Leading call only
    expect(mockFetchDaily).toHaveBeenCalledTimes(1)

    // Advance past the 3s throttle window to trigger trailing
    act(() => {
      vi.advanceTimersByTime(3000)
    })

    // Leading + trailing = exactly 2 fetches
    expect(mockFetchDaily).toHaveBeenCalledTimes(2)
  })
})
