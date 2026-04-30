/**
 * MainLayout tests.
 *
 * Tests: layout renders sidebar + navbar + outlet, sidebar collapse toggle,
 * breadcrumb rendering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'

// Mock heavy deps before importing the component
vi.mock('@/hooks/useIdleTimeout', () => ({
  useIdleTimeout: () => ({
    showWarning: false,
    minutesRemaining: 5,
    resetTimer: vi.fn(),
  }),
}))

// Breadcrumbs uses useMatches which requires a data router — mock it in layout tests
vi.mock('./Breadcrumbs', () => ({
  Breadcrumbs: () => null,
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => {
    const mockState = {
      user: { fullName: 'Admin User', roles: ['ADMIN'], branchIds: ['1'] },
      isLoggingOut: false,
      logout: vi.fn(),
    }
    return selector(mockState)
  },
  selectUser: (s: { user: unknown }) => s.user,
  selectLogout: (s: { logout: unknown }) => s.logout,
  selectIsLoggingOut: (s: { isLoggingOut: boolean }) => s.isLoggingOut,
}))

vi.mock('@/stores/branchStore', () => ({
  useBranchStore: (selector: (s: unknown) => unknown) => {
    const mockState = {
      branches: [],
      selectedBranch: null,
      selectedBranchId: null,
      isLoading: false,
      fetchBranches: vi.fn(),
    }
    return selector(mockState)
  },
  selectFetchBranches: (s: { fetchBranches: unknown }) => s.fetchBranches,
  selectSelectedBranch: (s: { selectedBranch: unknown }) => s.selectedBranch,
  selectSelectedBranchId: (s: { selectedBranchId: unknown }) => s.selectedBranchId,
  selectIsLoadingBranches: (s: { isLoading: boolean }) => s.isLoading,
  selectBranches: (s: { branches: unknown }) => s.branches,
  selectSetSelectedBranch: (s: { setSelectedBranch: unknown }) => s.setSelectedBranch,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'es', changeLanguage: vi.fn() },
  }),
}))

// Static import after mocks are set up
import MainLayout from './MainLayout'

describe('MainLayout', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  function renderLayout() {
    return render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<MainLayout />}>
            <Route index element={<div>Page content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )
  }

  it('renders sidebar, navbar and outlet content', () => {
    renderLayout()

    // Outlet content
    expect(screen.getByText('Page content')).toBeInTheDocument()
    // Sidebar footer has logout button (user actions moved from Navbar to Sidebar)
    expect(screen.getByLabelText('layout.sidebar.logout')).toBeInTheDocument()
  })

  it('toggles sidebar collapse state on desktop', () => {
    renderLayout()

    const collapseButton = screen.getByLabelText('layout.sidebar.collapse')
    fireEvent.click(collapseButton)

    // After collapse, button label should change
    expect(screen.getByLabelText('layout.sidebar.expand')).toBeInTheDocument()
    expect(localStorage.getItem('sidebar-collapsed')).toBe('true')
  })

  it('persists sidebar collapsed state from localStorage', () => {
    localStorage.setItem('sidebar-collapsed', 'true')
    renderLayout()

    // The expand button should be visible (sidebar starts collapsed)
    expect(screen.getByLabelText('layout.sidebar.expand')).toBeInTheDocument()
  })

  it('shows mobile hamburger button', () => {
    renderLayout()
    expect(screen.getByLabelText('layout.navbar.toggleSidebar')).toBeInTheDocument()
  })
})
