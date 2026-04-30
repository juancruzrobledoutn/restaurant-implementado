/**
 * Badge — status indicator with accessible screen-reader prefix.
 *
 * Accessibility: always includes <span className="sr-only">Estado:</span>
 * before the visible text so screen readers announce "Estado: Activo".
 *
 * Skill: dashboard-crud-page, interface-design
 */

import type { ReactNode } from 'react'

export type BadgeVariant = 'success' | 'danger' | 'warning' | 'info' | 'neutral'

interface BadgeProps {
  variant?: BadgeVariant
  children: ReactNode
  className?: string
}

const variantClasses: Record<BadgeVariant, string> = {
  success: 'bg-green-900/30 text-green-400 border border-green-700/50',
  danger: 'bg-red-900/30 text-red-400 border border-red-700/50',
  warning: 'bg-yellow-900/30 text-yellow-400 border border-yellow-700/50',
  info: 'bg-blue-900/30 text-blue-400 border border-blue-700/50',
  neutral: 'bg-gray-700 text-gray-400 border border-gray-600',
}

export function Badge({ variant = 'neutral', children, className = '' }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        variantClasses[variant],
        className,
      ].join(' ')}
    >
      <span className="sr-only">Estado:</span>
      {children}
    </span>
  )
}
