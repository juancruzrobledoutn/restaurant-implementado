/**
 * throttle utility tests (C-30).
 *
 * Covers leading+trailing throttle semantics:
 * - First call fires immediately (leading edge)
 * - Subsequent calls within delay are suppressed
 * - Last suppressed call fires after delay (trailing edge)
 * - Timer resets after trailing fires
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { throttle } from './throttle'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('throttle — leading edge', () => {
  it('fires immediately on the first call', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, 300)

    throttled('a')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('a')
  })

  it('does NOT fire again while within the delay window', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, 300)

    throttled('a')
    throttled('b')
    throttled('c')
    // Only leading call should have fired
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('throttle — trailing edge', () => {
  it('fires once after delay with the last suppressed argument', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, 300)

    throttled('a')    // leading — fires
    throttled('b')    // suppressed
    throttled('c')    // suppressed — last value

    expect(fn).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(300)

    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith('c')
  })

  it('does NOT fire trailing if no calls were suppressed', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, 300)

    throttled('a')    // leading — fires, no suppressed calls
    vi.advanceTimersByTime(300)

    // Only the leading call, no trailing
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('throttle — burst of events (mirrors useSalesWebSocketRefresh scenario)', () => {
  it('fires at most 2 times (leading + 1 trailing) for 10 calls in <delay window', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, 3000)

    // Simulate 10 rapid WS events
    for (let i = 0; i < 10; i++) {
      throttled(`event-${i}`)
    }

    expect(fn).toHaveBeenCalledTimes(1) // only leading so far

    vi.advanceTimersByTime(3000)

    expect(fn).toHaveBeenCalledTimes(2) // leading + trailing
    expect(fn).toHaveBeenLastCalledWith('event-9') // last suppressed arg
  })
})

describe('throttle — resets after trailing fires', () => {
  it('fires again (new leading) after the trailing has completed and a new call arrives', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, 300)

    throttled('a')    // leading
    throttled('b')    // suppressed
    vi.advanceTimersByTime(300)  // trailing fires with 'b'

    expect(fn).toHaveBeenCalledTimes(2)

    // New burst — should restart the cycle
    throttled('c')    // new leading
    expect(fn).toHaveBeenCalledTimes(3)
    expect(fn).toHaveBeenLastCalledWith('c')
  })
})
