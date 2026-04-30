/**
 * kitchenAPI — REST client for kitchen display endpoints.
 *
 * Uses /api/kitchen/rounds for listing (allows ADMIN/MANAGER/KITCHEN roles).
 * Uses /api/admin/rounds/{id} PATCH for status transitions (ADMIN/MANAGER only).
 *
 * Decision from design.md: Dashboard Kitchen Display is for ADMIN/MANAGER,
 * who use /api/admin/rounds/{id} for status updates.
 */

import { fetchAPI } from '@/services/api'
import type { KitchenRound, KitchenRoundStatus } from '@/types/operations'

interface BackendKitchenRound {
  id: number
  session_id: number
  branch_id: number
  status: string
  submitted_at: string
  table_number: number
  sector_name: string
  diner_count: number
  items: Array<{
    product_name: string
    quantity: number
    notes?: string
    is_voided: boolean
  }>
}

function toKitchenRound(b: BackendKitchenRound): KitchenRound {
  return {
    id: String(b.id),
    session_id: String(b.session_id),
    branch_id: String(b.branch_id),
    status: b.status as KitchenRoundStatus,
    submitted_at: b.submitted_at,
    table_number: b.table_number,
    sector_name: b.sector_name,
    diner_count: b.diner_count,
    items: b.items,
  }
}

export const kitchenAPI = {
  /**
   * List kitchen rounds for a branch, optionally filtered by status.
   * Returns rounds with status SUBMITTED | IN_KITCHEN | READY.
   */
  listRounds: async (branchId: string, status?: KitchenRoundStatus): Promise<KitchenRound[]> => {
    const params = new URLSearchParams({ branch_id: String(parseInt(branchId, 10)) })
    if (status) params.set('status', status)
    const data = await fetchAPI<BackendKitchenRound[]>(`/api/kitchen/rounds?${params}`)
    return data.map(toKitchenRound)
  },

  /**
   * Update a round's status (SUBMITTED → IN_KITCHEN → READY).
   * Hits /api/admin/rounds/{id} PATCH endpoint.
   */
  patchRoundStatus: async (roundId: string, status: KitchenRoundStatus): Promise<KitchenRound> => {
    const data = await fetchAPI<BackendKitchenRound>(`/api/admin/rounds/${parseInt(roundId, 10)}`, {
      method: 'PATCH',
      body: { status },
    })
    return toKitchenRound(data)
  },
}
