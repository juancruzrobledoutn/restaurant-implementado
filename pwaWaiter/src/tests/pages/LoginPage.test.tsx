/**
 * LoginPage tests — requires branch, credentials + verify flow, 2FA message.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  )
  return {
    ...actual,
    useNavigate: () => navigateMock,
    Navigate: ({ to }: { to: string }) => {
      navigateMock(to)
      return null
    },
  }
})

import LoginPage from '@/pages/LoginPage'
import { useBranchSelectionStore } from '@/stores/branchSelectionStore'
import { useAuthStore, __resetAuthModuleState } from '@/stores/authStore'

const API_URL = 'http://localhost:8000'

async function setup({
  hasBranch = true,
  branchId = '1',
}: { hasBranch?: boolean; branchId?: string } = {}) {
  navigateMock.mockClear()
  __resetAuthModuleState()
  useAuthStore.setState({
    isAuthenticated: false,
    user: null,
    isLoading: false,
    error: null,
    requires2fa: false,
    isLoggingOut: false,
    assignedSectorId: null,
    assignedSectorName: null,
  })
  if (hasBranch) {
    useBranchSelectionStore.setState({
      branchId,
      branchName: 'Centro',
      branchSlug: 'centro',
    })
  } else {
    useBranchSelectionStore.setState({
      branchId: null,
      branchName: null,
      branchSlug: null,
    })
  }
}

describe('LoginPage', () => {
  beforeEach(async () => {
    await setup()
  })

  it('redirects to /select-branch when no branch is selected', async () => {
    await setup({ hasBranch: false })
    render(
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/select-branch')
    })
  })

  it('successful login + assigned=true navigates to /tables', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>,
    )

    await user.type(screen.getByLabelText(/Email/i), 'waiter@demo.com')
    await user.type(screen.getByLabelText(/Contraseña/i), 'waiter123')
    await user.click(screen.getByRole('button', { name: /Ingresar/i }))

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/tables', { replace: true })
    })
    expect(useAuthStore.getState().assignedSectorId).toBe('5')
    expect(useAuthStore.getState().assignedSectorName).toBe('Salón principal')
  })

  it('login + assigned=false navigates to /access-denied', async () => {
    await setup({ hasBranch: true, branchId: '99' }) // mock returns assigned=false for branchId !== 1

    // Also override login to return a user whose branch_ids contains 99
    server.use(
      http.post(`${API_URL}/api/auth/login`, () =>
        HttpResponse.json({
          access_token: 'token',
          token_type: 'bearer',
          user: {
            id: 10,
            email: 'waiter@demo.com',
            full_name: 'Mozo',
            tenant_id: 1,
            branch_ids: [99],
            roles: ['WAITER'],
          },
        }),
      ),
    )

    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>,
    )

    await user.type(screen.getByLabelText(/Email/i), 'waiter@demo.com')
    await user.type(screen.getByLabelText(/Contraseña/i), 'waiter123')
    await user.click(screen.getByRole('button', { name: /Ingresar/i }))

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/access-denied', {
        replace: true,
      })
    })
  })

  it('invalid credentials show Spanish error message', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>,
    )

    await user.type(screen.getByLabelText(/Email/i), 'bad@demo.com')
    await user.type(screen.getByLabelText(/Contraseña/i), 'wrong')
    await user.click(screen.getByRole('button', { name: /Ingresar/i }))

    expect(
      await screen.findByText(/credenciales incorrectas/i),
    ).toBeInTheDocument()
  })

  it('requires_2fa response shows a Spanish notice', async () => {
    server.use(
      http.post(`${API_URL}/api/auth/login`, () =>
        HttpResponse.json({ requires_2fa: true, message: '2FA required' }),
      ),
    )

    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>,
    )

    await user.type(screen.getByLabelText(/Email/i), 'waiter@demo.com')
    await user.type(screen.getByLabelText(/Contraseña/i), 'waiter123')
    await user.click(screen.getByRole('button', { name: /Ingresar/i }))

    expect(
      await screen.findByText(/2FA activo/i),
    ).toBeInTheDocument()
  })
})
