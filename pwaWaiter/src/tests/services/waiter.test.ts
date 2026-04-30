/**
 * Waiter service tests — C-20 + C-21 API functions.
 */
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import {
  getPublicBranches,
  verifyBranchAssignment,
  getCompactMenu,
  createWaiterRound,
  confirmRound,
  requestCheck,
  submitManualPayment,
  closeTable,
  listServiceCalls,
  ackServiceCall,
  fetchWaiterTables,
  catchupWaiterEvents,
} from '@/services/waiter'
import { __resetAuthModuleState } from '@/stores/authStore'

const API_URL = 'http://localhost:8000'

describe('getPublicBranches', () => {
  it('converts numeric IDs to strings', async () => {
    __resetAuthModuleState()
    const branches = await getPublicBranches()
    expect(branches).toHaveLength(2)
    expect(branches[0]?.id).toBe('1')
    expect(typeof branches[0]?.id).toBe('string')
    expect(branches[0]?.name).toBe('Buen Sabor Centro')
    expect(branches[0]?.slug).toBe('centro')
  })
})

describe('verifyBranchAssignment', () => {
  it('maps assigned=true response to the frontend WaiterAssignment shape', async () => {
    const result = await verifyBranchAssignment('1')
    expect(result).toEqual({
      assigned: true,
      sectorId: '5',
      sectorName: 'Salón principal',
    })
  })

  it('maps assigned=false response to a simple object', async () => {
    const result = await verifyBranchAssignment('99')
    expect(result).toEqual({ assigned: false })
  })

  it('uses branch_id as query param', async () => {
    let capturedUrl = ''
    server.use(
      http.get(`${API_URL}/api/waiter/verify-branch-assignment`, ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json({ assigned: false })
      }),
    )

    await verifyBranchAssignment('42')
    expect(capturedUrl).toContain('branch_id=42')
  })
})

// ---------------------------------------------------------------------------
// C-21 service tests
// ---------------------------------------------------------------------------

