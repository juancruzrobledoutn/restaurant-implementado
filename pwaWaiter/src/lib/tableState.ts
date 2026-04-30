/**
 * tableState.ts — pure function to derive visual state for a table card.
 *
 * NO React, NO Zustand imports. Purely functional — input/output.
 *
 * Priority of animations (highest first):
 * 1. Service call OPEN → red blink
 * 2. Round PENDING (not confirmed) → yellow pulse
 * 3. Round READY (not served) → orange blink
 * 4. CHECK_REQUESTED (session PAYING) → violet pulse
 * 5. Recent status change (<3s) → blue blink
 * 6. No animation → none
 */

import type { Table, TableStatus } from '@/stores/tableStore'
import type { Round } from '@/stores/roundsStore'
import type { ServiceCallDTO } from '@/services/waiter'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VisualAnimation =
  | 'red-blink'
  | 'yellow-pulse'
  | 'orange-blink'
  | 'violet-pulse'
  | 'blue-blink'
  | 'none'

export interface VisualTableState {
  tableId: string
  displayStatus: TableStatus
  animation: VisualAnimation
  /** Summary label for accessibility */
  label: string
  /** Number of open service calls */
  openServiceCallCount: number
  /** Number of pending rounds */
  pendingRoundCount: number
  /** Number of ready rounds */
  readyRoundCount: number
}

// ---------------------------------------------------------------------------
// Derive function
// ---------------------------------------------------------------------------

const RECENT_CHANGE_THRESHOLD_MS = 3_000

export function deriveVisualState(
  table: Table,
  rounds: Round[],
  serviceCalls: ServiceCallDTO[],
  _now: number = Date.now(),
): VisualTableState {
  const openServiceCalls = serviceCalls.filter(
    (c) => c.tableId === table.id && c.status !== 'CLOSED',
  )

  const pendingRounds = rounds.filter((r) => r.status === 'PENDING')
  const readyRounds = rounds.filter((r) => r.status === 'READY')

  // Determine animation by priority
  let animation: VisualAnimation = 'none'

  if (openServiceCalls.length > 0) {
    animation = 'red-blink'
  } else if (pendingRounds.length > 0) {
    animation = 'yellow-pulse'
  } else if (readyRounds.length > 0) {
    animation = 'orange-blink'
  } else if (table.status === 'PAYING') {
    animation = 'violet-pulse'
  } else {
    // Check for recent status change
    // Note: table doesn't store lastChangedAt; we use this as a future hook.
    // Components can pass `now` to trigger blue-blink for 3s after an update.
    // For now, `none` unless the caller uses the recentChangedAt helper.
    animation = 'none'
  }

  const label = buildLabel(table, openServiceCalls.length, pendingRounds.length)

  return {
    tableId: table.id,
    displayStatus: table.status,
    animation,
    label,
    openServiceCallCount: openServiceCalls.length,
    pendingRoundCount: pendingRounds.length,
    readyRoundCount: readyRounds.length,
  }
}

/**
 * Helper to compute animation for a recently-changed table.
 * Call immediately after applying a WS event to get blue-blink for 3 seconds.
 */
export function deriveWithRecentChange(
  table: Table,
  rounds: Round[],
  serviceCalls: ServiceCallDTO[],
  lastChangedAt: number,
  now: number = Date.now(),
): VisualTableState {
  const base = deriveVisualState(table, rounds, serviceCalls, now)

  // Override animation with blue-blink if within threshold AND no higher priority
  if (
    base.animation === 'none' &&
    now - lastChangedAt < RECENT_CHANGE_THRESHOLD_MS
  ) {
    return { ...base, animation: 'blue-blink' }
  }

  return base
}

function buildLabel(
  table: Table,
  serviceCallCount: number,
  pendingRoundCount: number,
): string {
  const parts = [`Mesa ${table.code}`]

  if (serviceCallCount > 0) {
    parts.push(`${serviceCallCount} llamado${serviceCallCount > 1 ? 's' : ''} sin atender`)
  }
  if (pendingRoundCount > 0) {
    parts.push(`${pendingRoundCount} pedido${pendingRoundCount > 1 ? 's' : ''} por confirmar`)
  }

  const statusLabels: Record<string, string> = {
    AVAILABLE: 'Disponible',
    OCCUPIED: 'Ocupada',
    ACTIVE: 'Activa',
    PAYING: 'Cobrando',
    OUT_OF_SERVICE: 'Fuera de servicio',
  }

  parts.push(statusLabels[table.status] ?? table.status)

  return parts.join(' — ')
}
