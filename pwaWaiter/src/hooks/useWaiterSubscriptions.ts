/**
 * useWaiterSubscriptions — ref pattern hooks for WS event subscriptions.
 *
 * Follows the two-effects ref pattern (ws-frontend-subscription skill):
 * - Effect A (dep `[]`): sync handler ref on every render
 * - Effect B (dep `[sessionId]` or `[]`): subscribe once, return unsubscribe
 *
 * Two variants:
 * - `useGlobalWaiterSubscriptions()` — for /tables (all table events)
 * - `useTableSubscriptions(tableId, sessionId)` — for /tables/:tableId detail
 */

import { useRef, useEffect } from 'react'
import { waiterWsService } from '@/services/waiterWs'
import { useTableStore } from '@/stores/tableStore'
import { useRoundsStore } from '@/stores/roundsStore'
import { useServiceCallsStore } from '@/stores/serviceCallsStore'
import { logger } from '@/utils/logger'
import type { WaiterEvent } from '@/types/ws'

// ---------------------------------------------------------------------------
// Global subscriptions — /tables page
// Handles TABLE_SESSION_STARTED, TABLE_CLEARED, TABLE_STATUS_CHANGED,
// SERVICE_CALL_CREATED, SERVICE_CALL_ACKED, SERVICE_CALL_CLOSED,
// CHECK_REQUESTED, CHECK_PAID
// ---------------------------------------------------------------------------

export function useGlobalWaiterSubscriptions(): void {
  // Effect A — refs (dep `[]`): updated every render for fresh store access
  const tableStoreRef = useRef(useTableStore)
  const roundsStoreRef = useRef(useRoundsStore)
  const serviceCallsStoreRef = useRef(useServiceCallsStore)

  useEffect(() => {
    tableStoreRef.current = useTableStore
    roundsStoreRef.current = useRoundsStore
    serviceCallsStoreRef.current = useServiceCallsStore
  })

  // Effect B — subscriptions (dep `[]`): subscribe once, return cleanup
  useEffect(() => {
    const handleEvent = (event: WaiterEvent) => {
      logger.debug(`useGlobalWaiterSubscriptions: ${event.event_type}`)
      // Events are already handled by waiterWsService dispatch to stores.
      // This hook exists so components can get a render-trigger if needed.
      // Store updates happen in waiterWsService.handleStoreUpdate().
    }

    const unsubs = [
      'TABLE_SESSION_STARTED',
      'TABLE_CLEARED',
      'TABLE_STATUS_CHANGED',
      'SERVICE_CALL_CREATED',
      'SERVICE_CALL_ACKED',
      'SERVICE_CALL_CLOSED',
      'CHECK_REQUESTED',
      'CHECK_PAID',
    ].map((eventType) =>
      waiterWsService.on(eventType, (e) => handleEvent(e)),
    )

    return () => {
      unsubs.forEach((unsub) => unsub())
    }
  }, [])
}

// ---------------------------------------------------------------------------
// Table-detail subscriptions — /tables/:tableId page
// Handles ROUND_* + global events scoped to a tableId
// ---------------------------------------------------------------------------

export function useTableSubscriptions(
  tableId: string,
  sessionId: string | null,
): void {
  // Effect A — refs
  const roundsStoreRef = useRef(useRoundsStore)
  const serviceCallsStoreRef = useRef(useServiceCallsStore)

  useEffect(() => {
    roundsStoreRef.current = useRoundsStore
    serviceCallsStoreRef.current = useServiceCallsStore
  })

  // Effect B — subscriptions (dep `[sessionId]`): re-sub when session changes
  useEffect(() => {
    if (!sessionId) return

    logger.debug(`useTableSubscriptions: subscribing for session=${sessionId}`)

    const handleEvent = (event: WaiterEvent) => {
      logger.debug(`useTableSubscriptions[${tableId}]: ${event.event_type}`)
      // Store mutations handled by waiterWsService.handleStoreUpdate() already
    }

    const unsubs = [
      'ROUND_PENDING',
      'ROUND_CONFIRMED',
      'ROUND_SUBMITTED',
      'ROUND_IN_KITCHEN',
      'ROUND_READY',
      'ROUND_SERVED',
      'ROUND_CANCELED',
      'SERVICE_CALL_CREATED',
      'SERVICE_CALL_ACKED',
      'SERVICE_CALL_CLOSED',
    ].map((eventType) =>
      waiterWsService.on(eventType, (e) => handleEvent(e)),
    )

    return () => {
      logger.debug(`useTableSubscriptions: unsubscribing for session=${sessionId}`)
      unsubs.forEach((unsub) => unsub())
    }
  }, [sessionId, tableId])
}
