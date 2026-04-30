/**
 * retryQueueStore tests — enqueue, drain, backoff, cap, user-scoping, failed-after-10.
 *
 * Uses fake-indexeddb to polyfill IDB in jsdom environment.
 * Each test resets the IDB singleton and clears all entries.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useRetryQueueStore,
  registerOpHandler,
  selectPendingCount,
  selectFailedEntries,
  selectAllEntries,
  selectIsDraining,
  __resetIdb,
  __clearAll,
} from '@/stores/retryQueueStore'
import type { RetryEntry, RetryOp } from '@/stores/retryQueueStore'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function enqueueOne(userId = 'u-1', op: RetryOp = 'createRound', payload: unknown = { sessionId: 'sess-1' }) {
  return useRetryQueueStore.getState().enqueue({ userId, op, payload })
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(async () => {
  // Reset DB singleton so each test gets a fresh IDB instance
  __resetIdb()
  await __clearAll()
  useRetryQueueStore.setState({ entries: [], isDraining: false })
})

// ---------------------------------------------------------------------------
// enqueue
// ---------------------------------------------------------------------------

describe('enqueue', () => {
  it('adds a new entry to the queue', async () => {
    const result = await enqueueOne()
    expect(result).toBe('ok')

    const entries = selectAllEntries(useRetryQueueStore.getState())
    expect(entries).toHaveLength(1)
    expect(entries[0]?.op).toBe('createRound')
  })

  it('creates entry with composite id: {userId}:{entryId}', async () => {
    await enqueueOne('user-42')
    const entries = selectAllEntries(useRetryQueueStore.getState())
    expect(entries[0]?.id).toMatch(/^user-42:/)
  })

  it('sets attempts=0 and nextAttemptAt <= Date.now() on creation', async () => {
    const before = Date.now()
    await enqueueOne()
    const entry = selectAllEntries(useRetryQueueStore.getState())[0]!
    expect(entry.attempts).toBe(0)
    expect(entry.nextAttemptAt).toBeGreaterThanOrEqual(before - 5)
    expect(entry.nextAttemptAt).toBeLessThanOrEqual(Date.now() + 5)
  })

  it('returns "full" and blocks when queue has 500 entries', async () => {
    // Fill up to the cap by enqueueing many entries
    // We reach 500 by directly setting state (avoid slow loop)
    const fakeEntries: RetryEntry[] = Array.from({ length: 500 }, (_, i) => ({
      id: `u-1:entry-${i}`,
      op: 'closeTable',
      payload: null,
      clientOpId: `op-${i}`,
      createdAt: Date.now(),
      attempts: 0,
      nextAttemptAt: Date.now(),
    }))

    // Populate IDB via the store's hydrate path by directly writing to IDB
    // Use __clearAll + direct IDB writes via the lib
    const { openDB, put } = await import('@/lib/idb')
    const db = await openDB('waiter-retry-queue', 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('retry-ops')) {
          d.createObjectStore('retry-ops', { keyPath: 'id' })
        }
      },
    })

    for (const entry of fakeEntries) {
      await put(db, 'retry-ops', entry)
    }
    // Reset singleton so retryQueueStore opens the same DB
    __resetIdb()
    await useRetryQueueStore.getState().hydrate()

    const result = await enqueueOne()
    expect(result).toBe('full')
  })

  it('persists entry across hydrate() calls (survives reload simulation)', async () => {
    await enqueueOne()
    // Reset in-memory state but keep IDB intact
    __resetIdb()
    useRetryQueueStore.setState({ entries: [] })
    await useRetryQueueStore.getState().hydrate()

    const entries = selectAllEntries(useRetryQueueStore.getState())
    expect(entries).toHaveLength(1)
    expect(entries[0]?.op).toBe('createRound')
  })
})

// ---------------------------------------------------------------------------
// drain — happy path
// ---------------------------------------------------------------------------

describe('drain — success', () => {
  it('calls the registered handler and removes the entry on success', async () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    registerOpHandler('createRound', handler)

    await enqueueOne()
    await useRetryQueueStore.getState().drain()

    expect(handler).toHaveBeenCalledOnce()
    const entries = selectAllEntries(useRetryQueueStore.getState())
    expect(entries).toHaveLength(0)
    expect(selectPendingCount(useRetryQueueStore.getState())).toBe(0)
  })

  it('skips entries not yet due (nextAttemptAt in the future)', async () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    registerOpHandler('createRound', handler)

    await enqueueOne()
    // Manually push nextAttemptAt into the future
    const entries = selectAllEntries(useRetryQueueStore.getState())
    const entry = { ...entries[0]!, nextAttemptAt: Date.now() + 60_000 }
    const { openDB, put } = await import('@/lib/idb')
    const db = await openDB('waiter-retry-queue', 1)
    await put(db, 'retry-ops', entry)
    __resetIdb()
    await useRetryQueueStore.getState().hydrate()

    await useRetryQueueStore.getState().drain()
    expect(handler).not.toHaveBeenCalled()
  })

  it('drains multiple entries in a single pass', async () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    registerOpHandler('ackServiceCall', handler)

    await enqueueOne('u-1', 'ackServiceCall')
    await enqueueOne('u-1', 'ackServiceCall')
    await useRetryQueueStore.getState().drain()

    expect(handler).toHaveBeenCalledTimes(2)
    expect(selectAllEntries(useRetryQueueStore.getState())).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// drain — failure + backoff
// ---------------------------------------------------------------------------

describe('drain — failure and backoff', () => {
  it('increments attempts and sets nextAttemptAt in the future on failure', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('network'))
    registerOpHandler('confirmRound', handler)

    await enqueueOne('u-1', 'confirmRound')
    await useRetryQueueStore.getState().drain()

    const entries = selectAllEntries(useRetryQueueStore.getState())
    expect(entries).toHaveLength(1)
    expect(entries[0]?.attempts).toBe(1)
    expect(entries[0]?.nextAttemptAt).toBeGreaterThan(Date.now())
    expect(entries[0]?.failed).toBeUndefined()
  })

  it('marks entry as failed: true after MAX_ATTEMPTS (10) failures', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('always fails'))
    registerOpHandler('requestCheck', handler)

    await enqueueOne('u-1', 'requestCheck')

    // Simulate 10 drain cycles — each one calls handler once
    // We manually set nextAttemptAt to the past before each drain
    for (let i = 0; i < 10; i++) {
      // Push nextAttemptAt to now so it's due
      __resetIdb()
      await useRetryQueueStore.getState().hydrate()
      const e = selectAllEntries(useRetryQueueStore.getState())[0]!
      const updated = { ...e, nextAttemptAt: Date.now() - 1 }
      const { openDB, put } = await import('@/lib/idb')
      const db = await openDB('waiter-retry-queue', 1)
      await put(db, 'retry-ops', updated)
      __resetIdb()
      await useRetryQueueStore.getState().hydrate()
      await useRetryQueueStore.getState().drain()
    }

    const entries = selectAllEntries(useRetryQueueStore.getState())
    expect(entries).toHaveLength(1)
    expect(entries[0]?.failed).toBe(true)
    expect(entries[0]?.attempts).toBe(10)

    const failed = selectFailedEntries(useRetryQueueStore.getState())
    expect(failed).toHaveLength(1)
    expect(selectPendingCount(useRetryQueueStore.getState())).toBe(0)
  })

  it('does not process already-failed entries in subsequent drains', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('fail'))
    registerOpHandler('closeTable', handler)

    await enqueueOne('u-1', 'closeTable')

    // Run 10 times to mark as failed
    for (let i = 0; i < 10; i++) {
      __resetIdb()
      await useRetryQueueStore.getState().hydrate()
      const e = selectAllEntries(useRetryQueueStore.getState())[0]!
      const updated = { ...e, nextAttemptAt: Date.now() - 1 }
      const { openDB, put } = await import('@/lib/idb')
      const db = await openDB('waiter-retry-queue', 1)
      await put(db, 'retry-ops', updated)
      __resetIdb()
      await useRetryQueueStore.getState().hydrate()
      await useRetryQueueStore.getState().drain()
    }

    // One more drain — handler should not be called again
    const callCountBefore = handler.mock.calls.length
    __resetIdb()
    await useRetryQueueStore.getState().hydrate()
    const e = selectAllEntries(useRetryQueueStore.getState())[0]!
    const updated = { ...e, nextAttemptAt: Date.now() - 1 }
    const { openDB, put } = await import('@/lib/idb')
    const db = await openDB('waiter-retry-queue', 1)
    await put(db, 'retry-ops', updated)
    __resetIdb()
    await useRetryQueueStore.getState().hydrate()
    await useRetryQueueStore.getState().drain()

    expect(handler.mock.calls.length).toBe(callCountBefore) // no new calls
  })
})

// ---------------------------------------------------------------------------
// User scoping
// ---------------------------------------------------------------------------

describe('user scoping', () => {
  it('entries from different users coexist in the queue', async () => {
    await enqueueOne('user-A')
    await enqueueOne('user-B')

    const entries = selectAllEntries(useRetryQueueStore.getState())
    expect(entries).toHaveLength(2)

    const ids = entries.map((e) => e.id)
    expect(ids.some((id) => id.startsWith('user-A:'))).toBe(true)
    expect(ids.some((id) => id.startsWith('user-B:'))).toBe(true)
  })

  it('clearUserEntries removes only entries for the given userId', async () => {
    await enqueueOne('user-A')
    await enqueueOne('user-B')

    await useRetryQueueStore.getState().clearUserEntries('user-A')

    const entries = selectAllEntries(useRetryQueueStore.getState())
    expect(entries).toHaveLength(1)
    expect(entries[0]?.id).toMatch(/^user-B:/)
  })

  it('clearUserEntries is a no-op when user has no entries', async () => {
    await enqueueOne('user-A')
    await useRetryQueueStore.getState().clearUserEntries('user-Z')

    const entries = selectAllEntries(useRetryQueueStore.getState())
    expect(entries).toHaveLength(1) // user-A entry untouched
  })
})

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

describe('selectors', () => {
  it('selectPendingCount excludes failed entries', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('fail'))
    registerOpHandler('closeServiceCall', handler)

    await enqueueOne('u-1', 'closeServiceCall') // will fail
    await enqueueOne('u-1', 'createRound') // stays pending — nextAttemptAt kept in the future

    // Run 10 drains to mark closeServiceCall as failed.
    // createRound is kept with nextAttemptAt in the future so drain always skips it,
    // regardless of any handler registered by previous tests.
    for (let i = 0; i < 10; i++) {
      __resetIdb()
      await useRetryQueueStore.getState().hydrate()
      const entries = selectAllEntries(useRetryQueueStore.getState())
      const { openDB, put } = await import('@/lib/idb')
      const db = await openDB('waiter-retry-queue', 1)
      for (const e of entries) {
        if (e.op === 'closeServiceCall') {
          // Make it due so the failing handler runs
          await put(db, 'retry-ops', { ...e, nextAttemptAt: Date.now() - 1 })
        } else {
          // Keep createRound in the future so it is never processed
          await put(db, 'retry-ops', { ...e, nextAttemptAt: Date.now() + 60_000 })
        }
      }
      __resetIdb()
      await useRetryQueueStore.getState().hydrate()
      await useRetryQueueStore.getState().drain()
    }

    // closeServiceCall is now failed, createRound is still pending
    expect(selectPendingCount(useRetryQueueStore.getState())).toBe(1)
    expect(selectFailedEntries(useRetryQueueStore.getState())).toHaveLength(1)
  })

  it('selectIsDraining is true only during an active drain', async () => {
    // No active drain → false
    expect(selectIsDraining(useRetryQueueStore.getState())).toBe(false)

    // While draining → true (captured via a slow handler)
    let isDrainingDuringHandler = false
    registerOpHandler('submitManualPayment', async () => {
      isDrainingDuringHandler = selectIsDraining(useRetryQueueStore.getState())
    })

    await enqueueOne('u-1', 'submitManualPayment')
    await useRetryQueueStore.getState().drain()

    expect(isDrainingDuringHandler).toBe(true)
    expect(selectIsDraining(useRetryQueueStore.getState())).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Parallel drain with concurrency cap — task 9.1
// ---------------------------------------------------------------------------

describe('drain — parallel execution', () => {
  it('processes 30 entries faster than sequential would (< 500ms for 50ms latency each)', async () => {
    const LATENCY_MS = 50
    const COUNT = 30

    // Handler with artificial 50ms latency
    const handler = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => setTimeout(resolve, LATENCY_MS)),
    )
    registerOpHandler('createRound', handler)

    // Enqueue 30 entries
    for (let i = 0; i < COUNT; i++) {
      await enqueueOne('u-1', 'createRound', { index: i })
    }

    // Make all entries due
    __resetIdb()
    await useRetryQueueStore.getState().hydrate()
    const entries = selectAllEntries(useRetryQueueStore.getState())
    const { openDB, put } = await import('@/lib/idb')
    const db = await openDB('waiter-retry-queue', 1)
    for (const e of entries) {
      await put(db, 'retry-ops', { ...e, nextAttemptAt: Date.now() - 1 })
    }
    __resetIdb()
    await useRetryQueueStore.getState().hydrate()

    const start = Date.now()
    await useRetryQueueStore.getState().drain()
    const elapsed = Date.now() - start

    // Sequential would take 30 * 50ms = 1500ms.
    // With concurrency cap of 10: ceil(30/10) * 50ms = 150ms + overhead.
    // We allow generous budget of 500ms to account for test overhead.
    expect(elapsed).toBeLessThan(500)
    expect(handler).toHaveBeenCalledTimes(COUNT)
  })

  it('does not abort on individual entry failure — all others still process', async () => {
    const TOTAL = 10
    const FAILING_INDICES = [2, 5, 8] // 3 of 10 will fail

    const handler = vi.fn().mockImplementation(async (_entry: unknown) => {
      const idx = handler.mock.calls.length - 1
      if (FAILING_INDICES.includes(idx)) {
        throw new Error(`Simulated failure at index ${idx}`)
      }
    })
    registerOpHandler('confirmRound', handler)

    for (let i = 0; i < TOTAL; i++) {
      await enqueueOne('u-1', 'confirmRound', { index: i })
    }

    // Make all due
    __resetIdb()
    await useRetryQueueStore.getState().hydrate()
    const entries = selectAllEntries(useRetryQueueStore.getState())
    const { openDB, put } = await import('@/lib/idb')
    const db = await openDB('waiter-retry-queue', 1)
    for (const e of entries) {
      await put(db, 'retry-ops', { ...e, nextAttemptAt: Date.now() - 1 })
    }
    __resetIdb()
    await useRetryQueueStore.getState().hydrate()

    await useRetryQueueStore.getState().drain()

    // All 10 handlers were called (failures didn't abort the batch)
    expect(handler).toHaveBeenCalledTimes(TOTAL)

    // 7 succeeded (removed), 3 failed (attempts incremented)
    const remaining = selectAllEntries(useRetryQueueStore.getState())
    expect(remaining).toHaveLength(FAILING_INDICES.length)
  })
})
