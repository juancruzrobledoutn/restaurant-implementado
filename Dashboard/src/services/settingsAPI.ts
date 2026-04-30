/**
 * settingsAPI — HTTP client for branch and tenant settings endpoints (C-28).
 *
 * All functions use fetchAPI from api.ts (auto-attaches Authorization header).
 *
 * Endpoints:
 *   GET    /api/admin/branches/{id}/settings
 *   PATCH  /api/admin/branches/{id}
 *   GET    /api/admin/tenants/me
 *   PATCH  /api/admin/tenants/me
 */

import { fetchAPI } from '@/services/api'
import type { BranchSettings, TenantSettings, OpeningHoursWeek } from '@/types/settings'

// ---------------------------------------------------------------------------
// Backend response shapes (numbers → strings at this boundary)
// ---------------------------------------------------------------------------

interface BackendBranchSettings {
  id: number
  tenant_id: number
  name: string
  address: string
  slug: string
  phone: string | null
  timezone: string
  opening_hours: OpeningHoursWeek | null
}

interface BackendTenantSettings {
  id: number
  name: string
}

function toBranchSettings(b: BackendBranchSettings): BranchSettings {
  return {
    ...b,
    id: String(b.id),
    tenant_id: String(b.tenant_id),
  }
}

function toTenantSettings(b: BackendTenantSettings): TenantSettings {
  return {
    ...b,
    id: String(b.id),
  }
}

// ---------------------------------------------------------------------------
// Branch settings
// ---------------------------------------------------------------------------

export async function getBranchSettings(branchId: string): Promise<BranchSettings> {
  const data = await fetchAPI<BackendBranchSettings>(
    `/api/admin/branches/${branchId}/settings`,
  )
  return toBranchSettings(data)
}

export interface BranchSettingsPatch {
  name?: string
  address?: string
  slug?: string
  phone?: string | null
  timezone?: string
  opening_hours?: OpeningHoursWeek | null
}

export async function updateBranchSettings(
  branchId: string,
  patch: BranchSettingsPatch,
): Promise<BranchSettings> {
  const data = await fetchAPI<BackendBranchSettings>(`/api/admin/branches/${branchId}`, {
    method: 'PATCH',
    body: patch,
  })
  return toBranchSettings(data)
}

// ---------------------------------------------------------------------------
// Tenant settings
// ---------------------------------------------------------------------------

export async function getTenantSettings(): Promise<TenantSettings> {
  const data = await fetchAPI<BackendTenantSettings>('/api/admin/tenants/me')
  return toTenantSettings(data)
}

export interface TenantSettingsPatch {
  name?: string
}

export async function updateTenantSettings(patch: TenantSettingsPatch): Promise<TenantSettings> {
  const data = await fetchAPI<BackendTenantSettings>('/api/admin/tenants/me', {
    method: 'PATCH',
    body: patch,
  })
  return toTenantSettings(data)
}
