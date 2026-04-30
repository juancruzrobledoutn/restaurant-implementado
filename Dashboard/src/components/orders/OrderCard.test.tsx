/**
 * OrderCard component tests (C-25).
 *
 * Skill: test-driven-development, dashboard-crud-page
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OrderCard } from './OrderCard'
import type { Round } from '@/types/operations'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRound(overrides: Partial<Round> = {}): Round {
  return {
    id: '1',
    round_number: 3,
    session_id: 's1',
    branch_id: '10',
    status: 'PENDING',
    table_id: 't1',
    table_code: 'A05',
    table_number: 5,
    sector_id: 'sec1',
    sector_name: 'Terraza',
    diner_id: null,
    diner_name: null,
    items_count: 4,
    total_cents: 120050,
    pending_at: new Date(Date.now() - 10 * 60_000).toISOString(), // 10m ago
    confirmed_at: null,
    submitted_at: null,
    in_kitchen_at: null,
    ready_at: null,
    served_at: null,
    canceled_at: null,
    cancel_reason: null,
    created_by_role: 'WAITER',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrderCard', () => {
  it('renders table code', () => {
    render(<OrderCard round={makeRound()} onOpenDetail={vi.fn()} />)
    expect(screen.getByText('Mesa A05')).toBeInTheDocument()
  })

  it('renders sector name when present', () => {
    render(<OrderCard round={makeRound({ sector_name: 'Terraza' })} onOpenDetail={vi.fn()} />)
    expect(screen.getByText('Terraza')).toBeInTheDocument()
  })

  it('does not render sector when null', () => {
    render(<OrderCard round={makeRound({ sector_name: null })} onOpenDetail={vi.fn()} />)
    expect(screen.queryByText('Terraza')).not.toBeInTheDocument()
  })

  it('renders diner name when present', () => {
    render(<OrderCard round={makeRound({ diner_name: 'Juan Perez' })} onOpenDetail={vi.fn()} />)
    expect(screen.getByText(/Juan Perez/)).toBeInTheDocument()
  })

  it('renders items count', () => {
    render(<OrderCard round={makeRound({ items_count: 4 })} onOpenDetail={vi.fn()} />)
    expect(screen.getByText(/4 items/)).toBeInTheDocument()
  })

  it('shows singular "item" when count is 1', () => {
    render(<OrderCard round={makeRound({ items_count: 1 })} onOpenDetail={vi.fn()} />)
    expect(screen.getByText(/1 item/)).toBeInTheDocument()
  })

  it('shows elapsed time when pending_at is set', () => {
    const pending_at = new Date(Date.now() - 5 * 60_000).toISOString()
    render(<OrderCard round={makeRound({ pending_at, status: 'PENDING' })} onOpenDetail={vi.fn()} />)
    // Should show something like "5m"
    expect(screen.getByText(/\dm/)).toBeInTheDocument()
  })

  it('renders a status Badge', () => {
    render(<OrderCard round={makeRound({ status: 'READY' })} onOpenDetail={vi.fn()} />)
    expect(screen.getByText('Lista')).toBeInTheDocument()
  })

  it('calls onOpenDetail with round id on click', async () => {
    const onOpenDetail = vi.fn()
    render(<OrderCard round={makeRound({ id: '42' })} onOpenDetail={onOpenDetail} />)
    await userEvent.click(screen.getByRole('button'))
    expect(onOpenDetail).toHaveBeenCalledWith('42')
  })

  it('has aria-label with round number and table code', () => {
    render(<OrderCard round={makeRound({ round_number: 7, table_code: 'B02' })} onOpenDetail={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Ronda #7 mesa B02/i })).toBeInTheDocument()
  })
})
