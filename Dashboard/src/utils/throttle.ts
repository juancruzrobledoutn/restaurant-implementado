/**
 * throttle — leading + trailing edge throttle utility.
 *
 * - First call fires immediately (leading edge).
 * - Subsequent calls within `delayMs` are suppressed.
 * - The last suppressed call fires after the delay (trailing edge).
 * - The timer resets after the trailing call fires, so a new burst
 *   starts a fresh leading edge.
 *
 * Usage (C-30 — useSalesWebSocketRefresh):
 *   const throttledFetch = throttle(fetchDaily, 3000)
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function throttle<T extends (...args: any[]) => void>(
  fn: T,
  delayMs: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastArgs: Parameters<T> | null = null

  return function throttled(...args: Parameters<T>): void {
    if (timer === null) {
      // Leading edge — fire immediately
      fn(...args)
      timer = setTimeout(() => {
        timer = null
        // Trailing edge — fire only if there was a suppressed call
        if (lastArgs !== null) {
          const argsToCall = lastArgs
          lastArgs = null
          fn(...argsToCall)
        }
      }, delayMs)
    } else {
      // Within delay window — suppress but remember last args for trailing
      lastArgs = args
    }
  }
}
