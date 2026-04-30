/**
 * MercadoPago service for pwaMenu (C-19 / Task 7.3).
 *
 * CRITICO — HUMAN REVIEW REQUIRED before merge.
 *
 * PCI Scope Statement:
 *   This service is REDIRECT-ONLY. It NEVER handles card numbers, CVV,
 *   cardholder data, or any PCI-DSS regulated data.
 *   The diner is redirected to MercadoPago's hosted checkout (initPoint).
 *   No MP SDK is imported. No card tokenization is performed here.
 *   PCI scope is: SAQ A (redirect-only, no card data in scope).
 *
 * Flow:
 *   1. Call POST /api/billing/payment/preference with checkId
 *   2. Backend calls MP Checkout API and returns { initPoint, preferenceId }
 *   3. This service calls window.location.assign(initPoint) — full redirect
 *   4. MP handles payment, redirects back to VITE_MP_RETURN_URL
 *   5. PaymentResultPage reads query params and validates against paymentStore
 *
 * DO NOT:
 *   - Import @mercadopago/sdk-react or similar SDKs
 *   - Render any card input fields (CardForm, etc.)
 *   - Handle raw card data anywhere in the client
 *   - Log or transmit card holder info
 *
 * [HUMAN REVIEW REQUIRED — CRITICO]
 */
import { apiPost, ApiError } from './api'
import { toNumberId } from '../utils/idConversion'
import { logger } from '../utils/logger'
import type { PaymentPreferenceResponse } from '../types/billing'

// --- DTO ---

interface PreferenceDTO {
  preference_id: string
  init_point: string
  public_key: string
}

// --- 422 / 409 error types ---

export class PreferenceCreationError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code)
    this.name = 'PreferenceCreationError'
  }
}

async function parsePreferenceError(error: ApiError): Promise<PreferenceCreationError> {
  try {
    const body = JSON.parse(error.body) as { detail?: { code?: string } | string }
    const code =
      typeof body.detail === 'object' && body.detail?.code
        ? body.detail.code
        : typeof body.detail === 'string'
        ? body.detail
        : 'preference_error'
    return new PreferenceCreationError(code)
  } catch {
    return new PreferenceCreationError('preference_error')
  }
}

/**
 * Create a MercadoPago payment preference and redirect the diner.
 *
 * This function does two things atomically:
 * 1. Creates the preference via POST /api/billing/payment/preference
 * 2. Redirects to initPoint via window.location.assign()
 *
 * The caller (PaymentButton) should set paymentStore.phase='creating_preference'
 * BEFORE calling this function, and 'redirecting' when the promise resolves.
 *
 * Throws PreferenceCreationError on API errors.
 * Does NOT catch the redirect itself (it's a side effect — not recoverable).
 *
 * [HUMAN REVIEW — CRITICO: verify no card data flows through here]
 */
export async function createPreferenceAndRedirect(checkId: string): Promise<PaymentPreferenceResponse> {
  logger.info('mercadoPago.createPreferenceAndRedirect: creating preference', { checkId })

  let dto: PreferenceDTO
  try {
    dto = await apiPost<PreferenceDTO>('/api/billing/payment/preference', {
      check_id: toNumberId(checkId),
    })
  } catch (err) {
    if (err instanceof ApiError) {
      throw await parsePreferenceError(err)
    }
    throw err
  }

  const result: PaymentPreferenceResponse = {
    preferenceId: dto.preference_id,
    initPoint: dto.init_point,
    publicKey: dto.public_key,
  }

  logger.info('mercadoPago.createPreferenceAndRedirect: redirecting to MP', {
    preferenceId: dto.preference_id,
    // NOTE: initPoint is NOT logged — it contains payment parameters
  })

  // REDIRECT — PCI boundary: diner leaves pwaMenu scope here
  // All card data handling is done by MercadoPago's hosted checkout.
  window.location.assign(dto.init_point)

  return result
}
