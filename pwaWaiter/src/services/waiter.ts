/**
 * Waiter-scoped HTTP services.
 *
 * Covers:
 *   GET  /api/public/branches                             — public, no auth
 *   GET  /api/waiter/verify-branch-assignment?branch_id=  — JWT (WAITER)
 *   GET  /api/waiter/branches/{branchId}/menu             — compact menu
 *   GET  /api/waiter/tables                               — table list
 *   POST /api/waiter/tables/{tableId}/activate            — activate table
 *   POST /api/waiter/tables/{tableId}/close               — close table
 *   POST /api/waiter/sessions/{sessionId}/rounds          — create round (waiter)
 *   POST /api/waiter/sessions/{sessionId}/rounds/{roundId}/confirm — confirm round
 *   POST /api/waiter/sessions/{sessionId}/check           — request check
 *   POST /api/waiter/payments/manual                      — manual payment
 *   GET  /api/waiter/service-calls                        — list service calls
 *   PUT  /api/waiter/service-calls/{id}/ack               — ack service call
 *   PUT  /api/waiter/service-calls/{id}/close             — close service call
 *   GET  /ws/catchup                                      — catch-up events
 *
 * ID convention: backend = number, frontend = string. Convert at this boundary.
 */
import { fetchAPI } from './api'
import { env } from '@/config/env'
import type { Branch, BranchDTO } from '@/types/branch'
import type {
  VerifyBranchAssignmentResponse,
  WaiterAssignment,
} from '@/types/assignment'
import { toStringId, toNumberId } from '@/utils/idConversion'

// ---------------------------------------------------------------------------
// Pre-login: branches + verify assignment
// ---------------------------------------------------------------------------

/**
 * List all active branches for the waiter pre-login flow.
 * This endpoint is public — no Authorization header is sent.
 */
export async function getPublicBranches(): Promise<Branch[]> {
  const dtos = await fetchAPI<BranchDTO[]>('/api/public/branches', {
    method: 'GET',
    skipAuth: true,
  })
  return dtos.map((dto) => ({
    id: toStringId(dto.id),
    name: dto.name,
    slug: dto.slug,
    address: dto.address,
  }))
}

/**
 * Verify whether the authenticated waiter is assigned to the given branch today.
 */
export async function verifyBranchAssignment(
  branchId: string,
): Promise<WaiterAssignment> {
  const search = new URLSearchParams({ branch_id: branchId })
  const res = await fetchAPI<VerifyBranchAssignmentResponse>(
    `/api/waiter/verify-branch-assignment?${search.toString()}`,
    { method: 'GET' },
  )

  if (res.assigned && res.sector_id !== undefined && res.sector_name !== undefined) {
    return {
      assigned: true,
      sectorId: toStringId(res.sector_id),
      sectorName: res.sector_name,
    }
  }
  return { assigned: false }
}

// ---------------------------------------------------------------------------
// DTOs (backend shapes — number IDs)
// ---------------------------------------------------------------------------

export interface CompactProductDTO {
  id: number
  name: string
  price_cents: number
  is_available: boolean
  subcategory_id?: number
}

export interface CompactSubcategoryDTO {
  id: number
  name: string
  order: number
  products: CompactProductDTO[]
}

export interface CompactCategoryDTO {
  id: number
  name: string
  order: number
  subcategories: CompactSubcategoryDTO[]
}

export interface CompactMenuResponseDTO {
  categories: CompactCategoryDTO[]
  branch_id?: number
}

/** Frontend-safe shapes (string IDs) */
export interface CompactProduct {
  id: string
  name: string
  priceCents: number
  subcategoryId: string
  isAvailable: boolean
}

export interface CompactCategory {
  id: string
  name: string
}

export interface CompactMenuDTO {
  branchId: string
  categories: CompactCategory[]
  products: CompactProduct[]
}

export interface TableDTO {
  id: number
  code: string
  status: string
  sector_id: number
  sector_name: string
  session_id?: number | null
  session_status?: string | null
}

