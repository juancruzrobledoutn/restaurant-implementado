/**
 * DinerWS — singleton WebSocket client for pwaMenu diner connection.
 *
 * Features:
 * - Connects to /ws/diner?table_token=<TOKEN>
 * - State machine: DISCONNECTED | CONNECTING | CONNECTED | RECONNECTING | AUTH_FAILED
 * - Exponential backoff reconnect (1s → 30s, jitter ±30%, max 50 attempts)
 * - Non-recoverable close codes: 4001, 4003, 4029 → clear session + redirect
 * - Heartbeat: responds pong to server ping every 30s
 * - Maintains lastEventTimestamp for catch-up
 * - On RECONNECTING → CONNECTED: triggers catch-up
 * - Event: on(type, handler) returns unsubscribe function
 */
import { logger } from '../../utils/logger'
import { fetchSessionCatchup } from '../catchup'
import type { WsEvent, WsEventType } from '../../types/wsEvents'

export type WsConnectionState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'AUTH_FAILED'

const WS_URL =
  (typeof import.meta !== 'undefined' &&
    (import.meta.env?.VITE_WS_URL as string | undefined)) ??
  'ws://localhost:8001'

// Non-recoverable close codes
const NON_RECOVERABLE_CODES = new Set([4001, 4003, 4029])

const BACKOFF_BASE_MS = 1000
const BACKOFF_MAX_MS = 30_000
const BACKOFF_JITTER = 0.3
const MAX_RECONNECT_ATTEMPTS = 50

type EventHandler = (event: WsEvent) => void

class DinerWSService {
  private ws: WebSocket | null = null
  private state: WsConnectionState = 'DISCONNECTED'
  private token: string | null = null
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private wasReconnecting = false

  // lastEventTimestamp — ISO string of the last received event
  public lastEventTimestamp: string = new Date(0).toISOString()

  // Event handlers map: eventType → Set<handler>
  private handlers = new Map<string, Set<EventHandler>>()

  // Connection state listeners
  private connectionListeners = new Set<(state: WsConnectionState) => void>()

  // External references (set by wiring code)
  public onRehydrateRequired: (() => void) | null = null
  public onClearSession: (() => void) | null = null

  connect(token: string): void {
    if (this.ws && this.state !== 'DISCONNECTED') {
      if (this.token === token) return // already connected with same token
      this.disconnect()
    }

    this.token = token
    this._connect()
  }

