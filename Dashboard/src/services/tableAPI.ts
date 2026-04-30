/**
 * tableAPI — REST client for the app_table admin endpoints.
 *
 * Endpoint base: /api/admin/tables (C-07 backend)
 * ID conversion: string → parseInt(id, 10) at the boundary (backend uses BigInteger)
 */

import { fetchAPI } from '@/services/api'
import type { Table, TableFormData } from '@/types/operations'

interface BackendTable {
  id: number
  number: number
  code: string
  sector_id: number
  capacity: number
  status: string
  branch_id: number
  is_active: boolean
  created_at?: string
  updated_at?: string
}

function toTable(b: BackendTable): Table {
  return {
    ...b,
    id: String(b.id),
    sector_id: String(b.sector_id),
    branch_id: String(b.branch_id),
    status: b.status as Table['status'],
  }
}

function toBackendBody(data: TableFormData): Record<string, unknown> {
  return {
    ...data,
    sector_id: parseInt(data.sector_id, 10),
    branch_id: parseInt(data.branch_id, 10),
  }
}

export const tableAPI = {
  list: async (branchId: string): Promise<Table[]> => {
    const data = await fetchAPI<BackendTable[]>(`/api/admin/branches/${parseInt(branchId, 10)}/tables`)
    return data.map(toTable)
  },

  get: async (id: string): Promise<Table> => {
    const data = await fetchAPI<BackendTable>(`/api/admin/tables/${parseInt(id, 10)}`)
    return toTable(data)
  },

  create: async (formData: TableFormData): Promise<Table> => {
    const data = await fetchAPI<BackendTable>('/api/admin/tables', {
      method: 'POST',
      body: toBackendBody(formData),
    })
    return toTable(data)
  },

  update: async (id: string, formData: Partial<TableFormData>): Promise<Table> => {
    const body: Record<string, unknown> = { ...formData }
    if (formData.sector_id) body.sector_id = parseInt(formData.sector_id, 10)
    if (formData.branch_id) body.branch_id = parseInt(formData.branch_id, 10)
    const data = await fetchAPI<BackendTable>(`/api/admin/tables/${parseInt(id, 10)}`, {
      method: 'PUT',
      body,
    })
    return toTable(data)
  },

  delete: async (id: string): Promise<void> => {
    await fetchAPI(`/api/admin/tables/${parseInt(id, 10)}`, { method: 'DELETE' })
  },
}
