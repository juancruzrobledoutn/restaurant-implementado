/**
 * Centralized API client for pwaMenu.
 *
 * - Injects X-Table-Token header from sessionStore (unless skipAuth: true)
 * - Handles 401 by clearing session and redirecting to /scan?reason=expired
 * - Throws ApiError for non-OK responses
 * - All IDs are converted from number→string at the service layer (not here)
 */
import { useSessionStore } from '../stores/sessionStore'
import { logger } from '../utils/logger'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`ApiError ${status}: ${body}`)
    this.name = 'ApiError'
  }
}

export interface RequestOpts {
  headers?: Record<string, string>
  signal?: AbortSignal
  /** When true, the X-Table-Token header is NOT injected (for public endpoints). */
  skipAuth?: boolean
}

function buildHeaders(opts?: RequestOpts): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...opts?.headers,
  }
  if (!opts?.skipAuth) {
    const token = useSessionStore.getState().token
    if (token) {
      headers['X-Table-Token'] = token
    }
  }
  return headers
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    logger.warn('ApiError 401 — clearing session and redirecting')
    useSessionStore.getState().clear()
    window.location.href = '/scan?reason=expired'
    throw new ApiError(401, 'session_expired')
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ApiError(res.status, body)
  }
  // Handle empty responses (204 No Content)
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T
  }
  const text = await res.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

export async function apiGet<T>(path: string, opts?: RequestOpts): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'GET',
    headers: buildHeaders(opts),
    signal: opts?.signal,
  })
  return handleResponse<T>(res)
}

export async function apiPost<T>(path: string, body: unknown, opts?: RequestOpts): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: buildHeaders(opts),
    body: JSON.stringify(body),
    signal: opts?.signal,
  })
  return handleResponse<T>(res)
}

export async function apiPatch<T>(path: string, body: unknown, opts?: RequestOpts): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'PATCH',
    headers: buildHeaders(opts),
    body: JSON.stringify(body),
    signal: opts?.signal,
  })
  return handleResponse<T>(res)
}

export async function apiPut<T>(path: string, body: unknown, opts?: RequestOpts): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'PUT',
    headers: buildHeaders(opts),
    body: JSON.stringify(body),
    signal: opts?.signal,
  })
  return handleResponse<T>(res)
}

export async function apiDelete<T>(path: string, opts?: RequestOpts): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'DELETE',
    headers: buildHeaders(opts),
    signal: opts?.signal,
  })
  return handleResponse<T>(res)
}
