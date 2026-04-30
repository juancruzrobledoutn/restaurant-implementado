/**
 * Default MSW handlers for pwaWaiter tests.
 *
 * Individual tests can override specific handlers via `server.use(...)`.
 */
import { http, HttpResponse } from 'msw'

const API_URL = 'http://localhost:8000'

export const handlers = [
  // GET /api/public/branches — two active branches
  http.get(`${API_URL}/api/public/branches`, () => {
    return HttpResponse.json([
      {
        id: 1,
        name: 'Buen Sabor Centro',
        slug: 'centro',
        address: 'Av. Corrientes 1234',
      },
      {
        id: 2,
        name: 'Buen Sabor Palermo',
        slug: 'palermo',
        address: 'Santa Fe 3456',
      },
    ])
  }),

  // POST /api/auth/login — happy path
  http.post(`${API_URL}/api/auth/login`, async ({ request }) => {
    const body = (await request.json()) as {
      email?: string
      password?: string
    }
    if (body.email === 'waiter@demo.com' && body.password === 'waiter123') {
      return HttpResponse.json({
        access_token: 'fake-access-token',
        token_type: 'bearer',
        user: {
          id: 10,
          email: 'waiter@demo.com',
          full_name: 'Ana Mozo',
          tenant_id: 1,
          branch_ids: [1],
          roles: ['WAITER'],
        },
      })
    }
    return HttpResponse.json({ detail: 'Invalid credentials' }, { status: 401 })
  }),

  // POST /api/auth/refresh — returns a new token
  http.post(`${API_URL}/api/auth/refresh`, () => {
    return HttpResponse.json({
      access_token: 'fake-refreshed-token',
      token_type: 'bearer',
    })
  }),

  // POST /api/auth/logout — 204 No Content
  http.post(`${API_URL}/api/auth/logout`, () => {
    return new HttpResponse(null, { status: 204 })
  }),

  // GET /api/waiter/verify-branch-assignment
  http.get(`${API_URL}/api/waiter/verify-branch-assignment`, ({ request }) => {
    const url = new URL(request.url)
    const branchId = url.searchParams.get('branch_id')
    if (branchId === '1') {
      return HttpResponse.json({
        assigned: true,
        sector_id: 5,
        sector_name: 'Salón principal',
      })
    }
    return HttpResponse.json({ assigned: false })
  }),

  // POST /api/waiter/notifications/subscribe — 201 Created
  http.post(`${API_URL}/api/waiter/notifications/subscribe`, () => {
    return HttpResponse.json(
      { id: 1, endpoint: 'https://push.example/abc', is_active: true },
      { status: 201 },
    )
  }),

  // DELETE /api/waiter/notifications/subscribe — 204 No Content
  http.delete(`${API_URL}/api/waiter/notifications/subscribe`, () => {
    return new HttpResponse(null, { status: 204 })
  }),
]
