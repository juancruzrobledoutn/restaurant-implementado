/**
 * HomePage tests (C-30).
 *
 * Skills: test-driven-development, zustand-store-pattern, ws-frontend-subscription
 *
 * Scenarios:
 * 1. State without a selected branch → HomeEmptyBranchState + CTA button
 * 2. State with branch + mocked data → 4 KPIs + 5 quick-links
 * 3. Reactive update → tableStore change reflects in "mesas activas" KPI without refetch
 * 4. CTA dispatches CustomEvent('dashboard:focus-branch-switcher')
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import HomePage from './HomePage'
import type { Branch } from '@/types/branch'
import type { Table } from '@/types/operations'

// ---------------------------------------------------------------------------
// Mock stores
// ---------------------------------------------------------------------------

const mockFetchByBranch = vi.fn()
const mockFetchDaily = vi.fn()

vi.mock('@/stores/branchStore', () => ({
  useBranchStore: vi.fn(),
  selectSelectedBranch: (s: unknown) => (s as { selectedBranch: Branch | null }).selectedBranch,
  selectSelectedBranchId: (s: unknown) => (s as { selectedBranchId: string | null }).selectedBranchId,
}))

vi.mock('@/stores/tableStore', () => ({
  useTableStore: vi.fn(),
  selectTables: (s: unknown) => (s as { items: Table[] }).items,
  selectActiveTablesCount: (s: unknown) =>
    (s as { items: Table[] }).items.filter((t) => t.status === 'OCCUPIED' && t.is_active).length,
  selectTotalTablesCount: (s: unknown) =>
    (s as { items: Table[] }).items.filter((t) => t.is_active).length,
  useTableActions: () => ({ fetchByBranch: mockFetchByBranch }),
}))

vi.mock('@/stores/salesStore', () => ({
  useSalesStore: vi.fn(),
  selectDailyKPIs: (s: unknown) =>
    (s as { daily: Record<string, number> | null }).daily,
  selectSalesIsLoading: (s: unknown) => (s as { isLoading: boolean }).isLoading,
  useSalesActions: () => ({ fetchDaily: mockFetchDaily }),
}))

// Mock WS hooks to be no-ops in tests
vi.mock('@/hooks/useTableWebSocketSync', () => ({
  useTableWebSocketSync: vi.fn(),
}))

vi.mock('@/hooks/useSalesWebSocketRefresh', () => ({
  useSalesWebSocketRefresh: vi.fn(),
}))

// Mock helpContent
vi.mock('@/utils/helpContent', () => ({
  helpContent: { home: <div>Help content</div> },
}))

import { useBranchStore } from '@/stores/branchStore'
import { useTableStore } from '@/stores/tableStore'
import { useSalesStore } from '@/stores/salesStore'

// Double-cast via unknown to satisfy TypeScript strict mode with Vitest mocks
const mockUseBranchStore = useBranchStore as unknown as ReturnType<typeof vi.fn>
const mockUseTableStore = useTableStore as unknown as ReturnType<typeof vi.fn>
const mockUseSalesStore = useSalesStore as unknown as ReturnType<typeof vi.fn>

function makeBranch(overrides: Partial<Branch> = {}): Branch {
  return {
    id: 1,
    name: 'Centro',
    address: 'Av. Corrientes 123',
    slug: 'centro',
    ...overrides,
  }
}

function makeTable(overrides: Partial<Table> = {}): Table {
  return {
    id: '1',
    branch_id: '1',
    sector_id: '10',
    number: 1,
    code: 'A-01',
    capacity: 4,
    status: 'AVAILABLE',
    is_active: true,
    ...overrides,
  }
}

function setupBranchStore(selectedBranch: Branch | null) {
  mockUseBranchStore.mockImplementation((selector: (s: unknown) => unknown) => {
    return selector({
      selectedBranch,
      selectedBranchId: selectedBranch ? String(selectedBranch.id) : null,
    })
  })
}

function setupTableStore(items: Table[]) {
  mockUseTableStore.mockImplementation((selector: (s: unknown) => unknown) => {
    return selector({ items })
  })
}

function setupSalesStore(daily: Record<string, number> | null, isLoading = false) {
  mockUseSalesStore.mockImplementation((selector: (s: unknown) => unknown) => {
    return selector({ daily, isLoading })
  })
}

function renderHomePage() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: no branch, no tables, no sales
  setupBranchStore(null)
  setupTableStore([])
  setupSalesStore(null)
})

// ---------------------------------------------------------------------------
// Scenario 1: No branch selected
// ---------------------------------------------------------------------------

describe('no branch selected', () => {
  it('renders HomeEmptyBranchState with CTA button', () => {
    renderHomePage()
    expect(screen.getByRole('heading', { name: /Selecciona una sucursal/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Elegir sucursal/i })).toBeInTheDocument()
  })

  it('does NOT render KPI cards when no branch', () => {
    renderHomePage()
    expect(screen.queryByText(/Mesas activas/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Pedidos del dia/i)).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Scenario 2: Branch + mocked data
// ---------------------------------------------------------------------------

describe('branch selected with data', () => {
  const tables: Table[] = [
    makeTable({ id: '1', status: 'OCCUPIED', is_active: true }),
    makeTable({ id: '2', status: 'OCCUPIED', is_active: true }),
    makeTable({ id: '3', status: 'OCCUPIED', is_active: true }),
    makeTable({ id: '4', status: 'AVAILABLE', is_active: true }),
    makeTable({ id: '5', status: 'AVAILABLE', is_active: true }),
    makeTable({ id: '6', status: 'AVAILABLE', is_active: true }),
    makeTable({ id: '7', status: 'AVAILABLE', is_active: true }),
    makeTable({ id: '8', status: 'AVAILABLE', is_active: true }),
  ]

  const daily = {
    orders: 42,
    revenue_cents: 150000,
    average_ticket_cents: 3571,
    diners: 65,
  }

  beforeEach(() => {
    setupBranchStore(makeBranch({ name: 'Centro' }))
    setupTableStore(tables)
    setupSalesStore(daily)
  })

  it('shows branch name in the page header', () => {
    renderHomePage()
    expect(screen.getByRole('heading', { name: /Centro/i })).toBeInTheDocument()
  })

  it('shows "3/8" for mesas activas KPI', () => {
    renderHomePage()
    expect(screen.getByText('3/8')).toBeInTheDocument()
    expect(screen.getByText(/Mesas activas/i)).toBeInTheDocument()
  })

  it('shows orders count formatted', () => {
    renderHomePage()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText(/Pedidos del dia/i)).toBeInTheDocument()
  })

  it('shows 5 quick-links', () => {
    renderHomePage()
    // Quick links are rendered as Link elements (anchors in MemoryRouter)
    const links = screen.getAllByRole('link')
    // At minimum 5 links for the quick-links section
    expect(links.length).toBeGreaterThanOrEqual(5)
  })

  it('shows quick-link to kitchen display', () => {
    renderHomePage()
    // Use getAllByText since "Cocina" matches the title and the description contains "cocina"
    const matches = screen.getAllByText(/^Cocina$/i)
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('shows quick-link to sales', () => {
    renderHomePage()
    // "Ventas" appears exactly as the quick-link title
    const matches = screen.getAllByText(/^Ventas$/i)
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// Scenario 3: Reactive update — tableStore change reflects without refetch
// ---------------------------------------------------------------------------

describe('reactive table update', () => {
  it('updates mesas activas KPI when tableStore changes', () => {
    const initialTables: Table[] = [
      makeTable({ id: '1', status: 'AVAILABLE', is_active: true }),
      makeTable({ id: '2', status: 'AVAILABLE', is_active: true }),
    ]

    setupBranchStore(makeBranch())
    setupTableStore(initialTables)
    setupSalesStore({ orders: 0, revenue_cents: 0, average_ticket_cents: 0, diners: 0 })

    const { rerender } = renderHomePage()

    // Initially 0/2
    expect(screen.getByText('0/2')).toBeInTheDocument()

    // One table becomes OCCUPIED — update store mock
    const updatedTables: Table[] = [
      makeTable({ id: '1', status: 'OCCUPIED', is_active: true }),
      makeTable({ id: '2', status: 'AVAILABLE', is_active: true }),
    ]
    setupTableStore(updatedTables)

    rerender(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    )

    // Now 1/2
    expect(screen.getByText('1/2')).toBeInTheDocument()
    // No extra fetches triggered by the render
    // Tables were already in store (length > 0) → fetchByBranch NOT called
    expect(mockFetchByBranch).toHaveBeenCalledTimes(0)
  })
})

// ---------------------------------------------------------------------------
// Scenario 4: CTA dispatches CustomEvent
// ---------------------------------------------------------------------------

describe('CTA button', () => {
  it('dispatches dashboard:focus-branch-switcher CustomEvent on click', () => {
    setupBranchStore(null)
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    renderHomePage()

    const ctaButton = screen.getByRole('button', { name: /Elegir sucursal/i })
    fireEvent.click(ctaButton)

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'dashboard:focus-branch-switcher' }),
    )
  })
})
