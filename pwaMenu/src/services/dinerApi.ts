/**
 * Diner API service — authenticated with X-Table-Token.
 * All IDs converted from backend number → frontend string at this boundary.
 * Handles 409 structured errors: session_paying, insufficient_stock.
 */
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from './api'
import { toStringId, toNumberId } from '../utils/idConversion'
import type { CartItem } from '../types/cart'
import type { Round, RoundItem } from '../types/round'
import { logger } from '../utils/logger'

// --- 409 error types ---

export interface SessionPayingError {
  reason: 'session_paying'
}

export interface InsufficientStockProduct {
  product_id: number
  name: string
  requested: number
  available: number
}

export interface InsufficientStockError {
  reason: 'insufficient_stock'
  products: InsufficientStockProduct[]
}

export type ApiConflictError = SessionPayingError | InsufficientStockError

export class CartConflictError extends Error {
  constructor(public readonly detail: ApiConflictError) {
    super(`CartConflictError: ${detail.reason}`)
    this.name = 'CartConflictError'
  }
}

// --- DTO types ---

interface CartItemDTO {
  item_id: number
  product_id: number
  product_name: string
  quantity: number
  notes: string
  price_cents_snapshot: number
  diner_id: number
  diner_name: string
  added_at: string
}

interface RoundItemDTO {
  id: number
  product_id: number
  product_name: string
  quantity: number
  notes: string
  price_cents_snapshot: number
  diner_id: number
  diner_name: string
}

interface RoundDTO {
  id: number
  session_id: number
  round_number: number
  status: string
  items: RoundItemDTO[]
  notes: string
  submitted_at: string
  ready_at: string | null
  served_at: string | null
}

// DinerSessionView shape returned by GET /api/diner/session
interface DinerSessionViewDTO {
  session: {
    id: number
    status: string
  }
  table: {
    code: string
    status: string
  }
  branch_slug: string
}

// --- Converters ---

function toCartItem(dto: CartItemDTO): CartItem {
  return {
    id: toStringId(dto.item_id),
    productId: toStringId(dto.product_id),
    productName: dto.product_name,
    quantity: dto.quantity,
    notes: dto.notes,
    priceCentsSnapshot: dto.price_cents_snapshot,
    dinerId: toStringId(dto.diner_id),
    dinerName: dto.diner_name,
    pending: false,
    addedAt: dto.added_at,
  }
}

function toRoundItem(dto: RoundItemDTO): RoundItem {
  return {
    id: toStringId(dto.id),
    productId: toStringId(dto.product_id),
    productName: dto.product_name,
    quantity: dto.quantity,
    notes: dto.notes,
    priceCentsSnapshot: dto.price_cents_snapshot,
    dinerId: toStringId(dto.diner_id),
    dinerName: dto.diner_name,
  }
}

function toRound(dto: RoundDTO): Round {
  return {
    id: toStringId(dto.id),
    sessionId: toStringId(dto.session_id),
    roundNumber: dto.round_number,
    status: dto.status as Round['status'],
    items: dto.items.map(toRoundItem),
    notes: dto.notes,
    submittedAt: dto.submitted_at,
    readyAt: dto.ready_at,
    servedAt: dto.served_at,
  }
}

// --- Parse 409 conflict errors ---

async function parse409(error: ApiError): Promise<CartConflictError> {
  try {
    const body = JSON.parse(error.body) as { detail?: ApiConflictError }
    if (body.detail?.reason) {
      return new CartConflictError(body.detail)
    }
  } catch {
    // ignore parse errors
  }
  return new CartConflictError({ reason: 'session_paying' })
}

// --- Cart API ---

export const cartApi = {
  async add(payload: { product_id: string; quantity: number; notes?: string }): Promise<CartItem> {
    try {
      const dto = await apiPost<CartItemDTO>('/api/diner/cart/add', {
        product_id: toNumberId(payload.product_id),
        quantity: payload.quantity,
        notes: payload.notes ?? '',
      })
      return toCartItem(dto)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        throw await parse409(err)
      }
      throw err
    }
  },

  async update(
    itemId: string,
    payload: { quantity?: number; notes?: string },
  ): Promise<CartItem> {
    try {
      const dto = await apiPatch<CartItemDTO>(`/api/diner/cart/${toNumberId(itemId)}`, payload)
      return toCartItem(dto)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        throw await parse409(err)
      }
      throw err
    }
  },

  async remove(itemId: string): Promise<void> {
    try {
      await apiDelete(`/api/diner/cart/${toNumberId(itemId)}`)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        throw await parse409(err)
      }
      throw err
    }
  },

  async list(): Promise<CartItem[]> {
    const dtos = await apiGet<CartItemDTO[]>('/api/diner/cart')
    return dtos.map(toCartItem)
  },
}

// --- Rounds API ---

export const roundsApi = {
  async submit(notes?: string): Promise<Round> {
    try {
      const dto = await apiPost<RoundDTO>('/api/diner/rounds', { notes: notes ?? '' })
      return toRound(dto)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        throw await parse409(err)
      }
      throw err
    }
  },

  async list(): Promise<Round[]> {
    const dtos = await apiGet<RoundDTO[]>('/api/diner/rounds')
    return dtos.map(toRound)
  },
}

// --- Session API ---

export interface SessionInfo {
  id: string
  branchSlug: string
  tableCode: string
  status: string
  tableStatus: 'OPEN' | 'PAYING' | 'CLOSED'
}

export const sessionApi = {
  async get(): Promise<SessionInfo> {
    const dto = await apiGet<DinerSessionViewDTO>('/api/diner/session')
    return {
      id: toStringId(dto.session.id),
      branchSlug: dto.branch_slug,
      tableCode: dto.table.code,
      status: dto.session.status,
      tableStatus: (dto.table.status as 'OPEN' | 'PAYING' | 'CLOSED') ?? 'OPEN',
    }
  },
}

logger.debug('dinerApi initialized')
