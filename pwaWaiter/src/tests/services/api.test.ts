/**
 * fetchAPI tests — Authorization header, 401 refresh+retry, concurrent refresh mutex.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'

const API_URL = 'http://localhost:8000'

async function loadFresh() {
  vi.resetModules()
  const apiMod = await import('@/services/api')
  return apiMod
}

describe('fetchAPI', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('attaches Authorization header when token is present', async () => {
    const { fetchAPI, registerAuthStore } = await loadFresh()
    registerAuthStore({
      getAccessToken: () => 'my-token',
      isLoggingOut: () => false,
      logout: async () => {},
      setAccessToken: () => {},
    })

    let capturedAuth: string | null = null
    server.use(
      http.get(`${API_URL}/echo`, ({ request }) => {
        capturedAuth = request.headers.get('authorization')
        return HttpResponse.json({ ok: true })
      }),
    )

    await fetchAPI('/echo')
    expect(capturedAuth).toBe('Bearer my-token')
  })

  it('omits Authorization when skipAuth is true', async () => {
    const { fetchAPI, registerAuthStore } = await loadFresh()
    registerAuthStore({
      getAccessToken: () => 'my-token',
      isLoggingOut: () => false,
      logout: async () => {},
      setAccessToken: () => {},
    })

    let capturedAuth: string | null = null
    server.use(
      http.get(`${API_URL}/public`, ({ request }) => {
        capturedAuth = request.headers.get('authorization')
        return HttpResponse.json({ ok: true })
      }),
    )

    await fetchAPI('/public', { skipAuth: true })
    expect(capturedAuth).toBeNull()
  })

  it('401 triggers silent refresh and retries the original request once', async () => {
    const { fetchAPI, registerAuthStore } = await loadFresh()

    let setToken = 'old-token'
    registerAuthStore({
      getAccessToken: () => setToken,
      isLoggingOut: () => false,
      logout: async () => {},
      setAccessToken: (t: string) => {
        setToken = t
      },
    })

    let attempts = 0
    let refreshCalls = 0

    server.use(
      http.get(`${API_URL}/protected`, ({ request }) => {
        attempts += 1
        const auth = request.headers.get('authorization')
        if (auth === 'Bearer fake-refreshed-token') {
          return HttpResponse.json({ ok: true })
        }
        return new HttpResponse(null, { status: 401 })
      }),
      http.post(`${API_URL}/api/auth/refresh`, () => {
        refreshCalls += 1
        return HttpResponse.json({
          access_token: 'fake-refreshed-token',
          token_type: 'bearer',
        })
      }),
    )

    const result = await fetchAPI<{ ok: boolean }>('/protected')
    expect(result).toEqual({ ok: true })
    expect(attempts).toBe(2)
    expect(refreshCalls).toBe(1)
    expect(setToken).toBe('fake-refreshed-token')
  })

  it('concurrent 401 requests share a single refresh', async () => {
    const { fetchAPI, registerAuthStore } = await loadFresh()

    let token = 'old'
    registerAuthStore({
      getAccessToken: () => token,
      isLoggingOut: () => false,
      logout: async () => {},
      setAccessToken: (t: string) => {
        token = t
      },
    })

    let refreshCalls = 0
    server.use(
      http.get(`${API_URL}/protected`, ({ request }) => {
        const auth = request.headers.get('authorization')
        if (auth === 'Bearer fresh') {
          return HttpResponse.json({ ok: true })
        }
        return new HttpResponse(null, { status: 401 })
      }),
      http.post(`${API_URL}/api/auth/refresh`, async () => {
        refreshCalls += 1
        // Simulate a slow refresh — gives all 3 requests time to hit 401 first
        await new Promise((r) => setTimeout(r, 50))
        return HttpResponse.json({ access_token: 'fresh', token_type: 'bearer' })
      }),
    )

    const [a, b, c] = await Promise.all([
      fetchAPI<{ ok: boolean }>('/protected'),
      fetchAPI<{ ok: boolean }>('/protected'),
      fetchAPI<{ ok: boolean }>('/protected'),
    ])
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(c.ok).toBe(true)
    expect(refreshCalls).toBe(1)
  })

  it('second 401 after refresh triggers logout', async () => {
    const { fetchAPI, registerAuthStore, APIError } = await loadFresh()

    const logoutFn = vi.fn().mockResolvedValue(undefined)
    registerAuthStore({
      getAccessToken: () => 'stale',
      isLoggingOut: () => false,
      logout: logoutFn,
      setAccessToken: () => {},
    })

    server.use(
      http.get(`${API_URL}/protected`, () => new HttpResponse(null, { status: 401 })),
      http.post(`${API_URL}/api/auth/refresh`, () =>
        HttpResponse.json({ access_token: 'new', token_type: 'bearer' }),
      ),
    )

    await expect(fetchAPI('/protected')).rejects.toBeInstanceOf(APIError)
    expect(logoutFn).toHaveBeenCalledOnce()
  })
})
