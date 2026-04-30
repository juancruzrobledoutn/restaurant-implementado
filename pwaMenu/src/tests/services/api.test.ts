/**
 * Unit tests for api.ts client.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import { useSessionStore } from '../../stores/sessionStore'

// We import after setting up store
async function importApi() {
  return import('../../services/api')
}

function resetStore() {
  useSessionStore.setState({
    token: null,
    branchSlug: null,
    tableCode: null,
    sessionId: null,
    expiresAt: null,
  })
}

describe('api client', () => {
  beforeEach(() => {
    resetStore()
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('injects X-Table-Token when token present', async () => {
    useSessionStore.setState({ token: 'my-secret-token', expiresAt: Date.now() + 1_000_000, branchSlug: 'br', tableCode: 'tc', sessionId: null })

    let capturedToken: string | null = null

    server.use(
      http.get('http://localhost:8000/api/test', ({ request }) => {
        capturedToken = request.headers.get('X-Table-Token')
        return HttpResponse.json({ ok: true })
      }),
    )

    const { apiGet } = await importApi()
    await apiGet('/api/test')

    expect(capturedToken).toBe('my-secret-token')
  })

  it('omits header with skipAuth', async () => {
    useSessionStore.setState({ token: 'secret', expiresAt: Date.now() + 1_000_000, branchSlug: 'br', tableCode: 'tc', sessionId: null })

    let capturedToken: string | null = 'present'

    server.use(
      http.get('http://localhost:8000/api/public/test', ({ request }) => {
        capturedToken = request.headers.get('X-Table-Token')
        return HttpResponse.json({ ok: true })
      }),
    )

    const { apiGet } = await importApi()
    await apiGet('/api/public/test', { skipAuth: true })

    expect(capturedToken).toBeNull()
  })

  it('401 clears session and redirects', async () => {
    useSessionStore.setState({ token: 'expired-token', expiresAt: Date.now() + 1_000_000, branchSlug: 'br', tableCode: 'tc', sessionId: null })

    // Mock window.location.href setter
    const locationMock = { href: '' }
    Object.defineProperty(window, 'location', {
      writable: true,
      value: locationMock,
    })

    server.use(
      http.get('http://localhost:8000/api/protected', () => {
        return HttpResponse.json({ detail: 'Unauthorized' }, { status: 401 })
      }),
    )

    const { apiGet, ApiError } = await importApi()

    await expect(apiGet('/api/protected')).rejects.toThrow(ApiError)
    expect(useSessionStore.getState().token).toBeNull()
    expect(locationMock.href).toBe('/scan?reason=expired')
  })
})
