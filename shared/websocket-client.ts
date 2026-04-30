/**
 * BaseWebSocketClient — abstract base class for all WebSocket clients.
 *
 * Each frontend implements its own concrete class for its specific subscriptions.
 * Full implementation with reconnect, catch-up, and event routing is in the
 * WebSocket change.
 *
 * Pattern: ref pattern (two effects), return unsubscribe always.
 * Never use console.* — use the logger from the specific frontend.
 */
export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface WebSocketMessage {
  type: string
  payload: unknown
  timestamp: string
}

export type MessageHandler = (message: WebSocketMessage) => void

export abstract class BaseWebSocketClient {
  protected url: string
  protected socket: WebSocket | null = null
  protected status: WebSocketStatus = 'disconnected'
  protected handlers: Map<string, Set<MessageHandler>> = new Map()

  constructor(url: string) {
    this.url = url
  }

  /**
   * Connect to the WebSocket server.
   * Concrete classes implement authentication (JWT or table token).
   */
  abstract connect(token: string): void

  /**
   * Disconnect and clean up resources.
   */
  abstract disconnect(): void

  /**
   * Subscribe to a specific event type.
   * Returns an unsubscribe function — ALWAYS call it on cleanup.
   */
  subscribe(eventType: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set())
    }
    this.handlers.get(eventType)!.add(handler)

    return () => {
      this.handlers.get(eventType)?.delete(handler)
    }
  }

  protected dispatch(message: WebSocketMessage): void {
    const handlers = this.handlers.get(message.type)
    if (handlers) {
      handlers.forEach((handler) => handler(message))
    }
  }

  getStatus(): WebSocketStatus {
    return this.status
  }
}
