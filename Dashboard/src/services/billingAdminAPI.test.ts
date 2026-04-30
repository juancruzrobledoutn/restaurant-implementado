/**
 * billingAdminAPI tests (C-26 — task 5.5).
 *
 * Coverage:
 * - listChecks: 200 OK → PaginatedChecks with ID conversion (number → string)
 * - listChecks: 403 → APIError thrown
 * - listChecks: 409 → APIError thrown (date range > 90 days)
 * - listChecks: 429 → APIError thrown (rate limit)
 * - listPayments: 200 OK → PaginatedPayments with ID conversion
 * - listPayments: 403 → APIError thrown
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock env before importing anything that reads it
vi.mock('@/config/env', () => ({
  env: { API_URL: 'http://localhost:8000', WS_URL: 'ws://localhost:8001' },
}))

import { APIError } from './api'
import { billingAdminAPI } from './billingAdminAPI'
import type { ChecksFilter, PaymentsFilter } from '@/types/billing'

// ---------------------------------------------------------------------------
// Global fetch mock
// ---------------------------------------------------------------------------

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ---------------------------------------------------------------------------
// Auth store mock (required by fetchAPI interceptor)
// ---------------------------------------------------------------------------

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return {
    ...actual,
    fetchAPI: vi.fn(),
  }
})

import { fetchAPI } from './api'
const mockFetchAPI = fetchAPI as ReturnType<typeof vi.fn>

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const todayStr = '2026-04-21'

const defaultChecksFilter: ChecksFilter = {
  date: todayStr,
  status: null,
  page: 1,
  page_size: 20,
}

const defaultPaymentsFilter: PaymentsFilter = {
  from: todayStr,
  to: todayStr,
  method: null,
  status: null,
  page: 1,
  page_size: 20,
}

const backendChecksResponse = {
  items: [
    {
      id: 42,
      session_id: 7,
      branch_id: 3,
      total_cents: 5000,
      covered_cents: 2500,
      status: 'PAID',
      created_at: '2026-04-21T12:00:00Z',
    },
  ],
  total: 1,
  page: 1,
  page_size: 20,
  total_pages: 1,
}

const backendPaymentsResponse = {
  items: [
    {
      id: 99,
      check_id: 42,
      amount_cents: 2500,
      method: 'cash',
      status: 'APPROVED',
      created_at: '2026-04-21T12:30:00Z',
    },
  ],
  total: 1,
  page: 1,
  page_size: 20,
  total_pages: 1,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAPIError(status: number, message: string): APIError {
  return new APIError(status, message)
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// listChecks
// ---------------------------------------------------------------------------

describe('billingAdminAPI.listChecks', () => {
  it('returns PaginatedChecks with IDs converted to strings on 200', async () => {
    mockFetchAPI.mockResolvedValueOnce(backendChecksResponse)

    const result = await billingAdminAPI.listChecks('3', defaultChecksFilter)

    expect(result.total).toBe(1)
    expect(result.total_pages).toBe(1)
    expect(result.items).toHaveLength(1)

    const item = result.items[0]!
    // IDs MUST be strings in frontend (backend → string conversion at boundary)
    expect(typeof item.id).toBe('string')
    expect(typeof item.session_id).toBe('string')
    expect(typeof item.branch_id).toBe('string')
    expect(item.id).toBe('42')
    expect(item.session_id).toBe('7')
    expect(item.branch_id).toBe('3')
    expect(item.total_cents).toBe(5000)
    expect(item.covered_cents).toBe(2500)
    expect(item.status).toBe('PAID')
  })

  it('builds correct URL params and calls fetchAPI', async () => {
    mockFetchAPI.mockResolvedValueOnce(backendChecksResponse)

    await billingAdminAPI.listChecks('3', { ...defaultChecksFilter, status: 'REQUESTED' })

    expect(mockFetchAPI).toHaveBeenCalledOnce()
    const url: string = mockFetchAPI.mock.calls[0]?.[0]
    expect(url).toContain('/api/admin/billing/checks')
    expect(url).toContain('branch_id=3')
    expect(url).toContain('from=2026-04-21')
    expect(url).toContain('to=2026-04-21')
    expect(url).toContain('status=REQUESTED')
    expect(url).toContain('page=1')
    expect(url).toContain('page_size=20')
  })

  it('does not include status param when status is null', async () => {
    mockFetchAPI.mockResolvedValueOnce(backendChecksResponse)

    await billingAdminAPI.listChecks('3', defaultChecksFilter)

    const url: string = mockFetchAPI.mock.calls[0]?.[0]
    expect(url).not.toContain('status=')
  })

  it('throws APIError on 403 (sucursal ajena)', async () => {
    mockFetchAPI.mockRejectedValueOnce(makeAPIError(403, 'Branch access denied'))

    await expect(billingAdminAPI.listChecks('99', defaultChecksFilter)).rejects.toThrow(
      APIError,
    )
  })

  it('throws APIError on 409 (rango > 90 días)', async () => {
    mockFetchAPI.mockRejectedValueOnce(makeAPIError(409, 'El rango de fechas no puede superar 90 dias'))

    await expect(billingAdminAPI.listChecks('3', defaultChecksFilter)).rejects.toThrow(
      APIError,
    )
  })

  it('throws APIError on 429 (rate limit)', async () => {
    mockFetchAPI.mockRejectedValueOnce(makeAPIError(429, 'Rate limit exceeded'))

    await expect(billingAdminAPI.listChecks('3', defaultChecksFilter)).rejects.toThrow(
      APIError,
    )
  })
})

// ---------------------------------------------------------------------------
// listPayments
// ---------------------------------------------------------------------------

describe('billingAdminAPI.listPayments', () => {
  it('returns PaginatedPayments with IDs converted to strings on 200', async () => {
    mockFetchAPI.mockResolvedValueOnce(backendPaymentsResponse)

    const result = await billingAdminAPI.listPayments('3', defaultPaymentsFilter)

    expect(result.total).toBe(1)
    expect(result.items).toHaveLength(1)

    const item = result.items[0]!
    expect(typeof item.id).toBe('string')
    expect(typeof item.check_id).toBe('string')
    expect(item.id).toBe('99')
    expect(item.check_id).toBe('42')
    expect(item.amount_cents).toBe(2500)
    expect(item.method).toBe('cash')
    expect(item.status).toBe('APPROVED')
  })

  it('builds correct URL params including method and status filters', async () => {
    mockFetchAPI.mockResolvedValueOnce(backendPaymentsResponse)

    await billingAdminAPI.listPayments('3', {
      ...defaultPaymentsFilter,
      method: 'card',
      status: 'APPROVED',
    })

    const url: string = mockFetchAPI.mock.calls[0]?.[0]
    expect(url).toContain('/api/admin/billing/payments')
    expect(url).toContain('branch_id=3')
    expect(url).toContain('from=2026-04-21')
    expect(url).toContain('to=2026-04-21')
    expect(url).toContain('method=card')
    expect(url).toContain('status=APPROVED')
  })

  it('throws APIError on 403', async () => {
    mockFetchAPI.mockRejectedValueOnce(makeAPIError(403, 'Branch access denied'))

    await expect(billingAdminAPI.listPayments('99', defaultPaymentsFilter)).rejects.toThrow(
      APIError,
    )
  })

  it('throws APIError on 409 (rango > 90 días)', async () => {
    mockFetchAPI.mockRejectedValueOnce(makeAPIError(409, 'rango supera 90 dias'))

    await expect(billingAdminAPI.listPayments('3', defaultPaymentsFilter)).rejects.toThrow(
      APIError,
    )
  })

  it('throws APIError on 429 (rate limit)', async () => {
    mockFetchAPI.mockRejectedValueOnce(makeAPIError(429, 'Rate limit exceeded'))

    await expect(billingAdminAPI.listPayments('3', defaultPaymentsFilter)).rejects.toThrow(
      APIError,
    )
  })
})
