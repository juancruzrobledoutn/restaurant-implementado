/**
 * QuickLinkCard — internal reusable card for HomeQuickLinks (C-30).
 *
 * Skills: interface-design, vercel-react-best-practices
 *
 * A <Link> wrapper with consistent dark-theme styling and orange hover accent.
 * Always rendered as a navigation element; a11y role is handled by Link itself.
 */

import { Link } from 'react-router'
import type { LucideIcon } from 'lucide-react'

interface QuickLinkCardProps {
  to: string
  icon: LucideIcon
  title: string
  description: string
}

export function QuickLinkCard({ to, icon: Icon, title, description }: QuickLinkCardProps) {
  return (
    <Link
      to={to}
      className="flex items-start gap-3 rounded-lg border border-gray-600 bg-gray-800 p-5 transition-colors hover:border-orange-500/50 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:ring-offset-gray-900"
      aria-label={`${title}: ${description}`}
    >
      <Icon
        className="mt-0.5 h-5 w-5 shrink-0 text-orange-400"
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="mt-0.5 text-xs text-gray-400">{description}</p>
      </div>
    </Link>
  )
}
