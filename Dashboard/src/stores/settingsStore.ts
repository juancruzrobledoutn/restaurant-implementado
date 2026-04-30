/**
 * settingsStore — branch and tenant settings state (C-28).
 *
 * Skill: zustand-store-pattern
 *
 * State slices:
 *  - branchSettings / isLoadingBranch
 *  - tenantSettings / isLoadingTenant
 *  - error (shared — last error across both slices)
 *
 * Design decisions:
 *  - No persist middleware: settings are always fetched fresh on mount
 *  - clearBranchSettings: called when the active branch changes (branchStore handler)
 *  - IDs are strings on the frontend (converted at API boundary in settingsAPI)
 */

import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import {
  getBranchSettings,
  updateBranchSettings as apiUpdateBranchSettings,
  getTenantSettings,
  updateTenantSettings as apiUpdateTenantSettings,
} from '@/services/settingsAPI'
import type { BranchSettings, TenantSettings } from '@/types/settings'
import type { BranchSettingsPatch, TenantSettingsPatch } from '@/services/settingsAPI'
import { handleError } from '@/utils/logger'

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

interface SettingsState {
  branchSettings: BranchSettings | null
  tenantSettings: TenantSettings | null
  isLoadingBranch: boolean
  isLoadingTenant: boolean
  error: string | null

  // Branch actions
  fetchBranchSettings: (branchId: string) => Promise<void>
  updateBranchSettings: (branchId: string, patch: BranchSettingsPatch) => Promise<void>
  clearBranchSettings: () => void

  // Tenant actions
  fetchTenantSettings: () => Promise<void>
  updateTenantSettings: (patch: TenantSettingsPatch) => Promise<void>
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSettingsStore = create<SettingsState>()((set) => ({
  branchSettings: null,
  tenantSettings: null,
  isLoadingBranch: false,
  isLoadingTenant: false,
  error: null,

  // ---------------------------------------------------------------------------
  // Branch
  // ---------------------------------------------------------------------------

  fetchBranchSettings: async (branchId) => {
    set({ isLoadingBranch: true, error: null })
    try {
      const data = await getBranchSettings(branchId)
      set({ branchSettings: data, isLoadingBranch: false })
    } catch (err) {
      set({ isLoadingBranch: false, error: handleError(err, 'settingsStore.fetchBranchSettings') })
    }
  },

  updateBranchSettings: async (branchId, patch) => {
    set({ isLoadingBranch: true, error: null })
    try {
      const data = await apiUpdateBranchSettings(branchId, patch)
      set({ branchSettings: data, isLoadingBranch: false })
    } catch (err) {
      set({ isLoadingBranch: false, error: handleError(err, 'settingsStore.updateBranchSettings') })
      throw err
    }
  },

  clearBranchSettings: () => {
    set({ branchSettings: null })
  },

  // ---------------------------------------------------------------------------
  // Tenant
  // ---------------------------------------------------------------------------

  fetchTenantSettings: async () => {
    set({ isLoadingTenant: true, error: null })
    try {
      const data = await getTenantSettings()
      set({ tenantSettings: data, isLoadingTenant: false })
    } catch (err) {
      set({ isLoadingTenant: false, error: handleError(err, 'settingsStore.fetchTenantSettings') })
    }
  },

  updateTenantSettings: async (patch) => {
    set({ isLoadingTenant: true, error: null })
    try {
      const data = await apiUpdateTenantSettings(patch)
      set({ tenantSettings: data, isLoadingTenant: false })
    } catch (err) {
      set({ isLoadingTenant: false, error: handleError(err, 'settingsStore.updateTenantSettings') })
      throw err
    }
  },
}))

// ---------------------------------------------------------------------------
// Selectors (stable references — never inline)
// ---------------------------------------------------------------------------

export const selectBranchSettings = (s: SettingsState) => s.branchSettings
export const selectTenantSettings = (s: SettingsState) => s.tenantSettings
export const selectIsLoadingBranch = (s: SettingsState) => s.isLoadingBranch
export const selectIsLoadingTenant = (s: SettingsState) => s.isLoadingTenant
export const selectSettingsError = (s: SettingsState) => s.error

// ---------------------------------------------------------------------------
// Composite hooks
// ---------------------------------------------------------------------------

export const useSettingsActions = () =>
  useSettingsStore(
    useShallow((s) => ({
      fetchBranchSettings: s.fetchBranchSettings,
      updateBranchSettings: s.updateBranchSettings,
      clearBranchSettings: s.clearBranchSettings,
      fetchTenantSettings: s.fetchTenantSettings,
      updateTenantSettings: s.updateTenantSettings,
    })),
  )
