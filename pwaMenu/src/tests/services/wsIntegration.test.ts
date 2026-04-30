/**
 * e2e-lite tests: WS + MSW integration.
 *
 * Tests:
 * - WS connects and dinerWS emits CART_ITEM_ADDED event from another diner
 * - cartStore.applyWsEvent correctly handles the shared item
 * - roundsStore.applyWsEvent handles ROUND_PENDING from WS event
 * - TABLE_STATUS_CHANGED updates sessionStore
 *
 * Uses dinerWS singleton with FakeWebSocket stub (no real WS server needed).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useCartStore } from '../../stores/cartStore'
import { useRoundsStore } from '../../stores/roundsStore'
import { useSessionStore } from '../../stores/sessionStore'

// ─── Mock sessionStore for dinerWS._handleCatchUp ─────────────────────────────
vi.mock('../../stores/sessionStore', async () => {
  const actual = await vi.importActual<typeof import('../../stores/sessionStore')>(
    '../../stores/sessionStore',
  )
  return {
    ...actual,
    // Override getState to return controlled value for dinerWS internals
    useSessionStore: {
      ...actual.useSessionStore,
      getState: () => ({
        ...actual.useSessionStore.getState(),
        sessionId: '42',
        token: 'test-token',
        clear: vi.fn(),
      }),
    },
  }
})

// ─── Mock catchup service ─────────────────────────────────────────────────────
vi.mock('../../services/catchup', () => ({
  fetchSessionCatchup: vi.fn().mockResolvedValue({ status: 'ok', events: [] }),
}))

// ─── FakeWebSocket stub ───────────────────────────────────────────────────────
interface FakeWs {
  onopen: ((e: Event) => void) | null
  onmessage: ((e: MessageEvent) => void) | null
  onclose: ((e: CloseEvent) => void) | null
  onerror: ((e: Event) => void) | null
  send: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  _open(): void
  _message(data: unknown): void
}

let fakeWs: FakeWs | null = null

function createFakeWs(): FakeWs {
  const instance: FakeWs = {
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send: vi.fn(),
    close: vi.fn(),
    _open() {
      this.onopen?.(new Event('open'))
    },
    _message(data: unknown) {
      this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }))
    },
  }
  fakeWs = instance
  return instance
}

import { dinerWS } from '../../services/ws/dinerWS'

describe('WebSocket + Store Integration (e2e-lite)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fakeWs = null

    vi.stubGlobal('WebSocket', function () {
      return createFakeWs()
    })

    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: 'http://localhost/' },
    })

    dinerWS.disconnect()
    dinerWS.onClearSession = null
    dinerWS.onRehydrateRequired = null

    // Reset stores
    useCartStore.setState({ items: {}, _processedIds: [] })
    useRoundsStore.setState({ rounds: {}, _processedIds: [] })
    useSessionStore.setState({
      token: 'test-token',
      sessionId: '42',
      dinerId: 'diner-1',
      dinerName: 'Juan',
      tableStatus: 'OPEN',
      branchSlug: 'default',
      tableCode: 'mesa-1',
      expiresAt: Date.now() + 8 * 60 * 60 * 1000,
    })
  })

  afterEach(() => {
    dinerWS.disconnect()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('CART_ITEM_ADDED from another diner updates cartStore as shared item', () => {
    const cartWsEvent = {
      type: 'CART_ITEM_ADDED',
      event_id: 'ev-shared-1',
      created_at: new Date().toISOString(),
      item: {
        item_id: 99,
        product_id: 42,
        product_name: 'Pizza Margherita',
        quantity: 1,
        notes: '',
        price_cents_snapshot: 80000,
        diner_id: 999, // different diner
        diner_name: 'Ana',
        added_at: new Date().toISOString(),
      },
    }

    // Register handler to wire WS → cartStore
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dinerWS.on('CART_ITEM_ADDED', (event: any) => {
      useCartStore.getState().applyWsEvent(event)
    })

    dinerWS.connect('test-token')
    fakeWs!._open()
    fakeWs!._message(cartWsEvent)

    // Check cartStore has the shared item
    const items = Object.values(useCartStore.getState().items)
    expect(items).toHaveLength(1)
    expect(items[0].dinerId).toBe('999')
    expect(items[0].dinerName).toBe('Ana')
    expect(items[0].productName).toBe('Pizza Margherita')
  })

  it('CART_ITEM_ADDED deduplication: same event_id not applied twice', () => {
    const cartWsEvent = {
      type: 'CART_ITEM_ADDED',
      event_id: 'ev-dup-1',
      created_at: new Date().toISOString(),
      item: {
        item_id: 100,
        product_id: 42,
        product_name: 'Burger',
        quantity: 1,
        notes: '',
        price_cents_snapshot: 70000,
        diner_id: 2,
        diner_name: 'Pedro',
        added_at: new Date().toISOString(),
      },
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dinerWS.on('CART_ITEM_ADDED', (event: any) => {
      useCartStore.getState().applyWsEvent(event)
    })

    dinerWS.connect('test-token')
    fakeWs!._open()

    // Send same event twice
    fakeWs!._message(cartWsEvent)
    fakeWs!._message(cartWsEvent)

    // Only 1 item should be in cart (dedup by event_id)
    const items = Object.values(useCartStore.getState().items)
    expect(items).toHaveLength(1)
  })

  it('ROUND_PENDING WS event updates roundsStore', () => {
    const roundEvent = {
      type: 'ROUND_PENDING',
      event_id: 'ev-round-1',
      created_at: new Date().toISOString(),
      // WsRoundPendingEvent shape: flat, not nested
      session_id: 42,
      round_id: 5,
      round_number: 1,
      submitted_at: new Date().toISOString(),
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dinerWS.on('ROUND_PENDING', (event: any) => {
      useRoundsStore.getState().applyWsEvent(event)
    })

    dinerWS.connect('test-token')
    fakeWs!._open()
    fakeWs!._message(roundEvent)

    const rounds = Object.values(useRoundsStore.getState().rounds)
    expect(rounds).toHaveLength(1)
    expect(rounds[0].status).toBe('PENDING')
    expect(rounds[0].id).toBe('5')
  })

  it('TABLE_STATUS_CHANGED updates sessionStore.tableStatus', () => {
    const tableEvent = {
      type: 'TABLE_STATUS_CHANGED',
      event_id: 'ev-table-1',
      status: 'PAYING',
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dinerWS.on('TABLE_STATUS_CHANGED', (event: any) => {
      useSessionStore.getState().setTableStatus(event.status)
    })

    dinerWS.connect('test-token')
    fakeWs!._open()
    fakeWs!._message(tableEvent)

    expect(useSessionStore.getState().tableStatus).toBe('PAYING')
  })

  it('non-recoverable code 4001 clears session via onClearSession', () => {
    const clearFn = vi.fn()
    dinerWS.onClearSession = clearFn

    dinerWS.connect('test-token')
    fakeWs!._open()

    const closeEvt = new CloseEvent('close', { code: 4001, reason: 'auth_failed', wasClean: false })
    fakeWs!.onclose!(closeEvt)

    expect(clearFn).toHaveBeenCalledOnce()
    expect(window.location.href).toBe('/scan')
  })
})
