/**
 * Billing domain types for pwaMenu (C-19).
 *
 * Mirrors backend billing schemas — IDs are strings in frontend, numbers in backend.
 * All money values are in cents (integer).
 */

// --- Check (app_check) ---

export type CheckStatus = 'OPEN' | 'REQUESTED' | 'CLOSED' | 'PAID' | 'CANCELLED'
export type SplitMethod = 'equal_split' | 'by_consumption' | 'custom'

export interface Charge {
  id: string
  dinerId: string
  dinerName: string
  amountCents: number
  splitMethod: SplitMethod
}

export interface Payment {
  id: string
  method: string // 'mercadopago' | 'cash' | 'card'
  amountCents: number
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  externalId: string | null
  paidAt: string | null
}

export interface Check {
  id: string
  sessionId: string
  status: CheckStatus
  splitMethod: SplitMethod
  totalCents: number
  remainingCents: number
  charges: Charge[]
  payments: Payment[]
  createdAt: string
  updatedAt: string
}

// --- Billing request payload ---

export interface CheckRequestPayload {
  split_method: SplitMethod
}

// --- Payment preference (MercadoPago redirect) ---

export interface PaymentPreferenceResponse {
  preferenceId: string
  initPoint: string // redirect URL
  publicKey: string
}

// --- Payment FSM phases ---

export type PaymentPhase =
  | 'idle'               // No active payment flow
  | 'creating_preference' // Calling POST /api/billing/payment/preference
  | 'redirecting'         // window.location.assign(initPoint) called
  | 'waiting'             // Returned from MP, waiting WS confirmation
  | 'approved'            // Payment confirmed (WS or polling)
  | 'rejected'            // Payment rejected
  | 'failed'              // Technical error or mismatch

export interface PaymentError {
  code: string
  message: string
}

// --- Customer profile ---

export interface CustomerProfile {
  id: string
  deviceHint: string | null
  name: string | null
  email: string | null
  optedIn: boolean
  consentVersion: string | null
}

export interface VisitEntry {
  sessionId: string
  branchId: string
  status: string
  visitedAt: string
}

export interface PreferenceEntry {
  productId: string
  productName: string
  totalQuantity: number
}

// --- Opt-in payload ---

export interface OptInPayload {
  name: string
  email: string
  consent_version: string
  consent_granted: boolean
}
