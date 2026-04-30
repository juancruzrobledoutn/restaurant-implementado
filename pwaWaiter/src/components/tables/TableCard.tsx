/**
 * TableCard — visual card for one table in the waiter grid.
 *
 * Extended in C-21 to consume `deriveVisualState` and render animations.
 * Animation classes map to Tailwind custom keyframes defined in index.css.
 */
import { useNavigate } from 'react-router-dom'
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useRoundsStore } from '@/stores/roundsStore'
import { useServiceCallsStore } from '@/stores/serviceCallsStore'
import { deriveVisualState } from '@/lib/tableState'
import type { Table } from '@/stores/tableStore'
import type { VisualAnimation } from '@/lib/tableState'

// ---------------------------------------------------------------------------
// Animation CSS class mapping
// ---------------------------------------------------------------------------

const ANIMATION_CLASSES: Record<VisualAnimation, string> = {
  'red-blink': 'animate-blink-red',
  'yellow-pulse': 'animate-pulse-yellow',
  'orange-blink': 'animate-blink-orange',
  'violet-pulse': 'animate-pulse-violet',
  'blue-blink': 'animate-blink-blue',
  'none': '',
}

const STATUS_BASE_CLASSES: Record<string, string> = {
  AVAILABLE: 'bg-green-50 text-green-800 border-green-300',
  OCCUPIED: 'bg-orange-50 text-orange-800 border-orange-300',
  ACTIVE: 'bg-blue-50 text-blue-800 border-blue-300',
  PAYING: 'bg-yellow-50 text-yellow-800 border-yellow-300',
  OUT_OF_SERVICE: 'bg-gray-100 text-gray-500 border-gray-300',
}

const STATUS_LABELS: Record<string, string> = {
  AVAILABLE: 'Disponible',
  OCCUPIED: 'Ocupada',
  ACTIVE: 'Activa',
  PAYING: 'Cobrando',
  OUT_OF_SERVICE: 'Fuera de servicio',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  table: Table
  onClick?: (tableId: string) => void
}

export function TableCard({ table, onClick }: Props) {
  const navigate = useNavigate()
  const sessionId = table.sessionId ?? ''

  // useShallow required: both selectors return new array references on every render.
  const rounds = useRoundsStore(
    useShallow((s) => {
      const sessionMap = s.bySession[sessionId]
      if (!sessionMap) return []
      return Object.values(sessionMap)
    }),
  )
  const allCalls = useServiceCallsStore(
    useShallow((s) => Object.values(s.byId)),
  )

  const visual = useMemo(
    () => deriveVisualState(table, rounds, allCalls),
    [table, rounds, allCalls],
  )

  const animClass = ANIMATION_CLASSES[visual.animation]
  const baseClass = STATUS_BASE_CLASSES[table.status] ?? STATUS_BASE_CLASSES['AVAILABLE']!
  const label = STATUS_LABELS[table.status] ?? table.status

  function handleClick() {
    if (onClick) {
      onClick(table.id)
    } else {
      void navigate(`/tables/${table.id}`)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      data-testid={`table-${table.code}`}
      className={`relative flex aspect-square flex-col items-center justify-center gap-2 rounded-lg border-2 p-4 text-center shadow-sm transition hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary ${baseClass} ${animClass}`}
      aria-label={visual.label}
    >
      <span className="text-2xl font-bold">{table.code}</span>
      <span className="text-xs font-medium uppercase tracking-wide">{label}</span>

      {/* Service call badge */}
      {visual.openServiceCallCount > 0 && (
        <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
          {visual.openServiceCallCount}
        </span>
      )}

      {/* Pending rounds badge */}
      {visual.pendingRoundCount > 0 && (
        <span className="absolute -left-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-yellow-500 text-[10px] font-bold text-white">
          {visual.pendingRoundCount}
        </span>
      )}
    </button>
  )
}
