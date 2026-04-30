/**
 * useSessionStatusGuard — defensive session status check.
 *
 * Refetches GET /api/diner/session on mount and updates sessionStore.tableStatus.
 * Used in /cart and /cart/confirm to catch missed TABLE_STATUS_CHANGED events.
 */
import { useEffect } from 'react'
import { sessionApi } from '../services/dinerApi'
import { useSessionStore } from '../stores/sessionStore'
import { logger } from '../utils/logger'

export function useSessionStatusGuard(): void {
  useEffect(() => {
    const controller = new AbortController()

    sessionApi
      .get()
      .then((session) => {
        if (controller.signal.aborted) return
        useSessionStore.getState().setTableStatus(session.tableStatus)
        logger.debug('useSessionStatusGuard: table status refreshed', {
          tableStatus: session.tableStatus,
        })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        logger.error('useSessionStatusGuard: failed to fetch session', err)
      })

    return () => {
      controller.abort()
    }
  }, [])
}
