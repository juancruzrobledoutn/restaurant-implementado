/**
 * waiterAssignmentAPI — REST client for daily waiter sector assignments.
 *
 * Endpoint base: /api/admin/waiter-assignments (C-13 backend)
 * ID conversion: string → parseInt(id, 10) at the boundary
 */

import { fetchAPI } from '@/services/api'
import type { WaiterAssignment } from '@/types/operations'

interface BackendWaiterAssignment {
  id: number
  user_id: number
  sector_id: number
  date: string
  user?: {
    id: number
    email: string
    first_name: string
    last_name: string
  }
  sector?: {
    id: number
    name: string
  }
}

function toWaiterAssignment(b: BackendWaiterAssignment): WaiterAssignment {
  return {
    id: String(b.id),
    user_id: String(b.user_id),
    sector_id: String(b.sector_id),
    date: b.date,
    user: b.user
      ? {
          id: String(b.user.id),
          email: b.user.email,
          first_name: b.user.first_name,
          last_name: b.user.last_name,
        }
      : undefined,
    sector: b.sector
      ? { id: String(b.sector.id), name: b.sector.name }
      : undefined,
  }
}

export const waiterAssignmentAPI = {
  /**
   * List assignments for a date, optionally filtered by branch.
   * date: YYYY-MM-DD
   */
  list: async (date: string, branchId?: string): Promise<WaiterAssignment[]> => {
    const params = new URLSearchParams({ date })
    if (branchId) params.set('branch_id', String(parseInt(branchId, 10)))
    const data = await fetchAPI<BackendWaiterAssignment[]>(`/api/admin/waiter-assignments?${params}`)
    return data.map(toWaiterAssignment)
  },

  create: async (sectorId: string, userId: string, date: string): Promise<WaiterAssignment> => {
    const data = await fetchAPI<BackendWaiterAssignment>('/api/admin/waiter-assignments', {
      method: 'POST',
      body: {
        sector_id: parseInt(sectorId, 10),
        user_id: parseInt(userId, 10),
        date,
      },
    })
    return toWaiterAssignment(data)
  },

  delete: async (assignmentId: string): Promise<void> => {
    await fetchAPI(`/api/admin/waiter-assignments/${parseInt(assignmentId, 10)}`, {
      method: 'DELETE',
    })
  },
}
