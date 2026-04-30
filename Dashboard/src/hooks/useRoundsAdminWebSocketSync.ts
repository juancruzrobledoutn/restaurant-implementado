/**
 * useRoundsAdminWebSocketSync — subscribes to ROUND_* events and patches
 * the roundsAdminStore in real-time (C-25).
 *
 * Skill: ws-frontend-subscription, zustand-store-pattern
 *
 * Pattern: two-effect ref pattern to avoid listener accumulation:
 *   Effect 1 (no deps): syncs handleEventRef.current on every render.
 *   Effect 2 ([branchId]): subscribes once per branchId change; returns unsubscribe.
 *
 * On reconnect: calls fetchRounds(currentFilters) to reconcile state with
 *   the server in case events were missed during the disconnection window.
 *
 * ROUND_* events handled:
 *   ROUND_PENDING, ROUND_CONFIRMED, ROUND_SUBMITTED,
 *   ROUND_IN_KITCHEN, ROUND_READY, ROUND_SERVED, ROUND_CANCELED
 */

import { useRef, useEffect } from 'react'
import { dashboardWS } from '@/services/websocket'
import {
  useRoundsAdminStore,
  selectRoundsFilters,
} from '@/stores/roundsAdminStore'
import type { WSEvent } from '@/types/menu'

const ROUND_EVENTS = new Set([
  'ROUND_PENDING',
  'ROUND_CONFIRMED',
  'ROUND_SUBMITTED',
  'ROUND_IN_KITCHEN',
  'ROUND_READY',
  'ROUND_SERVED',
  'ROUND_CANCELED',
])

export function useRoundsAdminWebSocketSync(branchId: string | null): void {
  // ---------------------------------------------------------------------------
  // Effect 1: sync ref on every render (no deps — intentional)
  // Always points at the latest store handlers without re-subscribing.
  // ---------------------------------------------------------------------------
  const handleEvent = (event: WSEvent): void => {
    if (!ROUND_EVENTS.has(event.type)) return

    const store = useRoundsAdminStore.getState()

    switch (event.type) {
      case 'ROUND_PENDING':
        store.handleRoundPending(event)
        break
      case 'ROUND_CONFIRMED':
        store.handleRoundConfirmed(event)
        break
      case 'ROUND_SUBMITTED':
        store.handleRoundSubmitted(event)
        break
      case 'ROUND_IN_KITCHEN':
        store.handleRoundInKitchen(event)
        break
      case 'ROUND_READY':
        store.handleRoundReady(event)
        break
      case 'ROUND_SERVED':
        store.handleRoundServed(event)
        break
      case 'ROUND_CANCELED':
        store.handleRoundCanceled(event)
        break
    }
  }

  const handleEventRef = useRef(handleEvent)
  useEffect(() => {
    handleEventRef.current = handleEvent
  })

  // ---------------------------------------------------------------------------
  // Effect 2: subscribe once per branchId change
  // Returns unsubscribe in cleanup — no listener leaks on branch change or unmount.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!branchId) return

    // Subscribe to all round events for this branch
    const unsubscribeEvents = dashboardWS.onFiltered(
      branchId,
      '*',
      (e) => handleEventRef.current(e),
    )

    // On reconnect, refetch to reconcile missed events
    const unsubscribeConnection = dashboardWS.onConnectionChange((isConnected) => {
      if (isConnected) {
        const currentFilters = selectRoundsFilters(useRoundsAdminStore.getState())
        useRoundsAdminStore.getState().fetchRounds(currentFilters)
      }
    })

    return () => {
      unsubscribeEvents()
      unsubscribeConnection()
    }
  }, [branchId])
}
