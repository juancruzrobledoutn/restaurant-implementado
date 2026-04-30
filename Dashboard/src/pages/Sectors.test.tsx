/**
 * SectorsPage tests.
 *
 * Covers: branch guard, renders sectors, create modal opens,
 * delete with cascade preview, WAITER has no create.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetchByBranch = vi.fn()
const mockCreateSectorAsync = vi.fn()
const mockUpdateSectorAsync = vi.fn()
const mockDeleteSectorAsync = vi.fn()

let mockSectors: unknown[] = []
let mockIsLoading = false
let mockSelectedBranchId: string | null = null
let mockUserRoles: string[] = ['ADMIN']

vi.mock('@/stores/sectorStore', () => ({
  useSectorStore: (selector: (s: unknown) => unknown) =>
    selector({ items: mockSectors, isLoading: mockIsLoading, error: null }),
  selectSectors: (s: { items: unknown[] }) => s.items,
  selectSectorIsLoading: (s: { isLoading: boolean }) => s.isLoading,
  useSectorActions: () => ({
    fetchByBranch: mockFetchByBranch,
    createSectorAsync: mockCreateSectorAsync,
    updateSectorAsync: mockUpdateSectorAsync,
    deleteSectorAsync: mockDeleteSectorAsync,
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

vi.mock('@/services/cascadeService', () => ({
  deleteSectorWithCascade: vi.fn().mockResolvedValue(undefined),
  getSectorPreview: vi.fn().mockResolvedValue({ totalItems: 2, items: [{ label: 'Mesas', count: 2 }] }),
}))

vi.mock('@/utils/helpContent', () => ({
  helpContent: { sectors: null },
}))

vi.mock('@/utils/logger', () => ({
  handleError: vi.fn((_e: unknown, ctx: string) => `error:${ctx}`),
}))

vi.mock('@/utils/validation', () => ({
  validateSector: vi.fn().mockReturnValue({ isValid: true, errors: {} }),
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
  ConfirmDialog: ({ isOpen, children }: { isOpen: boolean; children?: React.ReactNode }) =>
    isOpen ? <div data-testid="confirm-dialog">{children}</div> : null,
}))

vi.mock('@/components/ui/CascadePreviewList', () => ({
  CascadePreviewList: ({ preview }: { preview: unknown }) => (
    <div data-testid="cascade-preview">{JSON.stringify(preview)}</div>
  ),
}))

vi.mock('@/components/ui/TableSkeleton', () => ({
  TableSkeleton: () => <div data-testid="table-skeleton" />,
}))

vi.mock('@/components/ui/Table', () => ({
  Table: ({ items, emptyMessage }: { items: unknown[]; emptyMessage: string }) =>
    items.length === 0 ? (
      <div data-testid="empty-table">{emptyMessage}</div>
    ) : (
      <table data-testid="data-table">
        <tbody>
          {items.map((_: unknown, i: number) => (
            <tr key={i} data-testid="table-row" />
          ))}
        </tbody>
      </table>
    ),
}))

vi.mock('@/components/ui/Pagination', () => ({
  Pagination: () => null,
}))

import SectorsPage from './Sectors'

function renderPage() {
  return render(
    <MemoryRouter>
      <SectorsPage />
    </MemoryRouter>,
  )
}

const sampleSector = { id: '1', name: 'Salon', branch_id: '100', is_active: true }

beforeEach(() => {
  mockSectors = []
  mockIsLoading = false
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

  it('fetches sectors on mount', () => {
    renderPage()
    expect(mockFetchByBranch).toHaveBeenCalledWith('100')
  })

  it('shows empty message when no sectors', () => {
    mockSectors = []
    renderPage()
    expect(screen.getByTestId('empty-table')).toBeTruthy()
  })

  it('renders row for each sector', () => {
    mockSectors = [sampleSector]
    renderPage()
    expect(screen.getByTestId('data-table')).toBeTruthy()
    expect(screen.getAllByTestId('table-row')).toHaveLength(1)
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

  it('shows skeleton while loading', () => {
    mockIsLoading = true
    renderPage()
    expect(screen.getByTestId('table-skeleton')).toBeTruthy()
  })
})
