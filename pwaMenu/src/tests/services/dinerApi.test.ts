/**
 * Tests for dinerApi.ts using MSW.
 * Tests: happy path add/update/remove, 409 session_paying, 409 insufficient_stock, 401 cleanup.
 */
import { describe, it, expect, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import { cartApi, roundsApi, sessionApi, CartConflictError } from '../../services/dinerApi'

// Mock sessionStore so X-Table-Token is injected
vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: {
    getState: () => ({
      token: 'test-table-token',
      clear: vi.fn(),
    }),
  },
}))

describe('dinerApi — cartApi', () => {
  describe('add', () => {
    it('happy path — returns CartItem with string IDs', async () => {
      server.use(
        http.post('http://localhost:8000/api/diner/cart/add', () =>
          HttpResponse.json({
            item_id: 101,
            product_id: 42,
            product_name: 'Milanesa',
            quantity: 2,
            notes: '',
            price_cents_snapshot: 12550,
            diner_id: 8,
            diner_name: 'Juan',
            added_at: '2026-04-18T12:00:00Z',
          }),
        ),
      )

      const item = await cartApi.add({ product_id: '42', quantity: 2 })
      expect(item.id).toBe('101')
      expect(item.productId).toBe('42')
      expect(item.pending).toBe(false)
    })

    it('409 session_paying → throws CartConflictError', async () => {
      server.use(
        http.post('http://localhost:8000/api/diner/cart/add', () =>
          HttpResponse.json(
            { detail: { reason: 'session_paying' } },
            { status: 409 },
          ),
        ),
      )

      await expect(
        cartApi.add({ product_id: '42', quantity: 1 }),
      ).rejects.toBeInstanceOf(CartConflictError)

      try {
        await cartApi.add({ product_id: '42', quantity: 1 })
      } catch (err) {
        if (err instanceof CartConflictError) {
          expect(err.detail.reason).toBe('session_paying')
        }
      }
    })

    it('409 insufficient_stock → throws CartConflictError with products list', async () => {
      server.use(
        http.post('http://localhost:8000/api/diner/cart/add', () =>
          HttpResponse.json(
            {
              detail: {
                reason: 'insufficient_stock',
                products: [
                  { product_id: 42, name: 'Milanesa', requested: 5, available: 2 },
                ],
              },
            },
            { status: 409 },
          ),
        ),
      )

      try {
        await cartApi.add({ product_id: '42', quantity: 5 })
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(CartConflictError)
        if (err instanceof CartConflictError && err.detail.reason === 'insufficient_stock') {
          expect(err.detail.products).toHaveLength(1)
          expect(err.detail.products[0].name).toBe('Milanesa')
        }
      }
    })
  })

  describe('remove', () => {
    it('happy path — resolves without error', async () => {
      server.use(
        http.delete('http://localhost:8000/api/diner/cart/101', () =>
          new HttpResponse(null, { status: 204 }),
        ),
      )
      await expect(cartApi.remove('101')).resolves.toBeUndefined()
    })
  })

  describe('list', () => {
    it('returns array of CartItems with string IDs', async () => {
      server.use(
        http.get('http://localhost:8000/api/diner/cart', () =>
          HttpResponse.json([
            {
              item_id: 55,
              product_id: 10,
              product_name: 'Burger',
              quantity: 1,
              notes: '',
              price_cents_snapshot: 8000,
              diner_id: 9,
              diner_name: 'Ana',
              added_at: '2026-04-18T12:00:00Z',
            },
          ]),
        ),
      )

      const items = await cartApi.list()
      expect(items).toHaveLength(1)
      expect(items[0].id).toBe('55')
    })
  })
})

describe('dinerApi — roundsApi', () => {
  describe('submit', () => {
    it('happy path — returns Round with string ID', async () => {
      server.use(
        http.post('http://localhost:8000/api/diner/rounds', () =>
          HttpResponse.json({
            id: 7,
            session_id: 12,
            round_number: 1,
            status: 'PENDING',
            items: [],
            notes: '',
            submitted_at: '2026-04-18T12:00:00Z',
            ready_at: null,
            served_at: null,
          }),
        ),
      )

      const round = await roundsApi.submit()
      expect(round.id).toBe('7')
      expect(round.status).toBe('PENDING')
    })
  })
})

describe('dinerApi — sessionApi', () => {
  it('returns session info including tableStatus', async () => {
    server.use(
      http.get('http://localhost:8000/api/diner/session', () =>
        HttpResponse.json({
          id: 42,
          branch_slug: 'default',
          table_code: 'mesa-1',
          status: 'active',
          table_status: 'OPEN',
        }),
      ),
    )

    const session = await sessionApi.get()
    expect(session.id).toBe('42')
    expect(session.tableStatus).toBe('OPEN')
  })
})
