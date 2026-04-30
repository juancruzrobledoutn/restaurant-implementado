/**
 * tableState.ts tests — animation priority matrix and deriveVisualState.
 *
 * Coverage (task 11.4):
 * - No animation (available, no calls, no rounds)
 * - red-blink: open service call (highest priority)
 * - yellow-pulse: pending round
 * - orange-blink: ready round
 * - violet-pulse: PAYING table
 * - blue-blink: recent change (via deriveWithRecentChange helper)
 * - Priority: red > yellow > orange > violet > blue
 */
import { describe, expect, it } from 'vitest'
import { deriveVisualState, deriveWithRecentChange } from '@/lib/tableState'
import type { Table } from '@/stores/tableStore'
import type { Round } from '@/stores/roundsStore'
import type { ServiceCallDTO } from '@/services/waiter'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTable(overrides: Partial<Table> = {}): Table {
  return {
    id: 't-1',
    code: 'INT-01',
    status: 'OCCUPIED',
    sectorId: 's-5',
    sectorName: 'Salón',
    sessionId: 'sess-1',
    sessionStatus: 'OPEN',
    ...overrides,
  }
}

function makeRound(status: Round['status']): Round {
  return {
    id: 'r-1',
    sessionId: 'sess-1',
    status,
    items: [{ id: 'i-1', productId: 'p-100', quantity: 2 }],
    createdAt: '2026-04-18T10:00:00Z',
  }
}

function makeCall(overrides: Partial<ServiceCallDTO> = {}): ServiceCallDTO {
  return {
    id: 'c-1',
    tableId: 't-1',
    sectorId: 's-5',
    status: 'OPEN',
    createdAt: '2026-04-18T10:00:00Z',
    ackedAt: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('deriveVisualState', () => {
  it('returns animation=none when table is available with no calls or rounds', () => {
    const table = makeTable({ status: 'AVAILABLE', sessionId: null, sessionStatus: null })
    const result = deriveVisualState(table, [], [])
    expect(result.animation).toBe('none')
    expect(result.openServiceCallCount).toBe(0)
    expect(result.pendingRoundCount).toBe(0)
    expect(result.readyRoundCount).toBe(0)
  })

  it('returns red-blink when there is an open service call', () => {
    const table = makeTable()
    const call = makeCall()
    const result = deriveVisualState(table, [], [call])
    expect(result.animation).toBe('red-blink')
    expect(result.openServiceCallCount).toBe(1)
  })

  it('returns yellow-pulse when there is a PENDING round and no service calls', () => {
    const table = makeTable()
    const round = makeRound('PENDING')
    const result = deriveVisualState(table, [round], [])
    expect(result.animation).toBe('yellow-pulse')
    expect(result.pendingRoundCount).toBe(1)
  })

  it('returns orange-blink when there is a READY round and no higher-priority state', () => {
    const table = makeTable()
    const round = makeRound('READY')
    const result = deriveVisualState(table, [round], [])
    expect(result.animation).toBe('orange-blink')
    expect(result.readyRoundCount).toBe(1)
  })

  it('returns violet-pulse for PAYING table with no rounds or calls', () => {
    const table = makeTable({ status: 'PAYING', sessionStatus: 'PAYING' })
    const result = deriveVisualState(table, [], [])
    expect(result.animation).toBe('violet-pulse')
  })

  // Priority tests
  it('red-blink overrides yellow-pulse (service call + pending round)', () => {
    const table = makeTable()
    const call = makeCall()
    const round = makeRound('PENDING')
    const result = deriveVisualState(table, [round], [call])
    expect(result.animation).toBe('red-blink')
  })

  it('red-blink overrides orange-blink (service call + ready round)', () => {
    const table = makeTable()
    const call = makeCall()
    const round = makeRound('READY')
    const result = deriveVisualState(table, [round], [call])
    expect(result.animation).toBe('red-blink')
  })

  it('red-blink overrides violet-pulse (service call + PAYING)', () => {
    const table = makeTable({ status: 'PAYING' })
    const call = makeCall()
    const result = deriveVisualState(table, [], [call])
    expect(result.animation).toBe('red-blink')
  })

  it('yellow-pulse overrides orange-blink (pending + ready rounds)', () => {
    const table = makeTable()
    const pendingRound = makeRound('PENDING')
    const readyRound = { ...makeRound('READY'), id: 'r-2' }
    const result = deriveVisualState(table, [pendingRound, readyRound], [])
    expect(result.animation).toBe('yellow-pulse')
    expect(result.pendingRoundCount).toBe(1)
    expect(result.readyRoundCount).toBe(1)
  })

  it('orange-blink overrides violet-pulse (ready round + PAYING table)', () => {
    const table = makeTable({ status: 'PAYING' })
    const round = makeRound('READY')
    const result = deriveVisualState(table, [round], [])
    expect(result.animation).toBe('orange-blink')
  })

  it('ignores CLOSED service calls in animation calculation', () => {
    const table = makeTable()
    const closedCall = makeCall({ status: 'CLOSED' })
    const result = deriveVisualState(table, [], [closedCall])
    expect(result.animation).toBe('none')
    expect(result.openServiceCallCount).toBe(0)
  })

  it('ignores service calls for other tables', () => {
    const table = makeTable()
    const otherCall = makeCall({ tableId: 't-99' })
    const result = deriveVisualState(table, [], [otherCall])
    expect(result.animation).toBe('none')
  })

  it('counts multiple pending rounds correctly', () => {
    const table = makeTable()
    const r1 = makeRound('PENDING')
    const r2 = { ...makeRound('PENDING'), id: 'r-2' }
    const result = deriveVisualState(table, [r1, r2], [])
    expect(result.pendingRoundCount).toBe(2)
  })

  it('returns tableId, displayStatus and label in result', () => {
    const table = makeTable({ status: 'AVAILABLE', sessionId: null, sessionStatus: null })
    const result = deriveVisualState(table, [], [])
    expect(result.tableId).toBe('t-1')
    expect(result.displayStatus).toBe('AVAILABLE')
    expect(result.label).toContain('Mesa INT-01')
    expect(result.label).toContain('Disponible')
  })
})

describe('deriveWithRecentChange', () => {
  it('returns blue-blink when within threshold and base animation is none', () => {
    const table = makeTable({ status: 'AVAILABLE', sessionId: null, sessionStatus: null })
    const now = Date.now()
    const lastChangedAt = now - 1000 // 1 second ago (within 3s threshold)
    const result = deriveWithRecentChange(table, [], [], lastChangedAt, now)
    expect(result.animation).toBe('blue-blink')
  })

  it('does NOT override red-blink with blue-blink even within threshold', () => {
    const table = makeTable()
    const call = makeCall()
    const now = Date.now()
    const lastChangedAt = now - 500
    const result = deriveWithRecentChange(table, [], [call], lastChangedAt, now)
    expect(result.animation).toBe('red-blink')
  })

  it('returns none (not blue-blink) when outside threshold', () => {
    const table = makeTable({ status: 'AVAILABLE', sessionId: null, sessionStatus: null })
    const now = Date.now()
    const lastChangedAt = now - 5000 // 5 seconds ago (> 3s threshold)
    const result = deriveWithRecentChange(table, [], [], lastChangedAt, now)
    expect(result.animation).toBe('none')
  })
})
