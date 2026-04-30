/**
 * billingAPI — REST client for per-session billing endpoints (C-12).
 *
 * Endpoint:
 *   GET /api/billing/check/{session_id}  → full check with charges + allocations + payments
 *
 * Used by CheckDetailModal when the user clicks "Ver detalle" (design.md D7).
 * Auth: JWT via fetchAPI interceptor.
 *
 * Note: This endpoint accepts both JWT and Table Token on the backend.
 * The Dashboard only sends JWT (standard fetchAPI path).
 */

import { fetchAPI } from '@/services/api'

// ---------------------------------------------------------------------------
// Response types (full check detail — backend CheckOut schema)
// ---------------------------------------------------------------------------

export interface AllocationDetail {
  id: string
  charge_id: string
  payment_id: string
  amount_cents: number
}

export interface ChargeDetail {
  id: string
  check_id: string
  diner_id: string | null
  amount_cents: number
  description: string | null
  remaining_cents: number
  allocations: AllocationDetail[]
}

export interface PaymentDetail {
  id: string
  check_id: string
  amount_cents: number
  method: string
  status: string
  external_id: string | null
  created_at: string
  allocations: AllocationDetail[]
}

export interface CheckDetail {
  id: string
  session_id: string
  branch_id: string
  tenant_id: string
  total_cents: number
  status: string
  created_at: string
  charges: ChargeDetail[]
  payments: PaymentDetail[]
}

// ---------------------------------------------------------------------------
// Backend raw shapes (IDs as numbers)
// ---------------------------------------------------------------------------

interface BackendAllocation {
  id: number
  charge_id: number
  payment_id: number
  amount_cents: number
}

interface BackendCharge {
  id: number
  check_id: number
  diner_id: number | null
  amount_cents: number
  description: string | null
  remaining_cents: number
  allocations: BackendAllocation[]
}

interface BackendPayment {
  id: number
  check_id: number
  amount_cents: number
  method: string
  status: string
  external_id: string | null
  created_at: string
  allocations: BackendAllocation[]
}

interface BackendCheckDetail {
  id: number
  session_id: number
  branch_id: number
  tenant_id: number
  total_cents: number
  status: string
  created_at: string
  charges: BackendCharge[]
  payments: BackendPayment[]
}

// ---------------------------------------------------------------------------
// Converters
// ---------------------------------------------------------------------------

function toAllocation(b: BackendAllocation): AllocationDetail {
  return {
    id: String(b.id),
    charge_id: String(b.charge_id),
    payment_id: String(b.payment_id),
    amount_cents: b.amount_cents,
  }
}

function toCharge(b: BackendCharge): ChargeDetail {
  return {
    id: String(b.id),
    check_id: String(b.check_id),
    diner_id: b.diner_id != null ? String(b.diner_id) : null,
    amount_cents: b.amount_cents,
    description: b.description,
    remaining_cents: b.remaining_cents,
    allocations: b.allocations.map(toAllocation),
  }
}

function toPaymentDetail(b: BackendPayment): PaymentDetail {
  return {
    id: String(b.id),
    check_id: String(b.check_id),
    amount_cents: b.amount_cents,
    method: b.method,
    status: b.status,
    external_id: b.external_id,
    created_at: b.created_at,
    allocations: b.allocations.map(toAllocation),
  }
}

function toCheckDetail(b: BackendCheckDetail): CheckDetail {
  return {
    id: String(b.id),
    session_id: String(b.session_id),
    branch_id: String(b.branch_id),
    tenant_id: String(b.tenant_id),
    total_cents: b.total_cents,
    status: b.status,
    created_at: b.created_at,
    charges: b.charges.map(toCharge),
    payments: b.payments.map(toPaymentDetail),
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const billingAPI = {
  /**
   * Fetch full check detail (charges + allocations + payments) for a session.
   * Used by CheckDetailModal — lazy loaded only when modal is opened.
   *
   * @param sessionId - The table session ID (string — converted to int at boundary)
   */
  getCheck: async (sessionId: string): Promise<CheckDetail> => {
    const data = await fetchAPI<BackendCheckDetail>(
      `/api/billing/check/${parseInt(sessionId, 10)}`,
    )
    return toCheckDetail(data)
  },
}
