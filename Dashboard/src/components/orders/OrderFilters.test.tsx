/**
 * OrderFilters component tests (C-25).
 *
 * Skill: test-driven-development, dashboard-crud-page
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OrderFilters } from './OrderFilters'
import type { RoundFilters } from '@/types/operations'

// ---------------------------------------------------------------------------
// Mock sectorStore
// ---------------------------------------------------------------------------

type SectorStoreState = { items: { id: string; name: string; branch_id: string; is_active: boolean }[] }

vi.mock('@/stores/sectorStore', () => ({
  useSectorStore: (selector: (s: SectorStoreState) => unknown) =>
    selector({
      items: [
        { id: 'sec1', name: 'Terraza', branch_id: '10', is_active: true },
        { id: 'sec2', name: 'Interior', branch_id: '10', is_active: true },
      ],
    }),
  selectSectors: (s: SectorStoreState) => s.items,
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultFilters: RoundFilters = {
  branch_id: '10',
  date: '2026-01-15',
  limit: 50,
  offset: 0,
}

type FilterProps = {
  filters: RoundFilters
  onFilterChange: <K extends keyof RoundFilters>(key: K, value: RoundFilters[K] | undefined) => void
  onClear: () => void
  onRefresh: () => void
  isLoading: boolean
}

function renderFilters(overrides: Partial<FilterProps> = {}) {
  const props: FilterProps = {
    filters: defaultFilters,
    onFilterChange: vi.fn() as FilterProps['onFilterChange'],
    onClear: vi.fn(),
    onRefresh: vi.fn(),
    isLoading: false,
    ...overrides,
  }
  return { ...render(<OrderFilters {...props} />), ...props }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrderFilters', () => {
  // Real timers for most tests — no internal setTimeout in Button/Select
  const user = () => userEvent.setup()

  it('renders date input with current filter value', () => {
    renderFilters()
    const dateInput = screen.getByLabelText(/filtrar por fecha/i) as HTMLInputElement
    expect(dateInput.value).toBe('2026-01-15')
  })

  it('renders sector select with options from store', () => {
    renderFilters()
    expect(screen.getByText('Terraza')).toBeInTheDocument()
    expect(screen.getByText('Interior')).toBeInTheDocument()
    expect(screen.getByText('Todos los sectores')).toBeInTheDocument()
  })

  it('renders all 7 status options + "Todos"', () => {
    renderFilters()
    expect(screen.getByText('Todos los estados')).toBeInTheDocument()
    expect(screen.getByText('Pendiente')).toBeInTheDocument()
    expect(screen.getByText('En cocina')).toBeInTheDocument()
    expect(screen.getByText('Cancelada')).toBeInTheDocument()
  })

  it('calls onFilterChange with new date on date input change', () => {
    const { onFilterChange } = renderFilters()
    const dateInput = screen.getByLabelText(/filtrar por fecha/i)
    fireEvent.change(dateInput, { target: { value: '2026-02-01' } })
    expect(onFilterChange).toHaveBeenCalledWith('date', '2026-02-01')
  })

  it('calls onFilterChange with sector_id on sector change', async () => {
    const { onFilterChange } = renderFilters()
    const sectorSelect = screen.getByLabelText(/filtrar por sector/i)
    await user().selectOptions(sectorSelect, 'sec1')
    expect(onFilterChange).toHaveBeenCalledWith('sector_id', 'sec1')
  })

  it('calls onFilterChange with status on status change', async () => {
    const { onFilterChange } = renderFilters()
    const statusSelect = screen.getByLabelText(/filtrar por estado/i)
    await user().selectOptions(statusSelect, 'READY')
    expect(onFilterChange).toHaveBeenCalledWith('status', 'READY')
  })

  // Debounce test: use fireEvent.change + fake timers to avoid userEvent pointer-event hang
  it('debounces table_code input — does not call immediately', () => {
    vi.useFakeTimers()
    try {
      const { onFilterChange } = renderFilters()
      const tableInput = screen.getByLabelText(/buscar por código de mesa/i)
      fireEvent.change(tableInput, { target: { value: 'A' } })
      // Should NOT have called yet (debounced)
      expect(onFilterChange).not.toHaveBeenCalledWith('table_code', expect.anything())
      // Advance past debounce threshold
      act(() => { vi.advanceTimersByTime(300) })
      expect(onFilterChange).toHaveBeenCalledWith('table_code', 'A')
    } finally {
      vi.useRealTimers()
    }
  })

  it('calls onClear when Limpiar button is clicked', () => {
    const { onClear } = renderFilters()
    fireEvent.click(screen.getByRole('button', { name: /limpiar filtros/i }))
    expect(onClear).toHaveBeenCalled()
  })

  it('calls onRefresh when refresh button is clicked', () => {
    const { onRefresh } = renderFilters()
    fireEvent.click(screen.getByRole('button', { name: /refrescar/i }))
    expect(onRefresh).toHaveBeenCalled()
  })

  it('has role="search" container', () => {
    renderFilters()
    expect(screen.getByRole('search')).toBeInTheDocument()
  })
})
