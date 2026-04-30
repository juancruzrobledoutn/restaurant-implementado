/**
 * CascadePreviewList — shows which entities will be affected by a cascade delete.
 *
 * Rendered inside ConfirmDialog before a delete confirmation.
 *
 * Skill: dashboard-crud-page
 */

import { AlertTriangle } from 'lucide-react'
import type { CascadePreview } from '@/types/menu'

interface CascadePreviewListProps {
  preview: CascadePreview
}

export function CascadePreviewList({ preview }: CascadePreviewListProps) {
  if (preview.totalItems === 0) return null

  return (
    <div className="mt-2 rounded-lg border border-red-700/50 bg-red-900/20 p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-red-300">
            Se eliminarán {preview.totalItems} elemento(s) relacionado(s):
          </p>
          <ul className="mt-2 space-y-1">
            {preview.items.map((item) => (
              <li key={item.label} className="text-sm text-red-300/80">
                • {item.count} {item.label}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
