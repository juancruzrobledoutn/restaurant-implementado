/**
 * AccessDeniedPage tests — logout vs change-branch actions.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  )
  return {
    ...actual,
    useNavigate: () => navigateMock,
  }
})

import AccessDeniedPage from '@/pages/AccessDeniedPage'
import { useBranchSelectionStore } from '@/stores/branchSelectionStore'
import { useAuthStore, __resetAuthModuleState } from '@/stores/authStore'

describe('AccessDeniedPage', () => {
  beforeEach(() => {
    navigateMock.mockClear()
    __resetAuthModuleState()
    useBranchSelectionStore.setState({
      branchId: '1',
      branchName: 'Centro',
      branchSlug: 'centro',
    })
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: '10', email: 'w@d.com', fullName: 'W', tenantId: '1', branchIds: ['1'], roles: ['WAITER'] },
      isLoading: false,
      error: null,
      requires2fa: false,
      isLoggingOut: false,
      assignedSectorId: null,
      assignedSectorName: null,
    })
  })

  it('Cerrar sesión clears selection and navigates to /select-branch', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <AccessDeniedPage />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: /Cerrar sesión/i }))

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/select-branch', {
        replace: true,
      })
    })
    expect(useBranchSelectionStore.getState().branchId).toBeNull()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('Cambiar sucursal keeps authentication but clears selection', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <AccessDeniedPage />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: /Cambiar sucursal/i }))

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/select-branch', {
        replace: true,
      })
    })
    expect(useBranchSelectionStore.getState().branchId).toBeNull()
    // Still authenticated — Cambiar sucursal does NOT log out
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('shows the branch name for context', () => {
    render(
      <MemoryRouter>
        <AccessDeniedPage />
      </MemoryRouter>,
    )
    expect(screen.getByText(/Centro/)).toBeInTheDocument()
  })
})