  private _connect(): void {
    if (!this.token) return

    this._setState('CONNECTING')
    const url = `${WS_URL}/ws/diner?table_token=${encodeURIComponent(this.token)}`

    try {
      this.ws = new WebSocket(url)
    } catch (err) {
      logger.error('dinerWS: failed to create WebSocket', err)
      this._scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      const prevState = this.state
      this._setState('CONNECTED')
      // Do NOT reset reconnectAttempt here — it accumulates across disconnect/reconnect
      // cycles. It is only reset by disconnect() or when transitioning from a
      // stable state (non-reconnecting). This ensures exponential backoff grows
      // correctly across multiple reconnect attempts in a single session.

      if (prevState === 'RECONNECTING' || this.wasReconnecting) {
        this.wasReconnecting = false
        this._handleCatchUp()
      }
    }

    this.ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as WsEvent

        // Heartbeat: respond to ping
        if (data.type === 'ping') {
          this.ws?.send(JSON.stringify({ type: 'pong' }))
          return
        }

        // Update lastEventTimestamp if event has one
        const asRecord = data as unknown as Record<string, unknown>
        if (typeof asRecord.created_at === 'string') {
          this.lastEventTimestamp = asRecord.created_at
        } else {
          this.lastEventTimestamp = new Date().toISOString()
        }

        this._emit(data)
      } catch (err) {
        logger.error('dinerWS: failed to parse message', err)
      }
    }

    this.ws.onclose = (event: CloseEvent) => {
      logger.info('dinerWS: connection closed', { code: event.code, reason: event.reason })

      if (NON_RECOVERABLE_CODES.has(event.code)) {
        logger.warn('dinerWS: non-recoverable close code, clearing session', { code: event.code })
        this._setState('AUTH_FAILED')
        this.onClearSession?.()
        window.location.href = '/scan'
        return
      }

      if (this.state !== 'DISCONNECTED') {
        this.wasReconnecting = true
        this._setState('RECONNECTING')
        this._scheduleReconnect()
      }
    }

    this.ws.onerror = (event) => {
      logger.error('dinerWS: WebSocket error', event)
    }
  }

  disconnect(): void {
    this._clearReconnectTimer()
    this.reconnectAttempt = 0
    this.wasReconnecting = false
    this._setState('DISCONNECTED')

    if (this.ws) {
      this.ws.onopen = null
      this.ws.onmessage = null
      this.ws.onclose = null
      this.ws.onerror = null
      this.ws.close()
      this.ws = null
    }
  }

  on(eventType: WsEventType | '*', handler: EventHandler): () => void {
    const key = eventType as string
    if (!this.handlers.has(key)) {
      this.handlers.set(key, new Set())
    }
    this.handlers.get(key)!.add(handler)

    return () => {
      this.handlers.get(key)?.delete(handler)
    }
  }

  onConnectionChange(listener: (state: WsConnectionState) => void): () => void {
    this.connectionListeners.add(listener)
    // Immediately notify with current state
    listener(this.state)
    return () => {
      this.connectionListeners.delete(listener)
    }
  }

  getState(): WsConnectionState {
    return this.state
  }

  private _setState(state: WsConnectionState): void {
    this.state = state
    for (const listener of this.connectionListeners) {
      listener(state)
    }
    logger.debug('dinerWS: state changed', { state })
  }

  private _emit(event: WsEvent): void {
    // Emit to specific event type handlers
    const typed = this.handlers.get(event.type)
    if (typed) {
      for (const handler of typed) {
        try {
          handler(event)
        } catch (err) {
          logger.error('dinerWS: handler error', err)
        }
      }
    }

    // Emit to wildcard handlers
    const wildcard = this.handlers.get('*')
    if (wildcard) {
      for (const handler of wildcard) {
        try {
          handler(event)
        } catch (err) {
          logger.error('dinerWS: wildcard handler error', err)
        }
      }
    }
  }

  private _scheduleReconnect(): void {
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      logger.warn('dinerWS: max reconnect attempts reached')
      this._setState('DISCONNECTED')
      return
    }

    const base = Math.min(BACKOFF_BASE_MS * Math.pow(2, this.reconnectAttempt), BACKOFF_MAX_MS)
    const jitter = base * BACKOFF_JITTER * (Math.random() * 2 - 1)
    const delay = Math.max(100, base + jitter)

    logger.info('dinerWS: reconnecting in', { delay, attempt: this.reconnectAttempt + 1 })
    this.reconnectAttempt++

    this.reconnectTimer = setTimeout(() => {
      this._connect()
    }, delay)
  }

  private _clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private async _handleCatchUp(): Promise<void> {
    const sessionState = await import('../../stores/sessionStore').then(
      (m) => m.useSessionStore.getState(),
    )
    const sessionId = sessionState.sessionId
    const token = sessionState.token

    if (!sessionId || !token) return

    logger.info('dinerWS: triggering catch-up', { since: this.lastEventTimestamp })

    const result = await fetchSessionCatchup(sessionId, this.lastEventTimestamp)

    if (result.status === 'too_old') {
      logger.info('dinerWS: catch-up too_old, emitting REHYDRATE_REQUIRED')
      this.onRehydrateRequired?.()
      return
    }

    // Apply events in order through the same pipeline
    for (const event of result.events) {
      this._emit(event)
    }
  }
}

// Singleton export
export const dinerWS = new DinerWSService()
