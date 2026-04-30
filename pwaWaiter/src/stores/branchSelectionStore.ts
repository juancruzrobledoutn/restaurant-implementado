/**
 * branchSelectionStore — persisted branch choice for the waiter pre-login flow.
 *
 * The waiter picks a branch at /select-branch BEFORE logging in (the endpoint
 * GET /api/public/branches is public). This selection is persisted to
 * localStorage so the next session remembers the choice.
 *
 * This store is SEPARATE from authStore — the JWT is never persisted, but the
 * branch choice is a UX preference, not a secret.
 *
 * Rules enforced (zustand-store-pattern skill):
 * - NEVER destructure the store — use the exported named selectors
 * - EMPTY_* stable refs (not needed here — only primitives)
 * - Modular: selectors in the same file as the store (simple store)
 */
import { create } from 'zustand'
import { STORAGE_KEYS } from '@/utils/constants'
import { readJSON, writeJSON, removeKey } from '@/utils/storage'
import { logger } from '@/utils/logger'

interface PersistedSelection {
  branchId: string
  branchName: string
  branchSlug: string
}

export interface SelectBranchPayload {
  branchId: string
  branchName: string
  branchSlug: string
}

interface BranchSelectionState {
  branchId: string | null
  branchName: string | null
  branchSlug: string | null

  // actions
  selectBranch: (payload: SelectBranchPayload) => void
  clearSelection: () => void
}

// ---------------------------------------------------------------------------
// Hydration helper — reads persisted state on module load
// ---------------------------------------------------------------------------
function hydrate(): Pick<BranchSelectionState, 'branchId' | 'branchName' | 'branchSlug'> {
  const stored = readJSON<PersistedSelection>(STORAGE_KEYS.BRANCH_SELECTION)
  if (!stored || !stored.branchId || !stored.branchName || !stored.branchSlug) {
    return { branchId: null, branchName: null, branchSlug: null }
  }
  return {
    branchId: stored.branchId,
    branchName: stored.branchName,
    branchSlug: stored.branchSlug,
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
export const useBranchSelectionStore = create<BranchSelectionState>()((set) => ({
  ...hydrate(),

  selectBranch: (payload) => {
    const next: PersistedSelection = {
      branchId: payload.branchId,
      branchName: payload.branchName,
      branchSlug: payload.branchSlug,
    }
    writeJSON(STORAGE_KEYS.BRANCH_SELECTION, next)
    set(next)
    logger.info('branchSelectionStore: branch selected', {
      branchId: next.branchId,
      branchName: next.branchName,
    })
  },

  clearSelection: () => {
    removeKey(STORAGE_KEYS.BRANCH_SELECTION)
    set({ branchId: null, branchName: null, branchSlug: null })
    logger.info('branchSelectionStore: selection cleared')
  },
}))

// ---------------------------------------------------------------------------
// Selectors — NEVER destructure; always use these
// ---------------------------------------------------------------------------

export const selectBranchId = (s: BranchSelectionState) => s.branchId
export const selectBranchName = (s: BranchSelectionState) => s.branchName
export const selectBranchSlug = (s: BranchSelectionState) => s.branchSlug

/** True if a branch has been chosen. Primitive — safe as plain selector. */
export const selectHasBranchSelection = (s: BranchSelectionState) =>
  s.branchId !== null

export const selectSelectBranchAction = (s: BranchSelectionState) => s.selectBranch
export const selectClearBranchSelectionAction = (s: BranchSelectionState) =>
  s.clearSelection
