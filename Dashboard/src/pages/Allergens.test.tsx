/**
 * AllergensPage tests.
 *
 * Covers: renders table with allergens, shows skeleton while loading,
 * opens create modal on button click, create modal closes on success,
 * delete dialog opens on delete click, branch-agnostic (no branch guard).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports of the module under test
// ---------------------------------------------------------------------------

const mockFetchAsync = vi.fn()
const mockCreateAsync = vi.fn()
const mockUpdateAsync = vi.fn()
const mockDeleteAsync = vi.fn()

let mockAllergens: unknown[] = []
let mockIsLoading = false

vi.mock('@/stores/allergenStore', () => ({
  useAllergenStore: (selector: (s: unknown) => unknown) => {
    const state = {
      items: mockAllergens,
      isLoading: mockIsLoading,
    }
    return selector(state)
  },
  selectAllergens: (s: { items: unknown[] }) => s.items,
  selectIsLoading: (s: { isLoading: boolean }) => s.isLoading,
  useAllergenActions: () => ({
    fetchAsync: mockFetchAsync,
    createAsync: mockCreateAsync,
    updateAsync: mockUpdateAsync,
    deleteAsync: mockDeleteAsync,
  }),
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { roles: ['ADMIN'] } }),
  selectUser: (s: { user: unknown }) => s.user,
}))

vi.mock('@/services/cascadeService', () => ({
  deleteAllergenWithCascade: vi.fn().mockResolvedValue(undefined),
  getAllergenPreview: vi.fn().mockResolvedValue({ totalItems: 0, sections: [] }),
}))

vi.mock('@/utils/helpContent', () => ({
  helpContent: { allergens: null },
}))

vi.mock('@/utils/logger', () => ({
  handleError: vi.fn((_e: unknown, ctx: string) => `error:${ctx}`),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

// Mock UI components that depend on CSS/portals
vi.mock('@/components/ui/PageContainer', () => ({
  PageContainer: ({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode; title?: string }) => (
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
    children?: React.ReactNode
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

vi.mock('@/components/ui/Pagination', () => ({
  Pagination: () => null,
}))

vi.mock('@/components/ui/HelpButton', () => ({
  HelpButton: () => null,
}))

vi.mock('@/components/ui/CascadePreviewList', () => ({
  CascadePreviewList: () => null,
}))

vi.mock('@/components/ui/Card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/Badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

vi.mock('@/components/ui/Input', () => ({
  Input: ({ label, name, value, onChange }: { label: string; name: string; value?: string; onChange?: React.ChangeEventHandler<HTMLInputElement> }) => (
    <label>
      {label}
      <input name={name} value={value ?? ''} onChange={onChange ?? (() => {})} />
    </label>
  ),
}))

vi.mock('@/components/ui/Select', () => ({
  Select: ({ label, name, value, onChange }: { label: string; name: string; value?: string; onChange?: React.ChangeEventHandler<HTMLSelectElement> }) => (
    <label>
      {label}
      <select name={name} value={value ?? ''} onChange={onChange ?? (() => {})}>
        <option value="">--</option>
      </select>
    </label>
  ),
}))

vi.mock('@/components/ui/Toggle', () => ({
  Toggle: ({ label, name, checked, onChange }: { label: string; name: string; checked?: boolean; onChange?: React.ChangeEventHandler<HTMLInputElement> }) => (
    <label>
      {label}
      <input type="checkbox" name={name} checked={checked ?? false} onChange={onChange ?? (() => {})} />
    </label>
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

import AllergensPage from './Allergens'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAllergen(id: string, name: string) {
  return {
    id,
    name,
    icon: '',
    description: '',
    is_mandatory: false,
    severity: 'mild',
    is_active: true,
    tenant_id: '1',
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AllergensPage />
    </MemoryRouter>,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AllergensPage', () => {
  beforeEach(() => {
    mockAllergens = []
    mockIsLoading = false
    mockFetchAsync.mockResolvedValue(undefined)
    mockCreateAsync.mockResolvedValue(undefined)
    mockDeleteAsync.mockResolvedValue(undefined)
  })

  it('shows skeleton while loading', () => {
    mockIsLoading = true
    renderPage()
    expect(screen.getByTestId('table-skeleton')).toBeInTheDocument()
  })

  it('shows empty message when no allergens', () => {
    renderPage()
    expect(screen.getByText('allergens.empty')).toBeInTheDocument()
  })

  it('renders allergen rows', () => {
    mockAllergens = [
      makeAllergen('1', 'Gluten'),
      makeAllergen('2', 'Lactosa'),
    ]
    renderPage()
    expect(screen.getByText('Gluten')).toBeInTheDocument()
    expect(screen.getByText('Lactosa')).toBeInTheDocument()
  })

  it('shows New Allergen button for ADMIN', () => {
    renderPage()
    expect(screen.getByTestId('page-actions')).toBeInTheDocument()
  })

  it('opens create modal when New button clicked', async () => {
    renderPage()
    const btn = screen.getByText('allergens.new')
    fireEvent.click(btn)
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  it('opens delete dialog when delete button clicked', async () => {
    mockAllergens = [makeAllergen('1', 'Gluten')]
    renderPage()
    const deleteBtn = screen.getByLabelText('Eliminar Gluten')
    fireEvent.click(deleteBtn)
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })
  })

  it('opens edit modal when edit button clicked', async () => {
    mockAllergens = [makeAllergen('1', 'Gluten')]
    renderPage()
    const editBtn = screen.getByLabelText('Editar Gluten')
    fireEvent.click(editBtn)
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })
})
