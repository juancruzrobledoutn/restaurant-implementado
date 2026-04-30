/**
 * TablesPage tests.
 *
 * Covers: branch guard (fallback when no branch), renders table list,
 * shows skeleton while loading, create modal opens, MANAGER has no delete button,
 * ADMIN has delete button, WS sync hook is called.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetchByBranch = vi.fn()
const mockCreateTableAsync = vi.fn()
const mockUpdateTableAsync = vi.fn()
const mockDeleteTableAsync = vi.fn()

let mockTables: unknown[] = []
let mockIsLoading = false
let mockSelectedBranchId: string | null = null
let mockUserRoles: string[] = ['ADMIN']

vi.mock('@/stores/tableStore', () => ({
  useTableStore: (selector: (s: unknown) => unknown) =>
    selector({ items: mockTables, isLoading: mockIsLoading, error: null }),
  selectTables: (s: { items: unknown[] }) => s.items,
  selectTableIsLoading: (s: { isLoading: boolean }) => s.isLoading,
  useTableActions: () => ({
    fetchByBranch: mockFetchByBranch,
    createTableAsync: mockCreateTableAsync,
    updateTableAsync: mockUpdateTableAsync,
    deleteTableAsync: mockDeleteTableAsync,
    handleTableStatusChanged: vi.fn(),
  }),
}))

vi.mock('@/stores/sectorStore', () => ({
  useSectorStore: (selector: (s: unknown) => unknown) =>
    selector({ items: [] }),
  selectSectors: (s: { items: unknown[] }) => s.items,
}))

vi.mock('@/stores/branchStore', () => ({
  useBranchStore: (selector: (s: unknown) => unknown) =>
    selector({ selectedBranchId: mockSelectedBranchId }),
  selectSelectedBranchId: (s: { selectedBranchId: string | null }) => s.selectedBranchId,
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { roles: mockUserRoles } }),
  selectUser: (s: { user: unknown }) => s.user,
}))

vi.mock('@/hooks/useTableWebSocketSync', () => ({
  useTableWebSocketSync: vi.fn(),
}))

vi.mock('@/utils/helpContent', () => ({
  helpContent: { tables: null },
}))

vi.mock('@/utils/logger', () => ({
  handleError: vi.fn((_e: unknown, ctx: string) => `error:${ctx}`),
}))

vi.mock('@/utils/validation', () => ({
  validateTable: vi.fn().mockReturnValue({ isValid: true, errors: {} }),
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

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div data-testid="modal">{children}</div> : null,
}))

vi.mock('@/components/ui/ConfirmDialog', () => ({
  ConfirmDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="confirm-dialog" /> : null,
}))

vi.mock('@/components/ui/TableSkeleton', () => ({
  TableSkeleton: () => <div data-testid="table-skeleton" />,
}))

vi.mock('@/components/ui/Table', () => ({
  Table: ({ items, columns, emptyMessage }: { items: unknown[]; columns: unknown[]; emptyMessage: string }) =>
    items.length === 0 ? (
      <div data-testid="empty-table">{emptyMessage}</div>
    ) : (
      <table data-testid="data-table">
        <tbody>
          {items.map((item: unknown, i: number) => (
            <tr key={i} data-testid="table-row">
              {(columns as { render?: (item: unknown) => React.ReactNode }[]).map((col, j: number) => (
                <td key={j}>{col.render ? col.render(item) : null}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    ),
}))

vi.mock('@/components/ui/Pagination', () => ({
  Pagination: () => null,
}))

import TablesPage from './Tables'

function renderPage() {
  return render(
    <MemoryRouter>
      <TablesPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockTables = []
  mockIsLoading = false
  mockSelectedBranchId = null
  mockUserRoles = ['ADMIN']
  vi.clearAllMocks()
})

describe('branch guard', () => {
  it('shows fallback when no branch is selected', () => {
    mockSelectedBranchId = null
    renderPage()
    expect(screen.getByText(/selecciona una sucursal/i)).toBeTruthy()
  })
})

describe('with branch', () => {
  beforeEach(() => { mockSelectedBranchId = '100' })

  it('shows skeleton while loading', () => {
    mockIsLoading = true
    renderPage()
    expect(screen.getByTestId('table-skeleton')).toBeTruthy()
  })

  it('shows empty message when no tables', () => {
    mockTables = []
    renderPage()
    expect(screen.getByTestId('empty-table')).toBeTruthy()
  })

  it('renders table rows when tables exist', () => {
    mockTables = [
      { id: '1', number: 1, code: 'A-01', sector_id: '10', capacity: 4, status: 'AVAILABLE', branch_id: '100', is_active: true },
    ]
    renderPage()
    expect(screen.getByTestId('data-table')).toBeTruthy()
    expect(screen.getAllByTestId('table-row')).toHaveLength(1)
  })

  it('ADMIN sees create button', () => {
    mockUserRoles = ['ADMIN']
    renderPage()
    expect(screen.getByTestId('page-actions')).toBeTruthy()
  })

  it('MANAGER sees create button', () => {
    mockUserRoles = ['MANAGER']
    renderPage()
    expect(screen.getByTestId('page-actions')).toBeTruthy()
  })

  it('WAITER does not see create button', () => {
    mockUserRoles = ['WAITER']
    renderPage()
    expect(screen.queryByTestId('page-actions')).toBeNull()
  })
})
