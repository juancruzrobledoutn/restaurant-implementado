/**
 * WebSocket event interfaces for pwaMenu diner connection.
 * All events include event_id for deduplication.
 */

// --- Cart events ---

export interface WsCartItemDto {
  item_id: number
  product_id: number
  product_name: string
  quantity: number
  notes: string
  price_cents_snapshot: number
  diner_id: number
  diner_name: string
  added_at: string
}

export interface WsCartItemAddedEvent {
  type: 'CART_ITEM_ADDED'
  event_id: string
  item: WsCartItemDto
}

export interface WsCartItemUpdatedEvent {
  type: 'CART_ITEM_UPDATED'
  event_id: string
  item: Pick<WsCartItemDto, 'item_id' | 'quantity' | 'notes'>
}

export interface WsCartItemRemovedEvent {
  type: 'CART_ITEM_REMOVED'
  event_id: string
  item_id: number
}

export interface WsCartClearedEvent {
  type: 'CART_CLEARED'
  event_id: string
  session_id: number
}

// --- Round events ---

export interface WsRoundPendingEvent {
  type: 'ROUND_PENDING'
  event_id: string
  session_id: number
  round_id: number
  round_number: number
  submitted_at: string
}

export interface WsRoundConfirmedEvent {
  type: 'ROUND_CONFIRMED'
  event_id: string
  session_id: number
  round_id: number
}

export interface WsRoundSubmittedEvent {
  type: 'ROUND_SUBMITTED'
  event_id: string
  session_id: number
  round_id: number
  submitted_at: string
}

export interface WsRoundInKitchenEvent {
  type: 'ROUND_IN_KITCHEN'
  event_id: string
  session_id: number
  round_id: number
}

export interface WsRoundReadyEvent {
  type: 'ROUND_READY'
  event_id: string
  session_id: number
  round_id: number
  ready_at: string
}

export interface WsRoundServedEvent {
  type: 'ROUND_SERVED'
  event_id: string
  session_id: number
  round_id: number
  served_at: string
}

export interface WsRoundCanceledEvent {
  type: 'ROUND_CANCELED'
  event_id: string
  session_id: number
  round_id: number
}

// --- Table status event ---

export interface WsTableStatusChangedEvent {
  type: 'TABLE_STATUS_CHANGED'
  event_id: string
  session_id: number
  status: 'OPEN' | 'PAYING' | 'CLOSED'
}

// --- Billing events (C-19) ---

export interface WsCheckRequestedEvent {
  type: 'CHECK_REQUESTED'
  event_id: string
  session_id: number
  check_id: number
  split_method: string
  total_cents: number
  requested_at: string
}

export interface WsCheckPaidEvent {
  type: 'CHECK_PAID'
  event_id: string
  session_id: number
  check_id: number
  paid_at: string
}

export interface WsPaymentApprovedEvent {
  type: 'PAYMENT_APPROVED'
  event_id: string
  session_id: number
  check_id: number
  payment_id: number
  amount_cents: number
  external_id: string | null
  approved_at: string
}

export interface WsPaymentRejectedEvent {
  type: 'PAYMENT_REJECTED'
  event_id: string
  session_id: number
  check_id: number
  payment_id: number
  reason: string | null
  rejected_at: string
}

// --- Ping/pong ---

export interface WsPingEvent {
  type: 'ping'
}

export interface WsPongEvent {
  type: 'pong'
}

// --- Union type ---

export type WsEvent =
  | WsCartItemAddedEvent
  | WsCartItemUpdatedEvent
  | WsCartItemRemovedEvent
  | WsCartClearedEvent
  | WsRoundPendingEvent
  | WsRoundConfirmedEvent
  | WsRoundSubmittedEvent
  | WsRoundInKitchenEvent
  | WsRoundReadyEvent
  | WsRoundServedEvent
  | WsRoundCanceledEvent
  | WsTableStatusChangedEvent
  | WsCheckRequestedEvent
  | WsCheckPaidEvent
  | WsPaymentApprovedEvent
  | WsPaymentRejectedEvent
  | WsPingEvent
  | WsPongEvent

export type WsEventType = WsEvent['type']
