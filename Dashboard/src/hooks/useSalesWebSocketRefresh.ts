/**
 * useSalesWebSocketRefresh — subscribes to financial WS events and
 * triggers a throttled re-fetch of daily sales KPIs (C-30).
 *
 * Skills: ws-frontend-subscription, zustand-store-pattern
 *
 * Pattern: two-effect ref pattern (same as useTableWebSocketSync):
 *   Effect 1 (no deps): syncs handleEventRef.current on every render.
 *   Effect 2 ([branchId, date]): subscribes once per branchId/date change.
 *
 * Events that trigger re-fetch:
 *   ROUND_SUBMITTED, ROUND_SERVED, ROUND_CANCELED, CHECK_PAID
 *
 * Throttle: 3 seconds, leading + trailing.
 * Rationale: prevents amplifying event bursts during busy service;
 * leading fires immediately, trailing guarantees the last event is captured.
 */

import { useRef, useEffect } from 'react'
import { dashboardWS } from '@/services/websocket'
import { useSalesStore } from '@/stores/salesStore'
import { throttle } from '@/utils/throttle'
import type { WSEvent } from '@/types/menu'

const FINANCIAL_EVENTS = new Set([
  'ROUND_SUBMITTED',
  'ROUND_SERVED',
  'ROUND_CANCELED',
  'CHECK_PAID',
])

const THROTTLE_MS = 3_000

export function useSalesWebSocketRefresh(
  branchId: string | null,
  date: string,
): void {
  // ---------------------------------------------------------------------------
  // Create a stable throttled fetch that persists across renders via ref.
  // We store it in a ref to avoid recreating the throttle timer on each render.
  // ---------------------------------------------------------------------------
  const throttledFetchRef = useRef<((branchId: string, date: string) => void) | null>(null)

  if (throttledFetchRef.current === null) {
    throttledFetchRef.current = throttle(
      (bId: string, d: string) => useSalesStore.getState().fetchDaily(bId, d),
      THROTTLE_MS,
    )
  }

  // ---------------------------------------------------------------------------
  // Handler: filter financial events then invoke throttled fetch.
  // Using useSalesStore.getState() avoids stale closures without extra deps.
  // ---------------------------------------------------------------------------
  const handleEvent = (event: WSEvent): void => {
    if (!FINANCIAL_EVENTS.has(event.type)) return
    throttledFetchRef.current!(branchId!, date)
  }

  // ---------------------------------------------------------------------------
  // Effect 1: sync ref on every render (no deps — intentional)
  // ---------------------------------------------------------------------------
  const handleEventRef = useRef(handleEvent)
  useEffect(() => {
    handleEventRef.current = handleEvent
  })

  // ---------------------------------------------------------------------------
  // Effect 2: subscribe once per [branchId, date] change
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!branchId) return

    const unsubscribe = dashboardWS.onFiltered(
      branchId,
      '*',
      (e) => handleEventRef.current(e),
    )

    return unsubscribe
  }, [branchId, date])
}
