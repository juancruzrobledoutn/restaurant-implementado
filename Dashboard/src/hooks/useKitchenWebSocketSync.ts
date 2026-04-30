/**
 * useKitchenWebSocketSync — subscribes to kitchen round WS events and
 * patches the kitchenDisplayStore in real-time.
 *
 * Skill: ws-frontend-subscription, zustand-store-pattern
 *
 * Pattern: two-effect ref pattern (same as useMenuWebSocketSync) to avoid
 * listener accumulation:
 *   Effect 1 (no deps): syncs handleEventRef.current on every render.
 *   Effect 2 ([branchId]): subscribes once per branchId change.
 *
 * Reconnect handling: registers an onConnectionChange listener that
 * calls fetchSnapshot(branchId) when the WS reconnects, so stale data
 * is replaced with a fresh snapshot from the server.
 */

import { useRef, useEffect } from 'react'
import { dashboardWS } from '@/services/websocket'
import { useKitchenDisplayStore } from '@/stores/kitchenDisplayStore'
import type { WSEvent } from '@/types/menu'

const ROUND_EVENTS = new Set([
  'ROUND_SUBMITTED',
  'ROUND_IN_KITCHEN',
  'ROUND_READY',
  'ROUND_CANCELED',
])

export function useKitchenWebSocketSync(branchId: string | null): void {
  // ---------------------------------------------------------------------------
  // Build the per-event handler that routes to store actions.
  // Using getState() avoids stale closure issues without adding deps.
  // ---------------------------------------------------------------------------
  const handleEvent = (event: WSEvent): void => {
    if (!ROUND_EVENTS.has(event.type)) return

    const store = useKitchenDisplayStore.getState()

    switch (event.type) {
      case 'ROUND_SUBMITTED':
        store.handleRoundSubmitted(event)
        break
      case 'ROUND_IN_KITCHEN':
        store.handleRoundInKitchen(event)
        break
      case 'ROUND_READY':
        store.handleRoundReady(event)
        break
      case 'ROUND_CANCELED':
        store.handleRoundCanceled(event)
        break
    }
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

    // Subscribe to all round events for this branch
    const unsubscribeEvents = dashboardWS.onFiltered(
      branchId,
      '*',
      (e) => handleEventRef.current(e),
    )

    // On reconnect, refresh the full snapshot to avoid stale data
    const unsubscribeConnection = dashboardWS.onConnectionChange((isConnected) => {
      if (isConnected) {
        useKitchenDisplayStore.getState().fetchSnapshot(branchId)
      }
    })

    return () => {
      unsubscribeEvents()
      unsubscribeConnection()
    }
  }, [branchId])
}
