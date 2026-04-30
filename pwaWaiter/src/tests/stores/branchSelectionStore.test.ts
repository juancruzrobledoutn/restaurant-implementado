/**
 * branchSelectionStore tests — pre-login branch choice persistence.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEYS } from '@/utils/constants'

describe('branchSelectionStore', () => {
  beforeEach(() => {
    localStorage.clear()
    // Re-import the store module after clearing storage so the initializer re-runs
    // with an empty localStorage (fresh state).
    //   Vitest caches module imports; resetModules() inside vi.isolateModules handles this.
  })

  it('selectBranch populates state and writes localStorage', async () => {
    const { useBranchSelectionStore } = await import(
      '@/stores/branchSelectionStore'
    )
    useBranchSelectionStore.setState({
      branchId: null,
      branchName: null,
      branchSlug: null,
    })

    useBranchSelectionStore.getState().selectBranch({
      branchId: '7',
      branchName: 'Sucursal Centro',
      branchSlug: 'centro',
    })

    const state = useBranchSelectionStore.getState()
    expect(state.branchId).toBe('7')
    expect(state.branchName).toBe('Sucursal Centro')
    expect(state.branchSlug).toBe('centro')

    const raw = localStorage.getItem(STORAGE_KEYS.BRANCH_SELECTION)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!)).toEqual({
      branchId: '7',
      branchName: 'Sucursal Centro',
      branchSlug: 'centro',
    })
  })

  it('clearSelection resets state and removes localStorage', async () => {
    const { useBranchSelectionStore } = await import(
      '@/stores/branchSelectionStore'
    )
    useBranchSelectionStore.getState().selectBranch({
      branchId: '1',
      branchName: 'B',
      branchSlug: 'b',
    })

    useBranchSelectionStore.getState().clearSelection()

    const state = useBranchSelectionStore.getState()
    expect(state.branchId).toBeNull()
    expect(state.branchName).toBeNull()
    expect(state.branchSlug).toBeNull()
    expect(localStorage.getItem(STORAGE_KEYS.BRANCH_SELECTION)).toBeNull()
  })

  it('hydrates from localStorage on module load', async () => {
    localStorage.setItem(
      STORAGE_KEYS.BRANCH_SELECTION,
      JSON.stringify({
        branchId: '42',
        branchName: 'Hydrated',
        branchSlug: 'hydrated',
      }),
    )

    vi.resetModules()
    const { useBranchSelectionStore } = await import(
      '@/stores/branchSelectionStore'
    )

    const state = useBranchSelectionStore.getState()
    expect(state.branchId).toBe('42')
    expect(state.branchName).toBe('Hydrated')
    expect(state.branchSlug).toBe('hydrated')
  })

  it('selectHasBranchSelection is true only when a branch is picked', async () => {
    const { useBranchSelectionStore, selectHasBranchSelection } = await import(
      '@/stores/branchSelectionStore'
    )
    useBranchSelectionStore.getState().clearSelection()
    expect(selectHasBranchSelection(useBranchSelectionStore.getState())).toBe(
      false,
    )

    useBranchSelectionStore.getState().selectBranch({
      branchId: '1',
      branchName: 'n',
      branchSlug: 's',
    })
    expect(selectHasBranchSelection(useBranchSelectionStore.getState())).toBe(
      true,
    )
  })
})
