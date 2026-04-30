/**
 * Round domain types.
 * All IDs are strings (converted at the API boundary).
 */

export type RoundStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'SUBMITTED'
  | 'IN_KITCHEN'
  | 'READY'
  | 'SERVED'
  | 'CANCELED'

export interface RoundItem {
  id: string
  productId: string
  productName: string
  quantity: number
  notes: string
  priceCentsSnapshot: number
  dinerId: string
  dinerName: string
}

export interface Round {
  id: string
  sessionId: string
  roundNumber: number
  status: RoundStatus
  items: RoundItem[]
  notes: string
  submittedAt: string // ISO timestamp
  readyAt: string | null
  servedAt: string | null
}

export interface RoundStoreState {
  rounds: Record<string, Round>
  processedEventIds: Set<string>
  setRounds: (rounds: Round[]) => void
  applyWsEvent: (event: RoundWsEvent) => void
  upsertRound: (round: Round) => void
  clear: () => void
}

export type RoundWsEventType =
  | 'ROUND_PENDING'
  | 'ROUND_CONFIRMED'
  | 'ROUND_SUBMITTED'
  | 'ROUND_IN_KITCHEN'
  | 'ROUND_READY'
  | 'ROUND_SERVED'
  | 'ROUND_CANCELED'

export interface RoundWsEvent {
  type: RoundWsEventType
  event_id: string
  session_id: number
  round_id: number
  round_number?: number
  status?: RoundStatus
  submitted_at?: string
  ready_at?: string
  served_at?: string
  [key: string]: unknown
}