export interface TableSessionDTO {
  id: string
  tableId: string
  status: string
  openedAt: string
}

export interface RoundItemDTO {
  id: number
  product_id: number
  quantity: number
  notes?: string | null
}

export interface CreateRoundItemDTO {
  product_id: number
  quantity: number
  notes?: string
}

export interface CreateRoundDTO {
  items: CreateRoundItemDTO[]
  client_op_id: string
}

export interface RoundDTO {
  id: string
  sessionId: string
  status: string
  items: Array<{
    id: string
    productId: string
    quantity: number
    notes?: string | null
  }>
  createdAt: string
}

export interface CheckDTO {
  id: string
  sessionId: string
  status: string
  totalCents: number
}

export interface ManualPaymentDTO {
  session_id: number
  amount_cents: number
  method: 'cash' | 'card' | 'transfer'
  reference?: string
  client_op_id: string
}

export interface PaymentDTO {
  id: string
  sessionId: string
  amountCents: number
  method: string
  status: string
  createdAt: string
}

export interface ServiceCallDTO {
  id: string
  tableId: string
  sectorId: string
  status: 'OPEN' | 'ACKED' | 'CLOSED'
  createdAt: string
  ackedAt?: string | null
}

export interface WaiterEventDTO {
  event_type: string
  tenant_id: number
  branch_id: number
  sector_id?: number
  timestamp?: string
  payload: unknown
}

// ---------------------------------------------------------------------------
// 2.1 Compact menu
// ---------------------------------------------------------------------------

export async function getCompactMenu(branchId: string): Promise<CompactMenuDTO> {
  const dto = await fetchAPI<CompactMenuResponseDTO>(
    `/api/waiter/branches/${branchId}/menu`,
    { method: 'GET' },
  )

  const categories: CompactCategory[] = dto.categories.map((cat) => ({
    id: toStringId(cat.id),
    name: cat.name,
  }))

  // Flatten products out of category → subcategory → products hierarchy
  const products: CompactProduct[] = dto.categories.flatMap((cat) =>
    cat.subcategories.flatMap((sub) =>
      sub.products.map((p) => ({
        id: toStringId(p.id),
        name: p.name,
        priceCents: p.price_cents,
        subcategoryId: toStringId(p.subcategory_id ?? sub.id),
        isAvailable: p.is_available,
      })),
    ),
  )

  return {
    branchId,
    categories,
    products,
  }
}

// ---------------------------------------------------------------------------
// 2.2 Create waiter round
// ---------------------------------------------------------------------------

export interface CreateRoundPayload {
  items: Array<{ productId: string; quantity: number; notes?: string }>
}

export async function createWaiterRound(
  sessionId: string,
  payload: CreateRoundPayload,
  clientOpId: string,
): Promise<RoundDTO> {
  const body: CreateRoundDTO = {
    items: payload.items.map((i) => ({
      product_id: toNumberId(i.productId),
      quantity: i.quantity,
      ...(i.notes ? { notes: i.notes } : {}),
    })),
    client_op_id: clientOpId,
  }

  const dto = await fetchAPI<{
    id: number
    session_id: number
    status: string
    items: RoundItemDTO[]
    created_at: string
  }>(`/api/waiter/sessions/${sessionId}/rounds`, {
    method: 'POST',
    body,
    headers: { 'Idempotency-Key': clientOpId },
  })

  return {
    id: toStringId(dto.id),
    sessionId: toStringId(dto.session_id),
    status: dto.status,
    items: dto.items.map((item) => ({
      id: toStringId(item.id),
      productId: toStringId(item.product_id),
      quantity: item.quantity,
      notes: item.notes,
    })),
    createdAt: dto.created_at,
  }
}

// ---------------------------------------------------------------------------
// 2.3 Confirm round (PENDING → CONFIRMED)
// ---------------------------------------------------------------------------

