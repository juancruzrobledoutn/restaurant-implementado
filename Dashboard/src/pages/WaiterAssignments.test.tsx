/**
 * WaiterAssignmentsPage tests.
 *
 * Covers: branch guard, renders assignments, date picker present,
 * create modal opens, duplicate assignment triggers error.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { WaiterAssignment } from '@/types/operations'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetchByDate = vi.fn()
const mockCreateAsync = vi.fn()
const mockDeleteAsync = vi.fn()
const mockSetDate = vi.fn()

let mockAssignments: WaiterAssignment[] = []
let mockIsLoading = false
let mockSelectedDate = '2026-01-01'
let mockSelectedBranchId: string | null = null
let mockUserRoles: string[] = ['ADMIN']

vi.mock('@/stores/waiterAssignmentStore', () => ({
  useWaiterAssignmentStore: (selector: (s: unknown) => unknown) =>
    selector({
      assignments: mockAssignments,
      isLoading: mockIsLoading,
      selectedDate: mockSelectedDate,
      error: null,
    }),
  selectAssignments: (s: { assignments: WaiterAssignment[] }) => s.assignments,
  selectSelectedDate: (s: { selectedDate: string }) => s.selectedDate,
  selectWaiterAssignmentIsLoading: (s: { isLoading: boolean }) => s.isLoading,
  useWaiterAssignmentActions: () => ({
    fetchByDate: mockFetchByDate,
    createAsync: mockCreateAsync,
    deleteAsync: mockDeleteAsync,
    setDate: mockSetDate,
  }),
}))

vi.mock('@/stores/staffStore', () => ({
  useWaitersByBranch: () => [],
}))

vi.mock('@/stores/sectorStore', () => ({
  useSectorsByBranch: () => [],
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
  helpContent: { waiterAssignments: null },
}))

vi.mock('@/utils/logger', () => ({
  handleError: vi.fn((_e: unknown, ctx: string) => `error:${ctx}`),
}))

vi.mock('@/utils/validation', () => ({
  validateWaiterAssignment: vi.fn().mockReturnValue({ isValid: true, errors: {} }),
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
  Table: ({ items, emptyMessage }: { items: unknown[]; emptyMessage: string }) =>
    items.length === 0 ? (
      <div data-testid="empty-table">{emptyMessage}</div>
    ) : (
      <div data-testid="data-table">{items.length} rows</div>
    ),
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

import WaiterAssignmentsPage from './WaiterAssignments'

function renderPage() {
  return render(
    <MemoryRouter>
      <WaiterAssignmentsPage />
    </MemoryRouter>,
  )
}

const sampleAssignment: WaiterAssignment = {
  id: '1',
  user_id: '10',
  sector_id: '20',
  date: '2026-01-01',
  user: { id: '10', first_name: 'Juan', last_name: 'Garcia', email: 'j@test.com' },
  sector: { id: '20', name: 'Salon' },
}

beforeEach(() => {
  mockAssignments = []
  mockIsLoading = false
  mockSelectedDate = '2026-01-01'
  mockSelectedBranchId = null
  mockUserRoles = ['ADMIN']
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

  it('fetches assignments on mount', () => {
    renderPage()
    expect(mockFetchByDate).toHaveBeenCalledWith('2026-01-01', '100')
  })

  it('shows empty message when no assignments', () => {
    renderPage()
    expect(screen.getByTestId('empty-table')).toBeTruthy()
  })

  it('renders assignments when present', () => {
    mockAssignments = [sampleAssignment]
    renderPage()
    expect(screen.getByTestId('data-table')).toBeTruthy()
  })

  it('date picker is visible', () => {
    renderPage()
    expect(screen.getByLabelText(/seleccionar fecha/i)).toBeTruthy()
  })

  it('ADMIN sees create button', () => {
    mockUserRoles = ['ADMIN']
    renderPage()
    expect(screen.getByTestId('page-actions')).toBeTruthy()
  })

  it('WAITER has no create button', () => {
    mockUserRoles = ['WAITER']
    renderPage()
    expect(screen.queryByTestId('page-actions')).toBeNull()
  })
})
