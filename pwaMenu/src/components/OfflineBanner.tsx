/**
 * OfflineBanner — shows a sticky banner when the diner WS connection is lost
 * or when there are pending (unsynced) retry queue entries.
 *
 * Connection state is tracked via `dinerWS.onConnectionChange` subscription.
 * Pending count is read from the retryQueueStore via `selectPendingCount`.
 *
 * Renders null when CONNECTED and queue is empty (happy path — no DOM node).
 * AUTH_FAILED is a terminal state handled by the session clear flow; banner
 * stays hidden to avoid confusing the redirect.
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { dinerWS } from '../services/ws/dinerWS'
import { useRetryQueueStore, selectPendingCount } from '../stores/retryQueueStore'
import type { WsConnectionState } from '../services/ws/dinerWS'

/** States where we show the "disconnected" message */
const DISCONNECTED_STATES: ReadonlySet<WsConnectionState> = new Set([
  'DISCONNECTED',
  'RECONNECTING',
  'CONNECTING',
])

export function OfflineBanner() {
  const { t } = useTranslation()
  const pendingCount = useRetryQueueStore(selectPendingCount)

  const [connectionState, setConnectionState] = useState<WsConnectionState>(() =>
    dinerWS.getState(),
  )

  useEffect(() => {
    // onConnectionChange calls listener immediately with current state,
    // so the initial state is always in sync (no stale snapshot).
    const unsubscribe = dinerWS.onConnectionChange(setConnectionState)
    return unsubscribe
  }, [])

  const isDisconnected = DISCONNECTED_STATES.has(connectionState)
  const hasPending = pendingCount > 0

  if (!isDisconnected && !hasPending) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full bg-amber-500 text-white text-sm px-4 py-2 flex flex-col gap-0.5"
    >
      {isDisconnected && (
        <span>{t('offline.banner.disconnected')}</span>
      )}
      {hasPending && (
        <span>{t('offline.banner.pending', { count: pendingCount })}</span>
      )}
    </div>
  )
}
