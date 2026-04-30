/**
 * AppShell — root container for all pages.
 *
 * Enforces mobile-first layout constraints:
 * - overflow-x-hidden w-full max-w-full (prevents horizontal scroll)
 * - pb-[env(safe-area-inset-bottom)] (iOS home indicator safe area)
 */
import type { ReactNode } from 'react'

interface AppShellProps {
  children: ReactNode
  className?: string
}

export function AppShell({ children, className = '' }: AppShellProps) {
  return (
    <div
      className={`min-h-screen overflow-x-hidden w-full max-w-full pb-[env(safe-area-inset-bottom)] ${className}`}
    >
      {children}
    </div>
  )
}
