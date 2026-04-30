/**
 * BranchSwitcher component tests — C-29 dashboard-branch-selector.
 *
 * Skills: test-driven-development, vercel-react-best-practices, interface-design
 *
 * Covers:
 * - Renders "Seleccionar sucursal" when nothing is selected
 * - Shows selected branch name when selection exists
 * - With 1 branch: shows name without dropdown affordance (no chevron interaction)
 * - With N branches: opens dropdown on click, lists all options
 * - Clicking an option calls setSelectedBranch
 * - Closes dropdown on outside click
 * - Shows loading skeleton while isLoading
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BranchSwitcher } from './BranchSwitcher'
import type { Branch } from '@/types/branch'

// Mock the branchStore
vi.mock('@/stores/branchStore', () => ({
  useBranchStore: vi.fn(),
  selectBranches: (s: unknown) => (s as { branches: Branch[] }).branches,
  selectSelectedBranch: (s: unknown) => (s as { selectedBranch: Branch | null }).selectedBranch,
  selectIsLoadingBranches: (s: unknown) => (s as { isLoading: boolean }).isLoading,
  selectSetSelectedBranch: (s: unknown) => (s as { setSelectedBranch: unknown }).setSelectedBranch,
}))

import { useBranchStore } from '@/stores/branchStore'
// Double-cast via unknown to satisfy TypeScript strict mode with Vitest mocks
const mockUseBranchStore = useBranchStore as unknown as ReturnType<typeof vi.fn>

function makeBranch(overrides: Partial<Branch> = {}): Branch {
  return {
    id: 1,
    name: 'Sucursal Centro',
    address: 'Av. Corrientes 123',
    slug: 'centro',
    ...overrides,
  }
}

function setupStore(overrides: {
  branches?: Branch[]
  selectedBranch?: Branch | null
  isLoading?: boolean
  setSelectedBranch?: ReturnType<typeof vi.fn>
} = {}) {
  const setSelectedBranch = overrides.setSelectedBranch ?? vi.fn()
  mockUseBranchStore.mockImplementation((selector: (s: unknown) => unknown) => {
    const state = {
      branches: overrides.branches ?? [],
      selectedBranch: overrides.selectedBranch ?? null,
      isLoading: overrides.isLoading ?? false,
      setSelectedBranch,
    }
    return selector(state)
  })
  return { setSelectedBranch }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// No selection state (with multiple branches so dropdown shows)
// ---------------------------------------------------------------------------

describe('no selection', () => {
  it('shows "Seleccionar sucursal" placeholder when nothing is selected and multiple branches exist', () => {
    setupStore({
      branches: [makeBranch({ id: 1 }), makeBranch({ id: 2, name: 'Sur', slug: 'sur' })],
      selectedBranch: null,
    })
    render(<BranchSwitcher />)
    expect(screen.getByText('Seleccionar sucursal')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

describe('loading state', () => {
  it('shows loading skeleton while isLoading is true', () => {
    setupStore({ isLoading: true })
    const { container } = render(<BranchSwitcher />)
    // Skeleton should have an animated pulse class
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
  })

  it('does NOT show branch name while loading', () => {
    setupStore({ isLoading: true, selectedBranch: makeBranch({ name: 'Centro' }) })
    render(<BranchSwitcher />)
    expect(screen.queryByText('Centro')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Single branch — no dropdown
// ---------------------------------------------------------------------------

describe('single branch', () => {
  it('shows branch name when 1 branch is available', () => {
    const branch = makeBranch({ name: 'Única Sucursal' })
    setupStore({ branches: [branch], selectedBranch: branch })
    render(<BranchSwitcher />)
    expect(screen.getByText('Única Sucursal')).toBeInTheDocument()
  })

  it('does NOT open a dropdown when only 1 branch', () => {
    const branch = makeBranch()
    setupStore({ branches: [branch], selectedBranch: branch })
    render(<BranchSwitcher />)

    const trigger = screen.getByRole('button')
    fireEvent.click(trigger)

    // No listbox should appear — it would be a single-item non-interactive display
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Multiple branches — dropdown
// ---------------------------------------------------------------------------

describe('multiple branches', () => {
  const branches = [
    makeBranch({ id: 1, name: 'Centro' }),
    makeBranch({ id: 2, name: 'Norte', slug: 'norte' }),
    makeBranch({ id: 3, name: 'Sur', slug: 'sur' }),
  ]

  it('shows selected branch name', () => {
    setupStore({ branches, selectedBranch: branches[0] })
    render(<BranchSwitcher />)
    expect(screen.getByText('Centro')).toBeInTheDocument()
  })

  it('opens dropdown with all branches on click', async () => {
    setupStore({ branches, selectedBranch: branches[0] })
    render(<BranchSwitcher />)

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument()
    })

    expect(screen.getAllByRole('option')).toHaveLength(3)
    expect(screen.getByText('Norte')).toBeInTheDocument()
    expect(screen.getByText('Sur')).toBeInTheDocument()
  })

  it('calls setSelectedBranch when an option is clicked', async () => {
    const { setSelectedBranch } = setupStore({ branches, selectedBranch: branches[0] })
    render(<BranchSwitcher />)

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => screen.getByRole('listbox'))
    fireEvent.click(screen.getByText('Norte'))

    expect(setSelectedBranch).toHaveBeenCalledWith(branches[1])
  })

  it('closes dropdown after selecting an option', async () => {
    setupStore({ branches, selectedBranch: branches[0] })
    render(<BranchSwitcher />)

    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => screen.getByRole('listbox'))
    fireEvent.click(screen.getByText('Norte'))

    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })
  })

  it('closes dropdown on outside click', async () => {
    setupStore({ branches, selectedBranch: branches[0] })
    const { container } = render(
      <div>
        <BranchSwitcher />
        <div data-testid="outside">Outside</div>
      </div>,
    )

    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => screen.getByRole('listbox'))

    fireEvent.mouseDown(container.querySelector('[data-testid="outside"]')!)

    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })
  })
})

// ---------------------------------------------------------------------------
// C-30: CustomEvent 'dashboard:focus-branch-switcher'
// ---------------------------------------------------------------------------

describe('dashboard:focus-branch-switcher CustomEvent', () => {
  it('opens the dropdown when event fires and multiple branches exist', async () => {
    const branches = [
      makeBranch({ id: 1, name: 'Centro' }),
      makeBranch({ id: 2, name: 'Norte', slug: 'norte' }),
    ]
    setupStore({ branches, selectedBranch: branches[0] })
    render(<BranchSwitcher />)

    // Dropdown should be closed initially
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    // Dispatch the CustomEvent
    window.dispatchEvent(new CustomEvent('dashboard:focus-branch-switcher'))

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument()
    })
  })

  it('does NOT open dropdown when only 1 branch (SingleBranchDisplay gets focus instead)', async () => {
    const branch = makeBranch({ name: 'Centro' })
    setupStore({ branches: [branch], selectedBranch: branch })
    render(<BranchSwitcher />)

    window.dispatchEvent(new CustomEvent('dashboard:focus-branch-switcher'))

    // No listbox for single branch
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })
  })
})
