/**
 * roundsAdminAPI — REST client for the admin rounds endpoints (C-25).
 *
 * Endpoints:
 *   GET  /api/admin/rounds        — paginated list with filters
 *   GET  /api/admin/rounds/{id}   — detail with embedded items
 *   PATCH /api/admin/rounds/{id}  — cancel (status: "CANCELED", cancel_reason)
 *
 * Boundary convention:
 *   - Backend returns IDs as numbers → converted to strings here
 *   - Prices are integers (cents) — never float
 */

import { fetchAPI } from '@/services/api'
import type { Round, RoundFilters, RoundItem, RoundListResponse } from '@/types/operations'

// ---------------------------------------------------------------------------
// Backend DTO shapes (raw response before ID conversion)
// ---------------------------------------------------------------------------

interface BackendRoundItem {
  id: number
  round_id: number
  product_id: number
  diner_id: number | null
  quantity: number
  notes: string | null
  price_cents_snapshot: number
  is_voided: boolean
  void_reason: string | null
  voided_at: string | null
  created_at: string
  updated_at: string
}

interface BackendRound {
  id: number
  round_number: number
  session_id: number
  branch_id: number
  status: string
  table_id: number
  table_code: string
  table_number: number
  sector_id: number | null
  sector_name: string | null
  diner_id: number | null
  diner_name: string | null
  items_count: number
  total_cents: number
  pending_at: string
  confirmed_at: string | null
  submitted_at: string | null
  in_kitchen_at: string | null
  ready_at: string | null
  served_at: string | null
  canceled_at: string | null
  cancel_reason: string | null
  created_by_role: string
  created_at: string
  updated_at: string
  items?: BackendRoundItem[]
}

interface BackendRoundListResponse {
  items: BackendRound[]
  total: number
  limit: number
  offset: number
}

// ---------------------------------------------------------------------------
// Converters — int IDs → string at boundary
// ---------------------------------------------------------------------------

function toRoundItem(b: BackendRoundItem): RoundItem {
  return {
    id: String(b.id),
    round_id: String(b.round_id),
    product_id: String(b.product_id),
    diner_id: b.diner_id != null ? String(b.diner_id) : null,
    quantity: b.quantity,
    notes: b.notes,
    price_cents_snapshot: b.price_cents_snapshot,
    is_voided: b.is_voided,
    void_reason: b.void_reason,
    voided_at: b.voided_at,
    created_at: b.created_at,
    updated_at: b.updated_at,
  }
}

function toRound(b: BackendRound): Round {
  return {
    id: String(b.id),
    round_number: b.round_number,
    session_id: String(b.session_id),
    branch_id: String(b.branch_id),
    status: b.status as Round['status'],
    table_id: String(b.table_id),
    table_code: b.table_code,
    table_number: b.table_number,
    sector_id: b.sector_id != null ? String(b.sector_id) : null,
    sector_name: b.sector_name,
    diner_id: b.diner_id != null ? String(b.diner_id) : null,
    diner_name: b.diner_name,
    items_count: b.items_count,
    total_cents: b.total_cents,
    pending_at: b.pending_at,
    confirmed_at: b.confirmed_at,
    submitted_at: b.submitted_at,
    in_kitchen_at: b.in_kitchen_at,
    ready_at: b.ready_at,
    served_at: b.served_at,
    canceled_at: b.canceled_at,
    cancel_reason: b.cancel_reason,
    created_by_role: b.created_by_role,
    created_at: b.created_at,
    updated_at: b.updated_at,
    items: b.items?.map(toRoundItem),
  }
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

export const roundsAdminAPI = {
  /**
   * List rounds for a branch with optional filters and pagination.
   * Returns a paginated RoundListResponse with IDs as strings.
   */
  listRounds: async (filters: Partial<RoundFilters>): Promise<RoundListResponse> => {
    const params = new URLSearchParams()

    if (filters.branch_id) params.set('branch_id', filters.branch_id)
    if (filters.date) params.set('date', filters.date)
    if (filters.sector_id) params.set('sector_id', filters.sector_id)
    if (filters.status) params.set('status', filters.status)
    if (filters.table_code) params.set('table_code', filters.table_code)
    if (filters.limit != null) params.set('limit', String(filters.limit))
    if (filters.offset != null) params.set('offset', String(filters.offset))

    const raw = await fetchAPI<BackendRoundListResponse>(
      `/api/admin/rounds?${params.toString()}`
    )

    return {
      items: raw.items.map(toRound),
      total: raw.total,
      limit: raw.limit,
      offset: raw.offset,
    }
  },

  /**
   * Get a single round with embedded items (for detail modal).
   */
  getRound: async (id: string): Promise<Round> => {
    const raw = await fetchAPI<BackendRound>(`/api/admin/rounds/${id}`)
    return toRound(raw)
  },

  /**
   * Cancel a round.
   * On success, the store should wait for the ROUND_CANCELED WS event — do not mutate locally.
   * Backend will emit the event after committing the status change.
   */
  cancelRound: async (id: string, cancelReason: string): Promise<void> => {
    await fetchAPI(`/api/admin/rounds/${id}`, {
      method: 'PATCH',
      body: { status: 'CANCELED', cancel_reason: cancelReason },
    })
  },
}
