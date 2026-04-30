/**
 * Card — surface container with subtle border and background.
 *
 * Skill: interface-design
 */

import type { ComponentProps, ReactNode } from 'react'

interface CardProps extends Omit<ComponentProps<'div'>, 'className'> {
  children: ReactNode
  className?: string
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

const paddingClasses = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
}

export function Card({ children, className = '', padding = 'md', ...rest }: CardProps) {
  return (
    <div
      {...rest}
      className={[
        'rounded-lg border border-gray-700 bg-gray-900',
        paddingClasses[padding],
        className,
      ].join(' ')}
    >
      {children}
    </div>
  )
}
