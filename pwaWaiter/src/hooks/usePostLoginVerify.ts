/**
 * usePostLoginVerify — orchestrates the verify-branch-assignment call after login.
 *
 * Triggered by LoginPage once `isAuthenticated` becomes true (and we have a
 * selected branch). Runs exactly once per (userId, branchId) pair.
 *
 * States:
 *   'idle'      — waiting to run
 *   'verifying' — request in flight
 *   'assigned'  — assigned=true; assignment was written to authStore
 *   'denied'    — assigned=false; UI should redirect to /access-denied
 *   'error'     — network/backend failure; UI shows a retry banner
 */
import { useEffect, useRef, useState } from 'react'
import { verifyBranchAssignment } from '@/services/waiter'
import { useAuthStore, selectSetAssignment } from '@/stores/authStore'
import { handleError, logger } from '@/utils/logger'

export type VerifyStatus = 'idle' | 'verifying' | 'assigned' | 'denied' | 'error'

export interface VerifyState {
  status: VerifyStatus
  error?: string
}

export function usePostLoginVerify(
  branchId: string | null,
  enabled: boolean,
): VerifyState & { retry: () => void } {
  const [state, setState] = useState<VerifyState>({ status: 'idle' })
  const setAssignment = useAuthStore(selectSetAssignment)
  // Trigger re-run on demand via an incrementing counter
  const [retryNonce, setRetryNonce] = useState(0)
  // Guard against re-entrancy when enabled flips rapidly
  const activeRequestRef = useRef<number>(0)

  useEffect(() => {
    if (!enabled || !branchId) {
      setState({ status: 'idle' })
      return
    }

    const requestId = activeRequestRef.current + 1
    activeRequestRef.current = requestId
    let cancelled = false

    async function run() {
      setState({ status: 'verifying' })
      try {
        const result = await verifyBranchAssignment(branchId!)
        if (cancelled || activeRequestRef.current !== requestId) return

        if (result.assigned) {
          setAssignment(result.sectorId, result.sectorName)
          setState({ status: 'assigned' })
          logger.info('usePostLoginVerify: waiter assigned', {
            sectorId: result.sectorId,
          })
        } else {
          setState({ status: 'denied' })
          logger.info('usePostLoginVerify: waiter NOT assigned today')
        }
      } catch (err) {
        if (cancelled || activeRequestRef.current !== requestId) return
        const message = handleError(err, 'usePostLoginVerify')
        setState({ status: 'error', error: message })
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [enabled, branchId, retryNonce, setAssignment])

  const retry = () => setRetryNonce((n) => n + 1)
  return { ...state, retry }
}
