/**
 * Button — accessible button with variants, loading state, and icon support.
 *
 * Skill: dashboard-crud-page, interface-design
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  isLoading?: boolean
  children?: ReactNode
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-white hover:bg-primary/90 disabled:bg-primary/50 focus-visible:ring-primary',
  secondary:
    'bg-gray-700 text-white hover:bg-gray-600 disabled:bg-gray-700/50 focus-visible:ring-gray-500',
  ghost:
    'bg-transparent text-gray-300 hover:bg-gray-700 hover:text-white disabled:opacity-50 focus-visible:ring-gray-500',
  danger:
    'bg-red-700 text-white hover:bg-red-600 disabled:bg-red-700/50 focus-visible:ring-red-500',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-9 px-4 text-sm',
  lg: 'h-11 px-6 text-base',
}

export function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  disabled,
  children,
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled ?? isLoading}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900',
        'disabled:cursor-not-allowed',
        variantClasses[variant],
        sizeClasses[size],
        className,
      ].join(' ')}
    >
      {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  )
}
