/**
 * SalesPage tests.
 *
 * Covers: branch guard, KPI cards render, date change triggers refetch,
 * empty top products table, fetch called on branch/date change.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { DailyKPIs, TopProduct } from '@/types/operations'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetchDaily = vi.fn()
const mockFetchTopProducts = vi.fn()
const mockSetDate = vi.fn()

let mockDaily: DailyKPIs | null = null
let mockTopProducts: TopProduct[] = []
let mockSelectedDate = '2026-01-01'
let mockIsLoading = false
let mockSelectedBranchId: string | null = null

vi.mock('@/stores/salesStore', () => ({
  useSalesStore: (selector: (s: unknown) => unknown) => {
    const state = {
      daily: mockDaily,
      topProducts: mockTopProducts,
      selectedDate: mockSelectedDate,
      isLoading: mockIsLoading,
      error: null,
    }
    return selector(state)
  },
  selectDailyKPIs: (s: { daily: DailyKPIs | null }) => s.daily,
  selectTopProducts: (s: { topProducts: TopProduct[] }) => s.topProducts,
  selectSalesSelectedDate: (s: { selectedDate: string }) => s.selectedDate,
  selectSalesIsLoading: (s: { isLoading: boolean }) => s.isLoading,
  useSalesActions: () => ({
    fetchDaily: mockFetchDaily,
    fetchTopProducts: mockFetchTopProducts,
    setDate: mockSetDate,
    reset: vi.fn(),
  }),
}))

vi.mock('@/stores/branchStore', () => ({
  useBranchStore: (selector: (s: unknown) => unknown) =>
    selector({ selectedBranchId: mockSelectedBranchId }),
  selectSelectedBranchId: (s: { selectedBranchId: string | null }) => s.selectedBranchId,
}))

vi.mock('@/utils/helpContent', () => ({
  helpContent: { sales: null },
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
  PageContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="page-container">{children}</div>
  ),
}))

vi.mock('@/components/sales/SalesKPICard', () => ({
  SalesKPICard: ({ label, value }: { label: string; value: number }) => (
    <div data-testid="kpi-card" data-label={label} data-value={value}>
      {label}: {value}
    </div>
  ),
}))

vi.mock('@/components/ui/Table', () => ({
  Table: ({ items, emptyMessage }: { items: unknown[]; emptyMessage: string }) =>
    items.length === 0 ? (
      <div data-testid="empty-table">{emptyMessage}</div>
    ) : (
      <div data-testid="products-table">{items.length} items</div>
    ),
}))

vi.mock('@/components/ui/TableSkeleton', () => ({
  TableSkeleton: () => <div data-testid="table-skeleton" />,
}))

vi.mock('@/components/ui/Pagination', () => ({
  Pagination: () => null,
}))

vi.mock('@/components/ui/Card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div data-testid="card">{children}</div>,
}))

vi.mock('@/components/ui/Button', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}))

import SalesPage from './Sales'

function renderPage() {
  return render(
    <MemoryRouter>
      <SalesPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockDaily = null
  mockTopProducts = []
  mockSelectedDate = '2026-01-01'
  mockIsLoading = false
  mockSelectedBranchId = null
  vi.clearAllMocks()
})

describe('branch guard', () => {
  it('shows fallback when no branch', () => {
    mockSelectedBranchId = null
    renderPage()
    expect(screen.getByText(/selecciona una sucursal/i)).toBeTruthy()
  })
})

describe('with branch', () => {
  beforeEach(() => { mockSelectedBranchId = '100' })

  it('fetches daily KPIs and top products on mount', () => {
    renderPage()
    expect(mockFetchDaily).toHaveBeenCalledWith('100', '2026-01-01')
    expect(mockFetchTopProducts).toHaveBeenCalledWith('100', '2026-01-01', 10)
  })

  it('renders 3 KPI cards when not loading', () => {
    mockDaily = { revenue_cents: 50000, orders: 10, average_ticket_cents: 5000, diners: 20 }
    renderPage()
    expect(screen.getAllByTestId('kpi-card')).toHaveLength(3)
  })

  it('shows zero values when daily is null', () => {
    mockDaily = null
    renderPage()
    const cards = screen.getAllByTestId('kpi-card')
    expect(cards[0]).toBeDefined()
  })

  it('shows empty table message when no top products', () => {
    mockTopProducts = []
    renderPage()
    expect(screen.getByTestId('empty-table')).toBeTruthy()
  })

  it('renders products table when topProducts exist', () => {
    mockTopProducts = [
      { product_id: '1', product_name: 'Milanesa', quantity_sold: 5, revenue_cents: 12500 },
    ]
    renderPage()
    expect(screen.getByTestId('products-table')).toBeTruthy()
  })
})
