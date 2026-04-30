/**
 * useTableWebSocketSync — subscribes to TABLE_* WS events and patches
 * the tableStore status field in real-time.
 *
 * Skill: ws-frontend-subscription, zustand-store-pattern
 *
 * Pattern: two-effect ref pattern (same as useMenuWebSocketSync):
 *   Effect 1 (no deps): syncs handleEventRef.current on every render.
 *   Effect 2 ([branchId]): subscribes once per branchId change.
 *
 * Events handled:
 *   TABLE_STATUS_CHANGED  → tableStore.handleTableStatusChanged(event)
 *
 * TABLE_SESSION_STARTED and TABLE_CLEARED are forwarded to the same
 * handleTableStatusChanged handler because the event payload carries
 * the new status value — no separate handler needed.
 */

import { useRef, useEffect } from 'react'
import { dashboardWS } from '@/services/websocket'
import { useTableStore } from '@/stores/tableStore'
import type { WSEvent } from '@/types/menu'

const TABLE_EVENTS = new Set([
  'TABLE_STATUS_CHANGED',
  'TABLE_SESSION_STARTED',
  'TABLE_CLEARED',
])

export function useTableWebSocketSync(branchId: string | null): void {
  // ---------------------------------------------------------------------------
  // Handler routes TABLE_* events to the tableStore.
  // Using getState() avoids stale closure issues without extra deps.
  // ---------------------------------------------------------------------------
  const handleEvent = (event: WSEvent): void => {
    if (!TABLE_EVENTS.has(event.type)) return
    useTableStore.getState().handleTableStatusChanged(event)
  }

  // ---------------------------------------------------------------------------
  // Effect 1: sync ref on every render (no deps — intentional)
  // ---------------------------------------------------------------------------
  const handleEventRef = useRef(handleEvent)
  useEffect(() => {
    handleEventRef.current = handleEvent
  })

  // ---------------------------------------------------------------------------
  // Effect 2: subscribe once per branchId change
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!branchId) return

    const unsubscribe = dashboardWS.onFiltered(
      branchId,
      '*',
      (e) => handleEventRef.current(e),
    )

    return unsubscribe
  }, [branchId])
}
