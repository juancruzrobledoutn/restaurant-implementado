/**
 * UrgencyBadge — color-coded elapsed-time indicator for kitchen rounds.
 *
 * Derives Tailwind color class from elapsed minutes using
 * KITCHEN_URGENCY_THRESHOLDS_MIN constants.
 *
 * Colors:
 *   < 5 min  → green  (on schedule)
 *   5–10 min → yellow (warning)
 *   10–15min → orange (high urgency)
 *   > 15 min → red    (critical)
 *
 * Accessibility: aria-label announces urgency level in plain text.
 */

import { KITCHEN_URGENCY_THRESHOLDS_MIN } from '@/utils/constants'

interface UrgencyBadgeProps {
  /** Minutes elapsed since the round was submitted. */
  elapsedMinutes: number
  className?: string
}

type UrgencyLevel = 'ok' | 'warning' | 'high' | 'critical'

function getUrgencyLevel(minutes: number): UrgencyLevel {
  if (minutes < KITCHEN_URGENCY_THRESHOLDS_MIN.warning) return 'ok'
  if (minutes < KITCHEN_URGENCY_THRESHOLDS_MIN.high) return 'warning'
  if (minutes < KITCHEN_URGENCY_THRESHOLDS_MIN.critical) return 'high'
  return 'critical'
}

const levelConfig: Record<
  UrgencyLevel,
  { bg: string; text: string; label: string }
> = {
  ok: {
    bg: 'bg-green-500',
    text: 'text-white',
    label: 'En tiempo',
  },
  warning: {
    bg: 'bg-yellow-500',
    text: 'text-zinc-900',
    label: 'Demorado',
  },
  high: {
    bg: 'bg-orange-500',
    text: 'text-white',
    label: 'Urgente',
  },
  critical: {
    bg: 'bg-red-500',
    text: 'text-white',
    label: 'Critico',
  },
}

export function UrgencyBadge({ elapsedMinutes, className = '' }: UrgencyBadgeProps) {
  const level = getUrgencyLevel(elapsedMinutes)
  const { bg, text, label } = levelConfig[level]
  const mins = Math.floor(elapsedMinutes)

  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
        bg,
        text,
        className,
      ].join(' ')}
      aria-label={`Urgencia: ${label} — ${mins} minutos`}
    >
      {mins}m
    </span>
  )
}
