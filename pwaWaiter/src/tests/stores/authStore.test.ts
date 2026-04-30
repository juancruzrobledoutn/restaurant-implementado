/**
 * authStore tests — JWT lifecycle (login, logout, refresh) and error handling.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'

const API_URL = 'http://localhost:8000'

async function loadFreshStore() {
  vi.resetModules()
  const mod = await import('@/stores/authStore')
  // Reset module-level token/timers from previous tests
  mod.__resetAuthModuleState()
  // Reset zustand state to initial
  mod.useAuthStore.setState({
    isAuthenticated: false,
    user: null,
    isLoading: false,
    error: null,
    requires2fa: false,
    isLoggingOut: false,
    assignedSectorId: null,
    assignedSectorName: null,
  })
  return mod
}

describe('authStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('login 200 authenticates, converts IDs, and stores user', async () => {
    const mod = await loadFreshStore()
    await mod.useAuthStore
      .getState()
      .login('waiter@demo.com', 'waiter123')

    const state = mod.useAuthStore.getState()
    expect(state.isAuthenticated).toBe(true)
    expect(state.user).toEqual({
      id: '10',
      email: 'waiter@demo.com',
      fullName: 'Ana Mozo',
      tenantId: '1',
      branchIds: ['1'],
      roles: ['WAITER'],
    })
    expect(state.error).toBeNull()
    expect(mod.getAccessToken()).toBe('fake-access-token')
  })

  it('login 401 sets Spanish error and keeps user unauthenticated', async () => {
    const mod = await loadFreshStore()
    await mod.useAuthStore.getState().login('wrong@demo.com', 'bad')

    const state = mod.useAuthStore.getState()
    expect(state.isAuthenticated).toBe(false)
    expect(state.error).toMatch(/credenciales/i)
    expect(mod.getAccessToken()).toBeNull()
  })

  it('login 429 sets Spanish rate-limit error', async () => {
    server.use(
      http.post(`${API_URL}/api/auth/login`, () =>
        HttpResponse.json({ detail: 'rate limited' }, { status: 429 }),
      ),
    )

    const mod = await loadFreshStore()
    await mod.useAuthStore.getState().login('waiter@demo.com', 'waiter123')

    const state = mod.useAuthStore.getState()
    expect(state.isAuthenticated).toBe(false)
    expect(state.error).toMatch(/intentos/i)
  })

  it('login with requires_2fa=true marks requires2fa and does not authenticate', async () => {
    server.use(
      http.post(`${API_URL}/api/auth/login`, () =>
        HttpResponse.json({
          requires_2fa: true,
          message: 'Requires 2FA',
        }),
      ),
    )

    const mod = await loadFreshStore()
    await mod.useAuthStore.getState().login('waiter@demo.com', 'waiter123')

    const state = mod.useAuthStore.getState()
    expect(state.isAuthenticated).toBe(false)
    expect(state.requires2fa).toBe(true)
  })

  it('logout cancels refresh, clears token, and resets state', async () => {
    const mod = await loadFreshStore()
    await mod.useAuthStore
      .getState()
      .login('waiter@demo.com', 'waiter123')
    expect(mod.getAccessToken()).toBe('fake-access-token')

    await mod.useAuthStore.getState().logout()

    const state = mod.useAuthStore.getState()
    expect(state.isAuthenticated).toBe(false)
    expect(state.user).toBeNull()
    expect(mod.getAccessToken()).toBeNull()
  })

  it('logout is idempotent while in-flight', async () => {
    const mod = await loadFreshStore()
    await mod.useAuthStore
      .getState()
      .login('waiter@demo.com', 'waiter123')

    mod.useAuthStore.setState({ isLoggingOut: true })
    // Second call must short-circuit and not throw
    await mod.useAuthStore.getState().logout()
    expect(mod.useAuthStore.getState().isLoggingOut).toBe(true)
  })

  it('access token is never written to localStorage', async () => {
    const mod = await loadFreshStore()
    await mod.useAuthStore
      .getState()
      .login('waiter@demo.com', 'waiter123')

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      const value = key ? localStorage.getItem(key) : null
      expect(key?.toLowerCase() ?? '').not.toMatch(/token|jwt/)
      expect(value ?? '').not.toContain('fake-access-token')
    }
  })
})
