/**
 * branchStore — branch selection and loading state (C-29 expansion).
 *
 * C-15 was the stub (only selectedBranchId).
 * C-29 expands with full branch list, object-level selection, fetchBranches()
 * and cascading store cleanup on branch switch.
 *
 * Persist strategy:
 * - selectedBranchId: persisted → restores last selection across page reloads
 * - branches: NOT persisted → always fetched fresh on mount (list may change)
 * - selectedBranch: NOT persisted → rehydrated from branches + selectedBranchId in fetchBranches
 *
 * Skill: zustand-store-pattern
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { STORAGE_KEYS, STORE_VERSIONS } from '@/utils/constants'
import { branchAPI } from '@/services/branchAPI'
import { logger } from '@/utils/logger'
import { useTableStore } from '@/stores/tableStore'
import { useSalesStore } from '@/stores/salesStore'
import { useSettingsStore } from '@/stores/settingsStore'
import type { Branch } from '@/types/branch'

// ---------------------------------------------------------------------------
// Stable empty fallback — never inline `?? []`
// ---------------------------------------------------------------------------
const EMPTY_BRANCHES: Branch[] = []

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------
interface BranchState {
  /** Full list loaded from API, filtered by user.branch_ids */
  branches: Branch[]
  /** Currently selected branch object */
  selectedBranch: Branch | null
  /** Persisted ID — survives page reload; derived from selectedBranch.id */
  selectedBranchId: string | null
  isLoading: boolean
  error: string | null

  // Actions
  fetchBranches: (userBranchIds: number[]) => Promise<void>
  setSelectedBranch: (branch: Branch) => void
  /** Legacy compat — used internally and by authStore on logout */
  setSelectedBranchId: (id: string | null) => void
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
export const useBranchStore = create<BranchState>()(
  persist(
    (set, get) => ({
      branches: EMPTY_BRANCHES,
      selectedBranch: null,
      selectedBranchId: null,
      isLoading: false,
      error: null,

      // ------------------------------------------------------------------
      // fetchBranches — fetch all branches then filter client-side
      // ------------------------------------------------------------------
      fetchBranches: async (userBranchIds: number[]) => {
        set({ isLoading: true, error: null })
        try {
          const all = await branchAPI.getBranches()
          const filtered = all.filter((b) => userBranchIds.includes(b.id))

          const currentSelectedBranch = get().selectedBranch
          const currentSelectedBranchId = get().selectedBranchId

          // Rehydrate selectedBranch from persisted ID if not set yet
          let selectedBranch = currentSelectedBranch
          if (!selectedBranch && currentSelectedBranchId) {
            const numericId = parseInt(currentSelectedBranchId, 10)
            selectedBranch = filtered.find((b) => b.id === numericId) ?? null
          }

          // Auto-select if only one branch available and nothing is selected
          if (!selectedBranch && filtered.length === 1) {
            selectedBranch = filtered[0]!
          }

          set({
            branches: filtered,
            isLoading: false,
            error: null,
            ...(selectedBranch !== currentSelectedBranch && {
              selectedBranch,
              selectedBranchId: selectedBranch ? String(selectedBranch.id) : null,
            }),
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          logger.error('branchStore.fetchBranches:', message)
          set({ isLoading: false, error: message })
        }
      },

      // ------------------------------------------------------------------
      // setSelectedBranch — switch branch and clear branch-dependent stores
      // ------------------------------------------------------------------
      setSelectedBranch: (branch: Branch) => {
        const previousBranch = get().selectedBranch

        set({
          selectedBranch: branch,
          selectedBranchId: String(branch.id),
        })

        // Only clean dependent stores when CHANGING branch (not on first selection)
        if (previousBranch !== null) {
          useTableStore.getState().clearAll()
          useSalesStore.getState().reset()
          useSettingsStore.getState().clearBranchSettings()
        }
      },

      // ------------------------------------------------------------------
      // setSelectedBranchId — legacy action (authStore logout + migrate)
      // ------------------------------------------------------------------
      setSelectedBranchId: (id: string | null) => {
        if (id === null) {
          // Full reset on logout
          set({ selectedBranchId: null, selectedBranch: null })
          return
        }
        set({ selectedBranchId: id })
      },
    }),
    {
      name: STORAGE_KEYS.SELECTED_BRANCH,
      version: STORE_VERSIONS.BRANCH,
      // Only persist selectedBranchId — branches are always fetched fresh
      partialize: (state) => ({ selectedBranchId: state.selectedBranchId }),
      migrate: (persistedState: unknown, _version: number): Partial<BranchState> => {
        if (!persistedState || typeof persistedState !== 'object') {
          return { selectedBranchId: null }
        }
        const state = persistedState as { selectedBranchId?: unknown }
        return {
          selectedBranchId:
            typeof state.selectedBranchId === 'string' ? state.selectedBranchId : null,
        }
      },
    },
  ),
)

// ---------------------------------------------------------------------------
// Named selectors — NEVER destructure; always use these
// ---------------------------------------------------------------------------

export const selectBranches = (s: BranchState) => s.branches
export const selectSelectedBranch = (s: BranchState) => s.selectedBranch
export const selectSelectedBranchId = (s: BranchState) => s.selectedBranchId
export const selectIsLoadingBranches = (s: BranchState) => s.isLoading
export const selectBranchError = (s: BranchState) => s.error

// Legacy compat selectors
export const selectSetSelectedBranchId = (s: BranchState) => s.setSelectedBranchId
export const selectFetchBranches = (s: BranchState) => s.fetchBranches
export const selectSetSelectedBranch = (s: BranchState) => s.setSelectedBranch
