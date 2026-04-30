/**
 * waiterWsService — singleton WebSocket client for /ws/waiter.
 *
 * Extended in C-21 with:
 * - Handlers for all 14 operational events (ROUND_*, SERVICE_CALL_*, CHECK_*, TABLE_*)
 * - localStorage `waiter:lastEventTimestamp` written after each event
 * - Drain of retryQueueStore on WS `open`
 * - Catch-up post-reconnect via GET /ws/catchup
 * - staleData flag when catchup is partial or gap > 5 min
 *
 * Design (design.md D-08, D-09):
 * - Events are NOT cached in the store — dispatched directly to handlers.
 * - Components use the ref pattern (two effects) per ws-frontend-subscription skill.
 */

import { env } from '@/config/env'
import { logger } from '@/utils/logger'
import {
  WS_RECONNECT_BASE_MS,
  WS_RECONNECT_JITTER_MS,
  WS_RECONNECT_MAX_MS,
} from '@/utils/constants'
import { useWaiterWsStore } from '@/stores/waiterWsStore'
import { useRoundsStore } from '@/stores/roundsStore'
import { useServiceCallsStore } from '@/stores/serviceCallsStore'
import type { WaiterEvent, WaiterEventHandler } from '@/types/ws'

/** Normal close code (RFC 6455) — used when disconnect() is explicit. */
const CLOSE_NORMAL = 1000

/** localStorage key for last-received event timestamp (ms since epoch). */
const LAST_EVENT_KEY = 'waiter:lastEventTimestamp'

/** 5 minutes in ms — gap exceeding this triggers stale banner. */
const STALE_GAP_MS = 5 * 60 * 1000

/**
 * Maximum reconnect attempts before giving up and calling onMaxReconnect.
 * Exposed via _reconnectAttempts; callers see this via the store.
 */
const MAX_RECONNECT_ATTEMPTS = 10

/**
 * Close codes that are NOT retryable.
 * These indicate a permanent auth/authz/rate-limit condition — reconnecting
 * with the same token will always fail. UI must redirect to login or show
 * a non-recoverable error.
 *
 * | Code | Meaning            | UI action              |
 * |------|--------------------|------------------------|
 * | 4001 | Auth failed        | Redirect to login      |
 * | 4003 | Forbidden          | Show access-denied     |
 * | 4029 | Rate limited       | Show rate-limit notice |
 */
const NON_RECONNECTABLE_CODES = new Set([4001, 4003, 4029])

/**
 * Handlers for session-level lifecycle events (not WS domain events).
 * These are registered once via connect() options.
 */
interface WaiterWsHandlers {
  /** Called when server closes with 4001 (JWT invalid/expired). */
  onAuthFail?: () => void
  /** Called when server closes with 4003 (waiter not authorized). */
  onForbidden?: () => void
  /** Called when server closes with 4029 (rate limited). */
  onRateLimited?: () => void
  /** Called when reconnect backoff is exhausted (>= MAX_RECONNECT_ATTEMPTS). */
  onMaxReconnect?: () => void
}

