/**
 * roundsAdminAPI unit tests.
 *
 * Verifies:
 * - URL construction and query params
 * - ID conversion (int → string at boundary)
 * - Response shape mapping
 * - cancelRound PATCH call
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { roundsAdminAPI } from './roundsAdminAPI'

vi.mock('@/services/api', () => ({ fetchAPI: vi.fn() }))

import { fetchAPI } from '@/services/api'
const mockFetchAPI = fetchAPI as ReturnType<typeof vi.fn>

const NOW = '2026-01-01T12:00:00Z'

function makeBackendRound(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    round_number: 3,
    session_id: 10,
    branch_id: 5,
    status: 'PENDING',
    table_id: 7,
    table_code: 'A-01',
    table_number: 1,
    sector_id: 2,
    sector_name: 'Salon',
    diner_id: null,
    diner_name: null,
    items_count: 2,
    total_cents: 3000,
    pending_at: NOW,
    confirmed_at: null,
    submitted_at: null,
    in_kitchen_at: null,
    ready_at: null,
    served_at: null,
    canceled_at: null,
    cancel_reason: null,
    created_by_role: 'WAITER',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listRounds', () => {
  it('calls GET /api/admin/rounds with correct query params', async () => {
    mockFetchAPI.mockResolvedValueOnce({
      items: [makeBackendRound()],
      total: 1,
      limit: 50,
      offset: 0,
    })

    const result = await roundsAdminAPI.listRounds({
      branch_id: '5',
      date: '2026-01-01',
      status: 'PENDING',
      limit: 50,
      offset: 0,
    })

    expect(mockFetchAPI).toHaveBeenCalledOnce()
    const [url] = mockFetchAPI.mock.calls[0]!
    expect(url).toContain('/api/admin/rounds')
    expect(url).toContain('branch_id=5')
    expect(url).toContain('date=2026-01-01')
    expect(url).toContain('status=PENDING')

    // Verify ID conversion
    expect(result.items[0]!.id).toBe('42')
    expect(result.items[0]!.branch_id).toBe('5')
    expect(result.items[0]!.session_id).toBe('10')
    expect(result.total).toBe(1)
  })

  it('converts sector_id and diner_id from int to string', async () => {
    mockFetchAPI.mockResolvedValueOnce({
      items: [makeBackendRound({ sector_id: 3, diner_id: 9 })],
      total: 1,
      limit: 50,
      offset: 0,
    })

    const result = await roundsAdminAPI.listRounds({ branch_id: '5' })
    expect(result.items[0]!.sector_id).toBe('3')
    expect(result.items[0]!.diner_id).toBe('9')
  })

  it('maps null sector_id to null', async () => {
    mockFetchAPI.mockResolvedValueOnce({
      items: [makeBackendRound({ sector_id: null })],
      total: 1,
      limit: 50,
      offset: 0,
    })

    const result = await roundsAdminAPI.listRounds({ branch_id: '5' })
    expect(result.items[0]!.sector_id).toBeNull()
  })
})

describe('getRound', () => {
  it('calls GET /api/admin/rounds/{id} and converts IDs', async () => {
    const mockItem = {
      id: 1,
      round_id: 42,
      product_id: 10,
      diner_id: null,
      quantity: 2,
      notes: null,
      price_cents_snapshot: 1500,
      is_voided: false,
      void_reason: null,
      voided_at: null,
      created_at: NOW,
      updated_at: NOW,
    }

    mockFetchAPI.mockResolvedValueOnce({
      ...makeBackendRound(),
      items: [mockItem],
    })

    const result = await roundsAdminAPI.getRound('42')

    expect(mockFetchAPI).toHaveBeenCalledWith('/api/admin/rounds/42')
    expect(result.id).toBe('42')
    expect(result.items).toHaveLength(1)
    expect(result.items![0]!.id).toBe('1')
    expect(result.items![0]!.product_id).toBe('10')
  })
})

describe('cancelRound', () => {
  it('calls PATCH /api/admin/rounds/{id} with CANCELED status and reason', async () => {
    mockFetchAPI.mockResolvedValueOnce(undefined)

    await roundsAdminAPI.cancelRound('42', 'Wrong order')

    expect(mockFetchAPI).toHaveBeenCalledWith('/api/admin/rounds/42', {
      method: 'PATCH',
      body: { status: 'CANCELED', cancel_reason: 'Wrong order' },
    })
  })
})
