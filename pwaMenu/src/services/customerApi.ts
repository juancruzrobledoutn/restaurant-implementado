/**
 * Customer API service for pwaMenu (C-19 / Task 7.2).
 *
 * Authenticated via X-Table-Token (injected by api.ts).
 * All IDs: backend number → frontend string at this boundary.
 *
 * Endpoints:
 *   GET  /api/customer/profile      → getProfile()
 *   POST /api/customer/opt-in       → optIn(payload)
 *   GET  /api/customer/history      → getHistory()
 *   GET  /api/customer/preferences  → getPreferences()
 */
import { apiGet, apiPost, ApiError } from './api'

import { logger } from '../utils/logger'
import type { CustomerProfile, VisitEntry, PreferenceEntry, OptInPayload } from '../types/billing'

// --- DTO types (backend shape) ---

interface CustomerProfileDTO {
  id: string
  device_hint: string | null
  name: string | null
  email: string | null
  opted_in: boolean
  consent_version: string | null
}

interface VisitDTO {
  session_id: string
  branch_id: string
  status: string
  visited_at: string
}

interface PreferenceDTO {
  product_id: string
  product_name: string
  total_quantity: number
}

// --- Converters ---

function toProfile(dto: CustomerProfileDTO): CustomerProfile {
  return {
    id: dto.id,
    deviceHint: dto.device_hint,
    name: dto.name,
    email: dto.email,
    optedIn: dto.opted_in,
    consentVersion: dto.consent_version,
  }
}

function toVisit(dto: VisitDTO): VisitEntry {
  return {
    sessionId: dto.session_id,
    branchId: dto.branch_id,
    status: dto.status,
    visitedAt: dto.visited_at,
  }
}

function toPreference(dto: PreferenceDTO): PreferenceEntry {
  return {
    productId: dto.product_id,
    productName: dto.product_name,
    totalQuantity: dto.total_quantity,
  }
}

// --- Customer API ---

export class CustomerNotFoundError extends Error {
  constructor() {
    super('customer_not_found')
    this.name = 'CustomerNotFoundError'
  }
}

export class AlreadyOptedInError extends Error {
  constructor() {
    super('already_opted_in')
    this.name = 'AlreadyOptedInError'
  }
}

export class ConsentRequiredError extends Error {
  constructor() {
    super('consent_required')
    this.name = 'ConsentRequiredError'
  }
}

export const customerApi = {
  /**
   * GET /api/customer/profile
   * Returns the customer profile for the current diner.
   * Throws CustomerNotFoundError on 404 (anonymous diner).
   */
  async getProfile(): Promise<CustomerProfile> {
    try {
      const dto = await apiGet<CustomerProfileDTO>('/api/customer/profile')
      return toProfile(dto)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        throw new CustomerNotFoundError()
      }
      throw err
    }
  },

  /**
   * POST /api/customer/opt-in
   * Record explicit GDPR consent.
   * Throws:
   *   ConsentRequiredError on 400 (consent_granted was false)
   *   AlreadyOptedInError on 409 (already opted in)
   */
  async optIn(payload: OptInPayload): Promise<CustomerProfile> {
    try {
      const dto = await apiPost<CustomerProfileDTO>('/api/customer/opt-in', payload)
      logger.info('customerApi.optIn: success')
      return toProfile(dto)
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 400) {
          throw new ConsentRequiredError()
        }
        if (err.status === 409) {
          throw new AlreadyOptedInError()
        }
      }
      throw err
    }
  },

  /**
   * GET /api/customer/history
   * Returns last 20 visits for the current customer.
   * Returns empty array on 404 (anonymous diner) — non-fatal.
   */
  async getHistory(): Promise<VisitEntry[]> {
    try {
      const dtos = await apiGet<VisitDTO[]>('/api/customer/history')
      return dtos.map(toVisit)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return []
      }
      throw err
    }
  },

  /**
   * GET /api/customer/preferences
   * Returns top 5 product preferences for the current customer.
   * Returns empty array on 404 (anonymous diner) — non-fatal.
   */
  async getPreferences(): Promise<PreferenceEntry[]> {
    try {
      const dtos = await apiGet<PreferenceDTO[]>('/api/customer/preferences')
      return dtos.map(toPreference)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return []
      }
      throw err
    }
  },
}

logger.debug('customerApi initialized')
