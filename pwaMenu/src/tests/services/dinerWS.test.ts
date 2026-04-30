/**
 * Tests for dinerWS.ts using a manual WebSocket stub.
 *
 * Tests:
 * - Connects and emits CONNECTED state on open
 * - Non-recoverable close code 4001: no reconnect, clears session, redirects to /scan
 * - Non-recoverable close code 4003: same behavior
 * - Non-recoverable close code 4029: same behavior
 * - Normal close triggers RECONNECTING + schedules reconnect
 * - Backoff delay: attempt 0 → base 1000ms, attempt 1 → base 2000ms, attempt 2 → base 4000ms
 * - wasReconnecting → CONNECTED triggers catch-up (onRehydrateRequired called for too_old)
 * - Events routed to on(type) handler
 * - Wildcard on('*') receives all events
 * - Ping message → sends pong, does NOT emit to handlers
 * - disconnect() stops reconnect timer
 * - Same token → connect() is a no-op
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mock sessionStore (dynamic import inside _handleCatchUp) ─────────────────
vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: {
    getState: () => ({
      sessionId: '42',
      token: 'test-table-token',
      clear: vi.fn(),
    }),
  },
}))

// ─── Mock catchup service ─────────────────────────────────────────────────────
const mockFetchSessionCatchup = vi.fn()
vi.mock('../../services/catchup', () => ({
  fetchSessionCatchup: (...args: unknown[]) => mockFetchSessionCatchup(...args),
}))

// ─── Fake WebSocket stub ──────────────────────────────────────────────────────
interface FakeWsInstance {
  url: string
  send: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  onopen: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
  onclose: ((event: CloseEvent) => void) | null
  onerror: ((event: Event) => void) | null
  // Test helpers
  _open(): void
  _close(code?: number, reason?: string): void
  _message(data: unknown): void
}

let lastWsInstance: FakeWsInstance | null = null
const WsInstances: FakeWsInstance[] = []

function createFakeWebSocket(url: string): FakeWsInstance {
  const instance: FakeWsInstance = {
    url,
    send: vi.fn(),
    close: vi.fn(),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    _open() {
      this.onopen?.(new Event('open'))
    },
    _close(code = 1000, reason = '') {
      const evt = new CloseEvent('close', { code, reason, wasClean: code === 1000 })
      this.onclose?.(evt)
    },
    _message(data: unknown) {
      const evt = new MessageEvent('message', { data: JSON.stringify(data) })
      this.onmessage?.(evt)
    },
  }
  lastWsInstance = instance
  WsInstances.push(instance)
  return instance
}

// ─── Import dinerWS AFTER mocks are set up ───────────────────────────────────
// We import the singleton instance, not the class.
// Each test must call disconnect() to reset internal state.
import { dinerWS } from '../../services/ws/dinerWS'

describe('dinerWS', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    WsInstances.length = 0
    lastWsInstance = null
    // Default: catch-up returns ok with no events (prevents unhandled rejection in backoff tests)
    mockFetchSessionCatchup.mockReset()
    mockFetchSessionCatchup.mockResolvedValue({ status: 'ok', events: [] })

    // Stub global WebSocket constructor
    vi.stubGlobal('WebSocket', function (url: string) {
      return createFakeWebSocket(url)
    })

    // Stub window.location (jsdom allows href assignment)
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: 'http://localhost/' },
    })

    // Always disconnect to reset singleton state
    dinerWS.disconnect()
    dinerWS.onClearSession = null
    dinerWS.onRehydrateRequired = null
  })

  afterEach(() => {
    dinerWS.disconnect()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  // ────────────────────────────────────────────────────────────────────────────
  describe('connect / state transitions', () => {
    it('transitions to CONNECTING then CONNECTED on open', () => {
      const states: string[] = []
      dinerWS.onConnectionChange((s) => states.push(s))

      dinerWS.connect('token-abc')
      expect(states).toContain('CONNECTING')

      lastWsInstance!._open()
      expect(states).toContain('CONNECTED')
    })

    it('same token — second connect() is a no-op (no new WS instance)', () => {
      dinerWS.connect('token-abc')
      lastWsInstance!._open()
      const firstInstance = lastWsInstance

      dinerWS.connect('token-abc') // same token
      expect(lastWsInstance).toBe(firstInstance)
      expect(WsInstances).toHaveLength(1)
    })

    it('different token — previous WS is closed and new one is created', () => {
      dinerWS.connect('token-one')
      lastWsInstance!._open()

      dinerWS.connect('token-two')
      expect(WsInstances).toHaveLength(2)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  describe('non-recoverable close codes', () => {
    it.each([4001, 4003, 4029])(
      'code %i → AUTH_FAILED, clears session, redirects to /scan, no reconnect timer',
      (code) => {
        const clearSession = vi.fn()
        dinerWS.onClearSession = clearSession

        dinerWS.connect('tok')
        lastWsInstance!._open()
        lastWsInstance!._close(code)

        expect(dinerWS.getState()).toBe('AUTH_FAILED')
        expect(clearSession).toHaveBeenCalledOnce()
        expect(window.location.href).toBe('/scan')

        // No reconnect scheduled — even after fake timer advance, no new WS
        vi.advanceTimersByTime(60_000)
        expect(WsInstances).toHaveLength(1) // only the original
      },
    )
  })

  // ────────────────────────────────────────────────────────────────────────────
  describe('reconnect backoff', () => {
    /**
     * The backoff formula is:
     *   base = min(1000 * 2^attempt, 30_000)
     *   jitter = base * 0.3 * (Math.random() * 2 - 1)
     *   delay = max(100, base + jitter)
     *
     * When Math.random() returns 0:
     *   jitter = base * 0.3 * (0 * 2 - 1) = base * 0.3 * -1 = -0.3 * base
     *   delay = max(100, base * 0.7)
     *
     * Concrete values with random=0:
     *   attempt 0: base=1000, delay=700
     *   attempt 1: base=2000, delay=1400
     *   attempt 4: base=16000, delay=11200
     *   attempt 5+: base=30000 (capped), delay=21000
     */
    function computeDelay(attempt: number): number {
      const base = Math.min(1000 * Math.pow(2, attempt), 30_000)
      // With Math.random()=0: jitter = base * 0.3 * (0*2 - 1) = -0.3 * base
      return Math.max(100, base * 0.7)
    }

    it('attempt 0 → delay ~700ms (base 1000ms × 0.7 with zero jitter)', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0)

      dinerWS.connect('tok')
      lastWsInstance!._open()
      lastWsInstance!._close(1006)

      expect(dinerWS.getState()).toBe('RECONNECTING')

      // Should NOT fire before 700ms
      vi.advanceTimersByTime(699)
      expect(WsInstances).toHaveLength(1)

      vi.advanceTimersByTime(1)
      expect(WsInstances).toHaveLength(2)
    })

    it('attempt 1 → delay ~1400ms (base 2000ms × 0.7 with zero jitter)', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0)

      dinerWS.connect('tok')
      // 1st open + close → attempt 0 reconnect in 700ms
      lastWsInstance!._open()
      lastWsInstance!._close(1006)
      vi.advanceTimersByTime(computeDelay(0)) // fires attempt 0 reconnect

      // 2nd open + close → attempt 1 reconnect in 1400ms
      lastWsInstance!._open()
      lastWsInstance!._close(1006)
      expect(dinerWS.getState()).toBe('RECONNECTING')

      // Should NOT fire at 1399ms
      vi.advanceTimersByTime(1399)
      expect(WsInstances).toHaveLength(2) // no 3rd yet

      vi.advanceTimersByTime(1)
      expect(WsInstances).toHaveLength(3) // 3rd created
    })

    it('attempt 4 → base is 16000ms (2^4), delay = 11200ms', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0)

      dinerWS.connect('tok')

      for (let i = 0; i < 4; i++) {
        lastWsInstance!._open()
        lastWsInstance!._close(1006)
        vi.advanceTimersByTime(computeDelay(i))
      }

      // After 4 advances, attempt index 4 should use base 16000ms → delay 11200ms
      lastWsInstance!._open()
      lastWsInstance!._close(1006)

      vi.advanceTimersByTime(computeDelay(4) - 1)
      const countBefore = WsInstances.length

      vi.advanceTimersByTime(1)
      expect(WsInstances.length).toBe(countBefore + 1)
    })

    it('backoff caps at 30000ms base once 2^attempt exceeds 30s', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0)

      dinerWS.connect('tok')

      for (let i = 0; i < 5; i++) {
        lastWsInstance!._open()
        lastWsInstance!._close(1006)
        vi.advanceTimersByTime(computeDelay(i))
      }

      // Attempt 5: 2^5 = 32000 → capped at 30000ms base → delay = 30000 * 0.7 = 21000ms
      lastWsInstance!._open()
      lastWsInstance!._close(1006)

      vi.advanceTimersByTime(computeDelay(5) - 1)
      const countBefore = WsInstances.length
      vi.advanceTimersByTime(1)
      expect(WsInstances.length).toBe(countBefore + 1)
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  describe('catch-up on RECONNECTING → CONNECTED', () => {
    it('on reconnect open: calls fetchSessionCatchup with lastEventTimestamp', async () => {
      mockFetchSessionCatchup.mockResolvedValue({ status: 'ok', events: [] })

      dinerWS.connect('tok')
      lastWsInstance!._open()

      // Set a known lastEventTimestamp via receiving a message
      const ts = '2026-04-18T12:00:00Z'
      lastWsInstance!._message({
        type: 'CART_ITEM_ADDED',
        event_id: 'ev-1',
        created_at: ts,
        item: {
          item_id: 1,
          product_id: 10,
          product_name: 'Pizza',
          quantity: 1,
          notes: '',
          price_cents_snapshot: 5000,
          diner_id: 8,
          diner_name: 'Juan',
          added_at: ts,
        },
      })

      // Now simulate a disconnect + reconnect
      lastWsInstance!._close(1006)
      vi.advanceTimersByTime(1000) // fires reconnect timer
      lastWsInstance!._open() // 2nd WS opens

      // _handleCatchUp is async — flush promises
      await vi.runAllTimersAsync()
      await Promise.resolve()

      expect(mockFetchSessionCatchup).toHaveBeenCalledWith('42', ts)
    })

    it('too_old response → onRehydrateRequired called', async () => {
      mockFetchSessionCatchup.mockResolvedValue({ status: 'too_old' })
      const rehydrate = vi.fn()
      dinerWS.onRehydrateRequired = rehydrate

      dinerWS.connect('tok')
      lastWsInstance!._open()
      lastWsInstance!._close(1006)
      vi.advanceTimersByTime(1000)
      lastWsInstance!._open()

      await vi.runAllTimersAsync()
      await Promise.resolve()

      expect(rehydrate).toHaveBeenCalledOnce()
    })

    it('ok response with events → events emitted through handlers', async () => {
      const event = {
        type: 'CART_ITEM_ADDED' as const,
        event_id: 'ev-catch-1',
        created_at: '2026-04-18T12:01:00Z',
        item: {
          item_id: 2,
          product_id: 11,
          product_name: 'Burger',
          quantity: 1,
          notes: '',
          price_cents_snapshot: 8000,
          diner_id: 9,
          diner_name: 'Ana',
          added_at: '2026-04-18T12:01:00Z',
        },
      }
      mockFetchSessionCatchup.mockResolvedValue({ status: 'ok', events: [event] })

      const handler = vi.fn()
      dinerWS.on('CART_ITEM_ADDED', handler)

      dinerWS.connect('tok')
      lastWsInstance!._open()
      lastWsInstance!._close(1006)
      vi.advanceTimersByTime(1000)
      lastWsInstance!._open()

      await vi.runAllTimersAsync()
      await Promise.resolve()

      expect(handler).toHaveBeenCalledWith(event)
    })

    it('fresh connect (not from RECONNECTING) does NOT trigger catch-up', async () => {
      mockFetchSessionCatchup.mockResolvedValue({ status: 'ok', events: [] })

      dinerWS.connect('tok')
      lastWsInstance!._open()

      await vi.runAllTimersAsync()
      await Promise.resolve()

      expect(mockFetchSessionCatchup).not.toHaveBeenCalled()
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  describe('event routing', () => {
    it('on(type) handler receives events of that type', () => {
      const handler = vi.fn()
      dinerWS.on('CART_ITEM_REMOVED', handler)

      dinerWS.connect('tok')
      lastWsInstance!._open()

      const evt = { type: 'CART_ITEM_REMOVED' as const, event_id: 'ev-2', item_id: 55 }
      lastWsInstance!._message(evt)

      expect(handler).toHaveBeenCalledWith(evt)
    })

    it('on("*") wildcard receives all event types', () => {
      const wildcard = vi.fn()
      dinerWS.on('*', wildcard)

      dinerWS.connect('tok')
      lastWsInstance!._open()

      lastWsInstance!._message({ type: 'CART_CLEARED', event_id: 'ev-3' })
      lastWsInstance!._message({ type: 'TABLE_STATUS_CHANGED', event_id: 'ev-4', status: 'PAYING' })

      expect(wildcard).toHaveBeenCalledTimes(2)
    })

    it('on() returns unsubscribe — handler no longer called after unsubscribe', () => {
      const handler = vi.fn()
      const unsub = dinerWS.on('CART_ITEM_ADDED', handler)

      dinerWS.connect('tok')
      lastWsInstance!._open()

      const evt = {
        type: 'CART_ITEM_ADDED' as const,
        event_id: 'ev-5',
        created_at: '2026-04-18T12:00:00Z',
        item: {
          item_id: 3,
          product_id: 10,
          product_name: 'Pizza',
          quantity: 1,
          notes: '',
          price_cents_snapshot: 5000,
          diner_id: 8,
          diner_name: 'Juan',
          added_at: '2026-04-18T12:00:00Z',
        },
      }

      lastWsInstance!._message(evt)
      expect(handler).toHaveBeenCalledTimes(1)

      unsub()
      lastWsInstance!._message(evt)
      expect(handler).toHaveBeenCalledTimes(1) // still 1, not 2
    })

    it('ping message → sends pong, does NOT emit to handlers', () => {
      const wildcardHandler = vi.fn()
      dinerWS.on('*', wildcardHandler)

      dinerWS.connect('tok')
      lastWsInstance!._open()
      lastWsInstance!._message({ type: 'ping' })

      expect(lastWsInstance!.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pong' }))
      // ping must NOT propagate to user handlers
      expect(wildcardHandler).not.toHaveBeenCalled()
    })
  })

  // ────────────────────────────────────────────────────────────────────────────
  describe('disconnect', () => {
    it('disconnect() sets state to DISCONNECTED and nulls ws', () => {
      dinerWS.connect('tok')
      lastWsInstance!._open()
      expect(dinerWS.getState()).toBe('CONNECTED')

      dinerWS.disconnect()
      expect(dinerWS.getState()).toBe('DISCONNECTED')
    })

    it('disconnect() cancels scheduled reconnect', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0)

      dinerWS.connect('tok')
      lastWsInstance!._open()
      lastWsInstance!._close(1006) // schedule reconnect in 1000ms
      expect(dinerWS.getState()).toBe('RECONNECTING')

      dinerWS.disconnect()

      // Advance past backoff — no new WS should be created
      vi.advanceTimersByTime(2000)
      expect(WsInstances).toHaveLength(1)
    })
  })
})
