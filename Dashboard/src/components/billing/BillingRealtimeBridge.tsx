/**
 * BillingRealtimeBridge — headless WS subscription component (C-26).
 *
 * Skill: ws-frontend-subscription
 *
 * Renders null. Subscribes to CHECK_* and PAYMENT_* events via dashboardWS.onFiltered
 * and upserts into billingAdminStore.
 *
 * Lifecycle:
 * - Mounts inside /checks or /payments page
 * - Re-subscribes when selectedBranchId changes
 * - Cleanup (unsub) on unmount or branchId change
 *
 * OQ-1 resolved: WS payloads are lightweight (IDs only).
 * The handler builds minimal CheckSummary/PaymentSummary from the payload.
 * For checks, the status field may be missing in CHECK_REQUESTED — defaults to REQUESTED.
 *
 * Design D5: mounted in each billing page (option a).
 */

import { useRef, useEffect } from 'react'

import { dashboardWS } from '@/services/websocket'
import { useBillingAdminStore } from '@/stores/billingAdminStore'
import { useBranchStore, selectSelectedBranchId } from '@/stores/branchStore'

import type { WSEvent } from '@/types/menu'
import type { CheckSummary, PaymentSummary, CheckStatus, PaymentStatus, PaymentMethod } from '@/types/billing'

// ---------------------------------------------------------------------------
// Event payload types (outbox shapes — resolved in task 1.4)
// ---------------------------------------------------------------------------

interface WSCheckPayload {
  check_id: number
  session_id: number
  branch_id: number
  tenant_id: number
  total_cents: number
  status?: string
}

interface WSPaymentPayload {
  payment_id: number
  check_id: number
  amount_cents: number
  method: string
  branch_id: number
  tenant_id: number
  external_id?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BillingRealtimeBridge() {
  const selectedBranchId = useBranchStore(selectSelectedBranchId)
  const upsertCheck = useBillingAdminStore((s) => s.upsertCheck)
  const upsertPayment = useBillingAdminStore((s) => s.upsertPayment)

  // ── Ref pattern: handler updated on every render (step 1 of 2) ──────────
  function handleEvent(event: WSEvent) {
    const type = event.type
    const payload = event.payload as Record<string, unknown>

    if (type === 'CHECK_REQUESTED' || type === 'CHECK_PAID') {
      const p = payload as unknown as WSCheckPayload
      const checkStatus: CheckStatus = type === 'CHECK_PAID' ? 'PAID' : 'REQUESTED'
      const check: CheckSummary = {
        id: String(p.check_id),
        session_id: String(p.session_id),
        branch_id: String(p.branch_id),
        total_cents: p.total_cents,
        covered_cents: 0,   // WS payload doesn't carry covered_cents; 0 is safe for listing
        status: checkStatus,
        created_at: new Date().toISOString(),
      }
      upsertCheck(check)
      return
    }

    if (type === 'PAYMENT_APPROVED' || type === 'PAYMENT_REJECTED') {
      const p = payload as unknown as WSPaymentPayload
      const paymentStatus: PaymentStatus = type === 'PAYMENT_APPROVED' ? 'APPROVED' : 'REJECTED'
      const payment: PaymentSummary = {
        id: String(p.payment_id),
        check_id: String(p.check_id),
        amount_cents: p.amount_cents,
        method: p.method as PaymentMethod,
        status: paymentStatus,
        created_at: new Date().toISOString(),
      }
      upsertPayment(payment)
    }
  }

  // Effect 1: sync ref on every render (no deps — intentional)
  const handleRef = useRef(handleEvent)
  useEffect(() => {
    handleRef.current = handleEvent
  })

  // Effect 2: subscribe once per branchId change
  useEffect(() => {
    if (!selectedBranchId) return
    const unsubscribe = dashboardWS.onFiltered(
      selectedBranchId,
      '*',
      (e) => handleRef.current(e),
    )
    return unsubscribe
  }, [selectedBranchId])

  return null
}