// ---------------------------------------------------------------------------
// Internal state (module-scoped — this is a singleton service)
// ---------------------------------------------------------------------------
let _ws: WebSocket | null = null
let _currentToken: string | null = null
let _currentBranchId: string | null = null
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null
let _manualClose = false
let _reconnectAttempts = 0
let _wasConnected = false  // Tracks if we had a previous connection (for catchup)
const _handlers = new Map<string, Set<WaiterEventHandler>>()
let _lifecycleHandlers: WaiterWsHandlers = {}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const waiterWsService = {
  /**
   * Open the WebSocket with the given JWT.
   * Idempotent: if already connected with same token, this is a no-op.
   *
   * @param token - JWT access token
   * @param branchId - branch ID for catch-up filtering
   * @param handlers - optional lifecycle handlers (auth fail, forbidden, rate limit, max reconnect)
   */
  connect(token: string, branchId?: string, handlers?: WaiterWsHandlers): void {
    if (_ws && _ws.readyState === WebSocket.OPEN && _currentToken === token) {
      return
    }

    cleanupSocket()

    _currentToken = token
    _currentBranchId = branchId ?? _currentBranchId
    _manualClose = false
    _lifecycleHandlers = handlers ?? {}
    openSocket(token)
  },

  /**
   * Close the WebSocket and stop all reconnect attempts.
   */
  disconnect(): void {
    _manualClose = true
    if (_reconnectTimer !== null) {
      clearTimeout(_reconnectTimer)
      _reconnectTimer = null
    }
    if (_ws) {
      try {
        _ws.close(CLOSE_NORMAL, 'client_disconnect')
      } catch {
        // No-op
      }
    }
    cleanupSocket()
    _currentToken = null
    _reconnectAttempts = 0
    _wasConnected = false
    useWaiterWsStore.getState()._resetReconnect()
    useWaiterWsStore.getState()._setConnected(false)
  },

  /**
   * Register a handler for a specific event_type.
   * Returns an unsubscribe function.
   * Use `'*'` to subscribe to every event.
   */
  on<T = unknown>(
    eventType: string,
    callback: WaiterEventHandler<T>,
  ): () => void {
    const set = _handlers.get(eventType) ?? new Set<WaiterEventHandler>()
    set.add(callback as WaiterEventHandler)
    _handlers.set(eventType, set)
    return () => this.off(eventType, callback)
  },

  /** Deregister a handler. */
  off<T = unknown>(eventType: string, callback: WaiterEventHandler<T>): void {
    const set = _handlers.get(eventType)
    if (!set) return
    set.delete(callback as WaiterEventHandler)
    if (set.size === 0) _handlers.delete(eventType)
  },

  /** Test-only: reset all module state between tests. */
  __reset(): void {
    this.disconnect()
    _handlers.clear()
    _wasConnected = false
    _currentBranchId = null
    _lifecycleHandlers = {}
  },
}

// ---------------------------------------------------------------------------
// Socket lifecycle
// ---------------------------------------------------------------------------

function openSocket(token: string): void {
  const url = `${env.WS_URL}/ws/waiter?token=${encodeURIComponent(token)}`
  logger.debug(`waiterWsService: opening socket to ${env.WS_URL}/ws/waiter`)

  let ws: WebSocket
  try {
    ws = new WebSocket(url)
  } catch (err) {
    logger.error('waiterWsService: WebSocket constructor threw', err)
    scheduleReconnect()
    return
  }
  _ws = ws

  ws.onopen = () => {
    logger.info('waiterWsService: connected')
    _reconnectAttempts = 0
    useWaiterWsStore.getState()._resetReconnect()
    useWaiterWsStore.getState()._setConnected(true)

    // Drain retry queue on reconnect
    void import('@/stores/retryQueueStore').then(({ useRetryQueueStore }) => {
      void useRetryQueueStore.getState().drain()
    })

    // Catch-up if we had a previous connection
    if (_wasConnected && _currentBranchId) {
      void performCatchup(_currentBranchId)
    }
    _wasConnected = true
  }

  ws.onmessage = (ev: MessageEvent) => {
    dispatchMessage(ev.data)
  }

  ws.onerror = (err) => {
    logger.warn('waiterWsService: socket error', err)
  }

  ws.onclose = (ev: CloseEvent) => {
    useWaiterWsStore.getState()._setConnected(false)
    logger.info(
      `waiterWsService: socket closed code=${ev.code} reason="${ev.reason}"`,
    )

    if (_manualClose) return

    // Non-reconnectable close codes — these indicate a permanent auth/authz/rate-limit
    // condition. Reconnecting with the same token will always fail, so we emit the
    // appropriate lifecycle handler and do NOT schedule a reconnect.
    if (NON_RECONNECTABLE_CODES.has(ev.code)) {
      logger.warn(`waiterWsService: non-reconnectable close code ${ev.code} — stopping reconnect`)
      switch (ev.code) {
        case 4001:
          _lifecycleHandlers.onAuthFail?.()
          break
        case 4003:
          _lifecycleHandlers.onForbidden?.()
          break
        case 4029:
          _lifecycleHandlers.onRateLimited?.()
          break
      }
      return
    }

    scheduleReconnect()
  }
}

// ---------------------------------------------------------------------------
// Event dispatch + store integration
// ---------------------------------------------------------------------------

