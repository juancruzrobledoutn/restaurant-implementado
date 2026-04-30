/**
 * PageContainer — standard page wrapper with title, help trigger, and actions.
 *
 * Every Dashboard CRUD page MUST use PageContainer with a helpContent prop.
 *
 * Skill: dashboard-crud-page, help-system-content
 */

import type { ReactNode } from 'react'
import { HelpButton } from './HelpButton'

interface PageContainerProps {
  title: string
  description?: string
  /** Required: help content rendered in the HelpButton popover */
  helpContent: ReactNode
  /** Optional action buttons rendered in the header (e.g. "New Category") */
  actions?: ReactNode
  children: ReactNode
}

export function PageContainer({
  title,
  description,
  helpContent,
  actions,
  children,
}: PageContainerProps) {
  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-white">{title}</h1>
              <HelpButton
                title={title}
                content={helpContent}
                size="md"
              />
            </div>
            {description && (
              <p className="mt-1 text-sm text-gray-400">{description}</p>
            )}
          </div>
        </div>

        {actions && (
          <div className="flex items-center gap-2 shrink-0">
            {actions}
          </div>
        )}
      </div>

      {/* Page content */}
      {children}
    </div>
  )
}
