/**
 * ProductsPage tests.
 *
 * Covers: branch guard, renders products filtered by branch,
 * shows skeleton, price display in cents→dollars, create modal,
 * delete dialog.
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

let mockProducts: unknown[] = []
let mockSubcategories: unknown[] = []
let mockIsLoading = false
let mockSelectedBranchId: string | null = null

vi.mock('@/stores/productStore', () => ({
  useProductStore: (selector: (s: unknown) => unknown) => {
    const state = { items: mockProducts, isLoading: mockIsLoading }
    return selector(state)
  },
  selectProducts: (s: { items: unknown[] }) => s.items,
  selectProductIsLoading: (s: { isLoading: boolean }) => s.isLoading,
  useProductActions: () => ({
    fetchAsync: mockFetchAsync,
    createAsync: mockCreateAsync,
    updateAsync: mockUpdateAsync,
    deleteAsync: mockDeleteAsync,
  }),
}))

vi.mock('@/stores/subcategoryStore', () => ({
  useSubcategoryStore: (selector: (s: unknown) => unknown) =>
    selector({ items: mockSubcategories }),
  selectSubcategories: (s: { items: unknown[] }) => s.items,
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

vi.mock('@/utils/helpContent', () => ({
  helpContent: { products: null },
}))

vi.mock('@/utils/logger', () => ({
  handleError: vi.fn((_e: unknown, ctx: string) => `error:${ctx}`),
}))

vi.mock('@/utils/formatters', () => ({
  formatPrice: (cents: number) => `$${(cents / 100).toFixed(2)}`,
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
  }: {
    isOpen: boolean
    title: string
    onConfirm: () => void
    onClose: () => void
  }) =>
    isOpen ? (
      <div role="alertdialog">
        <span>{title}</span>
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
vi.mock('@/components/ui/Card', () => ({ Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/components/ui/Badge', () => ({ Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }))
vi.mock('@/components/ui/Input', () => ({
  Input: ({ label, name, value, onChange }: { label: string; name: string; value?: string; onChange?: React.ChangeEventHandler<HTMLInputElement> }) => (
    <label>{label}<input name={name} value={value ?? ''} onChange={onChange ?? (() => {})} /></label>
  ),
}))
vi.mock('@/components/ui/Select', () => ({
  Select: ({ label, name, value, onChange }: { label: string; name: string; value?: string; onChange?: React.ChangeEventHandler<HTMLSelectElement> }) => (
    <label>{label}<select name={name} value={value ?? ''} onChange={onChange ?? (() => {})}><option value="">--</option></select></label>
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

import ProductsPage from './Products'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProduct(id: string, name: string, branchId = 'branch-1', priceCents = 1250) {
  return {
    id,
    name,
    description: '',
    price_cents: priceCents,
    image: '',
    featured: false,
    popular: false,
    is_active: true,
    branch_id: branchId,
    subcategory_id: 'sc-1',
    tenant_id: '1',
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ProductsPage />
    </MemoryRouter>,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProductsPage — branch guard', () => {
  beforeEach(() => {
    mockProducts = []
    mockSubcategories = []
    mockIsLoading = false
    mockSelectedBranchId = null
    mockFetchAsync.mockResolvedValue(undefined)
  })

  it('shows branch guard card when no branch selected', () => {
    renderPage()
    expect(screen.getByText('Selecciona una sucursal desde el Dashboard para ver sus productos')).toBeInTheDocument()
  })

  it('does NOT show New button when no branch selected', () => {
    renderPage()
    expect(screen.queryByTestId('page-actions')).not.toBeInTheDocument()
  })
})

describe('ProductsPage — with branch', () => {
  beforeEach(() => {
    mockProducts = []
    mockSubcategories = []
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

  it('shows empty message when no products', () => {
    renderPage()
    expect(screen.getByText('products.empty')).toBeInTheDocument()
  })

  it('only renders products belonging to selected branch', () => {
    mockProducts = [
      makeProduct('1', 'Hamburguesa', 'branch-1', 1500),
      makeProduct('2', 'Pizza', 'branch-2', 2000),
    ]
    renderPage()
    expect(screen.getByText('Hamburguesa')).toBeInTheDocument()
    expect(screen.queryByText('Pizza')).not.toBeInTheDocument()
  })

  it('displays price formatted from cents', () => {
    mockProducts = [makeProduct('1', 'Hamburguesa', 'branch-1', 1250)]
    renderPage()
    expect(screen.getByText('$12.50')).toBeInTheDocument()
  })

  it('shows New button for ADMIN', () => {
    renderPage()
    expect(screen.getByTestId('page-actions')).toBeInTheDocument()
  })

  it('opens create modal when New button clicked', async () => {
    renderPage()
    fireEvent.click(screen.getByText('products.new'))
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  it('opens delete dialog when delete button clicked', async () => {
    mockProducts = [makeProduct('1', 'Hamburguesa', 'branch-1')]
    renderPage()
    fireEvent.click(screen.getByLabelText('Eliminar Hamburguesa'))
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })
  })

  it('opens edit modal when edit button clicked', async () => {
    mockProducts = [makeProduct('1', 'Hamburguesa', 'branch-1')]
    renderPage()
    fireEvent.click(screen.getByLabelText('Editar Hamburguesa'))
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })
})
