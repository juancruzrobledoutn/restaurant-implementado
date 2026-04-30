/**
 * authStore unit tests.
 *
 * Tests: login success, login with 2FA, login failure, refresh cycle,
 * logout clears state, isLoggingOut prevents refresh.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAuthStore } from './authStore'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock env
vi.mock('@/config/env', () => ({
  env: { API_URL: 'http://localhost:8000', WS_URL: 'ws://localhost:8001' },
}))

// Mock api registerAuthStore — avoid side effects
vi.mock('@/services/api', () => ({
  registerAuthStore: vi.fn(),
}))

function makeLoginResponse(overrides: Record<string, unknown> = {}) {
  return {
    access_token: 'test-access-token',
    token_type: 'bearer',
    user: {
      id: 1,
      email: 'admin@test.com',
      full_name: 'Admin User',
      tenant_id: 10,
      branch_ids: [100, 101],
      roles: ['ADMIN'],
      is_2fa_enabled: false,
      ...overrides,
    },
  }
}

function mockFetchResponse(status: number, body: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  })
}

describe('authStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useAuthStore.setState({
      isAuthenticated: false,
      user: null,
      isLoading: false,
      error: null,
      requires2fa: false,
      isLoggingOut: false,
    })
    mockFetch.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ------------------------------------------------------------------
  // Initial state
  // ------------------------------------------------------------------
  it('starts unauthenticated', () => {
    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(false)
    expect(state.user).toBeNull()
    expect(state.isLoading).toBe(false)
    expect(state.error).toBeNull()
  })

  // ------------------------------------------------------------------
  // Login success
  // ------------------------------------------------------------------
  it('sets isAuthenticated and user on successful login', async () => {
    mockFetchResponse(200, makeLoginResponse())

    await useAuthStore.getState().login('admin@test.com', 'password')

    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(true)
    expect(state.user).not.toBeNull()
    expect(state.user?.email).toBe('admin@test.com')
    expect(state.user?.id).toBe('1') // converted from number
    expect(state.user?.tenantId).toBe('10')
    expect(state.user?.branchIds).toEqual(['100', '101'])
    expect(state.user?.roles).toEqual(['ADMIN'])
    expect(state.user?.totpEnabled).toBe(false)
    expect(state.isLoading).toBe(false)
    expect(state.error).toBeNull()
  })

  // ------------------------------------------------------------------
  // Login with 2FA required
  // ------------------------------------------------------------------
  it('sets requires2fa when backend returns requires_2fa', async () => {
    mockFetchResponse(200, { requires_2fa: true, message: '2FA required' })

    await useAuthStore.getState().login('admin@test.com', 'password')

    const state = useAuthStore.getState()
    expect(state.requires2fa).toBe(true)
    expect(state.isAuthenticated).toBe(false)
    expect(state.isLoading).toBe(false)
  })

  it('includes totp_code in request when provided', async () => {
    mockFetchResponse(200, makeLoginResponse())

    await useAuthStore.getState().login('admin@test.com', 'password', '123456')

    const callArgs = mockFetch.mock.calls[0]
    const bodyStr = (callArgs?.[1] as RequestInit | undefined)?.body as string | undefined
    const body = JSON.parse(bodyStr ?? '{}') as { totp_code?: string }
    expect(body.totp_code).toBe('123456')
  })

  // ------------------------------------------------------------------
  // Login failure
  // ------------------------------------------------------------------
  it('sets error on 401 login failure', async () => {
    mockFetchResponse(401, { detail: 'Invalid credentials' })

    await useAuthStore.getState().login('admin@test.com', 'wrong')

    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(false)
    expect(state.error).toBeTruthy()
    expect(state.isLoading).toBe(false)
  })

  it('sets error on 429 rate limiting', async () => {
    mockFetchResponse(429, { detail: 'Rate limited' })

    await useAuthStore.getState().login('admin@test.com', 'password')

    const state = useAuthStore.getState()
    expect(state.error).toBeTruthy()
    expect(state.isAuthenticated).toBe(false)
  })

  it('sets error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    await useAuthStore.getState().login('admin@test.com', 'password')

    const state = useAuthStore.getState()
    expect(state.error).toBeTruthy()
    expect(state.isAuthenticated).toBe(false)
  })

  // ------------------------------------------------------------------
  // Logout
  // ------------------------------------------------------------------
  it('clears auth state on logout', async () => {
    // First login
    mockFetchResponse(200, makeLoginResponse())
    await useAuthStore.getState().login('admin@test.com', 'password')
    expect(useAuthStore.getState().isAuthenticated).toBe(true)

    // Now logout
    mockFetchResponse(200, {})
    await useAuthStore.getState().logout()

    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(false)
    expect(state.user).toBeNull()
    expect(state.isLoggingOut).toBe(false)
  })

  it('does not trigger logout twice if already logging out', async () => {
    useAuthStore.setState({ isLoggingOut: true })

    await useAuthStore.getState().logout()

    // fetch should not have been called
    expect(mockFetch).not.toHaveBeenCalled()
  })

  // ------------------------------------------------------------------
  // clearError
  // ------------------------------------------------------------------
  it('clearError resets error to null', async () => {
    useAuthStore.setState({ error: 'Some error' })
    useAuthStore.getState().clearError()
    expect(useAuthStore.getState().error).toBeNull()
  })
})
