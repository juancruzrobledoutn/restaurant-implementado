/**
 * Billing API service for pwaMenu (C-19 / Task 7.1).
 *
 * Authenticated via X-Table-Token (injected by api.ts).
 * All IDs: backend number → frontend string at this boundary.
 * All money: backend cents integer → frontend cents integer (no conversion needed).
 *
 * Endpoints covered:
 *   POST /api/billing/check/request  → requestCheck(splitMethod)
 *   GET  /api/billing/check/{id}     → getCheck(sessionId)
 *   GET  /api/billing/payment/{id}/status → getPaymentStatus(paymentId)
 */
import { apiGet, apiPost, ApiError } from './api'
import { toStringId, toNumberId } from '../utils/idConversion'
import { logger } from '../utils/logger'
import type { Check, Charge, Payment, SplitMethod, CheckRequestPayload } from '../types/billing'

// --- DTO types (backend shape) ---

interface ChargeDTO {
  id: number
  diner_id: number
  diner_name: string
  amount_cents: number
  split_method: SplitMethod
}

interface PaymentDTO {
  id: number
  method: string
  amount_cents: number
  status: string
  external_id: string | null
  paid_at: string | null
}

interface CheckDTO {
  id: number
  session_id: number
  status: string
  split_method: SplitMethod
  total_cents: number
  remaining_cents: number
  charges: ChargeDTO[]
  payments: PaymentDTO[]
  created_at: string
  updated_at: string
}

interface PaymentStatusDTO {
  id: number
  status: string
  external_id: string | null
  paid_at: string | null
}

// --- Converters ---

function toCharge(dto: ChargeDTO): Charge {
  return {
    id: toStringId(dto.id),
    dinerId: toStringId(dto.diner_id),
    dinerName: dto.diner_name,
    amountCents: dto.amount_cents,
    splitMethod: dto.split_method,
  }
}

function toPayment(dto: PaymentDTO): Payment {
  return {
    id: toStringId(dto.id),
    method: dto.method,
    amountCents: dto.amount_cents,
    status: dto.status as Payment['status'],
    externalId: dto.external_id,
    paidAt: dto.paid_at,
  }
}

function toCheck(dto: CheckDTO): Check {
  return {
    id: toStringId(dto.id),
    sessionId: toStringId(dto.session_id),
    status: dto.status as Check['status'],
    splitMethod: dto.split_method,
    totalCents: dto.total_cents,
    remainingCents: dto.remaining_cents,
    charges: dto.charges.map(toCharge),
    payments: dto.payments.map(toPayment),
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  }
}

// --- 409 Conflict types ---

export class CheckConflictError extends Error {
  constructor(public readonly code: string) {
    super(`CheckConflictError: ${code}`)
    this.name = 'CheckConflictError'
  }
}

async function parse409(error: ApiError): Promise<CheckConflictError> {
  try {
    const body = JSON.parse(error.body) as { detail?: { code?: string } | string }
    if (typeof body.detail === 'object' && body.detail?.code) {
      return new CheckConflictError(body.detail.code)
    }
    if (typeof body.detail === 'string') {
      return new CheckConflictError(body.detail)
    }
  } catch {
    // ignore parse errors
  }
  return new CheckConflictError('check_conflict')
}

// --- Billing API ---

export const billingApi = {
  /**
   * POST /api/billing/check/request
   * Request a check (cuenta) for the current session.
   * Throws CheckConflictError on 409 (session_not_open, check_already_exists).
   */
  async requestCheck(splitMethod: SplitMethod): Promise<Check> {
    try {
      const dto = await apiPost<CheckDTO>('/api/billing/check/request', {
        split_method: splitMethod,
      } satisfies CheckRequestPayload)
      logger.info('billingApi.requestCheck', { splitMethod, checkId: dto.id })
      return toCheck(dto)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        throw await parse409(err)
      }
      throw err
    }
  },

  /**
   * GET /api/billing/check/{sessionId}
   * Fetch the current check for a session.
   * Returns null if 404 (no check yet for session).
   */
  async getCheck(sessionId: string): Promise<Check | null> {
    try {
      const dto = await apiGet<CheckDTO>(`/api/billing/check/${toNumberId(sessionId)}`)
      return toCheck(dto)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return null
      }
      throw err
    }
  },

  /**
   * GET /api/billing/payment/{paymentId}/status
   * Poll for payment status (WS-first, this is the fallback).
   */
  async getPaymentStatus(paymentId: string): Promise<Payment | null> {
    try {
      const dto = await apiGet<PaymentStatusDTO>(
        `/api/billing/payment/${toNumberId(paymentId)}/status`,
      )
      return {
        id: toStringId(dto.id),
        method: 'mercadopago',
        amountCents: 0, // status-only endpoint — amount not included
        status: dto.status as Payment['status'],
        externalId: dto.external_id,
        paidAt: dto.paid_at,
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return null
      }
      throw err
    }
  },
}

logger.debug('billingApi initialized')
