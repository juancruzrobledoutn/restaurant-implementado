/**
 * useEnqueuedAction — wraps useActionState with retry queue integration.
 *
 * Behavior:
 * - Calls server action via provided `fn`
 * - If request fails with network error → enqueues in retryQueueStore → returns `queued`
 * - If request fails with 4xx (validation/non-retryable) → returns `failed` without enqueuing
 * - If success → returns `success` with payload
 *
 * The hook itself does NOT call useActionState internally since the action signature
 * varies by use case. Instead it returns a wrapped action function that pages/components
 * pass to useActionState directly.
 *
 * Usage:
 *   const action = useEnqueuedAction({ op: 'createRound', userId, fn: createWaiterRound })
 *   const [state, formAction, isPending] = useActionState(action, { status: 'idle' })
 */

import { useCallback } from 'react'
import { useRetryQueueStore } from '@/stores/retryQueueStore'
import { APIError } from '@/services/api'
import { logger } from '@/utils/logger'
import type { RetryOp } from '@/stores/retryQueueStore'

export type EnqueuedActionStatus = 'idle' | 'queued' | 'sending' | 'success' | 'failed'

export interface EnqueuedActionResult<T = unknown> {
  status: EnqueuedActionStatus
  data?: T
  message?: string
}

interface UseEnqueuedActionOptions<TArgs, TResult> {
  op: RetryOp
  userId: string
  /** The actual async server call */
  fn: (args: TArgs) => Promise<TResult>
  /** Build the retryable payload to store in IDB if fn fails by network */
  buildPayload?: (args: TArgs) => unknown
}

/**
 * Returns a wrapped action fn that integrates with retryQueueStore.
 * Designed to be passed as the action argument to useActionState.
 */
export function useEnqueuedAction<TArgs, TResult>(
  options: UseEnqueuedActionOptions<TArgs, TResult>,
): (prevState: EnqueuedActionResult<TResult>, args: TArgs) => Promise<EnqueuedActionResult<TResult>> {
  const enqueue = useRetryQueueStore((s) => s.enqueue)

  // Use individual properties as deps instead of the whole `options` object.
  // When callers pass an object literal each render, `options` gets a new identity
  // every render → useCallback never caches → any downstream useEffect([fn]) loops.
  // The individual properties (fn, op, userId, buildPayload) are stable in practice
  // (imports, auth store values) and this restores pre-C-21 stable behavior.
  const { fn, op, userId, buildPayload } = options

  return useCallback(
    async (_prevState: EnqueuedActionResult<TResult>, args: TArgs): Promise<EnqueuedActionResult<TResult>> => {
      try {
        const data = await fn(args)
        return { status: 'success', data }
      } catch (err) {
        // 4xx errors → non-retryable (validation, auth, conflict)
        if (err instanceof APIError && err.status >= 400 && err.status < 500) {
          logger.warn(`useEnqueuedAction[${op}]: 4xx error (${err.status}) — not enqueuing`, (err as APIError).message)
          return { status: 'failed', message: (err as APIError).message }
        }

        // Network errors, 5xx → enqueue for retry
        logger.warn(`useEnqueuedAction[${op}]: network/server error — enqueuing`, err)

        const payload = buildPayload ? buildPayload(args) : args
        const result = await enqueue({
          userId,
          op,
          payload,
        })

        if (result === 'full') {
          return {
            status: 'failed',
            message: 'Demasiadas operaciones offline. Sincronice primero.',
          }
        }

        return {
          status: 'queued',
          message: 'Operación guardada. Se sincronizará cuando vuelva la conexión.',
        }
      }
    },
    [fn, op, userId, buildPayload, enqueue],
  )
}