function dispatchMessage(raw: unknown): void {
  if (typeof raw !== 'string') return
  let event: WaiterEvent
  try {
    event = JSON.parse(raw) as WaiterEvent
  } catch (err) {
    logger.warn('waiterWsService: failed to parse message', err)
    return
  }

  const type = event.event_type
  if (!type) {
    logger.warn('waiterWsService: message missing event_type', event)
    return
  }

  // Route to store actions
  handleStoreUpdate(event)

  // Write timestamp to localStorage
  updateLastEventTimestamp()

  // Specific handlers fire first
  const specific = _handlers.get(type)
  if (specific) {
    for (const cb of specific) {
      try {
        cb(event)
      } catch (err) {
        logger.error(`waiterWsService: handler for ${type} threw`, err)
      }
    }
  }

  // Wildcard handlers
  const wild = _handlers.get('*')
  if (wild) {
    for (const cb of wild) {
      try {
        cb(event)
      } catch (err) {
        logger.error(`waiterWsService: wildcard handler threw`, err)
      }
    }
  }
}

/**
 * Route WS event to the appropriate store action.
 * Direct imports used — no circular dependencies exist between stores and this service.
 */
function handleStoreUpdate(event: WaiterEvent): void {
  const type = event.event_type
  const payload = event.payload as Record<string, unknown>

  switch (type) {
    // ------ ROUND events ------
    case 'ROUND_PENDING':
    case 'ROUND_CONFIRMED':
    case 'ROUND_SUBMITTED':
    case 'ROUND_IN_KITCHEN':
    case 'ROUND_READY':
    case 'ROUND_SERVED':
    case 'ROUND_CANCELED': {
      const store = useRoundsStore.getState()
      const roundId = String(payload.round_id ?? '')
      const newStatus = (payload.status ?? type.replace('ROUND_', '')) as string
      if (roundId && newStatus) {
        store.updateRoundStatus(roundId, newStatus as never)
      }
      // For ROUND_PENDING: upsert full round if provided
      if (type === 'ROUND_PENDING' && payload.round) {
        const r = payload.round as Record<string, unknown>
        store.upsertRound({
          id: String(r.id ?? ''),
          sessionId: String(r.session_id ?? ''),
          status: 'PENDING',
          items: ((r.items ?? []) as Array<Record<string, unknown>>).map((i) => ({
            id: String(i.id ?? ''),
            productId: String(i.product_id ?? ''),
            quantity: Number(i.quantity ?? 1),
            notes: i.notes as string | null,
          })),
          createdAt: String(r.created_at ?? new Date().toISOString()),
        })
      }
      break
    }

    // ------ SERVICE_CALL events ------
    case 'SERVICE_CALL_CREATED': {
      const call = payload as Record<string, unknown>
      useServiceCallsStore.getState().upsert({
        id: String(call.id ?? ''),
        tableId: String(call.table_id ?? ''),
        sectorId: String(call.sector_id ?? ''),
        status: 'OPEN',
        createdAt: String(call.created_at ?? new Date().toISOString()),
        ackedAt: null,
      })
      break
    }

    case 'SERVICE_CALL_ACKED': {
      const call = payload as Record<string, unknown>
      const id = String(call.id ?? '')
      const existing = useServiceCallsStore.getState().byId[id]
      if (existing) {
        useServiceCallsStore.getState().upsert({
          ...existing,
          status: 'ACKED',
          ackedAt: String(call.acked_at ?? new Date().toISOString()),
        })
      }
      break
    }

    case 'SERVICE_CALL_CLOSED': {
      const id = String((payload as Record<string, unknown>).id ?? '')
      if (id) useServiceCallsStore.getState().remove(id)
      break
    }

    // ------ CHECK events ------
    case 'CHECK_REQUESTED': {
      const tableId = String(payload.table_id ?? '')
      if (tableId) {
        applyToTableStore('applyCheckRequested', tableId)
      }
      break
    }

    case 'CHECK_PAID': {
      const tableId = String(payload.table_id ?? '')
      if (tableId) {
        applyToTableStore('applyCheckPaid', tableId)
      }
      break
    }

    // ------ TABLE events ------
    case 'TABLE_SESSION_STARTED': {
      const tableId = String(payload.table_id ?? '')
      const sessionId = String(payload.session_id ?? '')
      if (tableId && sessionId) {
        applyToTableStore('applySessionStarted', tableId, sessionId)
      }
      break
    }

    case 'TABLE_CLEARED': {
      const tableId = String(payload.table_id ?? '')
      const sessionId = String(payload.session_id ?? '')
      if (tableId) {
        applyToTableStore('applySessionCleared', tableId)
      }
      // Also clear rounds for the session
      if (sessionId) {
        useRoundsStore.getState().clearSession(sessionId)
      }
      break
    }

    case 'TABLE_STATUS_CHANGED': {
      const tableId = String(payload.table_id ?? '')
      const status = String(payload.status ?? '') as never
      if (tableId && status) {
        applyToTableStore('applyStatusChanged', tableId, status)
      }
      break
    }

    default:
      logger.debug(`waiterWsService: unhandled event type ${type}`)
  }
}

