/**
 * dashboardWS — singleton WebSocket client for the Dashboard admin gateway.
 *
 * Connects to ${VITE_WS_URL}/ws/admin?token=${JWT}.
 *
 * Features:
 * - on / onFiltered / onFilteredMultiple / onThrottled / onFilteredThrottled
 * - onConnectionChange (with immediate notification)
 * - onMaxReconnect callback
 * - Exponential backoff reconnect (max 5 attempts)
 * - No reconnect on close codes 4001 (auth failed), 4003 (forbidden), 4029 (rate limited)
 * - Heartbeat ping every 30s with 10s pong timeout
 * - Token refresh via setTokenRefreshCallback
 * - Catch-up via GET /ws/catchup on reconnect
 *
 * Ref pattern: use this service with two-effect pattern in components.
 *
 * Skill: ws-frontend-subscription, websocket-engineer
 */

import { env } from '@/config/env'
import { logger } from '@/utils/logger'
import type { WSEvent, WSEventType } from '@/types/menu'

// Close codes that should NOT trigger reconnect
const NO_RECONNECT_CODES = new Set([4001, 4003, 4029])

const MAX_RECONNECT_ATTEMPTS = 5
const HEARTBEAT_INTERVAL_MS = 30_000
const PONG_TIMEOUT_MS = 10_000

type EventCallback = (event: WSEvent) => void
type ConnectionCallback = (isConnected: boolean) => void
type TokenRefreshCallback = () => Promise<string>

interface Subscription {
  type: WSEventType | '*'
  branchId?: string | null
  branchIds?: string[]
  callback: EventCallback
  throttleMs?: number
  lastFiredAt?: number
}

class DashboardWSClient {
  private ws: WebSocket | null = null
  private subscriptions: Set<Subscription> = new Set()
  private connectionListeners: Set<ConnectionCallback> = new Set()
  private maxReconnectListeners: Set<() => void> = new Set()
  private reconnectAttempts = 0
  private reconnectTimerId: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimerId: ReturnType<typeof setInterval> | null = null
  private pongTimerId: ReturnType<typeof setTimeout> | null = null
  private isConnected = false
  private currentToken: string | null = null
  private tokenRefreshCallback: TokenRefreshCallback | null = null
  private lastEventTimestamp: string | null = null
  private isManuallyDisconnected = false

  connect(token: string): void {
    this.currentToken = token
    this.isManuallyDisconnected = false
    this.reconnectAttempts = 0
    this._openConnection(token)
  }

  disconnect(): void {
    this.isManuallyDisconnected = true
    this._cleanup()
    if (this.ws) {
      this.ws.close(1000, 'Intentional disconnect')
      this.ws = null
    }
    this._notifyConnectionChange(false)
  }

  setTokenRefreshCallback(cb: TokenRefreshCallback): void {
    this.tokenRefreshCallback = cb
  }

  /**
   * Subscribe to an event type or all events ('*').
   * Returns an unsubscribe function.
   */
  on(type: WSEventType | '*', callback: EventCallback): () => void {
    const sub: Subscription = { type, callback }
    this.subscriptions.add(sub)
    return () => this.subscriptions.delete(sub)
  }

  /**
   * Subscribe filtered by branchId.
   */
  onFiltered(
    branchId: string | null,
    type: WSEventType | '*',
    callback: EventCallback,
  ): () => void {
    const sub: Subscription = { type, branchId, callback }
    this.subscriptions.add(sub)
    return () => this.subscriptions.delete(sub)
  }

  /**
   * Subscribe filtered by multiple branchIds.
   */
  onFilteredMultiple(
    branchIds: string[],
    type: WSEventType | '*',
    callback: EventCallback,
  ): () => void {
    const sub: Subscription = { type, branchIds, callback }
    this.subscriptions.add(sub)
    return () => this.subscriptions.delete(sub)
  }

  /**
   * Subscribe with throttling.
   */
  onThrottled(
    type: WSEventType | '*',
    callback: EventCallback,
    throttleMs = 100,
  ): () => void {
    const sub: Subscription = { type, callback, throttleMs, lastFiredAt: 0 }
    this.subscriptions.add(sub)
    return () => this.subscriptions.delete(sub)
  }

  /**
   * Subscribe filtered by branchId with throttling.
   */
  onFilteredThrottled(
    branchId: string | null,
    type: WSEventType | '*',
    callback: EventCallback,
    throttleMs = 100,
  ): () => void {
    const sub: Subscription = { type, branchId, callback, throttleMs, lastFiredAt: 0 }
    this.subscriptions.add(sub)
    return () => this.subscriptions.delete(sub)
  }

  /**
   * Subscribe to connection state changes.
   * Immediately notifies with current state.
   */
  onConnectionChange(callback: ConnectionCallback): () => void {
    this.connectionListeners.add(callback)
    // Notify immediately with current state
    callback(this.isConnected)
    return () => this.connectionListeners.delete(callback)
  }

  /**
   * Called when max reconnect attempts are exhausted.
   */
  onMaxReconnect(callback: () => void): () => void {
    this.maxReconnectListeners.add(callback)
    return () => this.maxReconnectListeners.delete(callback)
  }