export async function confirmRound(
  _sessionId: string,
  roundId: string,
  clientOpId: string,
): Promise<RoundDTO> {
  const dto = await fetchAPI<{
    id: number
    session_id: number
    status: string
    items?: RoundItemDTO[]
    created_at: string
  }>(`/api/waiter/rounds/${roundId}`, {
    method: 'PATCH',
    body: { status: 'CONFIRMED' },
    headers: { 'Idempotency-Key': clientOpId },
  })

  return {
    id: toStringId(dto.id),
    sessionId: toStringId(dto.session_id),
    status: dto.status,
    items: (dto.items ?? []).map((item) => ({
      id: toStringId(item.id),
      productId: toStringId(item.product_id),
      quantity: item.quantity,
      notes: item.notes,
    })),
    createdAt: dto.created_at,
  }
}

// ---------------------------------------------------------------------------
// 2.4 List rounds for a session (initial load when visiting table detail)
// ---------------------------------------------------------------------------

export async function listSessionRounds(sessionId: string): Promise<RoundDTO[]> {
  const dtos = await fetchAPI<Array<{
    id: number
    session_id: number
    status: string
    items: RoundItemDTO[]
    created_at: string
  }>>(`/api/waiter/rounds?session_id=${sessionId}`)

  return dtos.map((dto) => ({
    id: toStringId(dto.id),
    sessionId: toStringId(dto.session_id),
    status: dto.status,
    items: dto.items.map((item) => ({
      id: toStringId(item.id),
      productId: toStringId(item.product_id),
      quantity: item.quantity,
      notes: item.notes,
    })),
    createdAt: dto.created_at,
  }))
}

// ---------------------------------------------------------------------------
// 2.5 Request check (waiter-initiated)
// ---------------------------------------------------------------------------

export async function requestCheck(
  sessionId: string,
  clientOpId: string,
): Promise<CheckDTO> {
  const dto = await fetchAPI<{
    id: number
    session_id: number
    status: string
    total_cents: number
  }>(`/api/waiter/sessions/${sessionId}/check`, {
    method: 'POST',
    body: { client_op_id: clientOpId },
    headers: { 'Idempotency-Key': clientOpId },
  })

  return {
    id: toStringId(dto.id),
    sessionId: toStringId(dto.session_id),
    status: dto.status,
    totalCents: dto.total_cents,
  }
}

// ---------------------------------------------------------------------------
// 2.5 Submit manual payment
// ---------------------------------------------------------------------------

export interface ManualPaymentPayload {
  sessionId: string
  amountCents: number
  method: 'cash' | 'card' | 'transfer'
  reference?: string
}

export async function submitManualPayment(
  payload: ManualPaymentPayload,
  clientOpId: string,
): Promise<PaymentDTO> {
  const body: ManualPaymentDTO = {
    session_id: toNumberId(payload.sessionId),
    amount_cents: payload.amountCents,
    method: payload.method,
    client_op_id: clientOpId,
    ...(payload.reference ? { reference: payload.reference } : {}),
  }

  const dto = await fetchAPI<{
    id: number
    session_id: number
    amount_cents: number
    method: string
    status: string
    created_at: string
  }>('/api/waiter/payments/manual', {
    method: 'POST',
    body,
    headers: { 'Idempotency-Key': clientOpId },
  })

  return {
    id: toStringId(dto.id),
    sessionId: toStringId(dto.session_id),
    amountCents: dto.amount_cents,
    method: dto.method,
    status: dto.status,
    createdAt: dto.created_at,
  }
}

// ---------------------------------------------------------------------------
// 2.6 Close table
// ---------------------------------------------------------------------------

export async function closeTable(
  tableId: string,
  clientOpId: string,
): Promise<void> {
  await fetchAPI<void>(`/api/waiter/tables/${tableId}/close`, {
    method: 'POST',
    body: { client_op_id: clientOpId },
    headers: { 'Idempotency-Key': clientOpId },
  })
}

// ---------------------------------------------------------------------------
// 2.7 Service calls: list, ack, close
// ---------------------------------------------------------------------------