/** Helper to call tableStore actions without creating circular deps. */
function applyToTableStore(action: string, ...args: string[]): void {
  void import('@/stores/tableStore').then(({ useTableStore }) => {
    const store = useTableStore.getState() as unknown as Record<string, (...a: string[]) => void>
    if (typeof store[action] === 'function') {
      store[action]!(...args)
    }
  })
}

// ---------------------------------------------------------------------------
// Catch-up on reconnect
// ---------------------------------------------------------------------------

async function performCatchup(branchId: string): Promise<void> {
  const lastTs = localStorage.getItem(LAST_EVENT_KEY)
  if (!lastTs) {
    logger.debug('waiterWsService: no lastEventTimestamp — skipping catchup')
    return
  }

  const since = parseInt(lastTs, 10)
  const gapMs = Date.now() - since

  logger.info(`waiterWsService: performing catchup since=${since} (gap ${Math.round(gapMs / 1000)}s)`)

  try {
    const { catchupWaiterEvents } = await import('@/services/waiter')
    const result = await catchupWaiterEvents(branchId, since)

    // Replay events through the same dispatcher (without the localStorage write to avoid loops)
    for (const evt of result.events) {
      handleStoreUpdate(evt as WaiterEvent)
      // Dispatch to registered handlers too
      const specific = _handlers.get(evt.event_type)
      if (specific) {
        for (const cb of specific) {
          try { cb(evt as WaiterEvent) } catch { /* ignore */ }
        }
      }
    }

    // Update last timestamp
    if (result.events.length > 0) {
      const lastEvent = result.events[result.events.length - 1]
      if (lastEvent?.timestamp) {
        localStorage.setItem(LAST_EVENT_KEY, String(new Date(lastEvent.timestamp).getTime()))
      }
    }

    // Show stale banner if catchup was partial or gap > 5 min
    if (result.partial || gapMs > STALE_GAP_MS) {
      logger.warn('waiterWsService: stale data — catchup partial or gap > 5 min')
      useWaiterWsStore.getState()._setStaleData(true)
    } else {
      useWaiterWsStore.getState()._setStaleData(false)
    }

    logger.info(`waiterWsService: catchup replayed ${result.events.length} events`)
  } catch (err) {
    logger.error('waiterWsService: catchup failed', err)
    // Show stale banner on catchup error too
    useWaiterWsStore.getState()._setStaleData(true)
  }
}

function updateLastEventTimestamp(): void {
  try {
    localStorage.setItem(LAST_EVENT_KEY, String(Date.now()))
  } catch {
    // localStorage may be unavailable in some environments
  }
}

// ---------------------------------------------------------------------------
// Reconnect logic
// ---------------------------------------------------------------------------

function scheduleReconnect(): void {
  if (_currentToken === null) return

  _reconnectAttempts += 1
  useWaiterWsStore.getState()._incrementReconnect()

  // Exhausted — stop reconnecting and notify the UI
  if (_reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    logger.warn(`waiterWsService: max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached — stopping`)
    _lifecycleHandlers.onMaxReconnect?.()
    return
  }

  const exp = Math.min(
    WS_RECONNECT_BASE_MS * 2 ** (_reconnectAttempts - 1),
    WS_RECONNECT_MAX_MS,
  )
  const jitter = Math.random() * WS_RECONNECT_JITTER_MS
  const delay = exp + jitter

  logger.info(
    `waiterWsService: reconnect #${_reconnectAttempts} scheduled in ${Math.round(delay)}ms`,
  )

  if (_reconnectTimer !== null) clearTimeout(_reconnectTimer)
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null
    if (_manualClose || _currentToken === null) return
    openSocket(_currentToken)
  }, delay)
}

function cleanupSocket(): void {
  if (_ws) {
    _ws.onopen = null
    _ws.onmessage = null
    _ws.onerror = null
    _ws.onclose = null
    _ws = null
  }
}
