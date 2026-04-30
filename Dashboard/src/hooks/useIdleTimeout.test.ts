/**
 * useIdleTimeout tests.
 *
 * Tests: warning fires after timeout, activity resets timer,
 * logout fires after extended inactivity.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useIdleTimeout } from './useIdleTimeout'
import { IDLE_WARNING_MS, IDLE_LOGOUT_MS } from '@/utils/constants'

// Mock constants to use small values for testing
vi.mock('@/utils/constants', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/utils/constants')>()
  return {
    ...original,
    IDLE_WARNING_MS: 1_500_000, // use real values but we'll override via props
    IDLE_LOGOUT_MS: 1_800_000,
  }
})

vi.mock('@/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

describe('useIdleTimeout', () => {
  const mockLogout = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    vi.useFakeTimers()
    mockLogout.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows warning after warningMs of inactivity', () => {
    const WARNING_MS = 5_000
    const LOGOUT_MS = 10_000

    const { result } = renderHook(() =>
      useIdleTimeout({ onLogout: mockLogout, warningMs: WARNING_MS, logoutMs: LOGOUT_MS })
    )

    expect(result.current.showWarning).toBe(false)

    act(() => {
      vi.advanceTimersByTime(WARNING_MS + 100)
    })

    expect(result.current.showWarning).toBe(true)
  })

  it('calls logout after logoutMs of inactivity', async () => {
    const WARNING_MS = 1_000
    const LOGOUT_MS = 2_000

    renderHook(() =>
      useIdleTimeout({ onLogout: mockLogout, warningMs: WARNING_MS, logoutMs: LOGOUT_MS })
    )

    await act(async () => {
      vi.advanceTimersByTime(LOGOUT_MS + 100)
      // Allow any pending promises to resolve
      await Promise.resolve()
    })

    expect(mockLogout).toHaveBeenCalledTimes(1)
  })

  it('resets timer on activity', () => {
    const WARNING_MS = 5_000
    const LOGOUT_MS = 10_000

    const { result } = renderHook(() =>
      useIdleTimeout({ onLogout: mockLogout, warningMs: WARNING_MS, logoutMs: LOGOUT_MS })
    )

    // Advance almost to warning
    act(() => {
      vi.advanceTimersByTime(WARNING_MS - 1_000)
    })

    // Simulate activity — fire a mousemove event
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove'))
    })

    // Advance again — but since timer was reset, warning should not show yet
    act(() => {
      vi.advanceTimersByTime(WARNING_MS - 1_000)
    })

    expect(result.current.showWarning).toBe(false)
    expect(mockLogout).not.toHaveBeenCalled()
  })

  it('dismissing warning resets timer', () => {
    const WARNING_MS = 2_000
    const LOGOUT_MS = 4_000

    const { result } = renderHook(() =>
      useIdleTimeout({ onLogout: mockLogout, warningMs: WARNING_MS, logoutMs: LOGOUT_MS })
    )

    // Trigger warning
    act(() => {
      vi.advanceTimersByTime(WARNING_MS + 100)
    })
    expect(result.current.showWarning).toBe(true)

    // Dismiss warning
    act(() => {
      result.current.resetTimer()
    })
    expect(result.current.showWarning).toBe(false)
  })

  it('does not call logout when timer is reset before logoutMs', async () => {
    const WARNING_MS = 1_000
    const LOGOUT_MS = 2_000

    renderHook(() =>
      useIdleTimeout({ onLogout: mockLogout, warningMs: WARNING_MS, logoutMs: LOGOUT_MS })
    )

    // Advance to just before logout, then simulate activity
    act(() => {
      vi.advanceTimersByTime(LOGOUT_MS - 200)
    })

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove'))
    })

    // Give time for activity to be processed
    await act(async () => {
      vi.advanceTimersByTime(100)
      await Promise.resolve()
    })

    expect(mockLogout).not.toHaveBeenCalled()
  })

  it('exports correct IDLE constants', () => {
    expect(IDLE_WARNING_MS).toBe(1_500_000)
    expect(IDLE_LOGOUT_MS).toBe(1_800_000)
  })
})