export async function listServiceCalls(): Promise<ServiceCallDTO[]> {
  const dtos = await fetchAPI<
    Array<{
      id: number
      table_id: number
      sector_id: number
      status: 'OPEN' | 'ACKED' | 'CLOSED'
      created_at: string
      acked_at?: string | null
    }>
  >('/api/waiter/service-calls', { method: 'GET' })

  return dtos.map((dto) => ({
    id: toStringId(dto.id),
    tableId: toStringId(dto.table_id),
    sectorId: toStringId(dto.sector_id),
    status: dto.status,
    createdAt: dto.created_at,
    ackedAt: dto.acked_at,
  }))
}

export async function ackServiceCall(
  id: string,
  clientOpId: string,
): Promise<ServiceCallDTO> {
  const dto = await fetchAPI<{
    id: number
    table_id: number
    sector_id: number
    status: 'OPEN' | 'ACKED' | 'CLOSED'
    created_at: string
    acked_at?: string | null
  }>(`/api/waiter/service-calls/${id}/ack`, {
    method: 'PUT',
    body: { client_op_id: clientOpId },
    headers: { 'Idempotency-Key': clientOpId },
  })

  return {
    id: toStringId(dto.id),
    tableId: toStringId(dto.table_id),
    sectorId: toStringId(dto.sector_id),
    status: dto.status,
    createdAt: dto.created_at,
    ackedAt: dto.acked_at,
  }
}

export async function closeServiceCall(
  id: string,
  clientOpId: string,
): Promise<void> {
  await fetchAPI<void>(`/api/waiter/service-calls/${id}/close`, {
    method: 'PUT',
    body: { client_op_id: clientOpId },
    headers: { 'Idempotency-Key': clientOpId },
  })
}

// ---------------------------------------------------------------------------
// 2.8 Fetch waiter tables (real data — replaces mock from C-20)
// ---------------------------------------------------------------------------

export interface WaiterTableDTO {
  id: string
  code: string
  status: string
  sectorId: string
  sectorName: string
  sessionId?: string | null
  sessionStatus?: string | null
}

export async function fetchWaiterTables(): Promise<WaiterTableDTO[]> {
  const dtos = await fetchAPI<TableDTO[]>('/api/waiter/tables', {
    method: 'GET',
  })

  return dtos.map((dto) => ({
    id: toStringId(dto.id),
    code: dto.code,
    status: dto.status,
    sectorId: toStringId(dto.sector_id),
    sectorName: dto.sector_name,
    sessionId: dto.session_id != null ? toStringId(dto.session_id) : null,
    sessionStatus: dto.session_status ?? null,
  }))
}

// ---------------------------------------------------------------------------
// 2.9 Activate table
// ---------------------------------------------------------------------------

export async function activateTable(tableId: string): Promise<TableSessionDTO> {
  const dto = await fetchAPI<{
    id: number
    table_id: number
    status: string
    opened_at: string
  }>(`/api/waiter/tables/${tableId}/activate`, {
    method: 'POST',
    body: {},
  })

  return {
    id: toStringId(dto.id),
    tableId: toStringId(dto.table_id),
    status: dto.status,
    openedAt: dto.opened_at,
  }
}

// ---------------------------------------------------------------------------
// 2.10 Catch-up events (WS gateway endpoint)
// ---------------------------------------------------------------------------

export interface CatchupResponse {
  events: WaiterEventDTO[]
  partial: boolean
}

export async function catchupWaiterEvents(
  branchId: string,
  since: number,
): Promise<CatchupResponse> {
  // Note: this hits the WS gateway (port 8001) not the REST API (port 8000)
  // JWT is sent via Authorization: Bearer header (NOT as ?token= query param).
  // This prevents token from leaking into nginx access logs, Sentry URL capture,
  // browser history, and Referer headers.
  const token = (await import('@/stores/authStore').then((m) => m.getAccessToken())) ?? ''
  const search = new URLSearchParams({
    branch_id: branchId,
    since: String(since),
  })
  const url = `${env.WS_URL}/ws/catchup?${search.toString()}`

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
  if (!response.ok) {
    throw new Error(`Catchup failed: ${response.status}`)
  }

  return response.json() as Promise<CatchupResponse>
}
