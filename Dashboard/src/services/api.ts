/**
 * fetchAPI — centralized HTTP client for the Dashboard.
 *
 * Features:
 * - Auto-attaches Authorization: Bearer header from authStore in-memory token
 * - JSON Content-Type by default
 * - 401 interceptor: attempts a single silent token refresh then retries
 * - isLoggingOut guard: skips refresh if logout is in progress
 * - Non-401 errors are thrown with response detail message
 *
 * Usage:
 *   const data = await fetchAPI<CategoryList>('/api/admin/categories')
 *   const item = await fetchAPI<Category>('/api/admin/categories', { method: 'POST', body: { name } })
 */

import { env } from '@/config/env'
import { logger } from '@/utils/logger'

// Lazy import to avoid circular dependency — authStore imports nothing from api.ts
// but api.ts needs to read the token and trigger logout.
// We resolve the store reference at call time via a getter function.

type AuthStoreRef = {
  getAccessToken: () => string | null
  isLoggingOut: () => boolean
  logout: () => Promise<void>
  setAccessToken: (token: string) => void
}

let authStoreRef: AuthStoreRef | null = null

/** Register the auth store reference. Called once by authStore on init. */
export function registerAuthStore(ref: AuthStoreRef): void {
  authStoreRef = ref
}

// ---------------------------------------------------------------------------
// Core fetchAPI
// ---------------------------------------------------------------------------

export interface FetchAPIOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  /** If true, don't attach the Authorization header (used for /api/auth/* endpoints) */
  skipAuth?: boolean
}

export async function fetchAPI<T>(
  path: string,
  options: FetchAPIOptions = {},
): Promise<T> {
  const { body, skipAuth = false, ...restOptions } = options

  const response = await doRequest(path, body, restOptions, skipAuth)

  // Happy path
  if (response.ok) {
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }

  // 401 — attempt silent refresh unless we're logging out
  if (response.status === 401) {
    if (authStoreRef?.isLoggingOut()) {
      logger.debug('fetchAPI: 401 during logout — skipping refresh')
      throw new APIError(401, 'Unauthorized')
    }

    logger.debug('fetchAPI: 401 received — attempting silent refresh')
    const refreshed = await attemptRefresh()
    if (!refreshed) {
      throw new APIError(401, 'Unauthorized')
    }

    // Retry the original request once
    const retryResponse = await doRequest(path, body, restOptions, skipAuth)

    if (retryResponse.ok) {
      if (retryResponse.status === 204) return undefined as T
      return retryResponse.json() as Promise<T>
    }

    if (retryResponse.status === 401) {
      // Second 401 — session is truly expired, trigger logout
      logger.warn('fetchAPI: second 401 after refresh — triggering logout')
      if (authStoreRef) {
        await authStoreRef.logout()
      }
      throw new APIError(401, 'Session expired')
    }

    return handleErrorResponse(retryResponse)
  }

  return handleErrorResponse(response)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function doRequest(
  path: string,
  body: unknown,
  options: RequestInit,
  skipAuth: boolean,
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }

  if (!skipAuth && authStoreRef) {
    const token = authStoreRef.getAccessToken()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
  }

  const url = path.startsWith('http') ? path : `${env.API_URL}${path}`

  return fetch(url, {
    ...options,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

// ---------------------------------------------------------------------------
// Mutex — prevents multiple concurrent refresh calls (one wins, rest await it)
// ---------------------------------------------------------------------------
let refreshPromise: Promise<boolean> | null = null

/** De-duplicates concurrent 401 refresh attempts. All callers share the same Promise. */
async function ensureFreshToken(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

async function doRefresh(): Promise<boolean> {
  try {
    const response = await fetch(`${env.API_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include', // HttpOnly cookie
    })

    if (!response.ok) {
      logger.warn('fetchAPI: refresh failed — status', response.status)
      if (authStoreRef) {
        await authStoreRef.logout()
      }
      return false
    }

    const data = (await response.json()) as { access_token: string }
    authStoreRef?.setAccessToken(data.access_token)
    logger.debug('fetchAPI: token refreshed successfully')
    return true
  } catch (err) {
    logger.error('fetchAPI: refresh request threw', err)
    if (authStoreRef) {
      await authStoreRef.logout()
    }
    return false
  }
}

async function attemptRefresh(): Promise<boolean> {
  return ensureFreshToken()
}

async function handleErrorResponse(response: Response): Promise<never> {
  let detail = response.statusText
  try {
    const json = (await response.json()) as { detail?: string; message?: string }
    detail = json.detail ?? json.message ?? detail
  } catch {
    // Response body may not be JSON
  }
  logger.error(`fetchAPI: HTTP ${response.status} — ${detail}`)
  throw new APIError(response.status, detail)
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class APIError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'APIError'
  }
}