  // ---------------------------------------------------------------------------
  // Private methods
  // ---------------------------------------------------------------------------

  private _openConnection(token: string): void {
    try {
      const url = `${env.WS_URL}/ws/admin?token=${encodeURIComponent(token)}`
      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        logger.info('dashboardWS: connected')
        this.reconnectAttempts = 0
        this._notifyConnectionChange(true)
        this._startHeartbeat()
        // Catch-up after reconnect if we have a last timestamp
        if (this.lastEventTimestamp) {
          this._fetchCatchUp()
        }
      }

      this.ws.onmessage = (event) => {
        this._handleMessage(event.data as string)
      }

      this.ws.onclose = (event) => {
        logger.warn('dashboardWS: closed', { code: event.code, reason: event.reason })
        this._stopHeartbeat()
        this._notifyConnectionChange(false)

        if (this.isManuallyDisconnected) return

        if (NO_RECONNECT_CODES.has(event.code)) {
          logger.warn('dashboardWS: no reconnect due to close code', event.code)
          this.maxReconnectListeners.forEach((cb) => cb())
          return
        }

        this._scheduleReconnect()
      }

      this.ws.onerror = (error) => {
        logger.error('dashboardWS: error', error)
      }
    } catch (err) {
      logger.error('dashboardWS: failed to open connection', err)
      this._scheduleReconnect()
    }
  }

  private _handleMessage(raw: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      logger.warn('dashboardWS: received non-JSON message', raw)
      return
    }

    // Handle pong
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'type' in parsed &&
      (parsed as { type: string }).type === 'pong'
    ) {
      this._clearPongTimeout()
      return
    }

    const event = parsed as WSEvent
    if (!event.type) return

    // Track last event timestamp for catch-up
    if (event.timestamp) {
      this.lastEventTimestamp = event.timestamp
    }

    // Dispatch to matching subscriptions
    const now = Date.now()
    this.subscriptions.forEach((sub) => {
      // Type filter
      if (sub.type !== '*' && sub.type !== event.type) return

      // Branch filter (single)
      if (sub.branchId !== undefined) {
        if (sub.branchId !== null && event.branch_id !== sub.branchId) return
      }

      // Branch filter (multiple)
      if (sub.branchIds !== undefined) {
        if (!event.branch_id || !sub.branchIds.includes(event.branch_id)) return
      }

      // Throttle filter
      if (sub.throttleMs !== undefined) {
        if (now - (sub.lastFiredAt ?? 0) < sub.throttleMs) return
        sub.lastFiredAt = now
      }

      try {
        sub.callback(event)
      } catch (err) {
        logger.error('dashboardWS: subscription callback threw', err)
      }
    })
  }

  private _scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logger.warn('dashboardWS: max reconnect attempts reached')
      this.maxReconnectListeners.forEach((cb) => cb())
      return
    }

    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000)
    this.reconnectAttempts++
    logger.info(`dashboardWS: reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)

    this.reconnectTimerId = setTimeout(async () => {
      let token = this.currentToken

      // Try to refresh token before reconnecting
      if (this.tokenRefreshCallback) {
        try {
          token = await this.tokenRefreshCallback()
          this.currentToken = token
        } catch (err) {
          logger.error('dashboardWS: token refresh failed on reconnect', err)
        }
      }

      if (token) {
        this._openConnection(token)
      }
    }, delay)
  }

  private _startHeartbeat(): void {
    this._stopHeartbeat()
    this.heartbeatTimerId = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }))
        // Start pong timeout
        this.pongTimerId = setTimeout(() => {
          logger.warn('dashboardWS: pong timeout — force reconnect')
          this.ws?.close()
        }, PONG_TIMEOUT_MS)
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  private _stopHeartbeat(): void {
    if (this.heartbeatTimerId !== null) {
      clearInterval(this.heartbeatTimerId)
      this.heartbeatTimerId = null
    }
    this._clearPongTimeout()
  }

  private _clearPongTimeout(): void {
    if (this.pongTimerId !== null) {
      clearTimeout(this.pongTimerId)
      this.pongTimerId = null
    }
  }

  private _cleanup(): void {
    this._stopHeartbeat()
    if (this.reconnectTimerId !== null) {
      clearTimeout(this.reconnectTimerId)
      this.reconnectTimerId = null
    }
  }

  private _notifyConnectionChange(isConnected: boolean): void {
    this.isConnected = isConnected
    this.connectionListeners.forEach((cb) => cb(isConnected))
  }

  private async _fetchCatchUp(): Promise<void> {
    try {
      const params = new URLSearchParams()
      if (this.lastEventTimestamp) {
        params.set('since', this.lastEventTimestamp)
      }
      const response = await fetch(`${env.API_URL}/ws/catchup?${params.toString()}`, {
        headers: this.currentToken ? { Authorization: `Bearer ${this.currentToken}` } : {},
      })
      if (!response.ok) return

      const events = (await response.json()) as WSEvent[]
      for (const event of events) {
        this._handleMessage(JSON.stringify(event))
      }
    } catch (err) {
      logger.warn('dashboardWS: catch-up failed', err)
    }
  }
}

// Singleton instance
export const dashboardWS = new DashboardWSClient()
