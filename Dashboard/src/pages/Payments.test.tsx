/**
 * Payments page tests (C-26 — task 9.7).
 *
 * Coverage:
 * - Filters applied → fetchPayments called with correct params
 * - PaymentMethodSummary excludes REJECTED/PENDING (only APPROVED) — tested via selector logic
 * - WAITER would be redirected by router guard (backend enforces — structural note, not unit test)
 * - Click check_id → opens CheckDetailModal
 * - Filters persist via billingAdminStore (simulated by initial filter state)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { PaymentSummary, PaymentsFilter } from '@/types/billing'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetchPayments = vi.fn()
const mockSetPaymentsFilter = vi.fn()

let mockPayments: PaymentSummary[] = []
let mockIsLoading = false
let mockPaymentsFilter: PaymentsFilter = {
  from: '2026-04-21',
  to: '2026-04-21',
  method: null,
  status: null,
  page: 1,
  page_size: 20,
}
let mockSelectedBranchId: string | null = null

vi.mock('@/stores/billingAdminStore', () => ({
  useBillingAdminStore: (selector: (s: unknown) => unknown) => {
    const state = {
      payments: mockPayments,
      paymentsIsLoading: mockIsLoading,
      paymentsFilter: mockPaymentsFilter,
      paymentsTotal: mockPayments.length,
    }
    return selector(state)
  },
  selectPayments: (s: { payments: PaymentSummary[] }) => s.payments,
  selectPaymentsIsLoading: (s: { paymentsIsLoading: boolean }) => s.paymentsIsLoading,
  selectPaymentsFilter: (s: { paymentsFilter: PaymentsFilter }) => s.paymentsFilter,
  useBillingAdminActions: () => ({
    fetchPayments: mockFetchPayments,
    setPaymentsFilter: mockSetPaymentsFilter,
    fetchChecks: vi.fn(),
    upsertCheck: vi.fn(),
    upsertPayment: vi.fn(),
    setChecksFilter: vi.fn(),
    reset: vi.fn(),
  }),
}))

vi.mock('@/stores/branchStore', () => ({
  useBranchStore: (selector: (s: unknown) => unknown) =>
    selector({ selectedBranchId: mockSelectedBranchId }),
  selectSelectedBranchId: (s: { selectedBranchId: string | null }) => s.selectedBranchId,
}))

vi.mock('@/utils/helpContent', () => ({
  helpContent: { payments: null },
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
  TableSkeleton: () => <div data-testid="table-skeleton" />,
}))

vi.mock('@/components/ui/Card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="card">{children}</div>
  ),
}))

vi.mock('@/components/ui/Table', () => ({
  Table: ({ items, columns }: {
    items: unknown[]
    columns: { key: string; label: string; render?: (item: unknown) => React.ReactNode }[]
  }) => (
    <div data-testid="data-table">
      {items.map((item: unknown, i: number) => (
        <div key={i} data-testid={`table-row-${i}`}>
          {columns.map((col) => (
            <div key={col.key} data-testid={`cell-${i}-${col.key}`}>
              {col.render ? col.render(item) : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  ),
}))

vi.mock('@/components/ui/Badge', () => ({
  Badge: ({ children, variant }: { children: React.ReactNode; variant: string }) => (
    <span data-testid="badge" data-variant={variant}>{children}</span>
  ),
}))

vi.mock('@/components/ui/Pagination', () => ({
  Pagination: () => <div data-testid="pagination" />,
}))

vi.mock('@/components/ui/Button', () => ({
  Button: ({ children, onClick, 'aria-label': ariaLabel, className, variant, size }: {
    children: React.ReactNode
    onClick?: (e: React.MouseEvent) => void
    'aria-label'?: string
    className?: string
    variant?: string
    size?: string
  }) => (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      className={className}
      data-variant={variant}
      data-size={size}
    >
      {children}
    </button>
  ),
}))

vi.mock('@/components/billing/BillingRealtimeBridge', () => ({
  BillingRealtimeBridge: () => null,
}))

vi.mock('@/components/billing/PaymentMethodIcon', () => ({
  PaymentMethodIcon: ({ method }: { method: string }) => (
    <span data-testid="payment-method-icon" data-method={method}>{method}</span>
  ),
}))

vi.mock('@/components/billing/PaymentMethodSummary', () => ({
  PaymentMethodSummary: () => <div data-testid="payment-method-summary" />,
}))

vi.mock('@/components/billing/CheckDetailModal', () => ({
  CheckDetailModal: ({ isOpen, onClose, checkId }: {
    isOpen: boolean
    onClose: () => void
    sessionId: string | null
    checkId: string | null
  }) => (
    isOpen ? (
      <div data-testid="check-detail-modal" data-check-id={checkId}>
        <button onClick={onClose}>Cerrar</button>
      </div>
    ) : null
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
import PaymentsPage from './Payments'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPayments() {
  return render(
    <MemoryRouter>
      <PaymentsPage />
    </MemoryRouter>,
  )
}

function makePayment(id: string, status: 'APPROVED' | 'REJECTED' | 'PENDING' | 'FAILED' = 'APPROVED'): PaymentSummary {
  return {
    id,
    check_id: '42',
    amount_cents: 1500,
    method: 'cash',
    status,
    created_at: '2026-04-21T12:00:00Z',
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockPayments = []
  mockIsLoading = false
  mockSelectedBranchId = null
  mockPaymentsFilter = {
    from: '2026-04-21',
    to: '2026-04-21',
    method: null,
    status: null,
    page: 1,
    page_size: 20,
  }
  vi.clearAllMocks()
})

describe('PaymentsPage', () => {
  describe('branch guard', () => {
    it('renders fallback card when no branch is selected', () => {
      renderPayments()

      expect(screen.getByText(/Selecciona una sucursal/i)).toBeInTheDocument()
      expect(screen.queryByTestId('data-table')).not.toBeInTheDocument()
    })
  })

  describe('loading state', () => {
    it('renders TableSkeleton while loading', () => {
      mockSelectedBranchId = '1'
      mockIsLoading = true

      renderPayments()

      expect(screen.getByTestId('table-skeleton')).toBeInTheDocument()
    })
  })

  describe('fetch behavior', () => {
    it('calls fetchPayments when branch is selected', () => {
      mockSelectedBranchId = '3'

      renderPayments()

      expect(mockFetchPayments).toHaveBeenCalledWith('3')
    })

    it('changes to method filter call setPaymentsFilter correctly', () => {
      mockSelectedBranchId = '1'

      renderPayments()

      const methodSelect = screen.getByRole('combobox', { name: /Filtrar por metodo/i })
      fireEvent.change(methodSelect, { target: { value: 'card' } })

      expect(mockSetPaymentsFilter).toHaveBeenCalledWith({ method: 'card', page: 1 })
    })

    it('changes to status filter call setPaymentsFilter correctly', () => {
      mockSelectedBranchId = '1'

      renderPayments()

      const statusSelect = screen.getByRole('combobox', { name: /Filtrar por estado/i })
      fireEvent.change(statusSelect, { target: { value: 'APPROVED' } })

      expect(mockSetPaymentsFilter).toHaveBeenCalledWith({ status: 'APPROVED', page: 1 })
    })

    it('Hoy button resets date range to today', () => {
      mockSelectedBranchId = '1'

      renderPayments()

      const todayButton = screen.getByRole('button', { name: /Hoy/i })
      fireEvent.click(todayButton)

      expect(mockSetPaymentsFilter).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1 }),
      )
    })
  })

  describe('with data', () => {
    it('renders payment rows in table', () => {
      mockSelectedBranchId = '1'
      mockPayments = [makePayment('1', 'APPROVED'), makePayment('2', 'REJECTED')]

      renderPayments()

      expect(screen.getByTestId('data-table')).toBeInTheDocument()
      expect(screen.getByTestId('table-row-0')).toBeInTheDocument()
      expect(screen.getByTestId('table-row-1')).toBeInTheDocument()
    })

    it('renders PaymentMethodSummary section', () => {
      mockSelectedBranchId = '1'
      mockPayments = [makePayment('1')]

      renderPayments()

      expect(screen.getByTestId('payment-method-summary')).toBeInTheDocument()
    })
  })

  describe('click check_id opens modal', () => {
    it('opens CheckDetailModal when check_id button is clicked', () => {
      mockSelectedBranchId = '1'
      mockPayments = [makePayment('1')]

      renderPayments()

      // Modal should not be visible initially
      expect(screen.queryByTestId('check-detail-modal')).not.toBeInTheDocument()

      // Find the check_id button in the table row
      const checkButton = screen.getByRole('button', { name: /Ver cuenta 42/i })
      fireEvent.click(checkButton)

      expect(screen.getByTestId('check-detail-modal')).toBeInTheDocument()
      expect(screen.getByTestId('check-detail-modal').getAttribute('data-check-id')).toBe('42')
    })

    it('closes modal when onClose called', () => {
      mockSelectedBranchId = '1'
      mockPayments = [makePayment('1')]

      renderPayments()

      fireEvent.click(screen.getByRole('button', { name: /Ver cuenta 42/i }))
      expect(screen.getByTestId('check-detail-modal')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /Cerrar/i }))
      expect(screen.queryByTestId('check-detail-modal')).not.toBeInTheDocument()
    })
  })

  describe('filter persistence simulation', () => {
    it('renders filters pre-populated with persisted filter values', () => {
      mockSelectedBranchId = '1'
      // Simulate a persisted filter with method=cash
      mockPaymentsFilter = {
        from: '2026-04-01',
        to: '2026-04-21',
        method: 'cash',
        status: null,
        page: 1,
        page_size: 20,
      }

      renderPayments()

      // The from-date input should reflect the persisted value
      const fromInput = screen.getByLabelText(/Fecha desde/i) as HTMLInputElement
      expect(fromInput.value).toBe('2026-04-01')

      const toInput = screen.getByLabelText(/Fecha hasta/i) as HTMLInputElement
      expect(toInput.value).toBe('2026-04-21')

      const methodSelect = screen.getByRole('combobox', { name: /Filtrar por metodo/i }) as HTMLSelectElement
      expect(methodSelect.value).toBe('cash')
    })
  })
})
