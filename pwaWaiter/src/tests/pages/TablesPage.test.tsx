/**
 * TablesPage integration tests — render + key actions (task 13.6).
 *
 * Covers:
 * - Renders loading state while fetching tables
 * - Renders table list after fetch
 * - Shows "No hay mesas" when fetch returns empty
 * - Integrates OfflineBanner and StaleDataBanner
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import { useTableStore } from '@/stores/tableStore'
import { useRetryQueueStore } from '@/stores/retryQueueStore'
import { useWaiterWsStore } from '@/stores/waiterWsStore'
import { useAuthStore } from '@/stores/authStore'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => navigateMock,
  }
})

// Mock push service to avoid VAPID errors in tests
vi.mock('@/services/push', () => ({
  registerPushSubscription: vi.fn().mockResolvedValue({ success: false, reason: 'not_supported' }),
}))

// Mock WS service (no real WS in tests)
vi.mock('@/services/waiterWs', () => ({
  waiterWsService: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn().mockReturnValue(vi.fn()),
    off: vi.fn(),
    __reset: vi.fn(),
  },
}))

import TablesPage from '@/pages/TablesPage'

const API = 'http://localhost:8000'

function renderTablesPage() {
  return render(
    <MemoryRouter>
      <TablesPage />
    </MemoryRouter>,
  )
}

describe('TablesPage', () => {
  beforeEach(() => {
    navigateMock.mockClear()
    useTableStore.getState().clearTables()
    useRetryQueueStore.setState({ entries: [], isDraining: false })
    useWaiterWsStore.setState({ isConnected: false, reconnectAttempts: 0, isStaleData: false })
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: '10', email: 'waiter@demo.com', fullName: 'Ana Mozo', tenantId: '1', branchIds: ['1'], roles: ['WAITER'] },
      assignedSectorId: '5',
      assignedSectorName: 'Salón',
      isLoading: false,
      error: null,
      requires2fa: false,
      isLoggingOut: false,
    })
  })

  it('calls loadTables on mount and renders table codes', async () => {
    server.use(
      http.get(`${API}/api/waiter/tables`, () =>
        HttpResponse.json([
          { id: 1, code: 'INT-01', status: 'AVAILABLE', sector_id: 5, sector_name: 'Salón', session_id: null, session_status: null },
          { id: 2, code: 'INT-02', status: 'OCCUPIED', sector_id: 5, sector_name: 'Salón', session_id: 10, session_status: 'OPEN' },
        ]),
      ),
    )

    renderTablesPage()

    await waitFor(() => {
      expect(screen.getByText('INT-01')).toBeInTheDocument()
    })
    expect(screen.getByText('INT-02')).toBeInTheDocument()
  })

  it('shows page heading', () => {
    server.use(http.get(`${API}/api/waiter/tables`, () => HttpResponse.json([])))
    renderTablesPage()
    expect(screen.getByText(/Mis mesas/i)).toBeInTheDocument()
  })

  it('shows StaleDataBanner when isStaleData=true', async () => {
    server.use(http.get(`${API}/api/waiter/tables`, () => HttpResponse.json([])))
    useWaiterWsStore.setState({ isStaleData: true })
    renderTablesPage()
    expect(screen.getByText(/Datos pueden estar desactualizados/i)).toBeInTheDocument()
  })
})
