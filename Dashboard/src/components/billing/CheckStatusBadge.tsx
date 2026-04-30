/**
 * CheckStatusBadge — reusable status badge for billing checks (C-26).
 *
 * Skill: dashboard-crud-page (Badge with sr-only)
 *
 * Status mapping:
 *   REQUESTED → warning (yellow)
 *   PAID      → success (green)
 */

import { Badge } from '@/components/ui/Badge'
import type { CheckStatus } from '@/types/billing'

interface CheckStatusBadgeProps {
  status: CheckStatus
}

const STATUS_LABELS: Record<CheckStatus, string> = {
  REQUESTED: 'Pendiente',
  PAID: 'Pagada',
}

export function CheckStatusBadge({ status }: CheckStatusBadgeProps) {
  return (
    <Badge variant={status === 'PAID' ? 'success' : 'warning'}>
      {STATUS_LABELS[status] ?? status}
    </Badge>
  )
}
