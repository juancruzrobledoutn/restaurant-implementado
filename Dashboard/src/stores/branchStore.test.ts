/**
 * branchStore unit tests — C-29 dashboard-branch-selector.
 *
 * Skills: zustand-store-pattern, test-driven-development
 *
 * Covers:
 * - fetchBranches: fetches, filters by userBranchIds, stores result
 * - auto-select: if only 1 branch after filter, selects it automatically
 * - setSelectedBranch: updates selectedBranch and selectedBranchId
 * - branch switch: clears branch-dependent store data
 * - error state on network failure
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useBranchStore } from './branchStore'
import type { Branch } from '@/types/branch'

vi.mock('@/services/branchAPI', () => ({
  branchAPI: {
    getBranches: vi.fn(),
  },
}))

// Mock branch-dependent stores — verify clearAll is called on switch
vi.mock('@/stores/tableStore', () => ({
  useTableStore: {
    getState: vi.fn(() => ({ clearAll: vi.fn() })),
  },
}))

vi.mock('@/stores/salesStore', () => ({
  useSalesStore: {
    getState: vi.fn(() => ({ reset: vi.fn() })),
  },
}))

import { branchAPI } from '@/services/branchAPI'
const mockGetBranches = branchAPI.getBranches as ReturnType<typeof vi.fn>

import { useTableStore } from '@/stores/tableStore'
import { useSalesStore } from '@/stores/salesStore'

function makeBranch(overrides: Partial<Branch> = {}): Branch {
  return {
    id: 1,
    name: 'Sucursal Centro',
    address: 'Av. Corrientes 123',
    slug: 'centro',
    ...overrides,
  }
}

// Reset store state before each test
beforeEach(() => {
  useBranchStore.setState({
    branches: [],
    selectedBranch: null,
    selectedBranchId: null,
    isLoading: false,
    error: null,
  })
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// fetchBranches
// ---------------------------------------------------------------------------

describe('fetchBranches', () => {
  it('fetches branches and filters by userBranchIds', async () => {
    const all = [makeBranch({ id: 1 }), makeBranch({ id: 2, name: 'Sucursal Sur' }), makeBranch({ id: 3, name: 'Sucursal Norte' })]
    mockGetBranches.mockResolvedValueOnce(all)

    await useBranchStore.getState().fetchBranches([1, 3])

    const { branches } = useBranchStore.getState()
    expect(branches).toHaveLength(2)
    expect(branches[0]!.id).toBe(1)
    expect(branches[1]!.id).toBe(3)
  })

  it('sets isLoading true during fetch and false after', async () => {
    let capturedLoading = false
    mockGetBranches.mockImplementationOnce(async () => {
      capturedLoading = useBranchStore.getState().isLoading
      return [makeBranch()]
    })

    await useBranchStore.getState().fetchBranches([1])
    expect(capturedLoading).toBe(true)
    expect(useBranchStore.getState().isLoading).toBe(false)
  })

  it('sets error on network failure', async () => {
    mockGetBranches.mockRejectedValueOnce(new Error('Network error'))

    await useBranchStore.getState().fetchBranches([1])

    const { isLoading, error } = useBranchStore.getState()
    expect(isLoading).toBe(false)
    expect(error).toMatch(/Network error/)
  })

  it('returns empty branches when no IDs match', async () => {
    mockGetBranches.mockResolvedValueOnce([makeBranch({ id: 99 })])

    await useBranchStore.getState().fetchBranches([1, 2])

    expect(useBranchStore.getState().branches).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Auto-select: single branch
// ---------------------------------------------------------------------------

describe('auto-select', () => {
  it('auto-selects when only 1 branch is returned and nothing is selected', async () => {
    const single = makeBranch({ id: 5, name: 'Única' })
    mockGetBranches.mockResolvedValueOnce([single])

    await useBranchStore.getState().fetchBranches([5])

    const { selectedBranch, selectedBranchId } = useBranchStore.getState()
    expect(selectedBranch?.id).toBe(5)
    expect(selectedBranchId).toBe('5')
  })

  it('does NOT auto-select when 2 or more branches are available', async () => {
    mockGetBranches.mockResolvedValueOnce([makeBranch({ id: 1 }), makeBranch({ id: 2, name: 'Sur' })])

    await useBranchStore.getState().fetchBranches([1, 2])

    const { selectedBranch } = useBranchStore.getState()
    expect(selectedBranch).toBeNull()
  })

  it('does NOT auto-select when a branch is already selected', async () => {
    const existing = makeBranch({ id: 7, name: 'Ya Seleccionada' })
    useBranchStore.setState({ selectedBranch: existing, selectedBranchId: '7' })

    const single = makeBranch({ id: 5, name: 'Nueva' })
    mockGetBranches.mockResolvedValueOnce([single])

    await useBranchStore.getState().fetchBranches([5])

    // Should remain as the pre-existing selection
    expect(useBranchStore.getState().selectedBranch?.id).toBe(7)
  })
})

// ---------------------------------------------------------------------------
// setSelectedBranch
// ---------------------------------------------------------------------------

describe('setSelectedBranch', () => {
  it('sets selectedBranch and derives selectedBranchId as string', () => {
    const branch = makeBranch({ id: 42, name: 'Test Branch' })
    useBranchStore.getState().setSelectedBranch(branch)

    const { selectedBranch, selectedBranchId } = useBranchStore.getState()
    expect(selectedBranch?.id).toBe(42)
    expect(selectedBranchId).toBe('42')
  })

  it('calls clearAll on tableStore when switching branches', () => {
    const mockClearAll = vi.fn()
    ;(useTableStore.getState as ReturnType<typeof vi.fn>).mockReturnValueOnce({ clearAll: mockClearAll })

    useBranchStore.setState({ selectedBranch: makeBranch({ id: 1 }), selectedBranchId: '1' })
    useBranchStore.getState().setSelectedBranch(makeBranch({ id: 2, name: 'Sur' }))

    expect(mockClearAll).toHaveBeenCalledTimes(1)
  })

  it('calls reset on salesStore when switching branches', () => {
    const mockReset = vi.fn()
    ;(useSalesStore.getState as ReturnType<typeof vi.fn>).mockReturnValueOnce({ reset: mockReset })

    useBranchStore.setState({ selectedBranch: makeBranch({ id: 1 }), selectedBranchId: '1' })
    useBranchStore.getState().setSelectedBranch(makeBranch({ id: 2, name: 'Sur' }))

    expect(mockReset).toHaveBeenCalledTimes(1)
  })

  it('does NOT clear dependent stores on first selection (no previous branch)', () => {
    const mockClearAll = vi.fn()
    ;(useTableStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({ clearAll: mockClearAll })

    // selectedBranch is null initially — this is the first selection
    useBranchStore.getState().setSelectedBranch(makeBranch({ id: 1 }))

    expect(mockClearAll).not.toHaveBeenCalled()
  })
})
