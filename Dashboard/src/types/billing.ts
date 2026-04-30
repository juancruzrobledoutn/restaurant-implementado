/**
 * Billing domain types for Dashboard admin views (C-26).
 *
 * Convention:
 * - All IDs are strings in frontend (backend returns ints — convert at boundary)
 * - Prices are integers in cents (12550 = $125.50)
 * - Backend snake_case is preserved in these types (consistent with operations.ts)
 */

// ---------------------------------------------------------------------------
// Enums / Literals
// ---------------------------------------------------------------------------

export type CheckStatus = 'REQUESTED' | 'PAID'

export type PaymentStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'FAILED'

export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'mercadopago'

// ---------------------------------------------------------------------------
// Check summary (admin listing row)
// ---------------------------------------------------------------------------

export interface CheckSummary {
  id: string
  session_id: string
  branch_id: string
  total_cents: number
  covered_cents: number
  status: CheckStatus
  created_at: string   // ISO 8601
}

// ---------------------------------------------------------------------------
// Payment summary (admin listing row)
// ---------------------------------------------------------------------------

export interface PaymentSummary {
  id: string
  check_id: string
  amount_cents: number
  method: PaymentMethod
  status: PaymentStatus
  created_at: string   // ISO 8601
}

// ---------------------------------------------------------------------------
// Paginated wrappers
// ---------------------------------------------------------------------------

export interface PaginatedChecks {
  items: CheckSummary[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export interface PaginatedPayments {
  items: PaymentSummary[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

// ---------------------------------------------------------------------------
// Filter types (persisted in billingAdminStore)
// ---------------------------------------------------------------------------

export interface ChecksFilter {
  date: string            // YYYY-MM-DD (default today)
  status: CheckStatus | null
  page: number
  page_size: number
}

export interface PaymentsFilter {
  from: string            // YYYY-MM-DD
  to: string              // YYYY-MM-DD
  method: PaymentMethod | null
  status: PaymentStatus | null
  page: number
  page_size: number
}

// ---------------------------------------------------------------------------
// Derived KPIs (computed client-side from checks array)
// ---------------------------------------------------------------------------

export interface ChecksKPIs {
  totalChecks: number
  totalBilledCents: number
  pendingChecks: number
}

// ---------------------------------------------------------------------------
// Payment method summary (computed client-side from payments)
// ---------------------------------------------------------------------------

export interface PaymentMethodSummaryRow {
  method: PaymentMethod
  count: number
  total_cents: number
}

// ---------------------------------------------------------------------------
// WebSocket event payloads (outbox shape — design.md Open Question #1 resolved)
// CHECK_REQUESTED / CHECK_PAID — lightweight, only IDs + status
// PAYMENT_APPROVED / PAYMENT_REJECTED — lightweight, only IDs + amount + method
// The WS handler refetches when needed to populate full row data.
// ---------------------------------------------------------------------------

export interface WSCheckPayload {
  check_id: number
  session_id: number
  branch_id: number
  tenant_id: number
  total_cents: number
  status?: CheckStatus
  split_method?: string
}

export interface WSPaymentPayload {
  payment_id: number
  check_id: number
  amount_cents: number
  method: string
  branch_id: number
  tenant_id: number
  external_id?: string
}
