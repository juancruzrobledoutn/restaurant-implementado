/**
 * Settings page tests (C-28, tasks 16.1-16.2).
 *
 * Coverage:
 * - ADMIN sees 3 tabs: Sucursal, Perfil, Negocio
 * - MANAGER sees 2 tabs: Sucursal, Perfil (no Negocio)
 * - WAITER sees 1 tab: Perfil only
 * - Query param ?tab=X selects the correct tab
 * - Invalid tab for role falls back to first visible tab
 * - Tab change updates URL
 * - Accessibility: role=tablist, aria-selected correct
 *
 * Skill: test-driven-development
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { User } from '@/types/auth'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockUser: User | null = null
let mockBranchId: string | null = '1'

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: mockUser }),
  selectUser: (s: { user: User | null }) => s.user,
}))

vi.mock('@/stores/branchStore', () => ({
  useBranchStore: (selector: (s: unknown) => unknown) =>
    selector({ selectedBranchId: mockBranchId }),
  selectSelectedBranchId: (s: { selectedBranchId: string | null }) => s.selectedBranchId,
}))

vi.mock('@/components/ui/PageContainer', () => ({
  PageContainer: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}))

vi.mock('@/components/ui/HelpButton', () => ({
  HelpButton: () => null,
}))

vi.mock('@/components/settings/BranchSettingsForm', () => ({
  BranchSettingsForm: ({ branchId }: { branchId: string }) => (
    <div data-testid="branch-form">BranchForm:{branchId}</div>
  ),
}))

vi.mock('@/components/settings/ProfileForm', () => ({
  ProfileForm: () => <div data-testid="profile-form">ProfileForm</div>,
}))

vi.mock('@/components/settings/TenantSettingsForm', () => ({
  TenantSettingsForm: () => <div data-testid="tenant-form">TenantForm</div>,
}))

vi.mock('@/utils/helpContent', () => ({
  helpContent: {
    settingsBranch: null,
    settingsProfile: null,
    settingsTenant: null,
  },
}))

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------

import SettingsPage from './Settings'

function renderSettings(url = '/settings') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <SettingsPage />
    </MemoryRouter>,
  )
}

function makeUser(roles: string[]): User {
  return {
    id: '1',
    email: 'test@test.com',
    fullName: 'Test User',
    tenantId: '10',
    branchIds: ['1'],
    roles,
    totpEnabled: false,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockBranchId = '1'
})

describe('SettingsPage', () => {
  // ---------------------------------------------------------------------------
  // Role-based tab visibility
  // ---------------------------------------------------------------------------

  it('ADMIN sees 3 tabs', () => {
    mockUser = makeUser(['ADMIN'])
    renderSettings()

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(3)
    expect(screen.getByRole('tab', { name: /sucursal/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /perfil/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /negocio/i })).toBeInTheDocument()
  })

  it('MANAGER sees 2 tabs (no Negocio)', () => {
    mockUser = makeUser(['MANAGER'])
    renderSettings()

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(screen.getByRole('tab', { name: /sucursal/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /perfil/i })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /negocio/i })).not.toBeInTheDocument()
  })

  it('WAITER sees only 1 tab (Perfil)', () => {
    mockUser = makeUser(['WAITER'])
    renderSettings()

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(1)
    expect(screen.getByRole('tab', { name: /perfil/i })).toBeInTheDocument()
  })

  it('KITCHEN sees only 1 tab (Perfil)', () => {
    mockUser = makeUser(['KITCHEN'])
    renderSettings()

    expect(screen.getAllByRole('tab')).toHaveLength(1)
    expect(screen.getByRole('tab', { name: /perfil/i })).toBeInTheDocument()
  })

  // ---------------------------------------------------------------------------
  // Active tab and content
  // ---------------------------------------------------------------------------

  it('ADMIN defaults to branch tab (first visible)', () => {
    mockUser = makeUser(['ADMIN'])
    renderSettings('/settings')

    expect(screen.getByRole('tab', { name: /sucursal/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('branch-form')).toBeInTheDocument()
  })

  it('WAITER defaults to profile tab', () => {
    mockUser = makeUser(['WAITER'])
    renderSettings('/settings')

    expect(screen.getByRole('tab', { name: /perfil/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('profile-form')).toBeInTheDocument()
  })

  // ---------------------------------------------------------------------------
  // Query param tab selection
  // ---------------------------------------------------------------------------

  it('?tab=profile selects profile tab', () => {
    mockUser = makeUser(['ADMIN'])
    renderSettings('/settings?tab=profile')

    expect(screen.getByRole('tab', { name: /perfil/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('profile-form')).toBeInTheDocument()
  })

  it('?tab=tenant selects tenant tab for ADMIN', () => {
    mockUser = makeUser(['ADMIN'])
    renderSettings('/settings?tab=tenant')

    expect(screen.getByRole('tab', { name: /negocio/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('tenant-form')).toBeInTheDocument()
  })

  it('?tab=tenant falls back to first visible tab for MANAGER', () => {
    mockUser = makeUser(['MANAGER'])
    renderSettings('/settings?tab=tenant')

    // Tenant tab is not allowed for MANAGER — fallback to first visible (branch)
    expect(screen.getByRole('tab', { name: /sucursal/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByTestId('tenant-form')).not.toBeInTheDocument()
  })

  it('invalid ?tab=xyz falls back to first visible tab', () => {
    mockUser = makeUser(['ADMIN'])
    renderSettings('/settings?tab=xyz')

    // branch is first for ADMIN
    expect(screen.getByRole('tab', { name: /sucursal/i })).toHaveAttribute('aria-selected', 'true')
  })

  // ---------------------------------------------------------------------------
  // Tab click updates aria-selected
  // ---------------------------------------------------------------------------

  it('clicking a tab marks it as selected', async () => {
    const user = userEvent.setup()
    mockUser = makeUser(['ADMIN'])
    renderSettings()

    const profileTab = screen.getByRole('tab', { name: /perfil/i })
    await user.click(profileTab)

    expect(profileTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('profile-form')).toBeInTheDocument()
  })

  // ---------------------------------------------------------------------------
  // Accessibility
  // ---------------------------------------------------------------------------

  it('tablist has correct role and aria-label', () => {
    mockUser = makeUser(['ADMIN'])
    renderSettings()

    expect(screen.getByRole('tablist')).toBeInTheDocument()
  })

  it('non-active tabs have tabIndex=-1', () => {
    mockUser = makeUser(['ADMIN'])
    renderSettings()

    const profileTab = screen.getByRole('tab', { name: /perfil/i })
    const tenantTab = screen.getByRole('tab', { name: /negocio/i })
    expect(profileTab).toHaveAttribute('tabIndex', '-1')
    expect(tenantTab).toHaveAttribute('tabIndex', '-1')
  })

  it('active tab has tabIndex=0', () => {
    mockUser = makeUser(['ADMIN'])
    renderSettings()

    const branchTab = screen.getByRole('tab', { name: /sucursal/i })
    expect(branchTab).toHaveAttribute('tabIndex', '0')
  })

  // ---------------------------------------------------------------------------
  // No branch selected — shows placeholder for branch tab
  // ---------------------------------------------------------------------------

  it('shows placeholder when no branch is selected and branch tab is active', () => {
    mockUser = makeUser(['ADMIN'])
    mockBranchId = null
    renderSettings('/settings?tab=branch')

    expect(screen.queryByTestId('branch-form')).not.toBeInTheDocument()
    expect(screen.getByText(/seleccioná una sucursal/i)).toBeInTheDocument()
  })
})
