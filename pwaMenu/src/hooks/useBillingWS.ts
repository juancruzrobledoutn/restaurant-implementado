/**
 * useBillingWS — Routes billing WS events to the appropriate stores (C-19 / Task 7.5).
 *
 * Subscribes to CHECK_REQUESTED, CHECK_PAID, PAYMENT_APPROVED, PAYMENT_REJECTED
 * from dinerWS. Dispatches to billingStore, paymentStore, sessionStore as needed.
 *
 * Follows ws-frontend-subscription skill ref pattern strictly:
 * - Effect 1: sync handler ref on every render (no deps — intentional)
 * - Effect 2: subscribe ONCE — empty deps, always return unsubscribe
 *
 * Mount this hook ONCE in App.tsx inside the provider tree.
 * DO NOT mount it in individual pages (causes listener accumulation).
 */
import { useEffect, useRef } from 'react'
import { dinerWS } from '../services/ws/dinerWS'
import { useBillingStore } from '../stores/billingStore'
import { usePaymentStore } from '../stores/paymentStore'
import { useSessionStore } from '../stores/sessionStore'
import { toStringId } from '../utils/idConversion'
import { logger } from '../utils/logger'
import type { WsEvent } from '../types/wsEvents'
import type {
  WsCheckRequestedEvent,
  WsCheckPaidEvent,
  WsPaymentApprovedEvent,
  WsPaymentRejectedEvent,
} from '../types/wsEvents'
import type { Check, Payment } from '../types/billing'

// --- Event-id deduplication (shared with other WS handlers) ---
const SEEN_IDS = new Set<string>()
const SEEN_IDS_MAX = 200

function isDuplicate(eventId: string): boolean {
  if (SEEN_IDS.has(eventId)) return true
  if (SEEN_IDS.size >= SEEN_IDS_MAX) {
    // Evict oldest entry (Set preserves insertion order)
    const first = SEEN_IDS.values().next().value
    if (first !== undefined) SEEN_IDS.delete(first)
  }
  SEEN_IDS.add(eventId)
  return false
}

// --- Handler logic ---

function handleCheckRequested(event: WsCheckRequestedEvent): void {
  if (isDuplicate(event.event_id)) return

  // Build a minimal Check from the event (full hydration happens via GET)
  const check: Check = {
    id: toStringId(event.check_id),
    sessionId: toStringId(event.session_id),
    status: 'REQUESTED',
    splitMethod: event.split_method as Check['splitMethod'],
    totalCents: event.total_cents,
    remainingCents: event.total_cents,
    charges: [],
    payments: [],
    createdAt: event.requested_at,
    updatedAt: event.requested_at,
  }

  useBillingStore.getState().setCheck(check)
  // Update table status → PAYING when check is requested
  useSessionStore.getState().setTableStatus('PAYING')
  logger.info('useBillingWS: CHECK_REQUESTED', { checkId: event.check_id })
}

function handleCheckPaid(event: WsCheckPaidEvent): void {
  if (isDuplicate(event.event_id)) return

  useBillingStore.getState().updateStatus('PAID')
  useSessionStore.getState().setTableStatus('CLOSED')
  logger.info('useBillingWS: CHECK_PAID', { checkId: event.check_id })
}

function handlePaymentApproved(event: WsPaymentApprovedEvent): void {
  if (isDuplicate(event.event_id)) return

  const payment: Payment = {
    id: toStringId(event.payment_id),
    method: 'mercadopago',
    amountCents: event.amount_cents,
    status: 'approved',
    externalId: event.external_id,
    paidAt: event.approved_at,
  }

  useBillingStore.getState().addPayment(payment)
  usePaymentStore.getState().transition('approved', { paymentId: toStringId(event.payment_id) })
  logger.info('useBillingWS: PAYMENT_APPROVED', { paymentId: event.payment_id })
}

function handlePaymentRejected(event: WsPaymentRejectedEvent): void {
  if (isDuplicate(event.event_id)) return

  const payment: Payment = {
    id: toStringId(event.payment_id),
    method: 'mercadopago',
    amountCents: 0,
    status: 'rejected',
    externalId: null,
    paidAt: null,
  }

  useBillingStore.getState().addPayment(payment)
  usePaymentStore.getState().transition('rejected', {
    error: { code: 'payment_rejected', message: event.reason ?? 'Payment rejected' },
  })
  logger.info('useBillingWS: PAYMENT_REJECTED', { paymentId: event.payment_id })
}

function dispatchBillingEvent(event: WsEvent): void {
  switch (event.type) {
    case 'CHECK_REQUESTED':
      handleCheckRequested(event as WsCheckRequestedEvent)
      break
    case 'CHECK_PAID':
      handleCheckPaid(event as WsCheckPaidEvent)
      break
    case 'PAYMENT_APPROVED':
      handlePaymentApproved(event as WsPaymentApprovedEvent)
      break
    case 'PAYMENT_REJECTED':
      handlePaymentRejected(event as WsPaymentRejectedEvent)
      break
    // All other event types are handled by other hooks (cart, rounds)
  }
}

// --- React hook ---

/**
 * Mount this ONCE in App.tsx.
 *
 * Uses the two-effect ref pattern:
 * - dispatchRef.current is updated every render (Effect 1)
 * - Subscription is registered once (Effect 2, empty deps)
 *
 * This ensures the handler always has fresh store references without
 * causing re-subscription on every render.
 */
export function useBillingWS(): void {
  // Ref to the dispatcher — updated every render, subscription registered once
  const dispatchRef = useRef<(event: WsEvent) => void>(null!)

  // Effect 1: sync ref on every render (no deps — intentional)
  useEffect(() => {
    dispatchRef.current = dispatchBillingEvent
  })

  // Effect 2: subscribe once — empty deps is correct
  useEffect(() => {
    const unsubscribe = dinerWS.on('*', (e) => dispatchRef.current(e))
    return unsubscribe // Always cleanup on unmount
  }, [])
}
