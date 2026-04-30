/**
 * Hook that runs once at router mount to restore a persisted session from localStorage.
 * If the session is expired, it clears the store.
 */
import { useEffect } from 'react'
import { useSessionStore, hydrateSessionFromStorage } from '../stores/sessionStore'

export function useHydrateSession(): void {
  const activate = useSessionStore((s) => s.activate)
  const setSessionId = useSessionStore((s) => s.setSessionId)
  const clear = useSessionStore((s) => s.clear)

  useEffect(() => {
    // If the store was already initialized synchronously from localStorage
    // (via loadInitialSession in sessionStore.ts), skip re-hydration to avoid
    // overwriting sessionId/dinerId with null via activate().
    if (useSessionStore.getState().token) return

    const stored = hydrateSessionFromStorage()
    if (!stored) {
      clear()
      return
    }
    activate({
      token: stored.token,
      branchSlug: stored.branchSlug,
      tableCode: stored.tableCode,
    })
    if (stored.sessionId) {
      setSessionId(stored.sessionId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
