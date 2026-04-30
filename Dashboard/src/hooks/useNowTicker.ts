/**
 * useNowTicker — returns a Date that updates every `intervalMs` milliseconds.
 *
 * Used by KitchenDisplay to recalculate urgency badges without full re-renders.
 * Default interval: 30 seconds (matches the kitchen card refresh granularity).
 *
 * Usage:
 *   const now = useNowTicker()
 *   const elapsed = differenceInMinutes(now, new Date(round.submitted_at))
 */

import { useState, useEffect } from 'react'

const DEFAULT_INTERVAL_MS = 30_000

export function useNowTicker(intervalMs: number = DEFAULT_INTERVAL_MS): Date {
  const [now, setNow] = useState<Date>(() => new Date())

  useEffect(() => {
    const id = setInterval(() => {
      setNow(new Date())
    }, intervalMs)

    return () => clearInterval(id)
  }, [intervalMs])

  return now
}
