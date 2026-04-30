/**
 * MSW request handlers for tests.
 * Includes default handlers for menu, session, cart, and rounds endpoints.
 */
import { http, HttpResponse } from 'msw'

export const handlers = [
  http.get('http://localhost:8000/api/public/menu/:slug', () => {
    return HttpResponse.json([
      {
        id: 1,
        name: 'Entradas',
        subcategories: [
          {
            id: 10,
            name: 'Frías',
            products: [
              {
                id: 100,
                name: 'Ensalada César',
                description: 'Lechuga romana, crutones, parmesano',
                price_cents: 125050,
                image_url: null,
                is_available: true,
                allergens: [{ id: 1, code: 'MILK', name: 'Leche' }],
              },
            ],
          },
        ],
      },
    ])
  }),

  http.get('http://localhost:8000/api/diner/session', () => {
    return HttpResponse.json({
      session: { id: 42, status: 'OPEN' },
      table: { code: 'mesa-1', status: 'OPEN', capacity: 4 },
      branch_slug: 'default',
      diners: [],
      my_cart_items: [],
    })
  }),

  http.get('http://localhost:8000/api/diner/cart', () => {
    return HttpResponse.json([])
  }),

  http.post('http://localhost:8000/api/diner/cart/add', () => {
    return HttpResponse.json({
      item_id: 101,
      product_id: 42,
      product_name: 'Ensalada César',
      quantity: 1,
      notes: '',
      price_cents_snapshot: 125050,
      diner_id: 8,
      diner_name: 'Test User',
      added_at: new Date().toISOString(),
    })
  }),

  http.patch('http://localhost:8000/api/diner/cart/:itemId', () => {
    return HttpResponse.json({
      item_id: 101,
      product_id: 42,
      product_name: 'Ensalada César',
      quantity: 2,
      notes: '',
      price_cents_snapshot: 125050,
      diner_id: 8,
      diner_name: 'Test User',
      added_at: new Date().toISOString(),
    })
  }),

  http.delete('http://localhost:8000/api/diner/cart/:itemId', () => {
    return new HttpResponse(null, { status: 204 })
  }),

  http.get('http://localhost:8000/api/diner/rounds', () => {
    return HttpResponse.json([])
  }),

  http.post('http://localhost:8000/api/diner/rounds', () => {
    return HttpResponse.json({
      id: 1,
      session_id: 42,
      round_number: 1,
      status: 'PENDING',
      items: [],
      notes: '',
      submitted_at: new Date().toISOString(),
      ready_at: null,
      served_at: null,
    })
  }),

  http.get('http://localhost:8000/ws/catchup/session', () => {
    return HttpResponse.json({ status: 'ok', events: [] })
  }),
]
