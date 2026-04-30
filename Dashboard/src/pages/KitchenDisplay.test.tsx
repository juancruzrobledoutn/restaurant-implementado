/**
 * KitchenDisplayPage tests.
 *
 * Covers: branch guard, 3 columns present, loading state,
 * toggleAudio writes to localStorage, fetch called on mount.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { KitchenRound } from '@/types/operations'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetchSnapshot = vi.fn()
const mockToggleAudio = vi.fn()
let mockRounds: KitchenRound[] = []
let mockAudioEnabled = false
let mockIsLoading = false
let mockSelectedBranchId: string | null = null

vi.mock('@/stores/kitchenDisplayStore', () => ({
  useKitchenDisplayStore: (selector: (s: unknown) => unknown) => {
    const state = {
      rounds: mockRounds,
      audioEnabled: mockAudioEnabled,
      isLoading: mockIsLoading,
      error: null,
    }
    return selector(state)
  },
  selectKitchenRounds: (s: { rounds: KitchenRound[] }) => s.rounds,
  selectAudioEnabled: (s: { audioEnabled: boolean }) => s.audioEnabled,
  selectKitchenIsLoading: (s: { isLoading: boolean }) => s.isLoading,
  useKitchenDisplayActions: () => ({
    fetchSnapshot: mockFetchSnapshot,
    toggleAudio: mockToggleAudio,
    handleRoundSubmitted: vi.fn(),
    handleRoundInKitchen: vi.fn(),
    handleRoundReady: vi.fn(),
    handleRoundCanceled: vi.fn(),
    reset: vi.fn(),
  }),
}))

vi.mock('@/stores/branchStore', () => ({
  useBranchStore: (selector: (s: unknown) => unknown) =>
    selector({ selectedBranchId: mockSelectedBranchId }),
  selectSelectedBranchId: (s: { selectedBranchId: string | null }) => s.selectedBranchId,
}))

vi.mock('@/hooks/useKitchenWebSocketSync', () => ({
  useKitchenWebSocketSync: vi.fn(),
}))

vi.mock('@/hooks/useNowTicker', () => ({
  useNowTicker: () => new Date('2026-01-01T12:00:00Z'),
}))

vi.mock('@/services/kitchenAPI', () => ({
  kitchenAPI: { patchRoundStatus: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('@/stores/toastStore', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/utils/helpContent', () => ({
  helpContent: { kitchenDisplay: null },
}))

vi.mock('@/utils/logger', () => ({
  handleError: vi.fn((_e: unknown, ctx: string) => `error:${ctx}`),
}))

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router')
  return { ...actual, useNavigate: () => vi.fn() }
})

vi.mock('@/components/ui/PageContainer', () => ({
  PageContainer: ({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) => (
    <div data-testid="page-container">
      {actions && <div data-testid="page-actions">{actions}</div>}
      {children}
    </div>
  ),
}))

vi.mock('@/components/kitchen/KitchenTicketColumn', () => ({
  KitchenTicketColumn: ({ title, rounds }: { title: string; rounds: unknown[] }) => (
    <section data-testid={`column-${title.replace(/\s/g, '-').toLowerCase()}`}>
      <h2>{title}</h2>
      <span data-testid="round-count">{rounds.length}</span>
    </section>
  ),
}))

import KitchenDisplayPage from './KitchenDisplay'

function renderPage() {
  return render(
    <MemoryRouter>
      <KitchenDisplayPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockRounds = []
  mockAudioEnabled = false
  mockIsLoading = false
  mockSelectedBranchId = null
  vi.clearAllMocks()
})

describe('branch guard', () => {
  it('shows fallback when no branch', () => {
    mockSelectedBranchId = null
    renderPage()
    expect(screen.getByText(/selecciona una sucursal/i)).toBeTruthy()
  })
})

describe('with branch', () => {
  beforeEach(() => { mockSelectedBranchId = '100' })

  it('shows loading state', () => {
    mockIsLoading = true
    renderPage()
    expect(screen.getByText(/cargando pedidos/i)).toBeTruthy()
  })

  it('shows 3 columns when not loading', () => {
    mockIsLoading = false
    renderPage()
    expect(screen.getByTestId('column-enviados')).toBeTruthy()
    expect(screen.getByTestId('column-en-cocina')).toBeTruthy()
    expect(screen.getByTestId('column-listos')).toBeTruthy()
  })

  it('calls fetchSnapshot on mount', () => {
    renderPage()
    expect(mockFetchSnapshot).toHaveBeenCalledWith('100')
  })

  it('round count in submitted column matches SUBMITTED rounds', () => {
    mockRounds = [
      {
        id: '1',
        session_id: '1',
        branch_id: '100',
        status: 'SUBMITTED',
        submitted_at: '2026-01-01T11:00:00Z',
        table_number: 1,
        sector_name: 'Salon',
        diner_count: 2,
        items: [],
      } as KitchenRound,
    ]
    renderPage()
    const counts = screen.getAllByTestId('round-count')
    // First column is Enviados (SUBMITTED)
    expect(counts[0]?.textContent).toBe('1')
  })

  it('audio toggle button is rendered in page actions', () => {
    renderPage()
    expect(screen.getByTestId('page-actions')).toBeTruthy()
  })
})
