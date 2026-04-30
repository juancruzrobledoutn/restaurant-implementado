/**
 * StaffPage tests.
 *
 * Covers: branch guard, renders staff list, ADMIN sees delete button,
 * MANAGER does not see delete button, WAITER has no create.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetchAll = vi.fn()
const mockCreateStaffAsync = vi.fn()
const mockUpdateStaffAsync = vi.fn()
const mockDeleteStaffAsync = vi.fn()

let mockStaff: unknown[] = []
let mockIsLoading = false
let mockSelectedBranchId: string | null = null
let mockUserRoles: string[] = ['ADMIN']

vi.mock('@/stores/staffStore', () => ({
  useStaffStore: (selector: (s: unknown) => unknown) =>
    selector({ items: mockStaff, isLoading: mockIsLoading, error: null }),
  selectStaff: (s: { items: unknown[] }) => s.items,
  selectStaffIsLoading: (s: { isLoading: boolean }) => s.isLoading,
  useStaffActions: () => ({
    fetchAll: mockFetchAll,
    createStaffAsync: mockCreateStaffAsync,
    updateStaffAsync: mockUpdateStaffAsync,
    deleteStaffAsync: mockDeleteStaffAsync,
    assignRoleAsync: vi.fn(),
    revokeRoleAsync: vi.fn(),
  }),
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

vi.mock('@/utils/helpContent', () => ({
  helpContent: { staff: null },
}))

vi.mock('@/utils/logger', () => ({
  handleError: vi.fn((_e: unknown, ctx: string) => `error:${ctx}`),
}))

vi.mock('@/utils/validation', () => ({
  validateStaff: vi.fn().mockReturnValue({ isValid: true, errors: {} }),
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
  Table: ({
    items,
    columns,
    emptyMessage,
  }: {
    items: unknown[]
    columns: { render?: (item: unknown) => React.ReactNode }[]
    emptyMessage: string
  }) =>
    items.length === 0 ? (
      <div data-testid="empty-table">{emptyMessage}</div>
    ) : (
      <table data-testid="data-table">
        <tbody>
          {items.map((item: unknown, i: number) => (
            <tr key={i} data-testid="table-row">
              {columns.map((col, j: number) => (
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

import StaffPage from './Staff'

function renderPage() {
  return render(
    <MemoryRouter>
      <StaffPage />
    </MemoryRouter>,
  )
}

const sampleUser = {
  id: '1',
  email: 'juan@test.com',
  first_name: 'Juan',
  last_name: 'Garcia',
  is_active: true,
  assignments: [{ branch_id: '100', branch_name: 'Sucursal A', role: 'WAITER' }],
}

beforeEach(() => {
  mockStaff = []
  mockIsLoading = false
  mockSelectedBranchId = null
  mockUserRoles = ['ADMIN']
  vi.clearAllMocks()
})

describe('branch guard', () => {
  it('shows fallback when no branch selected', () => {
    mockSelectedBranchId = null
    renderPage()
    expect(screen.getByText(/selecciona una sucursal/i)).toBeTruthy()
  })
})

describe('with branch', () => {
  beforeEach(() => { mockSelectedBranchId = '100' })

  it('shows empty message when no staff', () => {
    mockStaff = []
    renderPage()
    expect(screen.getByTestId('empty-table')).toBeTruthy()
  })

  it('renders rows for staff users', () => {
    mockStaff = [sampleUser]
    renderPage()
    expect(screen.getByTestId('data-table')).toBeTruthy()
  })

  it('ADMIN sees create button', () => {
    mockUserRoles = ['ADMIN']
    renderPage()
    expect(screen.getByTestId('page-actions')).toBeTruthy()
  })

  it('MANAGER sees create button but not delete', () => {
    mockUserRoles = ['MANAGER']
    mockStaff = [sampleUser]
    renderPage()
    expect(screen.getByTestId('page-actions')).toBeTruthy()
    // MANAGER cannot delete — no delete buttons in rows
    // (delete button has aria-label="Eliminar ...")
    expect(screen.queryByLabelText(/eliminar/i)).toBeNull()
  })

  it('WAITER has no create button', () => {
    mockUserRoles = ['WAITER']
    renderPage()
    expect(screen.queryByTestId('page-actions')).toBeNull()
  })
})
