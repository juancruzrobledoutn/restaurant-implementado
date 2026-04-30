/**
 * WebSocket event types for the waiter channel.
 *
 * The waiter connects to /ws/waiter?token=JWT and receives events filtered
 * by branch_id and — for SECTOR_EVENTS — by sector_id. In C-20 the shell
 * wires up TABLE_* events; C-21 extends with ROUND_* and SERVICE_CALL_*.
 */

/** Known event type strings emitted to the waiter channel. */
export type WaiterEventType =
  // Branch-wide events (all waiters of the branch)
  | 'TABLE_SESSION_STARTED'
  | 'TABLE_CLEARED'
  | 'TABLE_STATUS_CHANGED'
  // Future (C-21): 'ROUND_PENDING', 'ROUND_CONFIRMED', 'ROUND_READY', 'ROUND_SERVED',
  // 'ROUND_CANCELED', 'SERVICE_CALL_CREATED', 'SERVICE_CALL_ACKED', 'SERVICE_CALL_CLOSED',
  // 'CHECK_REQUESTED', 'CHECK_PAID', 'PAYMENT_APPROVED', 'PAYMENT_REJECTED'
  | (string & {}) // allow forward-compat with events we don't enumerate yet

/** Canonical event envelope as emitted by the WS gateway. */
export interface WaiterEvent<T = unknown> {
  event_type: WaiterEventType
  tenant_id: number
  branch_id: number
  /** Present on SECTOR_EVENTS — used by the gateway to filter per-sector subscribers. */
  sector_id?: number
  /** ISO timestamp from the backend (optional, some legacy events omit it). */
  timestamp?: string
  /** Event-specific payload. */
  payload: T
}

/** Signature of a handler callback registered via waiterWsService.on(). */
export type WaiterEventHandler<T = unknown> = (event: WaiterEvent<T>) => void
