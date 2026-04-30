/**
 * useRoundsAdminWebSocketSync tests (C-25).
 *
 * Tests:
 * - onFiltered called with correct branchId
 * - onConnectionChange registered
 * - ROUND_* events routed to correct store handlers
 * - Cleanup (unsubscribe) invoked on unmount
 * - Resubscribes when branchId changes
 * - Does not subscribe when branchId is null
 * - On reconnect (isConnected=true) calls fetchRounds with current filters
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRoundsAdminWebSocketSync } from './useRoundsAdminWebSocketSync'
import type { WSEvent } from '@/types/menu'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUnsubscribeFiltered = vi.fn()
const mockUnsubscribeConnection = vi.fn()
const mockOnFiltered = vi.fn(
  (_branchId: string, _event: string, _cb: (e: unknown) => void) => mockUnsubscribeFiltered,
)
const mockOnConnectionChange = vi.fn(
  (_cb: (connected: boolean) => void) => mockUnsubscribeConnection,
)

vi.mock('@/services/websocket', () => ({
  dashboardWS: {
    onFiltered: (branchId: string, event: string, cb: (e: unknown) => void) =>
      mockOnFiltered(branchId, event, cb),
    onConnectionChange: (cb: (connected: boolean) => void) =>
      mockOnConnectionChange(cb),
  },
}))

const mockHandleRoundPending = vi.fn()
const mockHandleRoundConfirmed = vi.fn()
const mockHandleRoundSubmitted = vi.fn()
const mockHandleRoundInKitchen = vi.fn()
const mockHandleRoundReady = vi.fn()
const mockHandleRoundServed = vi.fn()
const mockHandleRoundCanceled = vi.fn()
const mockFetchRounds = vi.fn()

const MOCK_FILTERS = { branch_id: '5', date: '2026-01-01', limit: 50, offset: 0 }

vi.mock('@/stores/roundsAdminStore', () => ({
  useRoundsAdminStore: {
    getState: () => ({
      handleRoundPending: mockHandleRoundPending,
      handleRoundConfirmed: mockHandleRoundConfirmed,
      handleRoundSubmitted: mockHandleRoundSubmitted,
      handleRoundInKitchen: mockHandleRoundInKitchen,
      handleRoundReady: mockHandleRoundReady,
      handleRoundServed: mockHandleRoundServed,
      handleRoundCanceled: mockHandleRoundCanceled,
      fetchRounds: mockFetchRounds,
      filters: MOCK_FILTERS,
    }),
  },
  selectRoundsFilters: (s: { filters?: typeof MOCK_FILTERS }) => s.filters ?? MOCK_FILTERS,
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useRoundsAdminWebSocketSync', () => {
  it('calls onFiltered with correct branchId and wildcard', () => {
    renderHook(() => useRoundsAdminWebSocketSync('5'))
    expect(mockOnFiltered).toHaveBeenCalledWith('5', '*', expect.any(Function))
  })

  it('registers onConnectionChange', () => {
    renderHook(() => useRoundsAdminWebSocketSync('5'))
    expect(mockOnConnectionChange).toHaveBeenCalledWith(expect.any(Function))
  })

  it('does not subscribe when branchId is null', () => {
    renderHook(() => useRoundsAdminWebSocketSync(null))
    expect(mockOnFiltered).not.toHaveBeenCalled()
    expect(mockOnConnectionChange).not.toHaveBeenCalled()
  })

  it('routes ROUND_PENDING to handleRoundPending', () => {
    renderHook(() => useRoundsAdminWebSocketSync('5'))
    const cb = (mockOnFiltered.mock.calls[0] as unknown[])[2] as (e: WSEvent) => void
    const event = { type: 'ROUND_PENDING', data: { id: 1 } } as unknown as WSEvent
    act(() => cb(event))
    expect(mockHandleRoundPending).toHaveBeenCalledWith(event)
  })

  it('routes ROUND_CONFIRMED to handleRoundConfirmed', () => {
    renderHook(() => useRoundsAdminWebSocketSync('5'))
    const cb = (mockOnFiltered.mock.calls[0] as unknown[])[2] as (e: WSEvent) => void
    const event = { type: 'ROUND_CONFIRMED', data: { id: 1 } } as unknown as WSEvent
    act(() => cb(event))
    expect(mockHandleRoundConfirmed).toHaveBeenCalledWith(event)
  })

  it('routes ROUND_CANCELED to handleRoundCanceled', () => {
    renderHook(() => useRoundsAdminWebSocketSync('5'))
    const cb = (mockOnFiltered.mock.calls[0] as unknown[])[2] as (e: WSEvent) => void
    const event = { type: 'ROUND_CANCELED', data: { id: 1 } } as unknown as WSEvent
    act(() => cb(event))
    expect(mockHandleRoundCanceled).toHaveBeenCalledWith(event)
  })

  it('routes ROUND_SERVED to handleRoundServed', () => {
    renderHook(() => useRoundsAdminWebSocketSync('5'))
    const cb = (mockOnFiltered.mock.calls[0] as unknown[])[2] as (e: WSEvent) => void
    const event = { type: 'ROUND_SERVED', data: { id: 1 } } as unknown as WSEvent
    act(() => cb(event))
    expect(mockHandleRoundServed).toHaveBeenCalledWith(event)
  })

  it('ignores non-round events', () => {
    renderHook(() => useRoundsAdminWebSocketSync('5'))
    const cb = (mockOnFiltered.mock.calls[0] as unknown[])[2] as (e: WSEvent) => void
    const event = { type: 'TABLE_STATUS_CHANGED', data: {} } as unknown as WSEvent
    act(() => cb(event))
    expect(mockHandleRoundPending).not.toHaveBeenCalled()
    expect(mockHandleRoundCanceled).not.toHaveBeenCalled()
  })

  it('calls fetchRounds on reconnect (isConnected=true)', () => {
    renderHook(() => useRoundsAdminWebSocketSync('5'))
    const connCb = (mockOnConnectionChange.mock.calls[0] as unknown[])[0] as (b: boolean) => void
    act(() => connCb(true))
    expect(mockFetchRounds).toHaveBeenCalledWith(MOCK_FILTERS)
  })

  it('does not call fetchRounds when connection is lost (false)', () => {
    renderHook(() => useRoundsAdminWebSocketSync('5'))
    const connCb = (mockOnConnectionChange.mock.calls[0] as unknown[])[0] as (b: boolean) => void
    act(() => connCb(false))
    expect(mockFetchRounds).not.toHaveBeenCalled()
  })

  it('calls unsubscribe on unmount', () => {
    const { unmount } = renderHook(() => useRoundsAdminWebSocketSync('5'))
    unmount()
    expect(mockUnsubscribeFiltered).toHaveBeenCalled()
    expect(mockUnsubscribeConnection).toHaveBeenCalled()
  })

  it('resubscribes when branchId changes', () => {
    const { rerender } = renderHook(
      ({ id }: { id: string }) => useRoundsAdminWebSocketSync(id),
      { initialProps: { id: '5' } },
    )
    expect(mockOnFiltered).toHaveBeenCalledTimes(1)
    rerender({ id: '10' })
    expect(mockUnsubscribeFiltered).toHaveBeenCalledTimes(1)
    expect(mockOnFiltered).toHaveBeenCalledWith('10', '*', expect.any(Function))
  })
})
