/**
 * Push service tests — happy path, permission denied, missing VAPID key, not supported.
 *
 * jsdom doesn't include PushManager or ServiceWorkerRegistration, so we stub
 * globals before importing the module under test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Reset module state before each test so mocks applied via vi.stubEnv/vi.stubGlobal re-take effect
async function loadFreshPush() {
  vi.resetModules()
  return await import('@/services/push')
}

describe('registerPushSubscription', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('returns not_supported when ServiceWorker API is missing', async () => {
    // Ensure navigator exists but without serviceWorker
    vi.stubGlobal('navigator', {})
    const { registerPushSubscription } = await loadFreshPush()
    const result = await registerPushSubscription()
    expect(result).toEqual({ success: false, reason: 'not_supported' })
  })

  it('returns no_vapid_key when VITE_VAPID_PUBLIC_KEY is empty', async () => {
    vi.stubGlobal('navigator', { serviceWorker: {} })
    vi.stubGlobal('PushManager', class {})
    vi.stubGlobal('Notification', { requestPermission: vi.fn() })
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '')

    const { registerPushSubscription } = await loadFreshPush()
    const result = await registerPushSubscription()
    expect(result).toEqual({ success: false, reason: 'no_vapid_key' })
  })

  it('returns permission_denied when user blocks the prompt', async () => {
    vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve({}) } })
    vi.stubGlobal('PushManager', class {})
    vi.stubGlobal('Notification', {
      requestPermission: vi.fn().mockResolvedValue('denied'),
    })
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'BDummyKey123_-')

    const { registerPushSubscription } = await loadFreshPush()
    const result = await registerPushSubscription()
    expect(result).toEqual({ success: false, reason: 'permission_denied' })
  })

  it('happy path: subscribes and POSTs to backend', async () => {
    const fakeEndpoint = 'https://push.example/endpoint-abc'
    const fakeP256dh = new Uint8Array([1, 2, 3, 4, 5]).buffer
    const fakeAuth = new Uint8Array([6, 7, 8, 9, 10]).buffer

    const subscribeMock = vi.fn().mockResolvedValue({
      endpoint: fakeEndpoint,
      getKey: (name: string) => {
        if (name === 'p256dh') return fakeP256dh
        if (name === 'auth') return fakeAuth
        return null
      },
    })

    const readyMock = Promise.resolve({
      pushManager: { subscribe: subscribeMock },
    })

    vi.stubGlobal('navigator', {
      serviceWorker: { ready: readyMock },
    })
    vi.stubGlobal('PushManager', class {})
    vi.stubGlobal('Notification', {
      requestPermission: vi.fn().mockResolvedValue('granted'),
    })
    // Use a valid standard-base64 string so urlBase64ToUint8Array/atob does not throw
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'BDsYw0gB9r0YH4u1FfcXE8xH7w')

    // Spy on fetch directly — stubbing `navigator` globally interferes with MSW's
    // request interception, so we bypass MSW for this test.
    let postBody: unknown = null
    let fetchPath = ''
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        fetchPath = url
        if (init?.body) {
          postBody = JSON.parse(init.body as string)
        }
        return new Response(
          JSON.stringify({ id: 1, endpoint: fakeEndpoint, is_active: true }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        )
      },
    )

    const { registerPushSubscription } = await loadFreshPush()
    const result = await registerPushSubscription()

    expect(result).toEqual({ success: true })
    expect(subscribeMock).toHaveBeenCalledOnce()
    expect(fetchSpy).toHaveBeenCalled()
    expect(fetchPath).toContain('/api/waiter/notifications/subscribe')
    expect(postBody).not.toBeNull()
    expect(postBody).toMatchObject({
      endpoint: fakeEndpoint,
      p256dh_key: expect.any(String),
      auth_key: expect.any(String),
    })
    const body = postBody as {
      endpoint: string
      p256dh_key: string
      auth_key: string
    }
    // base64url strings never contain + / =
    expect(body.p256dh_key).not.toMatch(/[+/=]/)
    expect(body.auth_key).not.toMatch(/[+/=]/)

    fetchSpy.mockRestore()
  })
})
