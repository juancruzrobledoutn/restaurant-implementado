/**
 * useRetryQueueDrainer — initializes the retry queue drain listeners.
 *
 * Mount once in the app shell. Registers 'online' listener + 15s timer.
 * Cleans up on unmount.
 * Also listens for the 'pwamenu:retry-gave-up' custom event to show toast.
 */
import { useEffect } from 'react'
import { useRetryQueueStore } from '../stores/retryQueueStore'
import { logger } from '../utils/logger'
import type { RetryEntry } from '../stores/retryQueueStore'

interface UseRetryQueueDrainerOptions {
  onGaveUp?: (entry: RetryEntry) => void
}

export function useRetryQueueDrainer(options: UseRetryQueueDrainerOptions = {}): void {
  const { onGaveUp } = options

  useEffect(() => {
    const store = useRetryQueueStore.getState()

    // Hydrate from localStorage on mount + purge stale entries
    store.hydrate()

    // Start online + timer listeners
    const cleanup = store.startDrainListeners()

    // Listen for gave-up events to show toast
    function handleGaveUp(event: Event) {
      const { entry } = (event as CustomEvent<{ entry: RetryEntry }>).detail
      logger.warn('retryQueueDrainer: entry gave up after max attempts', {
        operation: entry.operation,
      })
      onGaveUp?.(entry)
    }

    window.addEventListener('pwamenu:retry-gave-up', handleGaveUp)

    return () => {
      cleanup()
      window.removeEventListener('pwamenu:retry-gave-up', handleGaveUp)
    }
  }, [onGaveUp])
}
