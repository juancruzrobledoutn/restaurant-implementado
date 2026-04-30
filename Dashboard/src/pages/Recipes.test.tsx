/**
 * RecipesPage tests.
 *
 * Covers: shows skeleton while loading, renders recipes, opens create modal,
 * opens edit modal, opens delete dialog, ingredient lines can be added/removed
 * inside the create modal.
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

let mockRecipes: unknown[] = []
let mockProducts: unknown[] = []
let mockIngredients: unknown[] = []
let mockIsLoading = false

vi.mock('@/stores/recipeStore', () => ({
  useRecipeStore: (selector: (s: unknown) => unknown) => {
    const state = { items: mockRecipes, isLoading: mockIsLoading }
    return selector(state)
  },
  selectRecipes: (s: { items: unknown[] }) => s.items,
  selectRecipeIsLoading: (s: { isLoading: boolean }) => s.isLoading,
  useRecipeActions: () => ({
    fetchAsync: mockFetchAsync,
    createAsync: mockCreateAsync,
    updateAsync: mockUpdateAsync,
    deleteAsync: mockDeleteAsync,
  }),
}))

vi.mock('@/stores/productStore', () => ({
  useProductStore: (selector: (s: unknown) => unknown) =>
    selector({ items: mockProducts }),
  selectProducts: (s: { items: unknown[] }) => s.items,
}))

vi.mock('@/stores/ingredientStore', () => ({
  useIngredientStore: (selector: (s: unknown) => unknown) =>
    selector({ ingredients: mockIngredients }),
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { roles: ['ADMIN'] } }),
  selectUser: (s: { user: unknown }) => s.user,
}))

vi.mock('@/utils/helpContent', () => ({
  helpContent: { recipes: null },
}))

vi.mock('@/utils/logger', () => ({
  handleError: vi.fn((_e: unknown, ctx: string) => `error:${ctx}`),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

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

import RecipesPage from './Recipes'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecipe(id: string, name: string, productId = 'p1') {
  return {
    id,
    name,
    product_id: productId,
    ingredients: [],
    is_active: true,
    tenant_id: '1',
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <RecipesPage />
    </MemoryRouter>,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RecipesPage', () => {
  beforeEach(() => {
    mockRecipes = []
    mockProducts = []
    mockIngredients = []
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

  it('shows empty message when no recipes', () => {
    renderPage()
    expect(screen.getByText('recipes.empty')).toBeInTheDocument()
  })

  it('renders recipe rows', () => {
    mockRecipes = [makeRecipe('1', 'Pizza Margarita'), makeRecipe('2', 'Hamburguesa Classic')]
    renderPage()
    expect(screen.getByText('Pizza Margarita')).toBeInTheDocument()
    expect(screen.getByText('Hamburguesa Classic')).toBeInTheDocument()
  })

  it('shows New Recipe button for ADMIN', () => {
    renderPage()
    expect(screen.getByTestId('page-actions')).toBeInTheDocument()
  })

  it('opens create modal when New button clicked', async () => {
    renderPage()
    fireEvent.click(screen.getByText('recipes.new'))
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  it('shows no ingredients message in empty form', async () => {
    renderPage()
    fireEvent.click(screen.getByText('recipes.new'))
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
    expect(screen.getByText(/No hay ingredientes/)).toBeInTheDocument()
  })

  it('adds ingredient line when Add Ingredient clicked', async () => {
    renderPage()
    fireEvent.click(screen.getByText('recipes.new'))
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
    // Click the add ingredient button inside the modal
    const addBtn = screen.getByText('recipes.addIngredient')
    fireEvent.click(addBtn)
    // A remove button should now be visible (index 1)
    await waitFor(() => {
      expect(screen.getByLabelText('Quitar ingrediente 1')).toBeInTheDocument()
    })
  })

  it('removes ingredient line when minus button clicked', async () => {
    renderPage()
    fireEvent.click(screen.getByText('recipes.new'))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    // Add one ingredient line
    fireEvent.click(screen.getByText('recipes.addIngredient'))
    await waitFor(() => expect(screen.getByLabelText('Quitar ingrediente 1')).toBeInTheDocument())
    // Remove it
    fireEvent.click(screen.getByLabelText('Quitar ingrediente 1'))
    await waitFor(() => {
      expect(screen.queryByLabelText('Quitar ingrediente 1')).not.toBeInTheDocument()
    })
  })

  it('opens delete dialog when delete button clicked', async () => {
    mockRecipes = [makeRecipe('1', 'Pizza Margarita')]
    renderPage()
    fireEvent.click(screen.getByLabelText('Eliminar Pizza Margarita'))
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })
  })

  it('opens edit modal when edit button clicked', async () => {
    mockRecipes = [makeRecipe('1', 'Pizza Margarita')]
    renderPage()
    fireEvent.click(screen.getByLabelText('Editar Pizza Margarita'))
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })
})
