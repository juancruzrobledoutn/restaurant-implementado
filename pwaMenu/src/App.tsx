/**
 * Root component — renders the React Router v7 provider with hydrated session.
 *
 * Wires up:
 * - WebSocket diner connection when session token is available
 * - CART_* events → cartStore
 * - ROUND_* events → roundsStore
 * - TABLE_STATUS_CHANGED → sessionStore
 * - REHYDRATE_REQUIRED → full rehydration via API
 * - retryQueueDrainer initialization
 * - retryQueueStore executor binding
 */
import { RouterProvider } from 'react-router-dom'
import { useEffect, useCallback } from 'react'
import { useHydrateSession } from './hooks/useHydrateSession'
import { useRetryQueueDrainer } from './hooks/useRetryQueueDrainer'
import { useDinerWS } from './hooks/useDinerWS'
import { useBillingWS } from './hooks/useBillingWS'
import { useRetryQueueStore } from './stores/retryQueueStore'
import { OfflineBanner } from './components/OfflineBanner'
import { router } from './router'
import { useSessionStore, selectSessionId } from './stores/sessionStore'
import { useCartStore } from './stores/cartStore'
import { useRoundsStore } from './stores/roundsStore'
import { cartApi, roundsApi } from './services/dinerApi'
import { dinerWS } from './services/ws/dinerWS'
import { logger } from './utils/logger'
import type { WsEvent } from './types/wsEvents'
import type { CartWsEvent } from './types/cart'
import type { RoundWsEvent } from './types/round'
import type { WsTableStatusChangedEvent } from './types/wsEvents'
import type { TableStatus } from './stores/sessionStore'
import type { RetryEntry } from './stores/retryQueueStore'

function AppRoot() {
  useHydrateSession()

  const sessionId = useSessionStore(selectSessionId)

  // Wire dinerWS clear session callback
  useEffect(() => {
    dinerWS.onClearSession = () => {
      useSessionStore.getState().clear()
    }
    return () => {
      dinerWS.onClearSession = null
    }
  }, [])

  // Wire REHYDRATE_REQUIRED — full rehydration
  const handleRehydrate = useCallback(async () => {
    if (!sessionId) return
    logger.info('App: REHYDRATE_REQUIRED — fetching full cart + rounds')
    try {
      const [cartItems, rounds] = await Promise.all([
        cartApi.list(),
        roundsApi.list(),
      ])
      useCartStore.getState().replaceAll(cartItems)
      useRoundsStore.getState().setRounds(rounds)
    } catch (err) {
      logger.error('App: rehydration failed', err)
    }
  }, [sessionId])

  useEffect(() => {
    dinerWS.onRehydrateRequired = () => {
      void handleRehydrate()
    }
    return () => {
      dinerWS.onRehydrateRequired = null
    }
  }, [handleRehydrate])

  // Wire retry queue executor
  useEffect(() => {
    useRetryQueueStore.getState().setExecutor(async (entry: RetryEntry) => {
      switch (entry.operation) {
        case 'cart.add': {
          const payload = entry.payload as { product_id: string; quantity: number; notes?: string }
          const item = await cartApi.add(payload)
          // Idempotent insert: skip if item already present (e.g. server persisted
          // the item via WS event before the retry executor ran — prevents duplicates).
          useCartStore.getState().addIfAbsent(item)
          break
        }
        case 'cart.update': {
          const payload = entry.payload as { itemId: string; quantity?: number; notes?: string }
          const { itemId, ...rest } = payload
          await cartApi.update(itemId, rest)
          break
        }
        case 'cart.remove': {
          const payload = entry.payload as { itemId: string }
          await cartApi.remove(payload.itemId)
          break
        }
        case 'rounds.submit': {
          const payload = entry.payload as { notes?: string }
          const round = await roundsApi.submit(payload.notes)
          useRoundsStore.getState().upsertRound(round)
          useCartStore.getState().clear()
          break
        }
      }
    })
  }, [])

  // WS event handlers
  const handleCartEvent = useCallback((event: WsEvent) => {
    useCartStore.getState().applyWsEvent(event as unknown as CartWsEvent)
  }, [])

  const handleRoundEvent = useCallback((event: WsEvent) => {
    useRoundsStore.getState().applyWsEvent(event as RoundWsEvent)
  }, [])

  const handleTableStatusChanged = useCallback((event: WsEvent) => {
    const e = event as WsTableStatusChangedEvent
    useSessionStore.getState().setTableStatus(e.status as TableStatus)
    logger.info('App: TABLE_STATUS_CHANGED', { status: e.status })
  }, [])

  // Wire up WebSocket (token-based connection + event routing)
  useDinerWS({
    onCartAdded: handleCartEvent,
    onCartUpdated: handleCartEvent,
    onCartRemoved: handleCartEvent,
    onCartCleared: handleCartEvent,
    onRoundEvent: handleRoundEvent,
    onTableStatusChanged: handleTableStatusChanged,
  })

  // C-19: billing WS events (CHECK_REQUESTED, CHECK_PAID, PAYMENT_APPROVED, PAYMENT_REJECTED)
  // Mounted once here — routes events to billingStore, paymentStore, sessionStore
  useBillingWS()

  // Initialize retry queue drainer
  useRetryQueueDrainer({
    onGaveUp: (entry) => {
      logger.warn('App: retry gave up for entry', { operation: entry.operation })
    },
  })

  return (
    <>
      <OfflineBanner />
      <RouterProvider router={router} />
    </>
  )
}

export default AppRoot
