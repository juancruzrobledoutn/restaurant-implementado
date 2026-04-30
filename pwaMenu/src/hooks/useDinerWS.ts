/**
 * useDinerWS — React hook for diner WebSocket connection.
 *
 * Two-effect pattern (ref pattern):
 * - Effect 1: setup connection (depends on token)
 * - Effect 2: subscribe event handlers (uses refs to avoid re-subscribing)
 *
 * Follows ws-frontend-subscription skill pattern strictly.
 */
import { useEffect, useRef } from 'react'
import { dinerWS } from '../services/ws/dinerWS'
import { useSessionStore, selectToken } from '../stores/sessionStore'
import type { WsEvent } from '../types/wsEvents'

interface UseDinerWSHandlers {
  onCartAdded?: (event: WsEvent) => void
  onCartUpdated?: (event: WsEvent) => void
  onCartRemoved?: (event: WsEvent) => void
  onCartCleared?: (event: WsEvent) => void
  onRoundEvent?: (event: WsEvent) => void
  onTableStatusChanged?: (event: WsEvent) => void
}

export function useDinerWS(handlers: UseDinerWSHandlers = {}): void {
  const token = useSessionStore(selectToken)

  // Stable refs for each handler — updated on every render so they always have
  // the latest closure, without triggering re-subscription.
  const onCartAddedRef = useRef(handlers.onCartAdded)
  const onCartUpdatedRef = useRef(handlers.onCartUpdated)
  const onCartRemovedRef = useRef(handlers.onCartRemoved)
  const onCartClearedRef = useRef(handlers.onCartCleared)
  const onRoundEventRef = useRef(handlers.onRoundEvent)
  const onTableStatusChangedRef = useRef(handlers.onTableStatusChanged)

  // Effect 1: sync refs on every render (no deps — intentional)
  useEffect(() => {
    onCartAddedRef.current = handlers.onCartAdded
    onCartUpdatedRef.current = handlers.onCartUpdated
    onCartRemovedRef.current = handlers.onCartRemoved
    onCartClearedRef.current = handlers.onCartCleared
    onRoundEventRef.current = handlers.onRoundEvent
    onTableStatusChangedRef.current = handlers.onTableStatusChanged
  })

  // Effect 2: setup / teardown connection based on token
  useEffect(() => {
    if (!token) return

    dinerWS.connect(token)
    return () => {
      dinerWS.disconnect()
    }
  }, [token])

  // One stable ref for the wildcard dispatcher — updated each render via Effect 1.
  // This is the canonical ref pattern from ws-frontend-subscription skill:
  // the ref stays always-current without causing re-subscriptions.
  const dispatchRef = useRef<(event: WsEvent) => void>(null!)
  // Effect 1b: sync the dispatch ref on every render (no deps — intentional)
  useEffect(() => {
    dispatchRef.current = (event: WsEvent) => {
      switch (event.type) {
        case 'CART_ITEM_ADDED':
          onCartAddedRef.current?.(event)
          break
        case 'CART_ITEM_UPDATED':
          onCartUpdatedRef.current?.(event)
          break
        case 'CART_ITEM_REMOVED':
          onCartRemovedRef.current?.(event)
          break
        case 'CART_CLEARED':
          onCartClearedRef.current?.(event)
          break
        case 'ROUND_PENDING':
        case 'ROUND_CONFIRMED':
        case 'ROUND_SUBMITTED':
        case 'ROUND_IN_KITCHEN':
        case 'ROUND_READY':
        case 'ROUND_SERVED':
        case 'ROUND_CANCELED':
          onRoundEventRef.current?.(event)
          break
        case 'TABLE_STATUS_CHANGED':
          onTableStatusChangedRef.current?.(event)
          break
      }
    }
  })

  // Effect 3: subscribe once — always cleanup on unmount
  useEffect(() => {
    const unsubscribe = dinerWS.on('*', (e) => dispatchRef.current(e))
    return unsubscribe
  }, [])
}
