/**
 * LoginPage tests.
 *
 * Tests: renders email/password inputs, shows TOTP field when requires2fa=true,
 * shows error from store, redirects to / after successful login.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'

// Mock authStore
const mockLogin = vi.fn()
const mockClearError = vi.fn()

let mockIsAuthenticated = false
let mockError: string | null = null
let mockRequires2fa = false

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => {
    const mockState = {
      isAuthenticated: mockIsAuthenticated,
      error: mockError,
      requires2fa: mockRequires2fa,
      login: mockLogin,
      clearError: mockClearError,
    }
    return selector(mockState)
  },
  selectIsAuthenticated: (s: { isAuthenticated: boolean }) => s.isAuthenticated,
  selectError: (s: { error: string | null }) => s.error,
  selectRequires2fa: (s: { requires2fa: boolean }) => s.requires2fa,
  selectLogin: (s: { login: unknown }) => s.login,
  selectClearError: (s: { clearError: unknown }) => s.clearError,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

import LoginPage from './LoginPage'

function renderLoginPage() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div>Home</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('LoginPage', () => {
  beforeEach(() => {
    mockIsAuthenticated = false
    mockError = null
    mockRequires2fa = false
    mockLogin.mockReset()
    mockClearError.mockReset()
  })

  it('renders email and password inputs', () => {
    renderLoginPage()

    expect(screen.getByLabelText('auth.login.email')).toBeInTheDocument()
    expect(screen.getByLabelText('auth.login.password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'auth.login.submit' })).toBeInTheDocument()
  })

  it('does NOT show TOTP field when requires2fa is false', () => {
    renderLoginPage()

    expect(screen.queryByLabelText('auth.login.totp.label')).not.toBeInTheDocument()
  })

  it('shows TOTP field when requires2fa is true', () => {
    mockRequires2fa = true
    renderLoginPage()

    expect(screen.getByLabelText('auth.login.totp.label')).toBeInTheDocument()
  })

  it('displays error from authStore', () => {
    mockError = 'Credenciales incorrectas.'
    renderLoginPage()

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Credenciales incorrectas.')
  })

  it('calls login action on form submit', async () => {
    mockLogin.mockResolvedValue(undefined)
    renderLoginPage()

    fireEvent.change(screen.getByLabelText('auth.login.email'), {
      target: { value: 'admin@test.com' },
    })
    fireEvent.change(screen.getByLabelText('auth.login.password'), {
      target: { value: 'password123' },
    })

    // Submit via form action (React 19 pattern)
    const form = screen.getByRole('button', { name: 'auth.login.submit' }).closest('form')!
    fireEvent.submit(form)

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('admin@test.com', 'password123', undefined)
    })
  })

  it('redirects to / when already authenticated', async () => {
    mockIsAuthenticated = true
    renderLoginPage()

    await waitFor(() => {
      expect(screen.getByText('Home')).toBeInTheDocument()
    })
  })
})
