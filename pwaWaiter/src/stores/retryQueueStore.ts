/**
 * retryQueueStore — persistent offline retry queue for waiter operations.
 *
 * Stores failed/pending operations in IndexedDB (via `idb`) so they survive
 * page reloads and tab closures. Scoped by `userId` to prevent cross-user
 * data leakage on shared devices.
 *
 * Supported operations:
 *   createRound | confirmRound | ackServiceCall | closeServiceCall |
 *   requestCheck | submitManualPayment | closeTable
 *
 * Backoff: min(1000 * 2^attempts, 30000) + jitter(0..500)
 * Max attempts: 10 (then marked `failed: true`)
 * Cap: 500 entries (blocks new enqueues if full)
 *
 * Rules (zustand-store-pattern skill):
 * - NEVER destructure — use named selectors
 * - EMPTY_ARRAY stable fallback
 * - Zustand state = in-memory mirror for reactive selectors; IDB = source of truth
 */

import { create } from 'zustand'
import { openDB, put, deleteEntry, getAll, count, clear } from '@/lib/idb'
import { generateClientOpId } from '@/lib/idempotency'
import { logger } from '@/utils/logger'
import type { IDBPDatabase } from '@/lib/idb'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RetryOp =
  | 'createRound'
  | 'confirmRound'
  | 'ackServiceCall'
  | 'closeServiceCall'
  | 'requestCheck'
  | 'submitManualPayment'
  | 'closeTable'

export interface RetryEntry {
  /** Composite key: `{userId}:{entryId}` */
  id: string
  op: RetryOp
  payload: unknown
  clientOpId: string
  createdAt: number
  attempts: number
  nextAttemptAt: number
  failed?: boolean
}

export interface EnqueueParams {
  userId: string
  op: RetryOp
  payload: unknown
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DB_NAME = 'waiter-retry-queue'
const STORE_NAME = 'retry-ops'
const DB_VERSION = 1
const MAX_ENTRIES = 500
const MAX_ATTEMPTS = 10
const MAX_BACKOFF_MS = 30_000
const BASE_BACKOFF_MS = 1_000
const JITTER_MAX_MS = 500
/** Max concurrent operations during drain. Prevents backend overload after long offline periods. */
const DRAIN_CONCURRENCY = 10

function calcBackoff(attempts: number): number {
  const exp = Math.min(BASE_BACKOFF_MS * 2 ** attempts, MAX_BACKOFF_MS)
  const jitter = Math.random() * JITTER_MAX_MS
  return exp + jitter
}

// ---------------------------------------------------------------------------
// IDB setup
// ---------------------------------------------------------------------------

let _db: IDBPDatabase | null = null

async function getDB(): Promise<IDBPDatabase> {
  if (_db) return _db
  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // out-of-line key — entry.id is the key
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    },
  })
  return _db
}

// ---------------------------------------------------------------------------
// Operation handlers — called during drain()
// ---------------------------------------------------------------------------

type OpHandler = (entry: RetryEntry) => Promise<void>
const _opHandlers: Partial<Record<RetryOp, OpHandler>> = {}

/** Register a handler for a specific op. Called by the service layer. */
export function registerOpHandler(op: RetryOp, handler: OpHandler): void {
  _opHandlers[op] = handler
}

// ---------------------------------------------------------------------------
// Zustand state
// ---------------------------------------------------------------------------

const EMPTY_ENTRIES: RetryEntry[] = []

interface RetryQueueState {
  /** In-memory mirror of IDB entries for reactive selectors */
  entries: RetryEntry[]
  isDraining: boolean

  // Internal actions
  _setEntries: (entries: RetryEntry[]) => void
  _setDraining: (isDraining: boolean) => void

  // Public actions
  enqueue: (params: EnqueueParams) => Promise<'ok' | 'full'>
  drain: () => Promise<void>
  clearUserEntries: (userId: string) => Promise<void>
  hydrate: () => Promise<void>
}

