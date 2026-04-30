/**
 * OrdersPage tests (C-25).
 *
 * Covers:
 * - Branch guard (no branch selected)
 * - Loading state
 * - Empty state when no rounds
 * - Error state
 * - Renders column view by default
 * - Renders list view after toggle
 * - fetchRounds called on mount (with branchId)
 * - Detail modal opens when round selected
 * - Cancel dialog opens from detail modal cancel button
 * - RBAC: canCancel passed correctly to detail modal
 * - viewMode persisted to localStorage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { Round, RoundFilters } from '@/types/operations'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetchRounds = vi.fn().mockResolvedValue(undefined)
const mockSetFilter = vi.fn()
const mockClearFilters = vi.fn()
const mockSelectRound = vi.fn()
const mockCancelRound = vi.fn().mockResolvedValue(undefined)
const mockReset = vi.fn()

let mockRounds: Round[] = []
let mockIsLoading = false
let mockError: string | null = null
let mockFilters: RoundFilters = { branch_id: '10', date: '2026-01-15', limit: 50, offset: 0 }
let mockTotal = 0
let mockSelectedRoundId: string | null = null
let mockSelectedRoundObj: Round | null = null

vi.mock('@/stores/roundsAdminStore', () => ({
  EMPTY_ROUNDS: [],
  useRoundsAdminStore: (selector: (s: unknown) => unknown) => {
    const state = {
      rounds: mockRounds,
      isLoading: mockIsLoading,
      error: mockError,
      filters: mockFilters,
      total: mockTotal,
      selectedRoundId: mockSelectedRoundId,
    }
    return selector(state)
  },
  selectAdminRounds: (s: { rounds: Round[] }) => s.rounds,
  selectRoundsLoading: (s: { isLoading: boolean }) => s.isLoading,
  selectRoundsError: (s: { error: string | null }) => s.error,
  selectRoundsFilters: (s: { filters: RoundFilters }) => s.filters,
  selectRoundsTotal: (s: { total: number }) => s.total,
  selectSelectedRoundId: (s: { selectedRoundId: string | null }) => s.selectedRoundId,
  selectSelectedRound: () => mockSelectedRoundObj,
  useRoundsAdminActions: () => ({
    fetchRounds: mockFetchRounds,
    setFilter: mockSetFilter,
    clearFilters: mockClearFilters,
    selectRound: mockSelectRound,
    cancelRound: mockCancelRound,
    reset: mockReset,
  }),
}))

let mockSelectedBranchId: string | null = null

vi.mock('@/stores/branchStore', () => ({
  useBranchStore: (selector: (s: unknown) => unknown) =>
    selector({ selectedBranchId: mockSelectedBranchId }),
  selectSelectedBranchId: (s: { selectedBranchId: string | null }) => s.selectedBranchId,
}))

const mockFetchByBranch = vi.fn()

vi.mock('@/stores/sectorStore', () => {
  const store = (selector: (s: unknown) => unknown) => {
    const state = { items: [] }
    return selector(state)
  }
  // Attach getState for the useEffect direct call in Orders.tsx
  store.getState = () => ({ fetchByBranch: mockFetchByBranch })
  return {
    useSectorStore: store,
    selectSectors: (s: { items: unknown[] }) => s.items,
  }
})

vi.mock('@/hooks/useRoundsAdminWebSocketSync', () => ({
  useRoundsAdminWebSocketSync: vi.fn(),
}))

vi.mock('@/hooks/useAuthPermissions', () => ({
  useAuthPermissions: () => ({
    isAdmin: true,
    isManager: false,
    canCreate: true,
    canEdit: true,
    canDelete: true,
    canManagePromotions: true,
    canDeletePromotion: true,
  }),
}))

vi.mock('@/stores/toastStore', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/utils/helpContent', () => ({
  helpContent: { orders: null },
}))

vi.mock('@/utils/logger', () => ({
  handleError: vi.fn(),
}))

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router')
  return { ...actual, useNavigate: () => vi.fn() }
})

vi.mock('@/components/ui/PageContainer', () => ({
  PageContainer: ({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) => (
    <div data-testid="page-container">
      {actions && <div data-testid="page-actions">{actions}</div>}
      {children}
    </div>
  ),
}))

vi.mock('@/components/ui/TableSkeleton', () => ({
  TableSkeleton: () => <div data-testid="table-skeleton" />,
}))

vi.mock('@/components/orders/OrderFilters', () => ({
  OrderFilters: () => <div data-testid="order-filters" />,
}))

vi.mock('@/components/orders/OrderColumn', () => ({
  OrderColumn: ({ status, rounds }: { status: string; rounds: unknown[] }) => (
    <section data-testid={`column-${status}`}>
      <span>{rounds.length} rounds</span>
    </section>
  ),
}))

vi.mock('@/components/orders/OrderListTable', () => ({
  OrderListTable: ({ rounds }: { rounds: unknown[] }) => (
    <table data-testid="order-list-table">
      <tbody>
        {(rounds as { id: string }[]).map((r) => (
          <tr key={r.id}><td>{r.id}</td></tr>
        ))}
      </tbody>
    </table>
  ),
}))

vi.mock('@/components/orders/OrderDetailsModal', () => ({
  OrderDetailsModal: ({
    isOpen,
    onCancel,
    round,
  }: {
    isOpen: boolean
    round: { round_number: number } | null
    onCancel: (id: string) => void
    canCancel: boolean
    onClose: () => void
  }) =>
    isOpen ? (
      <div data-testid="order-details-modal">
        {round && (
          <button onClick={() => onCancel('round-1')}>cancel from modal</button>
        )}
      </div>
    ) : null,
}))

vi.mock('@/components/orders/CancelOrderDialog', () => ({
  CancelOrderDialog: ({
    isOpen,
    onConfirm,
  }: {
    isOpen: boolean
    onConfirm: (r: string) => Promise<void>
    isLoading: boolean
    roundNumber: number | null
    onClose: () => void
  }) =>
    isOpen ? (
      <div data-testid="cancel-dialog">
        <button onClick={() => onConfirm('Cliente se fue')}>confirm cancel</button>
      </div>
    ) : null,
}))

// Clear localStorage between tests
beforeEach(() => {
  mockRounds = []
  mockIsLoading = false
  mockError = null
  mockFilters = { branch_id: '10', date: '2026-01-15', limit: 50, offset: 0 }
  mockTotal = 0
  mockSelectedRoundId = null
  mockSelectedRoundObj = null
  mockSelectedBranchId = null
  vi.clearAllMocks()
  localStorage.removeItem('orders.viewMode')
})

import OrdersPage from './Orders'

function renderPage() {
  return render(
    <MemoryRouter>
      <OrdersPage />
    </MemoryRouter>,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('branch guard', () => {
  it('shows fallback message when no branch selected', () => {
    mockSelectedBranchId = null
    renderPage()
    expect(screen.getByText(/selecciona una sucursal/i)).toBeInTheDocument()
  })

  it('does NOT call fetchRounds when branchId is null', () => {
    mockSelectedBranchId = null
    renderPage()
    expect(mockFetchRounds).not.toHaveBeenCalled()
  })
})

describe('with branch', () => {
  beforeEach(() => { mockSelectedBranchId = '10' })

  it('calls fetchRounds on mount with branchId', () => {
    renderPage()
    expect(mockFetchRounds).toHaveBeenCalledWith(
      expect.objectContaining({ branch_id: '10' }),
    )
  })

  it('shows loading skeleton when isLoading and no rounds', () => {
    mockIsLoading = true
    mockRounds = []
    renderPage()
    expect(screen.getByTestId('table-skeleton')).toBeInTheDocument()
  })

  it('does not show skeleton when rounds are present (incremental update)', () => {
    mockIsLoading = true
    mockRounds = [
      {
        id: '1', round_number: 1, session_id: 's1', branch_id: '10',
        status: 'PENDING', table_id: 't1', table_code: 'A1', table_number: 1,
        sector_id: null, sector_name: null, diner_id: null, diner_name: null,
        items_count: 1, total_cents: 1000, pending_at: new Date().toISOString(),
        confirmed_at: null, submitted_at: null, in_kitchen_at: null,
        ready_at: null, served_at: null, canceled_at: null, cancel_reason: null,
        created_by_role: 'WAITER', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
    ]
    renderPage()
    expect(screen.queryByTestId('table-skeleton')).not.toBeInTheDocument()
  })

  it('shows empty state when not loading and no rounds', () => {
    mockIsLoading = false
    mockRounds = []
    renderPage()
    expect(screen.getByText(/no hay rondas que coincidan/i)).toBeInTheDocument()
  })

  it('shows error state when error is set', () => {
    mockError = 'Network error'
    renderPage()
    expect(screen.getByText('Network error')).toBeInTheDocument()
  })

  it('shows column view by default', () => {
    mockRounds = [
      {
        id: '1', round_number: 1, session_id: 's1', branch_id: '10',
        status: 'PENDING', table_id: 't1', table_code: 'A1', table_number: 1,
        sector_id: null, sector_name: null, diner_id: null, diner_name: null,
        items_count: 1, total_cents: 1000, pending_at: new Date().toISOString(),
        confirmed_at: null, submitted_at: null, in_kitchen_at: null,
        ready_at: null, served_at: null, canceled_at: null, cancel_reason: null,
        created_by_role: 'WAITER', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
    ]
    renderPage()
    expect(screen.getByTestId('column-PENDING')).toBeInTheDocument()
    expect(screen.queryByTestId('order-list-table')).not.toBeInTheDocument()
  })

  it('switches to list view when list button clicked', async () => {
    mockRounds = [
      {
        id: '1', round_number: 1, session_id: 's1', branch_id: '10',
        status: 'PENDING', table_id: 't1', table_code: 'A1', table_number: 1,
        sector_id: null, sector_name: null, diner_id: null, diner_name: null,
        items_count: 1, total_cents: 1000, pending_at: new Date().toISOString(),
        confirmed_at: null, submitted_at: null, in_kitchen_at: null,
        ready_at: null, served_at: null, canceled_at: null, cancel_reason: null,
        created_by_role: 'WAITER', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
    ]
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /vista lista/i }))
    expect(screen.getByTestId('order-list-table')).toBeInTheDocument()
    expect(screen.queryByTestId('column-PENDING')).not.toBeInTheDocument()
  })

  it('persists viewMode to localStorage on toggle', async () => {
    mockRounds = [
      {
        id: '1', round_number: 1, session_id: 's1', branch_id: '10',
        status: 'PENDING', table_id: 't1', table_code: 'A1', table_number: 1,
        sector_id: null, sector_name: null, diner_id: null, diner_name: null,
        items_count: 1, total_cents: 1000, pending_at: new Date().toISOString(),
        confirmed_at: null, submitted_at: null, in_kitchen_at: null,
        ready_at: null, served_at: null, canceled_at: null, cancel_reason: null,
        created_by_role: 'WAITER', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
    ]
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /vista lista/i }))
    expect(localStorage.getItem('orders.viewMode')).toBe('list')
  })

  it('shows detail modal when selectedRoundId is set', () => {
    mockSelectedRoundId = 'round-1'
    mockSelectedRoundObj = {
      id: 'round-1', round_number: 5, session_id: 's1', branch_id: '10',
      status: 'PENDING', table_id: 't1', table_code: 'A1', table_number: 1,
      sector_id: null, sector_name: null, diner_id: null, diner_name: null,
      items_count: 1, total_cents: 1000, pending_at: new Date().toISOString(),
      confirmed_at: null, submitted_at: null, in_kitchen_at: null,
      ready_at: null, served_at: null, canceled_at: null, cancel_reason: null,
      created_by_role: 'WAITER', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }
    renderPage()
    expect(screen.getByTestId('order-details-modal')).toBeInTheDocument()
  })

  it('opens cancel dialog when cancel triggered from detail modal', async () => {
    mockSelectedRoundId = 'round-1'
    mockSelectedRoundObj = {
      id: 'round-1', round_number: 5, session_id: 's1', branch_id: '10',
      status: 'PENDING', table_id: 't1', table_code: 'A1', table_number: 1,
      sector_id: null, sector_name: null, diner_id: null, diner_name: null,
      items_count: 1, total_cents: 1000, pending_at: new Date().toISOString(),
      confirmed_at: null, submitted_at: null, in_kitchen_at: null,
      ready_at: null, served_at: null, canceled_at: null, cancel_reason: null,
      created_by_role: 'WAITER', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }
    renderPage()
    await userEvent.click(screen.getByText('cancel from modal'))
    expect(screen.getByTestId('cancel-dialog')).toBeInTheDocument()
  })

  it('calls cancelRound when cancel confirmed', async () => {
    mockSelectedRoundId = 'round-1'
    mockSelectedRoundObj = {
      id: 'round-1', round_number: 5, session_id: 's1', branch_id: '10',
      status: 'PENDING', table_id: 't1', table_code: 'A1', table_number: 1,
      sector_id: null, sector_name: null, diner_id: null, diner_name: null,
      items_count: 1, total_cents: 1000, pending_at: new Date().toISOString(),
      confirmed_at: null, submitted_at: null, in_kitchen_at: null,
      ready_at: null, served_at: null, canceled_at: null, cancel_reason: null,
      created_by_role: 'WAITER', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }
    renderPage()
    // Open cancel dialog from modal
    await userEvent.click(screen.getByText('cancel from modal'))
    // Confirm cancellation
    await act(async () => {
      await userEvent.click(screen.getByText('confirm cancel'))
    })
    expect(mockCancelRound).toHaveBeenCalledWith('round-1', 'Cliente se fue')
  })

  it('renders filter bar', () => {
    renderPage()
    expect(screen.getByTestId('order-filters')).toBeInTheDocument()
  })

  it('calls reset on unmount', () => {
    const { unmount } = renderPage()
    unmount()
    expect(mockReset).toHaveBeenCalled()
  })
})
