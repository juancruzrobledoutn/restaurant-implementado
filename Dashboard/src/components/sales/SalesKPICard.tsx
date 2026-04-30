/**
 * SalesKPICard — simple KPI display card with a large value and a label.
 *
 * Props:
 *   label        — short description shown below the value
 *   value        — the raw numeric value (cents if format='currency', count otherwise)
 *   format       — 'currency' formats via formatPrice; 'number' formats as integer
 *   displayValue — (optional) overrides the formatted value; takes precedence over `value`
 *   icon         — (optional) LucideIcon component rendered before the value
 *
 * C-30: Added displayValue + icon props — fully backward compatible.
 */

import type { LucideIcon } from 'lucide-react'
import { formatPrice } from '@/utils/formatPrice'

interface SalesKPICardProps {
  label: string
  value: number
  format: 'currency' | 'number'
  /** Optional override — takes precedence over the computed format of `value`. */
  displayValue?: string
  /** Optional icon rendered before the value. */
  icon?: LucideIcon
}

export function SalesKPICard({ label, value, format, displayValue, icon: Icon }: SalesKPICardProps) {
  const computed =
    format === 'currency' ? formatPrice(value) : value.toLocaleString('es-AR')

  const rendered = displayValue ?? computed

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-gray-600 bg-gray-800 p-5">
      {Icon && (
        <Icon
          className="mb-1 h-4 w-4 text-gray-400"
          aria-hidden="true"
        />
      )}
      <p
        className="text-2xl font-bold text-white tabular-nums"
        aria-label={`${label}: ${rendered}`}
      >
        {rendered}
      </p>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
        {label}
      </p>
    </div>
  )
}