export const useRetryQueueStore = create<RetryQueueState>()((set, get) => ({
  entries: EMPTY_ENTRIES,
  isDraining: false,

  _setEntries: (entries) => set({ entries }),
  _setDraining: (isDraining) => set({ isDraining }),

  // ------------------------------------------------------------------
  // hydrate — load IDB entries into memory on app start
  // ------------------------------------------------------------------
  hydrate: async () => {
    try {
      const db = await getDB()
      const all = await getAll<RetryEntry>(db, STORE_NAME)
      set({ entries: all })
      logger.debug(`retryQueueStore: hydrated ${all.length} entries from IDB`)
    } catch (err) {
      logger.error('retryQueueStore: hydrate failed', err)
    }
  },

  // ------------------------------------------------------------------
  // enqueue — add an operation to the queue
  // ------------------------------------------------------------------
  enqueue: async ({ userId, op, payload }) => {
    const db = await getDB()
    const currentCount = await count(db, STORE_NAME)

    if (currentCount >= MAX_ENTRIES) {
      logger.warn('retryQueueStore: queue is full — blocking enqueue')
      return 'full'
    }

    const clientOpId = generateClientOpId()
    const entryId = generateClientOpId()
    const entry: RetryEntry = {
      id: `${userId}:${entryId}`,
      op,
      payload,
      clientOpId,
      createdAt: Date.now(),
      attempts: 0,
      nextAttemptAt: Date.now(),
    }

    await put<RetryEntry>(db, STORE_NAME, entry)
    const all = await getAll<RetryEntry>(db, STORE_NAME)
    set({ entries: all })

    logger.debug(`retryQueueStore: enqueued op=${op} id=${entry.id}`)
    return 'ok'
  },

  // ------------------------------------------------------------------
  // drain — process all due entries
  // ------------------------------------------------------------------
  drain: async () => {
    if (get().isDraining) return
    set({ isDraining: true })

    try {
      const db = await getDB()
      const all = await getAll<RetryEntry>(db, STORE_NAME)
      const now = Date.now()
      const due = all.filter((e) => !e.failed && e.nextAttemptAt <= now)

      logger.debug(`retryQueueStore: drain — ${due.length} entries due`)

      /**
       * Process a single entry: call its handler and update IDB on success/failure.
       * Returns a resolved Promise always (errors are caught internally) so that
       * Promise.allSettled can batch without aborting on first failure.
       */
      async function replayOne(entry: RetryEntry): Promise<void> {
        const handler = _opHandlers[entry.op]
        if (!handler) {
          logger.warn(`retryQueueStore: no handler for op=${entry.op}`)
          return
        }

        try {
          await handler(entry)
          // Success — remove from IDB
          await deleteEntry(db, STORE_NAME, entry.id)
          logger.info(`retryQueueStore: op=${entry.op} id=${entry.id} succeeded`)
        } catch (err) {
          const newAttempts = entry.attempts + 1
          if (newAttempts >= MAX_ATTEMPTS) {
            const failed: RetryEntry = { ...entry, attempts: newAttempts, failed: true }
            await put<RetryEntry>(db, STORE_NAME, failed)
            logger.warn(`retryQueueStore: op=${entry.op} id=${entry.id} marked failed after ${newAttempts} attempts`)
          } else {
            const backoff = calcBackoff(newAttempts)
            const updated: RetryEntry = {
              ...entry,
              attempts: newAttempts,
              nextAttemptAt: Date.now() + backoff,
            }
            await put<RetryEntry>(db, STORE_NAME, updated)
            logger.debug(`retryQueueStore: op=${entry.op} attempt ${newAttempts} failed, next in ${Math.round(backoff)}ms`, err)
          }
        }
      }

      // Process in batches of DRAIN_CONCURRENCY using Promise.allSettled.
      // This is faster than sequential for large queues (O(n/concurrency) instead of O(n))
      // while preventing backend overload after long offline periods.
      for (let i = 0; i < due.length; i += DRAIN_CONCURRENCY) {
        const batch = due.slice(i, i + DRAIN_CONCURRENCY)
        await Promise.allSettled(batch.map(replayOne))
      }

      // Refresh in-memory mirror
      const refreshed = await getAll<RetryEntry>(db, STORE_NAME)
      set({ entries: refreshed })
    } catch (err) {
      logger.error('retryQueueStore: drain threw', err)
    } finally {
      set({ isDraining: false })
    }
  },

  // ------------------------------------------------------------------
  // clearUserEntries — called on logout to prevent data leakage
  // ------------------------------------------------------------------
  clearUserEntries: async (userId: string) => {
    const db = await getDB()
    const all = await getAll<RetryEntry>(db, STORE_NAME)
    const userEntries = all.filter((e) => e.id.startsWith(`${userId}:`))

    await Promise.all(userEntries.map((e) => deleteEntry(db, STORE_NAME, e.id)))

    const remaining = await getAll<RetryEntry>(db, STORE_NAME)
    set({ entries: remaining })
    logger.info(`retryQueueStore: cleared ${userEntries.length} entries for user ${userId}`)
  },
}))

// ---------------------------------------------------------------------------
// Selectors — NEVER destructure stores
// ---------------------------------------------------------------------------

export const EMPTY_RETRY_ENTRIES: RetryEntry[] = []

export const selectPendingCount = (s: RetryQueueState): number =>
  s.entries.filter((e) => !e.failed).length

export const selectFailedEntries = (s: RetryQueueState): RetryEntry[] =>
  s.entries.filter((e) => e.failed === true)

export const selectEntriesBySession = (sessionId: string) =>
  (s: RetryQueueState): RetryEntry[] => {
    // Payload may contain sessionId — filter heuristically
    return s.entries.filter((e) => {
      const p = e.payload as Record<string, unknown> | null
      return p && (p.sessionId === sessionId || p.session_id === sessionId)
    })
  }

export const selectIsDraining = (s: RetryQueueState): boolean => s.isDraining

export const selectAllEntries = (s: RetryQueueState): RetryEntry[] => s.entries

// ---------------------------------------------------------------------------
// Global drain listeners — registered once at module init
// ---------------------------------------------------------------------------

function setupDrainListeners(): void {
  if (typeof window === 'undefined') return

  window.addEventListener('online', () => {
    logger.debug('retryQueueStore: online event — triggering drain')
    void useRetryQueueStore.getState().drain()
  })
}

setupDrainListeners()

/** Test-only: reset IDB reference (allows re-init across tests). */
export function __resetIdb(): void {
  _db = null
}

/** Test-only: clear all IDB entries and reset in-memory state. */
export async function __clearAll(): Promise<void> {
  const db = await getDB()
  await clear(db, STORE_NAME)
  useRetryQueueStore.setState({ entries: [] })
}
