/**
 * Sidebar tests (C-26 — tasks 10.4, 10.5 partial).
 *
 * Coverage:
 * - ADMIN sees Facturación (Cuentas + Pagos links)
 * - MANAGER sees Facturación
 * - WAITER does NOT see Facturación
 * - KITCHEN does NOT see Facturación
 * - Active item has aria-current="page" when at /checks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { User } from '@/types/auth'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockUser: User | null = null
let mockCanManagePromotions = false
let mockIsAdmin = false
let mockIsManager = false

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => {
    const state = {
      user: mockUser,
      isLoggingOut: false,
      logout: vi.fn(),
    }
    return selector(state)
  },
  selectUser: (s: { user: User | null }) => s.user,
  selectLogout: (s: { logout: unknown }) => s.logout,
  selectIsLoggingOut: (s: { isLoggingOut: boolean }) => s.isLoggingOut,
}))

vi.mock('@/hooks/useAuthPermissions', () => ({
  useAuthPermissions: () => ({
    isAdmin: mockIsAdmin,
    isManager: mockIsManager,
    canCreate: mockIsAdmin || mockIsManager,
    canEdit: mockIsAdmin || mockIsManager,
    canDelete: mockIsAdmin,
    canManagePromotions: mockCanManagePromotions,
    canDeletePromotion: mockIsAdmin,
  }),
}))

vi.mock('@/stores/branchStore', () => ({
  useBranchStore: () => null,
  selectSelectedBranch: (s: unknown) => s,
  selectSelectedBranchId: (s: unknown) => s,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'es', changeLanguage: vi.fn() },
  }),
}))

// Static import after mocks
import { Sidebar } from './Sidebar'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultSidebarProps = {
  isCollapsed: false,
  onToggleCollapse: vi.fn(),
  isOpen: false,
  onClose: vi.fn(),
}

function makeUser(roles: string[]): User {
  return {
    id: '1',
    email: 'user@test.com',
    fullName: 'Test User',
    roles,
    branchIds: ['1'],
    tenantId: '1',
    totpEnabled: false,
  }
}

function renderSidebar(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Sidebar {...defaultSidebarProps} />
    </MemoryRouter>,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockIsAdmin = false
  mockIsManager = false
  mockCanManagePromotions = false
  mockUser = null
})

describe('Sidebar — billing links visibility', () => {
  it('ADMIN sees layout.sidebar.checks link', () => {
    mockUser = makeUser(['ADMIN'])
    mockIsAdmin = true
    mockCanManagePromotions = true

    renderSidebar()

    // The translation returns the key itself (t(key) => key)
    expect(screen.getByText('layout.sidebar.checks')).toBeInTheDocument()
    expect(screen.getByText('layout.sidebar.payments')).toBeInTheDocument()
  })

  it('MANAGER sees layout.sidebar.checks link', () => {
    mockUser = makeUser(['MANAGER'])
    mockIsManager = true
    mockCanManagePromotions = true

    renderSidebar()

    expect(screen.getByText('layout.sidebar.checks')).toBeInTheDocument()
    expect(screen.getByText('layout.sidebar.payments')).toBeInTheDocument()
  })

  it('WAITER does NOT see billing links', () => {
    mockUser = makeUser(['WAITER'])
    mockIsAdmin = false
    mockIsManager = false

    renderSidebar()

    expect(screen.queryByText('layout.sidebar.checks')).not.toBeInTheDocument()
    expect(screen.queryByText('layout.sidebar.payments')).not.toBeInTheDocument()
  })

  it('KITCHEN does NOT see billing links', () => {
    mockUser = makeUser(['KITCHEN'])
    mockIsAdmin = false
    mockIsManager = false

    renderSidebar()

    expect(screen.queryByText('layout.sidebar.checks')).not.toBeInTheDocument()
    expect(screen.queryByText('layout.sidebar.payments')).not.toBeInTheDocument()
  })
})

describe('Sidebar — aria-current on active item', () => {
  it('checks link has aria-current="page" when at /checks', () => {
    mockUser = makeUser(['ADMIN'])
    mockIsAdmin = true
    mockCanManagePromotions = true

    renderSidebar('/checks')

    // The Link for /checks should have aria-current="page"
    const checksLink = screen.getByText('layout.sidebar.checks').closest('a')
    expect(checksLink).toHaveAttribute('aria-current', 'page')
  })

  it('payments link has aria-current="page" when at /payments', () => {
    mockUser = makeUser(['ADMIN'])
    mockIsAdmin = true
    mockCanManagePromotions = true

    renderSidebar('/payments')

    const paymentsLink = screen.getByText('layout.sidebar.payments').closest('a')
    expect(paymentsLink).toHaveAttribute('aria-current', 'page')
  })

  it('checks link does NOT have aria-current when at /', () => {
    mockUser = makeUser(['ADMIN'])
    mockIsAdmin = true
    mockCanManagePromotions = true

    renderSidebar('/')

    const checksLink = screen.getByText('layout.sidebar.checks').closest('a')
    expect(checksLink).not.toHaveAttribute('aria-current', 'page')
  })
})
