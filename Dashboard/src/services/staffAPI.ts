/**
 * staffAPI — REST client for staff management admin endpoints.
 *
 * Endpoint base: /api/admin/staff, /api/admin/staff/{id}/roles (C-13 backend)
 * ID conversion: string → parseInt(id, 10) at the boundary
 */

import { fetchAPI } from '@/services/api'
import type { StaffUser, StaffFormData, Role } from '@/types/operations'

interface BackendStaffUser {
  id: number
  email: string
  first_name: string
  last_name: string
  is_active: boolean
  assignments: Array<{
    branch_id: number
    branch_name: string
    role: string
  }>
}

function toStaffUser(b: BackendStaffUser): StaffUser {
  return {
    ...b,
    id: String(b.id),
    assignments: b.assignments.map((a) => ({
      branch_id: String(a.branch_id),
      branch_name: a.branch_name,
      role: a.role as Role,
    })),
  }
}

export const staffAPI = {
  list: async (branchId?: string): Promise<StaffUser[]> => {
    const params = branchId ? `?branch_id=${parseInt(branchId, 10)}` : ''
    const data = await fetchAPI<BackendStaffUser[]>(`/api/admin/staff${params}`)
    return data.map(toStaffUser)
  },

  get: async (id: string): Promise<StaffUser> => {
    const data = await fetchAPI<BackendStaffUser>(`/api/admin/staff/${parseInt(id, 10)}`)
    return toStaffUser(data)
  },

  create: async (formData: StaffFormData): Promise<StaffUser> => {
    const data = await fetchAPI<BackendStaffUser>('/api/admin/staff', {
      method: 'POST',
      body: formData,
    })
    return toStaffUser(data)
  },

  update: async (id: string, formData: Partial<StaffFormData>): Promise<StaffUser> => {
    const data = await fetchAPI<BackendStaffUser>(`/api/admin/staff/${parseInt(id, 10)}`, {
      method: 'PUT',
      body: formData,
    })
    return toStaffUser(data)
  },

  delete: async (id: string): Promise<void> => {
    await fetchAPI(`/api/admin/staff/${parseInt(id, 10)}`, { method: 'DELETE' })
  },

  /** Assign a role to a user for a specific branch. */
  assignRole: async (userId: string, branchId: string, role: Role): Promise<void> => {
    await fetchAPI(`/api/admin/staff/${parseInt(userId, 10)}/roles`, {
      method: 'POST',
      body: {
        branch_id: parseInt(branchId, 10),
        role,
      },
    })
  },

  /** Revoke a user's role for a specific branch. */
  revokeRole: async (userId: string, branchId: string): Promise<void> => {
    await fetchAPI(
      `/api/admin/staff/${parseInt(userId, 10)}/roles/${parseInt(branchId, 10)}`,
      { method: 'DELETE' },
    )
  },
}
