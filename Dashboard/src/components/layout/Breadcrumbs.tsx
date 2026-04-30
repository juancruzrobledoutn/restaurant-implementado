/**
 * Breadcrumbs — derived from React Router useMatches() + route handle metadata.
 *
 * Each route that should contribute a breadcrumb must declare:
 *   handle: { breadcrumb: 'i18n.key.here' }
 *
 * Example route:
 *   { path: '/categories', element: <CategoriesPage />, handle: { breadcrumb: 'layout.breadcrumbs.categories' } }
 */

import { Link, useMatches } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'

interface RouteHandle {
  breadcrumb?: string
}

export function Breadcrumbs() {
  const { t } = useTranslation()
  const matches = useMatches()

  // Filter only matches that have a breadcrumb in their handle
  const crumbs = matches
    .filter((m) => {
      const handle = m.handle as RouteHandle | undefined
      return handle?.breadcrumb != null
    })
    .map((m) => {
      const handle = m.handle as RouteHandle
      return {
        id: m.id,
        pathname: m.pathname,
        label: t(handle.breadcrumb!),
      }
    })

  if (crumbs.length <= 1) return null

  return (
    <nav aria-label="Breadcrumb" className="px-4 py-2 flex items-center gap-1 text-sm text-gray-400 border-b border-gray-700/50 bg-gray-900">
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1
        return (
          <span key={crumb.id} className="flex items-center gap-1">
            {index > 0 && <ChevronRight className="h-3.5 w-3.5 text-gray-600 shrink-0" />}
            {isLast ? (
              <span className="font-medium text-gray-200" aria-current="page">
                {crumb.label}
              </span>
            ) : (
              <Link
                to={crumb.pathname}
                className="hover:text-primary hover:underline transition-colors"
              >
                {crumb.label}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}
