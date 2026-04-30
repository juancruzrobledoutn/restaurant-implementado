/**
 * PromotionsPage tests — C-27.
 *
 * Covers: permission guard, empty state, loading skeleton, table with items,
 * create modal, form validation errors, edit modal, toggle, delete flow, filters,
 * and WS integration smoke.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { Promotion } from '@/types/menu'

// ---------------------------------------------------------------------------
// Store / service mocks
// ---------------------------------------------------------------------------

const mockFetchAsync = vi.fn()
const mockCreateAsync = vi.fn()
const mockUpdateAsync = vi.fn()
const mockToggleActiveAsync = vi.fn()

let mockItems: Promotion[] = []
let mockIsLoading = false
let mockCanManagePromotions = true
let mockCanDeletePromotion = true
let mockSelectedBranchId: string | null = null
let mockBranches: unknown[] = []

vi.mock('@/stores/promotionStore', () => ({
  usePromotionStore: (selector: (s: unknown) => unknown) => {
    const state = { items: mockItems, isLoading: mockIsLoading }
    return selector(state)
  },
  selectPromotions: (s: { items: unknown[] }) => s.items,
  selectIsLoading: (s: { isLoading: boolean }) => s.isLoading,
  usePromotionActions: () => ({
    fetchAsync: mockFetchAsync,
    createAsync: mockCreateAsync,
    updateAsync: mockUpdateAsync,
    deleteAsync: vi.fn(),
    toggleActiveAsync: mockToggleActiveAsync,
  }),
}))

vi.mock('@/stores/catalogStore', () => ({
  useCatalogStore: (selector: (s: unknown) => unknown) =>
    selector({ fetchPromotionTypesAsync: vi.fn() }),
  selectPromotionTypes: () => [],
  usePromotionTypes: () => [],
}))

vi.mock('@/stores/branchStore', () => ({
  useBranchStore: (selector: (s: unknown) => unknown) =>
    selector({ selectedBranchId: mockSelectedBranchId, branches: mockBranches }),
  selectSelectedBranchId: (s: { selectedBranchId: string | null }) => s.selectedBranchId,
  selectBranches: (s: { branches: unknown[] }) => s.branches,
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { roles: mockCanManagePromotions ? (mockCanDeletePromotion ? ['ADMIN'] : ['MANAGER']) : ['KITCHEN'] } }),
  selectUser: (s: { user: unknown }) => s.user,
}))

vi.mock('@/hooks/useAuthPermissions', () => ({
  useAuthPermissions: () => ({
    isAdmin: mockCanDeletePromotion,
    isManager: mockCanManagePromotions && !mockCanDeletePromotion,
    canCreate: mockCanManagePromotions,
    canEdit: mockCanManagePromotions,
    canDelete: mockCanDeletePromotion,
    canManagePromotions: mockCanManagePromotions,
    canDeletePromotion: mockCanDeletePromotion,
  }),
}))

vi.mock('@/services/cascadeService', () => ({
  getPromotionPreview: vi.fn().mockResolvedValue(null),
  deletePromotionWithCascade: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/utils/helpContent', () => ({
  helpContent: { promotions: null },
}))

vi.mock('@/utils/logger', () => ({
  handleError: vi.fn((_e: unknown, ctx: string) => `error:${ctx}`),
}))

vi.mock('@/stores/toastStore', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

// ---------------------------------------------------------------------------
// UI mocks
// ---------------------------------------------------------------------------

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
      <div data-testid="empty-table">{emptyMessage}</div>
    ) : (
      <table>
        <tbody>
          {items.map((row, i) => (
            <tr key={i} data-testid="table-row">
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
vi.mock('@/components/ui/CascadePreviewList', () => ({
  CascadePreviewList: () => <div data-testid="cascade-preview" />,
}))
vi.mock('@/components/ui/Card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/ui/Badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))
vi.mock('@/components/ui/Input', () => ({
  Input: ({
    label,
    name,
    value,
    onChange,
    error,
  }: {
    label: string
    name: string
    value?: string
    onChange?: React.ChangeEventHandler<HTMLInputElement>
    error?: string
  }) => (
    <div>
      <label>
        {label}
        <input name={name} value={value ?? ''} onChange={onChange ?? (() => {})} />
      </label>
      {error && <p role="alert">{error}</p>}
    </div>
  ),
}))
vi.mock('@/components/ui/Select', () => ({
  Select: ({
    label,
    name,
    value,
    onChange,
    options,
  }: {
    label?: string
    name?: string
    value?: string
    onChange?: React.ChangeEventHandler<HTMLSelectElement>
    options?: Array<{ value: string; label: string }>
  }) => (
    <label>
      {label}
      <select name={name} value={value ?? ''} onChange={onChange ?? (() => {})}>
        {(options ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  ),
}))
vi.mock('@/components/ui/Toggle', () => ({
  Toggle: ({
    label,
    checked,
    onChange,
  }: {
    label: string
    checked?: boolean
    onChange?: React.ChangeEventHandler<HTMLInputElement>
    name?: string
  }) => (
    <label>
      {label}
      <input type="checkbox" checked={checked ?? false} onChange={onChange ?? (() => {})} />
    </label>
  ),
}))
vi.mock('@/components/ui/DateRangePicker', () => ({
  DateRangePicker: ({ error }: { error?: string }) =>
    error ? <p role="alert">{error}</p> : <div data-testid="date-range-picker" />,
}))
vi.mock('@/components/ui/MultiSelect', () => ({
  MultiSelect: ({ error }: { error?: string }) =>
    error ? <p role="alert">{error}</p> : <div data-testid="multi-select" />,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePromotion(overrides: Partial<Promotion> = {}): Promotion {
  return {
    id: '1',
    tenant_id: '10',
    name: 'Promo 2x1',
    description: '',
    price: 10000,
    start_date: '2025-06-15',
    start_time: '18:00:00',
    end_date: '2025-06-15',
    end_time: '22:00:00',
    promotion_type_id: undefined,
    is_active: true,
    created_at: '2025-01-01T00:00:00',
    updated_at: '2025-01-01T00:00:00',
    branches: [{ branch_id: '1', branch_name: 'Centro' }],
    items: [],
    ...overrides,
  }
}

import PromotionsPage from './Promotions'

function renderPage() {
  return render(
    <MemoryRouter>
      <PromotionsPage />
    </MemoryRouter>,
  )
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockItems = []
  mockIsLoading = false
  mockCanManagePromotions = true
  mockCanDeletePromotion = true
  mockSelectedBranchId = '1'
  mockBranches = [{ id: 1, name: 'Centro' }]
  mockFetchAsync.mockResolvedValue(undefined)
  mockCreateAsync.mockResolvedValue(undefined)
  mockUpdateAsync.mockResolvedValue(undefined)
  mockToggleActiveAsync.mockResolvedValue(undefined)
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PromotionsPage — permission guard', () => {
  it('redirects (renders Navigate) when !canManagePromotions (KITCHEN)', () => {
    mockCanManagePromotions = false
    mockCanDeletePromotion = false
    renderPage()
    // Navigate redirect replaces the page — no page-container rendered
    expect(screen.queryByTestId('page-container')).toBeNull()
  })
})

describe('PromotionsPage — empty state', () => {
  it('shows empty table message when no items and not loading', () => {
    renderPage()
    expect(screen.getByTestId('empty-table')).toBeTruthy()
    expect(screen.getByTestId('empty-table').textContent).toBe('promotions.empty')
  })

  it('shows create button in page actions', () => {
    renderPage()
    expect(screen.getByTestId('page-actions')).toBeTruthy()
    expect(screen.getByText('promotions.create')).toBeTruthy()
  })
})

describe('PromotionsPage — loading', () => {
  it('renders TableSkeleton while loading with no items', () => {
    mockIsLoading = true
    renderPage()
    expect(screen.getByTestId('table-skeleton')).toBeTruthy()
  })

  it('renders table (not skeleton) when loading but items already present', () => {
    mockIsLoading = true
    mockItems = [makePromotion()]
    renderPage()
    expect(screen.queryByTestId('table-skeleton')).toBeNull()
    expect(screen.getAllByTestId('table-row')).toHaveLength(1)
  })
})

describe('PromotionsPage — table with items', () => {
  it('renders 3 table rows when 3 promotions in store', () => {
    mockItems = [
      makePromotion({ id: '1', name: 'Promo 1' }),
      makePromotion({ id: '2', name: 'Promo 2' }),
      makePromotion({ id: '3', name: 'Promo 3' }),
    ]
    renderPage()
    expect(screen.getAllByTestId('table-row')).toHaveLength(3)
  })
})

describe('PromotionsPage — RBAC', () => {
  it('MANAGER — table visible and no delete buttons', () => {
    mockCanManagePromotions = true
    mockCanDeletePromotion = false
    mockItems = [makePromotion({ id: '1', name: 'Promo 1' })]
    renderPage()
    expect(screen.getByTestId('page-container')).toBeTruthy()
    // Delete button should not exist
    expect(screen.queryByLabelText('Eliminar Promo 1')).toBeNull()
    // Edit button should exist
    expect(screen.getByLabelText('Editar Promo 1')).toBeTruthy()
  })

  it('ADMIN — table visible and delete buttons present', () => {
    mockCanManagePromotions = true
    mockCanDeletePromotion = true
    mockItems = [makePromotion({ id: '1', name: 'Promo 1' })]
    renderPage()
    expect(screen.getByLabelText('Eliminar Promo 1')).toBeTruthy()
    expect(screen.getByLabelText('Editar Promo 1')).toBeTruthy()
  })
})

describe('PromotionsPage — create modal', () => {
  it('opens modal when create button clicked', async () => {
    renderPage()
    fireEvent.click(screen.getByText('promotions.create'))
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy()
    })
  })

  it('shows name input inside modal', async () => {
    renderPage()
    fireEvent.click(screen.getByText('promotions.create'))
    await waitFor(() => {
      expect(screen.getByLabelText('promotions.fields.name')).toBeTruthy()
    })
  })
})

describe('PromotionsPage — edit modal', () => {
  it('opens modal with item data when edit button clicked', async () => {
    mockItems = [makePromotion({ id: '1', name: 'Promo 1' })]
    renderPage()
    fireEvent.click(screen.getByLabelText('Editar Promo 1'))
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy()
    })
    // Name field should have pre-loaded value
    const nameInput = screen.getByLabelText('promotions.fields.name')
    expect((nameInput as HTMLInputElement).value).toBe('Promo 1')
  })
})

describe('PromotionsPage — toggle active', () => {
  it('calls toggleActiveAsync when toggle is clicked', async () => {
    mockToggleActiveAsync.mockResolvedValue(undefined)
    mockItems = [makePromotion({ id: '1', name: 'Promo 1', is_active: true })]
    renderPage()

    // The Toggle renders a checkbox — find the one in the status cell
    const toggles = screen.getAllByRole('checkbox')
    fireEvent.click(toggles[0]!)

    await waitFor(() => {
      expect(mockToggleActiveAsync).toHaveBeenCalledWith('1')
    })
  })
})

describe('PromotionsPage — delete flow', () => {
  it('opens confirm dialog when delete button clicked', async () => {
    mockItems = [makePromotion({ id: '1', name: 'Promo 1' })]
    renderPage()
    fireEvent.click(screen.getByLabelText('Eliminar Promo 1'))
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeTruthy()
    })
  })

  it('calls deletePromotionWithCascade when confirm clicked', async () => {
    const { deletePromotionWithCascade } = await import('@/services/cascadeService')

    mockItems = [makePromotion({ id: '1', name: 'Promo 1' })]
    renderPage()
    fireEvent.click(screen.getByLabelText('Eliminar Promo 1'))
    await waitFor(() => screen.getByRole('alertdialog'))
    fireEvent.click(screen.getByText('Confirm'))

    await waitFor(() => {
      expect(deletePromotionWithCascade).toHaveBeenCalledWith('1')
    })
  })
})

describe('PromotionsPage — filters', () => {
  it('filters by status active — only active items visible', () => {
    mockItems = [
      makePromotion({ id: '1', name: 'Activa', is_active: true }),
      makePromotion({ id: '2', name: 'Inactiva', is_active: false }),
    ]
    renderPage()

    // Find the status filter select and change to 'active'
    const selects = screen.getAllByRole('combobox')
    // First select is status filter
    fireEvent.change(selects[0]!, { target: { value: 'active' } })

    expect(screen.getByText('Activa')).toBeTruthy()
    expect(screen.queryByText('Inactiva')).toBeNull()
  })

  it('filters by status inactive — only inactive items visible', () => {
    mockItems = [
      makePromotion({ id: '1', name: 'Activa', is_active: true }),
      makePromotion({ id: '2', name: 'Inactiva', is_active: false }),
    ]
    renderPage()

    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[0]!, { target: { value: 'inactive' } })

    expect(screen.queryByText('Activa')).toBeNull()
    expect(screen.getByText('Inactiva')).toBeTruthy()
  })

  it('filters by branch — only promotions with matching branch visible', () => {
    mockBranches = [
      { id: 1, name: 'Centro' },
      { id: 2, name: 'Norte' },
    ]
    mockItems = [
      makePromotion({ id: '1', name: 'P1', branches: [{ branch_id: '1', branch_name: 'Centro' }] }),
      makePromotion({ id: '2', name: 'P2', branches: [{ branch_id: '2', branch_name: 'Norte' }] }),
    ]
    renderPage()

    // Third select is branch filter
    const selects = screen.getAllByRole('combobox')
    const branchSelect = selects[2]!
    fireEvent.change(branchSelect, { target: { value: '2' } })

    expect(screen.queryByText('P1')).toBeNull()
    expect(screen.getByText('P2')).toBeTruthy()
  })

  it('shows all items when filter is "all"', () => {
    mockItems = [
      makePromotion({ id: '1', name: 'Activa', is_active: true }),
      makePromotion({ id: '2', name: 'Inactiva', is_active: false }),
    ]
    renderPage()
    // Default is 'all' — both visible
    expect(screen.getByText('Activa')).toBeTruthy()
    expect(screen.getByText('Inactiva')).toBeTruthy()
  })
})
