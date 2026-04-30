/**
 * api.ts (fetchAPI) unit tests.
 *
 * Tests: Bearer header attachment, 401 interceptor with retry,
 * second 401 triggers logout, non-401 errors thrown.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchAPI, registerAuthStore, APIError } from './api'

// Mock env
vi.mock('@/config/env', () => ({
  env: { API_URL: 'http://localhost:8000', WS_URL: 'ws://localhost:8001' },
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function makeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response
}

// Setup a test auth store ref
const mockLogout = vi.fn()
const mockSetAccessToken = vi.fn()
let _token: string | null = 'test-token'
let _isLoggingOut = false

beforeEach(() => {
  _token = 'test-token'
  _isLoggingOut = false
  mockFetch.mockReset()
  mockLogout.mockReset()
  mockSetAccessToken.mockReset()

  registerAuthStore({
    getAccessToken: () => _token,
    isLoggingOut: () => _isLoggingOut,
    logout: mockLogout,
    setAccessToken: (t) => {
      _token = t
      mockSetAccessToken(t)
    },
  })
})

describe('fetchAPI', () => {
  // ------------------------------------------------------------------
  // Bearer header
  // ------------------------------------------------------------------
  it('attaches Authorization Bearer header', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200, { data: 'ok' }))

    await fetchAPI('/api/test')

    const call0 = mockFetch.mock.calls[0]
    const [_url, options] = call0 ?? []
    const headers = (options as RequestInit | undefined)?.headers as Record<string, string> | undefined
    expect(headers?.['Authorization']).toBe('Bearer test-token')
    expect(headers?.['Content-Type']).toBe('application/json')
  })

  it('does not attach Authorization header when skipAuth is true', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200, {}))

    await fetchAPI('/api/auth/login', { skipAuth: true })

    const call0 = mockFetch.mock.calls[0]
    const [_url, options] = call0 ?? []
    const headers = (options as RequestInit | undefined)?.headers as Record<string, string> | undefined
    expect(headers?.['Authorization']).toBeUndefined()
  })

  // ------------------------------------------------------------------
  // 401 interceptor — single retry
  // ------------------------------------------------------------------
  it('retries request after successful silent refresh on 401', async () => {
    // First call returns 401, refresh succeeds, retry returns 200
    mockFetch
      .mockResolvedValueOnce(makeResponse(401, { detail: 'Unauthorized' }))
      .mockResolvedValueOnce(makeResponse(200, { access_token: 'new-token' })) // refresh
      .mockResolvedValueOnce(makeResponse(200, { data: 'ok' })) // retry

    const result = await fetchAPI<{ data: string }>('/api/test')

    expect(result.data).toBe('ok')
    expect(mockSetAccessToken).toHaveBeenCalledWith('new-token')
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('calls logout on second 401 after refresh', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(401, { detail: 'Unauthorized' }))
      .mockResolvedValueOnce(makeResponse(200, { access_token: 'new-token' })) // refresh
      .mockResolvedValueOnce(makeResponse(401, { detail: 'Still unauthorized' })) // retry

    mockLogout.mockResolvedValue(undefined)

    await expect(fetchAPI('/api/test')).rejects.toThrow(APIError)
    expect(mockLogout).toHaveBeenCalledTimes(1)
  })

  it('skips refresh when isLoggingOut is true', async () => {
    _isLoggingOut = true
    mockFetch.mockResolvedValueOnce(makeResponse(401, {}))

    await expect(fetchAPI('/api/test')).rejects.toThrow(APIError)
    // Only one fetch call — no refresh attempt
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  // ------------------------------------------------------------------
  // Non-401 errors
  // ------------------------------------------------------------------
  it('throws APIError for 400 without retrying', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(400, { detail: 'Bad request' }))

    await expect(fetchAPI('/api/test')).rejects.toThrow(APIError)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockLogout).not.toHaveBeenCalled()
  })

  it('throws APIError for 403 without retrying', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(403, { detail: 'Forbidden' }))

    await expect(fetchAPI('/api/test')).rejects.toThrow(APIError)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('throws APIError for 500 without retrying', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(500, { detail: 'Server error' }))

    await expect(fetchAPI('/api/test')).rejects.toThrow(APIError)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockLogout).not.toHaveBeenCalled()
  })

  // ------------------------------------------------------------------
  // JSON body
  // ------------------------------------------------------------------
  it('serializes body to JSON', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200, {}))

    await fetchAPI('/api/test', { method: 'POST', body: { name: 'test' } })

    const call0 = mockFetch.mock.calls[0]
    const [_url, options] = call0 ?? []
    expect((options as RequestInit | undefined)?.body).toBe('{"name":"test"}')
  })
})
