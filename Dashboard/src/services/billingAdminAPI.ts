/**
 * billingAdminAPI — REST client for admin billing endpoints (C-26).
 *
 * Endpoints:
 *   GET /api/admin/billing/checks    → paginated check listing (ADMIN/MANAGER)
 *   GET /api/admin/billing/payments  → paginated payment listing (ADMIN/MANAGER)
 *
 * Auth: JWT via fetchAPI interceptor.
 * Rate limit: 60/min per endpoint (server-side).
 *
 * Design (design.md D1): separate from billingAPI (per-session) — admin surface.
 */

import { fetchAPI } from '@/services/api'
import type {
  ChecksFilter,
  PaymentsFilter,
  PaginatedChecks,
  PaginatedPayments,
  CheckSummary,
  PaymentSummary,
} from '@/types/billing'

// ---------------------------------------------------------------------------
// Backend response shapes (raw — IDs as numbers; converted at boundary)
// ---------------------------------------------------------------------------

interface BackendCheckSummary {
  id: number
  session_id: number
  branch_id: number
  total_cents: number
  covered_cents: number
  status: string
  created_at: string
}

interface BackendPaymentSummary {
  id: number
  check_id: number
  amount_cents: number
  method: string
  status: string
  created_at: string
}

interface BackendPaginatedChecks {
  items: BackendCheckSummary[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

interface BackendPaginatedPayments {
  items: BackendPaymentSummary[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

// ---------------------------------------------------------------------------
// ID conversion helpers (number → string at boundary)
// ---------------------------------------------------------------------------

function toCheckSummary(b: BackendCheckSummary): CheckSummary {
  return {
    id: String(b.id),
    session_id: String(b.session_id),
    branch_id: String(b.branch_id),
    total_cents: b.total_cents,
    covered_cents: b.covered_cents,
    status: b.status as CheckSummary['status'],
    created_at: b.created_at,
  }
}

function toPaymentSummary(b: BackendPaymentSummary): PaymentSummary {
  return {
    id: String(b.id),
    check_id: String(b.check_id),
    amount_cents: b.amount_cents,
    method: b.method as PaymentSummary['method'],
    status: b.status as PaymentSummary['status'],
    created_at: b.created_at,
  }
}

// ---------------------------------------------------------------------------
// Query param builders
// ---------------------------------------------------------------------------

function buildChecksParams(
  branchId: string,
  filter: ChecksFilter,
): string {
  const params = new URLSearchParams({
    branch_id: String(parseInt(branchId, 10)),
    from: filter.date,
    to: filter.date,
    page: String(filter.page),
    page_size: String(filter.page_size),
  })
  if (filter.status) params.set('status', filter.status)
  return params.toString()
}

function buildPaymentsParams(
  branchId: string,
  filter: PaymentsFilter,
): string {
  const params = new URLSearchParams({
    branch_id: String(parseInt(branchId, 10)),
    from: filter.from,
    to: filter.to,
    page: String(filter.page),
    page_size: String(filter.page_size),
  })
  if (filter.method) params.set('method', filter.method)
  if (filter.status) params.set('status', filter.status)
  return params.toString()
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const billingAdminAPI = {
  /**
   * Fetch paginated checks for a branch with optional filters.
   *
   * Raises HTTP 409 if date range exceeds 90 days (server enforced).
   * Raises HTTP 403 if user lacks ADMIN/MANAGER role or branch access.
   */
  listChecks: async (
    branchId: string,
    filter: ChecksFilter,
  ): Promise<PaginatedChecks> => {
    const qs = buildChecksParams(branchId, filter)
    const data = await fetchAPI<BackendPaginatedChecks>(
      `/api/admin/billing/checks?${qs}`,
    )
    return {
      items: data.items.map(toCheckSummary),
      total: data.total,
      page: data.page,
      page_size: data.page_size,
      total_pages: data.total_pages,
    }
  },

  /**
   * Fetch paginated payments for a branch with optional filters.
   *
   * Raises HTTP 409 if date range exceeds 90 days (server enforced).
   * Raises HTTP 403 if user lacks ADMIN/MANAGER role or branch access.
   */
  listPayments: async (
    branchId: string,
    filter: PaymentsFilter,
  ): Promise<PaginatedPayments> => {
    const qs = buildPaymentsParams(branchId, filter)
    const data = await fetchAPI<BackendPaginatedPayments>(
      `/api/admin/billing/payments?${qs}`,
    )
    return {
      items: data.items.map(toPaymentSummary),
      total: data.total,
      page: data.page,
      page_size: data.page_size,
      total_pages: data.total_pages,
    }
  },
}
