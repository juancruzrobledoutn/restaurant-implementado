/**
 * E2E-lite tests — offline → enqueue → online → drain (task 15.7).
 *
 * Simulates the full offline-retry lifecycle without a real network:
 * 1. Operation fails with network error → queued in retryQueueStore
 * 2. `window.online` event fires → drain() processes the queue
 * 3. Handler succeeds on retry → entry removed
 *
 * Uses fake-indexeddb for IDB and registerOpHandler for the drain handlers.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useRetryQueueStore,
  registerOpHandler,
  selectPendingCount,
  selectAllEntries,
  __resetIdb,
  __clearAll,
} from '@/stores/retryQueueStore'
import type { RetryOp } from '@/stores/retryQueueStore'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  __resetIdb()
  await __clearAll()
  useRetryQueueStore.setState({ entries: [], isDraining: false })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function enqueue(op: RetryOp = 'createRound', userId = 'u-1') {
  return useRetryQueueStore.getState().enqueue({
    userId,
    op,
    payload: { sessionId: 'sess-1', items: [{ productId: 'p-1', quantity: 1 }] },
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('offline → enqueue', () => {
  it('enqueue stores the operation in retryQueueStore', async () => {
    const result = await enqueue('createRound')
    expect(result).toBe('ok')
    expect(selectPendingCount(useRetryQueueStore.getState())).toBe(1)
    expect(selectAllEntries(useRetryQueueStore.getState())[0]?.op).toBe('createRound')
  })

  it('enqueue multiple operations for different ops', async () => {
    await enqueue('createRound')
    await enqueue('confirmRound')
    await enqueue('requestCheck')

    expect(selectPendingCount(useRetryQueueStore.getState())).toBe(3)
  })
})

describe('online → drain (success)', () => {
  it('drains successfully: handler called and entry removed', async () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    registerOpHandler('createRound', handler)

    await enqueue('createRound')
    expect(selectPendingCount(useRetryQueueStore.getState())).toBe(1)

    await useRetryQueueStore.getState().drain()

    expect(handler).toHaveBeenCalledOnce()
    expect(selectPendingCount(useRetryQueueStore.getState())).toBe(0)
    expect(selectAllEntries(useRetryQueueStore.getState())).toHaveLength(0)
  })

  it('drains all pending entries in a single pass', async () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    registerOpHandler('ackServiceCall', handler)

    await enqueue('ackServiceCall')
    await enqueue('ackServiceCall')
    await enqueue('ackServiceCall')

    await useRetryQueueStore.getState().drain()

    expect(handler).toHaveBeenCalledTimes(3)
    expect(selectAllEntries(useRetryQueueStore.getState())).toHaveLength(0)
  })
})

describe('drain — first fail then succeed (retry lifecycle)', () => {
  it('entry persists after first failure and succeeds on second drain', async () => {
    let callCount = 0
    const handler = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount < 2) throw new Error('temporary failure')
    })
    registerOpHandler('confirmRound', handler)

    await enqueue('confirmRound')

    // First drain — fails, entry remains with nextAttemptAt in the future
    await useRetryQueueStore.getState().drain()
    expect(selectPendingCount(useRetryQueueStore.getState())).toBe(1)
    expect(selectAllEntries(useRetryQueueStore.getState())[0]?.attempts).toBe(1)

    // Push nextAttemptAt to the past so next drain processes it
    __resetIdb()
    await useRetryQueueStore.getState().hydrate()
    const entry = selectAllEntries(useRetryQueueStore.getState())[0]!
    const { openDB, put } = await import('@/lib/idb')
    const db = await openDB('waiter-retry-queue', 1)
    await put(db, 'retry-ops', { ...entry, nextAttemptAt: Date.now() - 1 })
    __resetIdb()
    await useRetryQueueStore.getState().hydrate()

    // Second drain — succeeds
    await useRetryQueueStore.getState().drain()
    expect(handler).toHaveBeenCalledTimes(2)
    expect(selectAllEntries(useRetryQueueStore.getState())).toHaveLength(0)
  })
})

describe('drain — IDB persistence across simulated reload', () => {
  it('operations survive simulated page reload (IDB persists)', async () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    registerOpHandler('requestCheck', handler)

    // Enqueue
    await enqueue('requestCheck')
    expect(selectPendingCount(useRetryQueueStore.getState())).toBe(1)

    // Simulate reload: reset in-memory state
    useRetryQueueStore.setState({ entries: [], isDraining: false })
    __resetIdb()

    // Re-hydrate from IDB (as would happen on app start)
    await useRetryQueueStore.getState().hydrate()
    expect(selectPendingCount(useRetryQueueStore.getState())).toBe(1)

    // Drain after reload
    await useRetryQueueStore.getState().drain()
    expect(handler).toHaveBeenCalledOnce()
    expect(selectAllEntries(useRetryQueueStore.getState())).toHaveLength(0)
  })
})

describe('concurrent drain protection', () => {
  it('does not allow concurrent drains (idempotent while draining)', async () => {
    let resolveHandler!: () => void
    const handlerPromise = new Promise<void>((resolve) => {
      resolveHandler = resolve
    })
    const handler = vi.fn().mockReturnValue(handlerPromise)
    registerOpHandler('closeTable', handler)

    await enqueue('closeTable')

    // Start first drain (does not await)
    const drain1 = useRetryQueueStore.getState().drain()

    // Start second drain immediately — should be a no-op
    const drain2 = useRetryQueueStore.getState().drain()

    // Resolve handler
    resolveHandler()
    await drain1
    await drain2

    // Handler should have been called exactly once
    expect(handler).toHaveBeenCalledOnce()
  })
})
