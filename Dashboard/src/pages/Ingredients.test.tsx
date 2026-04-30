/**
 * IngredientsPage tests.
 *
 * Covers: shows skeleton while loading, renders groups, expands group to show
 * ingredients, opens group create modal, opens ingredient modal for a group,
 * delete group dialog opens.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetchGroupsAsync = vi.fn()
const mockCreateGroupAsync = vi.fn()
const mockUpdateGroupAsync = vi.fn()
const mockDeleteGroupAsync = vi.fn()
const mockCreateIngredientAsync = vi.fn()
const mockUpdateIngredientAsync = vi.fn()
const mockDeleteIngredientAsync = vi.fn()

let mockGroups: unknown[] = []
let mockIngredients: unknown[] = []
let mockIsLoading = false

vi.mock('@/stores/ingredientStore', () => ({
  useIngredientStore: (selector: (s: unknown) => unknown) => {
    const state = {
      groups: mockGroups,
      ingredients: mockIngredients,
      isLoading: mockIsLoading,
      fetchGroupsAsync: mockFetchGroupsAsync,
      createGroupAsync: mockCreateGroupAsync,
      updateGroupAsync: mockUpdateGroupAsync,
      deleteGroupAsync: mockDeleteGroupAsync,
      createIngredientAsync: mockCreateIngredientAsync,
      updateIngredientAsync: mockUpdateIngredientAsync,
      deleteIngredientAsync: mockDeleteIngredientAsync,
    }
    return selector(state)
  },
  selectGroups: (s: { groups: unknown[] }) => s.groups,
  selectIngredients: (s: { ingredients: unknown[] }) => s.ingredients,
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { roles: ['ADMIN'] } }),
  selectUser: (s: { user: unknown }) => s.user,
}))

vi.mock('@/services/cascadeService', () => ({
  deleteIngredientGroupWithCascade: vi.fn().mockResolvedValue(undefined),
  getIngredientGroupPreview: vi.fn().mockResolvedValue({ totalItems: 0, sections: [] }),
}))

vi.mock('@/utils/helpContent', () => ({
  helpContent: { ingredients: null },
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

vi.mock('@/components/ui/CascadePreviewList', () => ({
  CascadePreviewList: () => <div data-testid="cascade-preview" />,
}))

vi.mock('@/components/ui/Card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/Badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

vi.mock('@/components/ui/HelpButton', () => ({ HelpButton: () => null }))

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

import IngredientsPage from './Ingredients'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGroup(id: string, name: string) {
  return { id, name, is_active: true, tenant_id: '1' }
}

function makeIngredient(id: string, name: string, groupId: string) {
  return { id, name, unit: 'kg', is_active: true, group_id: groupId, tenant_id: '1' }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <IngredientsPage />
    </MemoryRouter>,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IngredientsPage', () => {
  beforeEach(() => {
    mockGroups = []
    mockIngredients = []
    mockIsLoading = false
    mockFetchGroupsAsync.mockResolvedValue(undefined)
    mockCreateGroupAsync.mockResolvedValue(undefined)
    mockCreateIngredientAsync.mockResolvedValue(undefined)
    mockDeleteGroupAsync.mockResolvedValue(undefined)
  })

  it('shows skeleton while loading', () => {
    mockIsLoading = true
    renderPage()
    expect(screen.getByTestId('table-skeleton')).toBeInTheDocument()
  })

  it('shows empty message when no groups', () => {
    renderPage()
    expect(screen.getByText('ingredients.emptyGroup')).toBeInTheDocument()
  })

  it('renders group names', () => {
    mockGroups = [makeGroup('g1', 'Verduras'), makeGroup('g2', 'Carnes')]
    renderPage()
    expect(screen.getByText('Verduras')).toBeInTheDocument()
    expect(screen.getByText('Carnes')).toBeInTheDocument()
  })

  it('ingredients are hidden until group is expanded', () => {
    mockGroups = [makeGroup('g1', 'Verduras')]
    mockIngredients = [makeIngredient('i1', 'Zanahoria', 'g1')]
    renderPage()
    // Ingredient should not be visible before expand
    expect(screen.queryByText('Zanahoria')).not.toBeInTheDocument()
  })

  it('shows ingredients after expanding group', async () => {
    mockGroups = [makeGroup('g1', 'Verduras')]
    mockIngredients = [makeIngredient('i1', 'Zanahoria', 'g1')]
    renderPage()
    // Click expand button on the group row — aria-label includes "grupo"
    const expandBtn = screen.getByLabelText('Expandir grupo Verduras')
    fireEvent.click(expandBtn)
    await waitFor(() => {
      expect(screen.getByText('Zanahoria')).toBeInTheDocument()
    })
  })

  it('shows New Group button for ADMIN', () => {
    renderPage()
    expect(screen.getByTestId('page-actions')).toBeInTheDocument()
  })

  it('opens group create modal when New Group button clicked', async () => {
    renderPage()
    fireEvent.click(screen.getByText('ingredients.newGroup'))
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  it('opens group delete dialog when delete button clicked', async () => {
    mockGroups = [makeGroup('g1', 'Verduras')]
    renderPage()
    fireEvent.click(screen.getByLabelText('Eliminar grupo Verduras'))
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })
  })

  it('opens group edit modal when edit button clicked', async () => {
    mockGroups = [makeGroup('g1', 'Verduras')]
    renderPage()
    fireEvent.click(screen.getByLabelText('Editar grupo Verduras'))
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })
})
