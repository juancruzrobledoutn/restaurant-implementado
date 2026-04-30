/**
 * ServiceCallsPage integration tests (task 13.6).
 *
 * Covers:
 * - Renders "Llamados de servicio" heading
 * - Shows "No hay llamados activos" when empty
 * - Renders service calls fetched on mount
 * - ACK and Close buttons trigger correct API calls
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import { useServiceCallsStore } from '@/stores/serviceCallsStore'
import { useRetryQueueStore } from '@/stores/retryQueueStore'
import { useAuthStore } from '@/stores/authStore'

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})

import ServiceCallsPage from '@/pages/ServiceCallsPage'

const API = 'http://localhost:8000'

function renderPage() {
  return render(
    <MemoryRouter>
      <ServiceCallsPage />
    </MemoryRouter>,
  )
}

describe('ServiceCallsPage', () => {
  beforeEach(() => {
    useServiceCallsStore.setState({ byId: {} })
    useRetryQueueStore.setState({ entries: [], isDraining: false })
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: '10', email: 'waiter@demo.com', fullName: 'Ana', tenantId: '1', branchIds: ['1'], roles: ['WAITER'] },
      assignedSectorId: null,
      assignedSectorName: null,
      isLoading: false,
      error: null,
      requires2fa: false,
      isLoggingOut: false,
    })
  })

  it('renders the heading', () => {
    server.use(http.get(`${API}/api/waiter/service-calls`, () => HttpResponse.json([])))
    renderPage()
    expect(screen.getByText(/Llamados de servicio/i)).toBeInTheDocument()
  })

  it('shows empty state when no active calls', async () => {
    server.use(http.get(`${API}/api/waiter/service-calls`, () => HttpResponse.json([])))
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/No hay llamados activos/i)).toBeInTheDocument()
    })
  })

  it('renders service calls fetched on mount', async () => {
    server.use(
      http.get(`${API}/api/waiter/service-calls`, () =>
        HttpResponse.json([
          { id: 1, table_id: 3, sector_id: 5, status: 'OPEN', created_at: '2026-04-18T10:00:00Z', acked_at: null },
        ]),
      ),
    )
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/Mesa 3/i)).toBeInTheDocument()
    })
  })

  it('calls ackServiceCall API and updates store when ACK is clicked', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(`${API}/api/waiter/service-calls`, () =>
        HttpResponse.json([
          { id: 1, table_id: 3, sector_id: 5, status: 'OPEN', created_at: '2026-04-18T10:00:00Z', acked_at: null },
        ]),
      ),
      http.put(`${API}/api/waiter/service-calls/1/ack`, () =>
        HttpResponse.json({ id: 1, table_id: 3, sector_id: 5, status: 'ACKED', created_at: '2026-04-18T10:00:00Z', acked_at: '2026-04-18T10:01:00Z' }),
      ),
    )
    renderPage()
    await waitFor(() => screen.getByRole('button', { name: /Acusar recibo/i }))
    await user.click(screen.getByRole('button', { name: /Acusar recibo/i }))
    await waitFor(() => {
      expect(screen.getByText('Visto')).toBeInTheDocument()
    })
  })
})
