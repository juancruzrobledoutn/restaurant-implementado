/**
 * Retry queue store for pwaMenu.
 *
 * Persists failed mutations to localStorage (FIFO, max 50 entries, TTL 5min per entry).
 * Falls back to in-memory queue if localStorage is unavailable.
 * Drains on: window 'online' event, periodic 15s timer, and explicit drain() call.
 */
import { create } from 'zustand'
import { logger } from '../utils/logger'
import { readJSON, writeJSON } from '../utils/storage'

const STORAGE_KEY = 'pwamenu-retry-queue'
const MAX_QUEUE_SIZE = 50
const ENTRY_TTL_MS = 5 * 60 * 1000 // 5 minutes
const MAX_ATTEMPTS = 3

export type RetryOperation = 'cart.add' | 'cart.update' | 'cart.remove' | 'rounds.submit'

export interface RetryEntry {
  id: string
  operation: RetryOperation
  payload: unknown
  enqueuedAt: number // Unix ms
  attempts: number
}

type RetryExecutor = (entry: RetryEntry) => Promise<void>

interface RetryQueueState {
  queue: RetryEntry[]
  _executor: RetryExecutor | null
  _drainTimer: ReturnType<typeof setInterval> | null
  _isDraining: boolean
  // actions
  enqueue: (operation: RetryOperation, payload: unknown) => void
  dequeue: (id: string) => void
  incrementAttempts: (id: string) => void
  hydrate: () => void
  purgeStale: () => void
  setExecutor: (executor: RetryExecutor) => void
  drain: () => Promise<void>
  startDrainListeners: () => () => void
}

function persistQueue(queue: RetryEntry[]): void {
  writeJSON(STORAGE_KEY, queue)
}

function loadQueue(): RetryEntry[] {
  const data = readJSON<RetryEntry[]>(STORAGE_KEY)
  if (!Array.isArray(data)) return []
  return data
}

export const useRetryQueueStore = create<RetryQueueState>()((set, get) => ({
  queue: [],
  _executor: null,
  _drainTimer: null,
  _isDraining: false,

  enqueue(operation, payload) {
    const entry: RetryEntry = {
      id: crypto.randomUUID(),
      operation,
      payload,
      enqueuedAt: Date.now(),
      attempts: 0,
    }

    set((state) => {
      const next = [...state.queue, entry]
      if (next.length > MAX_QUEUE_SIZE) {
        const dropped = next.shift()
        logger.warn('retryQueueStore: queue cap exceeded, dropping oldest', {
          dropped: dropped?.id,
          operation: dropped?.operation,
        })
      }
      persistQueue(next)
      return { queue: next }
    })
  },

  dequeue(id) {
    set((state) => {
      const next = state.queue.filter((e) => e.id !== id)
      persistQueue(next)
      return { queue: next }
    })
  },

  incrementAttempts(id) {
    set((state) => {
      const next = state.queue.map((e) =>
        e.id === id ? { ...e, attempts: e.attempts + 1 } : e,
      )
      persistQueue(next)
      return { queue: next }
    })
  },

  hydrate() {
    const raw = loadQueue()
    const now = Date.now()
    const valid = raw.filter((e) => e.enqueuedAt + ENTRY_TTL_MS >= now)
    const staleCount = raw.length - valid.length
    if (staleCount > 0) {
      logger.warn(`retryQueueStore: purged ${staleCount} stale entries on hydrate`)
    }
    persistQueue(valid)
    set({ queue: valid })
  },

  purgeStale() {
    const now = Date.now()
    set((state) => {
      const next = state.queue.filter((e) => e.enqueuedAt + ENTRY_TTL_MS >= now)
      const count = state.queue.length - next.length
      if (count > 0) {
        logger.warn(`retryQueueStore: purged ${count} stale entries`)
        persistQueue(next)
      }
      return { queue: next }
    })
  },

  setExecutor(executor) {
    set({ _executor: executor })
  },

  async drain() {
    const state = get()
    if (state._isDraining || state.queue.length === 0 || !state._executor) return

    set({ _isDraining: true })

    try {
      // Process FIFO — work on a snapshot to avoid mutation during iteration
      const snapshot = [...get().queue]

      for (const entry of snapshot) {
        const executor = get()._executor
        if (!executor) break

        // Check if entry is still in the queue (might have been dequeued)
        const current = get().queue.find((e) => e.id === entry.id)
        if (!current) continue

        // Check stale
        if (entry.enqueuedAt + ENTRY_TTL_MS < Date.now()) {
          get().dequeue(entry.id)
          continue
        }

        try {
          await executor(entry)
          get().dequeue(entry.id)
          logger.info('retryQueueStore: entry replayed successfully', { id: entry.id })
        } catch (_err) {
          get().incrementAttempts(entry.id)
          const updated = get().queue.find((e) => e.id === entry.id)

          if (updated && updated.attempts >= MAX_ATTEMPTS) {
            get().dequeue(entry.id)
            logger.warn('retryQueueStore: entry discarded after max attempts', {
              id: entry.id,
              operation: entry.operation,
            })
            // Toast is emitted externally by the consumer via the store's queue change
            // We dispatch a custom event so the UI can show the toast
            window.dispatchEvent(
              new CustomEvent('pwamenu:retry-gave-up', { detail: { entry } }),
            )
          }
        }
      }
    } finally {
      set({ _isDraining: false })
    }
  },

  startDrainListeners() {
    const handleOnline = () => {
      void get().drain()
    }

    window.addEventListener('online', handleOnline)

    const timer = setInterval(() => {
      if (get().queue.length > 0) {
        void get().drain()
      }
    }, 15_000) // every 15 seconds

    set({ _drainTimer: timer })

    return () => {
      window.removeEventListener('online', handleOnline)
      clearInterval(timer)
      set({ _drainTimer: null })
    }
  },
}))

// --- Selectors ---

export const selectQueue = (s: RetryQueueState): RetryEntry[] => s.queue
export const selectQueueLength = (s: RetryQueueState): number => s.queue.length

/** Count of pending (non-failed) entries — mirrors pwaWaiter's selectPendingCount naming. */
export const selectPendingCount = (s: RetryQueueState): number => s.queue.length
