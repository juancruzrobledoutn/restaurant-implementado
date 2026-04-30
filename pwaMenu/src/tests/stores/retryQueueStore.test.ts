/**
 * Unit tests for retryQueueStore.
 * Tests: enqueue FIFO, localStorage persistence, hydrate+purge stale, 3-fail discard,
 * fallback in-memory, drain on 'online'.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useRetryQueueStore } from '../../stores/retryQueueStore'

const STORAGE_KEY = 'pwamenu-retry-queue'

function resetStore() {
  useRetryQueueStore.setState({ queue: [], _executor: null, _drainTimer: null, _isDraining: false })
}

describe('retryQueueStore', () => {
  beforeEach(() => {
    resetStore()
    localStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('enqueue', () => {
    it('adds entries in FIFO order', () => {
      useRetryQueueStore.getState().enqueue('cart.add', { product_id: '1', quantity: 1 })
      useRetryQueueStore.getState().enqueue('cart.add', { product_id: '2', quantity: 2 })
      useRetryQueueStore.getState().enqueue('cart.add', { product_id: '3', quantity: 3 })

      const { queue } = useRetryQueueStore.getState()
      expect(queue).toHaveLength(3)

      const payloads = queue.map((e) => (e.payload as { product_id: string }).product_id)
      expect(payloads).toEqual(['1', '2', '3'])
    })

    it('persists to localStorage', () => {
      useRetryQueueStore.getState().enqueue('cart.add', { product_id: '1', quantity: 1 })

      const stored = localStorage.getItem(STORAGE_KEY)
      expect(stored).not.toBeNull()
      const parsed = JSON.parse(stored!)
      expect(parsed).toHaveLength(1)
    })

    it('drops oldest when cap (50) is exceeded', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      for (let i = 0; i < 51; i++) {
        useRetryQueueStore.getState().enqueue('cart.add', { idx: i })
      }

      const { queue } = useRetryQueueStore.getState()
      expect(queue).toHaveLength(50)
      // The oldest (idx: 0) was dropped; idx: 1 should be the first
      expect((queue[0].payload as { idx: number }).idx).toBe(1)
      expect(warnSpy).toHaveBeenCalled()
    })
  })

  describe('dequeue', () => {
    it('removes entry by id', () => {
      useRetryQueueStore.getState().enqueue('cart.add', {})
      const { queue } = useRetryQueueStore.getState()
      const id = queue[0].id

      useRetryQueueStore.getState().dequeue(id)
      expect(useRetryQueueStore.getState().queue).toHaveLength(0)
    })
  })

  describe('hydrate + purgeStale', () => {
    it('discards entries older than 5 minutes on hydrate', () => {
      const staleEntry = {
        id: 'stale-1',
        operation: 'cart.add',
        payload: {},
        enqueuedAt: Date.now() - 6 * 60 * 1000, // 6 minutes ago
        attempts: 0,
      }
      const freshEntry = {
        id: 'fresh-1',
        operation: 'cart.add',
        payload: {},
        enqueuedAt: Date.now() - 1 * 60 * 1000, // 1 minute ago
        attempts: 0,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify([staleEntry, freshEntry]))

      useRetryQueueStore.getState().hydrate()

      const { queue } = useRetryQueueStore.getState()
      expect(queue).toHaveLength(1)
      expect(queue[0].id).toBe('fresh-1')
    })
  })

  describe('drain — 3 failed attempts → discard', () => {
    it('discards entry after 3 consecutive fails and emits gave-up event', async () => {
      // Set executor that always throws
      const failingExecutor = vi.fn().mockRejectedValue(new Error('network fail'))
      useRetryQueueStore.getState().setExecutor(failingExecutor)

      // Pre-populate queue with attempts = 2 (one more fail = discard)
      useRetryQueueStore.setState({
        queue: [
          {
            id: 'entry-fail',
            operation: 'cart.add',
            payload: {},
            enqueuedAt: Date.now(),
            attempts: 2,
          },
        ],
        _executor: failingExecutor,
        _drainTimer: null,
        _isDraining: false,
      })

      const gaveUpEvents: Event[] = []
      window.addEventListener('pwamenu:retry-gave-up', (e) => gaveUpEvents.push(e))

      await useRetryQueueStore.getState().drain()

      window.removeEventListener('pwamenu:retry-gave-up', (e) => gaveUpEvents.push(e))

      expect(useRetryQueueStore.getState().queue).toHaveLength(0)
      expect(gaveUpEvents).toHaveLength(1)
    })
  })

  describe('localStorage unavailable fallback', () => {
    it('accepts enqueue in memory when localStorage throws', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('SecurityError', 'SecurityError')
      })

      expect(() => {
        useRetryQueueStore.getState().enqueue('cart.add', {})
      }).not.toThrow()

      // In-memory state should have the entry
      expect(useRetryQueueStore.getState().queue).toHaveLength(1)
      expect(warnSpy).toHaveBeenCalled()
    })
  })

  describe('drain on online event', () => {
    it('drains queue when drain() is called after online event', async () => {
      vi.useRealTimers()
      const successExecutor = vi.fn().mockResolvedValue(undefined)
      useRetryQueueStore.getState().setExecutor(successExecutor)
      useRetryQueueStore.getState().enqueue('cart.add', {})

      // Call drain directly (simulates what the 'online' listener does)
      await useRetryQueueStore.getState().drain()

      expect(useRetryQueueStore.getState().queue).toHaveLength(0)
      expect(successExecutor).toHaveBeenCalledOnce()
    })
  })
})
