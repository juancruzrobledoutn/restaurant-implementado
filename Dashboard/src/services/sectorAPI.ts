/**
 * sectorAPI — REST client for the branch_sector admin endpoints.
 *
 * Endpoint base: /api/admin/sectors (C-07 backend)
 * ID conversion: string → parseInt(id, 10) at the boundary
 */

import { fetchAPI } from '@/services/api'
import type { Sector, SectorFormData } from '@/types/operations'

interface BackendSector {
  id: number
  name: string
  branch_id: number
  is_active: boolean
  created_at?: string
  updated_at?: string
}

function toSector(b: BackendSector): Sector {
  return {
    ...b,
    id: String(b.id),
    branch_id: String(b.branch_id),
  }
}

export const sectorAPI = {
  list: async (branchId: string): Promise<Sector[]> => {
    const data = await fetchAPI<BackendSector[]>(`/api/admin/sectors?branch_id=${parseInt(branchId, 10)}`)
    return data.map(toSector)
  },

  get: async (id: string): Promise<Sector> => {
    const data = await fetchAPI<BackendSector>(`/api/admin/sectors/${parseInt(id, 10)}`)
    return toSector(data)
  },

  create: async (formData: SectorFormData): Promise<Sector> => {
    const data = await fetchAPI<BackendSector>('/api/admin/sectors', {
      method: 'POST',
      body: {
        ...formData,
        branch_id: parseInt(formData.branch_id, 10),
      },
    })
    return toSector(data)
  },

  update: async (id: string, formData: Partial<SectorFormData>): Promise<Sector> => {
    const body: Record<string, unknown> = { ...formData }
    if (formData.branch_id) body.branch_id = parseInt(formData.branch_id, 10)
    const data = await fetchAPI<BackendSector>(`/api/admin/sectors/${parseInt(id, 10)}`, {
      method: 'PUT',
      body,
    })
    return toSector(data)
  },

  delete: async (id: string): Promise<void> => {
    await fetchAPI(`/api/admin/sectors/${parseInt(id, 10)}`, { method: 'DELETE' })
  },
}
