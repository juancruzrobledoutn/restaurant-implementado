/**
 * CategoriesPage tests.
 *
 * Covers: branch guard (shows fallback card when no branch), renders categories,
 * shows skeleton while loading, create modal opens, delete dialog with cascade preview,
 * filters by selectedBranchId.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetchAsync = vi.fn()
const mockCreateAsync = vi.fn()
const mockUpdateAsync = vi.fn()
const mockDeleteAsync = vi.fn()

let mockCategories: unknown[] = []
let mockIsLoading = false
let mockSelectedBranchId: string | null = null

vi.mock('@/stores/categoryStore', () => ({
  useCategoryStore: (selector: (s: unknown) => unknown) => {
    const state = { items: mockCategories, isLoading: mockIsLoading }
    return selector(state)
  },
  selectCategories: (s: { items: unknown[] }) => s.items,
  selectCategoryIsLoading: (s: { isLoading: boolean }) => s.isLoading,
  useCategoryActions: () => ({
    fetchAsync: mockFetchAsync,
    createAsync: mockCreateAsync,
    updateAsync: mockUpdateAsync,
    deleteAsync: mockDeleteAsync,
  }),
}))

vi.mock('@/stores/branchStore', () => ({
  useBranchStore: (selector: (s: unknown) => unknown) =>
    selector({ selectedBranchId: mockSelectedBranchId }),
  selectSelectedBranchId: (s: { selectedBranchId: string | null }) => s.selectedBranchId,
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { roles: ['ADMIN'] } }),
  selectUser: (s: { user: unknown }) => s.user,
}))

vi.mock('@/services/cascadeService', () => ({
  deleteCategoryWithCascade: vi.fn().mockResolvedValue(undefined),
  getCategoryPreview: vi.fn().mockResolvedValue({ totalItems: 0, sections: [] }),
}))

vi.mock('@/utils/helpContent', () => ({
  helpContent: { categories: null },
}))

vi.mock('@/utils/logger', () => ({
  handleError: vi.fn((_e: unknown, ctx: string) => `error:${ctx}`),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router')
  return { ...actual, useNavigate: () => vi.fn() }
})

vi.mock('@/components/ui/PageContainer', () => ({
  PageContainer: ({
    children,
    actions,
  }: {
    children: React.ReactNode
    actions?: React.ReactNode
  }) => (
    <div data-testid="page-container">
      {actions && <div data-testid="page-actions">{actions}</div>}
      {children}
    </div>
  ),
}))

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({
    isOpen,
    children,
    footer,
    title,
  }: {
    isOpen: boolean
    children: React.ReactNode
    footer?: React.ReactNode
    title?: string
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        {children}
        {footer}
      </div>
    ) : null,
}))

vi.mock('@/components/ui/ConfirmDialog', () => ({
  ConfirmDialog: ({
    isOpen,
    title,
    onConfirm,
    onClose,
    children,
  }: {
    isOpen: boolean
    title: string
    onConfirm: () => void
    onClose: () => void
    children?: React.ReactNode
  }) =>
    isOpen ? (
      <div role="alertdialog">
        <span>{title}</span>
        {children}
        <button onClick={onConfirm}>Confirm</button>
        <button onClick={onClose}>Close</button>
      </div>
    ) : null,
}))

vi.mock('@/components/ui/TableSkeleton', () => ({
  TableSkeleton: () => <div data-testid="table-skeleton" />,
}))

vi.mock('@/components/ui/Table', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Table: ({ columns, items, emptyMessage }: { columns: Array<{ key: string; render: (item: any) => React.ReactNode }>; items: unknown[]; emptyMessage?: string }) =>
    items.length === 0 ? (
      <div>{emptyMessage}</div>
    ) : (
      <table>
        <tbody>
          {items.map((row, i) => (
            <tr key={i}>
              {columns.map((col) => (
                <td key={col.key}>{col.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    ),
}))

vi.mock('@/components/ui/Pagination', () => ({ Pagination: () => null }))
vi.mock('@/components/ui/HelpButton', () => ({ HelpButton: () => null }))
vi.mock('@/components/ui/CascadePreviewList', () => ({ CascadePreviewList: () => <div data-testid="cascade-preview" /> }))
vi.mock('@/components/ui/Card', () => ({ Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/components/ui/Badge', () => ({ Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }))
vi.mock('@/components/ui/Input', () => ({
  Input: ({ label, name, value, onChange }: { label: string; name: string; value?: string; onChange?: React.ChangeEventHandler<HTMLInputElement> }) => (
    <label>{label}<input name={name} value={value ?? ''} onChange={onChange ?? (() => {})} /></label>
  ),
}))
vi.mock('@/components/ui/Toggle', () => ({
  Toggle: ({ label, name, checked, onChange }: { label: string; name: string; checked?: boolean; onChange?: React.ChangeEventHandler<HTMLInputElement> }) => (
    <label>{label}<input type="checkbox" name={name} checked={checked ?? false} onChange={onChange ?? (() => {})} /></label>
  ),
}))

vi.mock('@/hooks/usePagination', () => ({
  usePagination: <T,>(items: T[]) => ({
    paginatedItems: items,
    currentPage: 1,
    totalPages: 1,
    totalItems: items.length,
    itemsPerPage: 10,
    setCurrentPage: vi.fn(),
  }),
}))

import CategoriesPage from './Categories'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCategory(id: string, name: string, branchId = 'branch-1') {
  return {
    id,
    name,
    order: 1,
    icon: '',
    image: '',
    is_active: true,
    branch_id: branchId,
    tenant_id: '1',
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <CategoriesPage />
    </MemoryRouter>,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CategoriesPage — branch guard', () => {
  beforeEach(() => {
    mockCategories = []
    mockIsLoading = false
    mockSelectedBranchId = null
    mockFetchAsync.mockResolvedValue(undefined)
  })

  it('shows branch guard card when no branch selected', () => {
    renderPage()
    // Branch guard card shows hardcoded Spanish message
    expect(screen.getByText('Selecciona una sucursal desde el Dashboard para ver sus categorias')).toBeInTheDocument()
  })

  it('does NOT show New Category button when no branch selected', () => {
    renderPage()
    expect(screen.queryByTestId('page-actions')).not.toBeInTheDocument()
  })
})

describe('CategoriesPage — with branch', () => {
  beforeEach(() => {
    mockCategories = []
    mockIsLoading = false
    mockSelectedBranchId = 'branch-1'
    mockFetchAsync.mockResolvedValue(undefined)
    mockCreateAsync.mockResolvedValue(undefined)
    mockDeleteAsync.mockResolvedValue(undefined)
  })

  it('shows skeleton while loading', () => {
    mockIsLoading = true
    renderPage()
    expect(screen.getByTestId('table-skeleton')).toBeInTheDocument()
  })

  it('shows empty message when no categories in branch', () => {
    renderPage()
    expect(screen.getByText('categories.empty')).toBeInTheDocument()
  })

  it('only renders categories belonging to the selected branch', () => {
    mockCategories = [
      makeCategory('1', 'Bebidas', 'branch-1'),
      makeCategory('2', 'Postres', 'branch-2'), // different branch — should not appear
    ]
    renderPage()
    expect(screen.getByText('Bebidas')).toBeInTheDocument()
    expect(screen.queryByText('Postres')).not.toBeInTheDocument()
  })

  it('shows New Category button for ADMIN', () => {
    renderPage()
    expect(screen.getByTestId('page-actions')).toBeInTheDocument()
  })

  it('opens create modal when New button clicked', async () => {
    renderPage()
    fireEvent.click(screen.getByText('categories.new'))
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  it('opens delete dialog when delete button clicked', async () => {
    mockCategories = [makeCategory('1', 'Bebidas', 'branch-1')]
    renderPage()
    fireEvent.click(screen.getByLabelText('Eliminar Bebidas'))
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })
  })

  it('opens edit modal when edit button clicked', async () => {
    mockCategories = [makeCategory('1', 'Bebidas', 'branch-1')]
    renderPage()
    fireEvent.click(screen.getByLabelText('Editar Bebidas'))
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })
})
