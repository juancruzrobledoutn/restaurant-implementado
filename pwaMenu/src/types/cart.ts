/**
 * Cart domain types.
 * All IDs are strings (converted at the API boundary from backend numeric IDs).
 * All prices are integer cents.
 */

export interface CartItem {
  id: string // 'tmp_...' for optimistic, real item_id for confirmed
  productId: string
  productName: string
  quantity: number
  notes: string
  priceCentsSnapshot: number // integer cents
  dinerId: string
  dinerName: string
  pending: boolean // true while waiting for backend confirmation
  addedAt: string // ISO timestamp — used for tmp↔WS merge window
}

export interface CartStoreState {
  items: Record<string, CartItem>
  processedEventIds: Set<string>
  // actions
  addItem: (product: AddItemProduct, quantity: number, notes?: string) => Promise<void>
  updateItem: (itemId: string, payload: UpdateItemPayload) => Promise<void>
  removeItem: (itemId: string) => Promise<void>
  clear: () => void
  applyWsEvent: (event: CartWsEvent) => void
  replaceAll: (items: CartItem[]) => void
}

export interface AddItemProduct {
  id: string
  name: string
  priceCents: number
}

export interface AddItemPayload {
  product_id: number
  quantity: number
  notes?: string
}

export interface UpdateItemPayload {
  quantity?: number
  notes?: string
}

// ---------------------------------------------------------------------------
// CartWsEvent — discriminated union (task 15.2)
// ---------------------------------------------------------------------------
// Each variant has a literal `type` discriminant so TypeScript narrows
// automatically in switch statements, eliminating `as unknown as` casts.

export interface CartItemAddedEvent {
  type: 'CART_ITEM_ADDED'
  event_id: string
  item: {
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
}

export interface CartItemUpdatedEvent {
  type: 'CART_ITEM_UPDATED'
  event_id: string
  item: {
    item_id: number
    quantity?: number
    notes?: string
  }
}

export interface CartItemRemovedEvent {
  type: 'CART_ITEM_REMOVED'
  event_id: string
  item_id: number
}

export interface CartClearedEvent {
  type: 'CART_CLEARED'
  event_id: string
}

/** Discriminated union — TypeScript narrows automatically in switch on `event.type`. */
export type CartWsEvent =
  | CartItemAddedEvent
  | CartItemUpdatedEvent
  | CartItemRemovedEvent
  | CartClearedEvent

/** Legacy union for backward compat — prefer CartWsEvent's literal type. */
export type CartWsEventType = CartWsEvent['type']
