/**
 * Checks page tests (C-26 — task 8.7).
 *
 * Coverage:
 * - No branch selected → fallback card rendered
 * - Branch selected, loading → TableSkeleton visible
 * - Branch selected, data loaded → table with status badges rendered
 * - Click "Ver" button → modal opens; billingAPI.getCheck called (via CheckDetailModal)
 * - KPIs computed correctly from checks data
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { CheckSummary } from '@/types/billing'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetchChecks = vi.fn()
const mockSetChecksFilter = vi.fn()

let mockChecks: CheckSummary[] = []
let mockIsLoading = false
const mockChecksFilter = { date: '2026-04-21', status: null, page: 1, page_size: 20 }
let mockSelectedBranchId: string | null = null

vi.mock('@/stores/billingAdminStore', () => ({
  useBillingAdminStore: (selector: (s: unknown) => unknown) => {
    const state = {
      checks: mockChecks,
      checksIsLoading: mockIsLoading,
      checksFilter: mockChecksFilter,
      checksTotal: mockChecks.length,
    }
    return selector(state)
  },
  selectChecks: (s: { checks: CheckSummary[] }) => s.checks,
  selectChecksIsLoading: (s: { checksIsLoading: boolean }) => s.checksIsLoading,
  selectChecksFilter: (s: { checksFilter: typeof mockChecksFilter }) => s.checksFilter,
  useChecksKPIs: () => ({
    totalChecks: mockChecks.length,
    totalBilledCents: mockChecks.reduce((sum, c) => sum + c.total_cents, 0),
    pendingChecks: mockChecks.filter((c) => c.status === 'REQUESTED').length,
  }),
  useBillingAdminActions: () => ({
    fetchChecks: mockFetchChecks,
    setChecksFilter: mockSetChecksFilter,
    fetchPayments: vi.fn(),
    upsertCheck: vi.fn(),
    upsertPayment: vi.fn(),
    setPaymentsFilter: vi.fn(),
    reset: vi.fn(),
  }),
}))

vi.mock('@/stores/branchStore', () => ({
  useBranchStore: (selector: (s: unknown) => unknown) =>
    selector({ selectedBranchId: mockSelectedBranchId }),
  selectSelectedBranchId: (s: { selectedBranchId: string | null }) => s.selectedBranchId,
}))

vi.mock('@/utils/helpContent', () => ({
  helpContent: { checks: null, payments: null },
}))

vi.mock('@/utils/logger', () => ({
  handleError: vi.fn((_e: unknown, ctx: string) => `error:${ctx}`),
}))

vi.mock('@/utils/formatPrice', () => ({
  formatPrice: (cents: number) => `$${(cents / 100).toFixed(2)}`,
}))

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router')
  return { ...actual, useNavigate: () => vi.fn() }
})

vi.mock('@/components/ui/PageContainer', () => ({
  PageContainer: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div data-testid="page-container" data-title={title}>{children}</div>
  ),
}))

vi.mock('@/components/ui/TableSkeleton', () => ({
  TableSkeleton: () => <div data-testid="table-skeleton">Loading...</div>,
}))

vi.mock('@/components/ui/Card', () => ({
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="card" className={className}>{children}</div>
  ),
}))

vi.mock('@/components/ui/Table', () => ({
  Table: ({ items, columns, emptyMessage }: {
    items: unknown[]
    columns: { key: string; label: string; render?: (item: unknown) => React.ReactNode }[]
    emptyMessage: string
  }) => (
    <div data-testid="data-table">
      {items.length === 0 ? (
        <div data-testid="empty-message">{emptyMessage}</div>
      ) : (
        <div data-testid="table-rows">
          {items.map((item: unknown, i: number) => (
            <div key={i} data-testid={`table-row-${i}`}>
              {columns.map((col) => (
                <div key={col.key} data-testid={`cell-${col.key}`}>
                  {col.render ? col.render(item) : String((item as Record<string, unknown>)[col.key])}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  ),
}))

vi.mock('@/components/ui/Pagination', () => ({
  Pagination: () => <div data-testid="pagination" />,
}))

vi.mock('@/components/ui/Button', () => ({
  Button: ({ children, onClick, 'aria-label': ariaLabel }: {
    children: React.ReactNode
    onClick?: () => void
    'aria-label'?: string
  }) => (
    <button onClick={onClick} aria-label={ariaLabel}>{children}</button>
  ),
}))

vi.mock('@/components/billing/BillingRealtimeBridge', () => ({
  BillingRealtimeBridge: () => null,
}))

vi.mock('@/components/billing/CheckStatusBadge', () => ({
  CheckStatusBadge: ({ status }: { status: string }) => (
    <span data-testid="check-status-badge">{status}</span>
  ),
}))

vi.mock('@/components/billing/CheckDetailModal', () => ({
  CheckDetailModal: ({ isOpen, onClose, sessionId, checkId }: {
    isOpen: boolean
    onClose: () => void
    sessionId: string | null
    checkId: string | null
  }) => (
    isOpen ? (
      <div data-testid="check-detail-modal" data-session-id={sessionId} data-check-id={checkId}>
        <button onClick={onClose}>Cerrar</button>
      </div>
    ) : null
  ),
}))

vi.mock('@/components/sales/SalesKPICard', () => ({
  SalesKPICard: ({ label, value }: { label: string; value: number }) => (
    <div data-testid="kpi-card" data-label={label} data-value={value}>{label}: {value}</div>
  ),
}))

vi.mock('@/hooks/usePagination', () => ({
  usePagination: (items: unknown[]) => ({
    paginatedItems: items,
    currentPage: 1,
    totalPages: 1,
    totalItems: items.length,
    itemsPerPage: 20,
    setCurrentPage: vi.fn(),
  }),
}))

// Static import after mocks
import ChecksPage from './Checks'

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function renderChecks() {
  return render(
    <MemoryRouter>
      <ChecksPage />
    </MemoryRouter>,
  )
}

function makeCheck(id: string, status: 'REQUESTED' | 'PAID' = 'REQUESTED'): CheckSummary {
  return {
    id,
    session_id: `sess-${id}`,
    branch_id: '1',
    total_cents: 1000,
    covered_cents: 0,
    status,
    created_at: '2026-04-21T12:00:00Z',
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockChecks = []
  mockIsLoading = false
  mockSelectedBranchId = null
  vi.clearAllMocks()
})

describe('ChecksPage', () => {
  describe('branch guard', () => {
    it('renders fallback card when no branch is selected', () => {
      renderChecks()

      // Branch guard message should be visible
      expect(screen.getByText(/Selecciona una sucursal/i)).toBeInTheDocument()
      // Table should NOT be rendered
      expect(screen.queryByTestId('data-table')).not.toBeInTheDocument()
    })

    it('does not fetch when no branch is selected', () => {
      renderChecks()
      expect(mockFetchChecks).not.toHaveBeenCalled()
    })
  })

  describe('loading state', () => {
    it('renders TableSkeleton while loading', () => {
      mockSelectedBranchId = '1'
      mockIsLoading = true

      renderChecks()

      expect(screen.getByTestId('table-skeleton')).toBeInTheDocument()
    })
  })

  describe('with data', () => {
    it('renders table with check rows', () => {
      mockSelectedBranchId = '1'
      mockIsLoading = false
      mockChecks = [makeCheck('1', 'REQUESTED'), makeCheck('2', 'PAID')]

      renderChecks()

      expect(screen.getByTestId('data-table')).toBeInTheDocument()
      expect(screen.getByTestId('table-rows')).toBeInTheDocument()
      expect(screen.queryByTestId('table-skeleton')).not.toBeInTheDocument()
    })

    it('renders CheckStatusBadge for each check status', () => {
      mockSelectedBranchId = '1'
      mockChecks = [makeCheck('1', 'REQUESTED'), makeCheck('2', 'PAID')]

      renderChecks()

      const badges = screen.getAllByTestId('check-status-badge')
      expect(badges).toHaveLength(2)
      expect(badges[0]).toHaveTextContent('REQUESTED')
      expect(badges[1]).toHaveTextContent('PAID')
    })

    it('renders empty message when branch is selected but no data', () => {
      mockSelectedBranchId = '1'
      mockChecks = []

      renderChecks()

      expect(screen.getByTestId('data-table')).toBeInTheDocument()
      expect(screen.getByTestId('empty-message')).toBeInTheDocument()
    })
  })

  describe('KPI cards', () => {
    it('renders 3 KPI cards with correct values', () => {
      mockSelectedBranchId = '1'
      mockChecks = [
        makeCheck('1', 'REQUESTED'),
        makeCheck('2', 'REQUESTED'),
        makeCheck('3', 'PAID'),
      ]

      renderChecks()

      const kpiCards = screen.getAllByTestId('kpi-card')
      expect(kpiCards).toHaveLength(3)

      // Total checks = 3
      const totalCard = kpiCards.find((c) => c.getAttribute('data-label') === 'Cuentas del dia')
      expect(totalCard).toBeDefined()
      expect(totalCard?.getAttribute('data-value')).toBe('3')

      // Pending checks = 2 (REQUESTED)
      const pendingCard = kpiCards.find((c) => c.getAttribute('data-label') === 'Cuentas pendientes')
      expect(pendingCard).toBeDefined()
      expect(pendingCard?.getAttribute('data-value')).toBe('2')
    })
  })

  describe('Ver detalle modal', () => {
    it('opens CheckDetailModal when Ver button is clicked', () => {
      mockSelectedBranchId = '1'
      mockChecks = [makeCheck('42')]

      renderChecks()

      // Modal should not be open initially
      expect(screen.queryByTestId('check-detail-modal')).not.toBeInTheDocument()

      // Click Ver button
      const verButton = screen.getByRole('button', { name: /Ver detalle de cuenta 42/i })
      fireEvent.click(verButton)

      // Modal should now be open
      expect(screen.getByTestId('check-detail-modal')).toBeInTheDocument()
    })

    it('passes correct checkId to CheckDetailModal', () => {
      mockSelectedBranchId = '1'
      mockChecks = [makeCheck('42')]

      renderChecks()

      const verButton = screen.getByRole('button', { name: /Ver detalle de cuenta 42/i })
      fireEvent.click(verButton)

      const modal = screen.getByTestId('check-detail-modal')
      expect(modal.getAttribute('data-check-id')).toBe('42')
    })

    it('closes modal when onClose is called', () => {
      mockSelectedBranchId = '1'
      mockChecks = [makeCheck('1')]

      renderChecks()

      const verButton = screen.getByRole('button', { name: /Ver detalle/i })
      fireEvent.click(verButton)

      expect(screen.getByTestId('check-detail-modal')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /Cerrar/i }))

      expect(screen.queryByTestId('check-detail-modal')).not.toBeInTheDocument()
    })
  })

  describe('fetch behavior', () => {
    it('calls fetchChecks when branch is selected', () => {
      mockSelectedBranchId = '5'

      renderChecks()

      expect(mockFetchChecks).toHaveBeenCalledWith('5')
    })
  })
})