describe('getCompactMenu', () => {
  it('returns menu with string IDs and flattened products', async () => {
    server.use(
      http.get(`${API_URL}/api/waiter/branches/1/menu`, () =>
        HttpResponse.json({
          branch_id: 1,
          categories: [
            {
              id: 10,
              name: 'Bebidas',
              subcategories: [
                {
                  id: 10,
                  name: 'Sin alcohol',
                  products: [
                    { id: 100, name: 'Agua', price_cents: 500, subcategory_id: 10, is_available: true },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    )
    const menu = await getCompactMenu('1')
    expect(menu.branchId).toBe('1')
    expect(typeof menu.branchId).toBe('string')
    expect(menu.categories[0]?.id).toBe('10')
    expect(menu.products[0]?.id).toBe('100')
    expect(menu.products[0]?.priceCents).toBe(500)
  })

  it('throws on 404', async () => {
    server.use(
      http.get(`${API_URL}/api/waiter/branches/99/menu`, () =>
        HttpResponse.json({ detail: 'Not found' }, { status: 404 }),
      ),
    )
    await expect(getCompactMenu('99')).rejects.toThrow()
  })
})

describe('createWaiterRound', () => {
  it('sends Idempotency-Key header and returns RoundDTO with string IDs', async () => {
    let capturedKey: string | null = null
    server.use(
      http.post(`${API_URL}/api/waiter/sessions/42/rounds`, ({ request }) => {
        capturedKey = request.headers.get('Idempotency-Key')
        return HttpResponse.json(
          {
            id: 1,
            session_id: 42,
            status: 'CONFIRMED',
            items: [{ id: 10, product_id: 100, quantity: 2, notes: null }],
            created_at: '2026-04-18T10:00:00Z',
          },
          { status: 201 },
        )
      }),
    )
    const round = await createWaiterRound(
      '42',
      { items: [{ productId: '100', quantity: 2 }] },
      'test-op-id',
    )
    expect(capturedKey).toBe('test-op-id')
    expect(round.id).toBe('1')
    expect(round.sessionId).toBe('42')
    expect(round.items[0]?.productId).toBe('100')
  })
})

describe('confirmRound', () => {
  it('sends Idempotency-Key and returns confirmed round', async () => {
    let capturedKey: string | null = null
    server.use(
      http.patch(`${API_URL}/api/waiter/rounds/5`, ({ request }) => {
        capturedKey = request.headers.get('Idempotency-Key')
        return HttpResponse.json({
          id: 5,
          session_id: 42,
          status: 'CONFIRMED',
          items: [],
          created_at: '2026-04-18T10:00:00Z',
        })
      }),
    )
    const round = await confirmRound('42', '5', 'op-confirm')
    expect(capturedKey).toBe('op-confirm')
    expect(round.status).toBe('CONFIRMED')
  })
})

describe('requestCheck', () => {
  it('returns CheckDTO with string IDs', async () => {
    server.use(
      http.post(`${API_URL}/api/waiter/sessions/42/check`, () =>
        HttpResponse.json({ id: 7, session_id: 42, status: 'OPEN', total_cents: 2500 }),
      ),
    )
    const check = await requestCheck('42', 'op-check')
    expect(check.id).toBe('7')
    expect(check.totalCents).toBe(2500)
  })
})

describe('submitManualPayment', () => {
  it('converts sessionId to number at boundary and sends Idempotency-Key', async () => {
    let body: Record<string, unknown> | null = null
    let key: string | null = null
    server.use(
      http.post(`${API_URL}/api/waiter/payments/manual`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        key = request.headers.get('Idempotency-Key')
        return HttpResponse.json(
          { id: 99, session_id: 42, amount_cents: 15050, method: 'cash', status: 'APPROVED', created_at: '' },
          { status: 201 },
        )
      }),
    )
    const payment = await submitManualPayment({ sessionId: '42', amountCents: 15050, method: 'cash' }, 'op-pay')
    expect(key).toBe('op-pay')
    expect((body as unknown as Record<string, unknown>)['session_id']).toBe(42)
    expect(payment.id).toBe('99')
  })
})

describe('closeTable', () => {
  it('POSTs with Idempotency-Key and resolves on 204', async () => {
    let key: string | null = null
    server.use(
      http.post(`${API_URL}/api/waiter/tables/3/close`, ({ request }) => {
        key = request.headers.get('Idempotency-Key')
        return new HttpResponse(null, { status: 204 })
      }),
    )
    await closeTable('3', 'op-close')
    expect(key).toBe('op-close')
  })
})

describe('listServiceCalls', () => {
  it('returns DTOs with string IDs', async () => {
    server.use(
      http.get(`${API_URL}/api/waiter/service-calls`, () =>
        HttpResponse.json([
          { id: 1, table_id: 3, sector_id: 5, status: 'OPEN', created_at: '2026-04-18T10:00:00Z', acked_at: null },
        ]),
      ),
    )
    const calls = await listServiceCalls()
    expect(calls[0]?.id).toBe('1')
    expect(calls[0]?.tableId).toBe('3')
  })
})

describe('ackServiceCall', () => {
  it('sends Idempotency-Key to ack endpoint', async () => {
    let key: string | null = null
    server.use(
      http.put(`${API_URL}/api/waiter/service-calls/1/ack`, ({ request }) => {
        key = request.headers.get('Idempotency-Key')
        return HttpResponse.json({ id: 1, table_id: 3, sector_id: 5, status: 'ACKED', created_at: '', acked_at: '' })
      }),
    )
    await ackServiceCall('1', 'op-ack')
    expect(key).toBe('op-ack')
  })
})

describe('fetchWaiterTables', () => {
  it('converts numeric IDs to strings', async () => {
    server.use(
      http.get(`${API_URL}/api/waiter/tables`, () =>
        HttpResponse.json([
          { id: 1, code: 'INT-01', status: 'AVAILABLE', sector_id: 5, sector_name: 'Salón', session_id: null, session_status: null },
        ]),
      ),
    )
    const tables = await fetchWaiterTables()
    expect(tables[0]?.id).toBe('1')
    expect(tables[0]?.sectorId).toBe('5')
    expect(typeof tables[0]?.id).toBe('string')
  })
})

describe('catchupWaiterEvents — JWT in Authorization header', () => {
  it('sends JWT via Authorization: Bearer header — NOT as ?token= query param', async () => {
    // Spy on global.fetch to capture the actual request made by catchupWaiterEvents.
    // We do this instead of MSW because env.WS_URL uses ws:// scheme which MSW
    // doesn't intercept for regular HTTP fetch calls.
    let capturedInit: RequestInit | undefined
    let capturedUrl: string | undefined

    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      capturedUrl = typeof input === 'string' ? input : (input as Request).url
      capturedInit = init
      return new Response(JSON.stringify({ events: [], partial: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    // Mock authStore.getAccessToken
    const authStoreMod = await import('@/stores/authStore')
    const getAccessToken = vi.spyOn(authStoreMod, 'getAccessToken').mockReturnValue('test-jwt-token')

    await catchupWaiterEvents('1', 1000)

    // JWT must be in Authorization header
    const headers = capturedInit?.headers as Record<string, string> | undefined
    expect(headers?.['Authorization']).toBe('Bearer test-jwt-token')

    // URL must NOT contain token= query param
    expect(capturedUrl).not.toContain('token=')

    fetchSpy.mockRestore()
    getAccessToken.mockRestore()
  })
})
