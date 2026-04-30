/**
 * useIdleTimeout tests — verify warning modal timing and logout call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useIdleTimeout } from '@/hooks/useIdleTimeout'

describe('useIdleTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows warning after warningMs and calls onLogout after logoutMs', async () => {
    const onLogout = vi.fn().mockResolvedValue(undefined)

    const { result } = renderHook(() =>
      useIdleTimeout({
        onLogout,
        warningMs: 2_000,
        logoutMs: 3_000, // 1s between warning and logout
      }),
    )

    // Initially no warning
    expect(result.current.showWarning).toBe(false)

    // Advance past warning threshold
    await act(async () => {
      vi.advanceTimersByTime(2_100)
    })
    expect(result.current.showWarning).toBe(true)
    expect(onLogout).not.toHaveBeenCalled()

    // Advance past logout threshold
    await act(async () => {
      vi.advanceTimersByTime(1_100)
    })
    expect(onLogout).toHaveBeenCalledOnce()
  })

  it('resetTimer hides the warning and restarts timers', async () => {
    const onLogout = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useIdleTimeout({
        onLogout,
        warningMs: 2_000,
        logoutMs: 3_000,
      }),
    )

    await act(async () => {
      vi.advanceTimersByTime(2_100)
    })
    expect(result.current.showWarning).toBe(true)

    await act(async () => {
      result.current.resetTimer()
    })
    expect(result.current.showWarning).toBe(false)

    // Warning timer restarts — after another 2.1s it should appear again
    await act(async () => {
      vi.advanceTimersByTime(2_100)
    })
    expect(result.current.showWarning).toBe(true)
  })

  it('activity (click) resets timers before warning fires', async () => {
    const onLogout = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useIdleTimeout({
        onLogout,
        warningMs: 5_000,
        logoutMs: 6_000,
      }),
    )

    // Halfway to warning
    await act(async () => {
      vi.advanceTimersByTime(3_000)
    })
    expect(result.current.showWarning).toBe(false)

    // User activity
    await act(async () => {
      document.dispatchEvent(new MouseEvent('click'))
    })

    // Another 3s — still should NOT trigger because the timer reset
    await act(async () => {
      vi.advanceTimersByTime(3_000)
    })
    expect(result.current.showWarning).toBe(false)
    expect(onLogout).not.toHaveBeenCalled()
  })
})
