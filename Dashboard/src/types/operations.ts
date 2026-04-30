/**
 * Operations domain types for Dashboard (C-16).
 *
 * Convention:
 * - All IDs are strings in the frontend (backend returns numbers — convert at boundary)
 * - Prices are integers in cents (12550 = $125.50)
 * - FormData types are used for create/edit modal state
 * - Backend responses use snake_case; these types mirror that shape after conversion
 */

// ---------------------------------------------------------------------------
// Role type (mirrors backend RBAC)
// ---------------------------------------------------------------------------

export type Role = 'ADMIN' | 'MANAGER' | 'KITCHEN' | 'WAITER'

// ---------------------------------------------------------------------------
// BranchSector
// ---------------------------------------------------------------------------

export interface Sector {
  id: string
  name: string
  branch_id: string
  is_active: boolean
  created_at?: string
  updated_at?: string
  _optimistic?: boolean
}

export interface SectorFormData {
  name: string
  branch_id: string
  is_active: boolean
}

// ---------------------------------------------------------------------------
// Table (app_table)
// ---------------------------------------------------------------------------

export type TableStatus = 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'OUT_OF_SERVICE'

export interface Table {
  id: string
  number: number
  code: string
  sector_id: string
  capacity: number
  status: TableStatus
  branch_id: string
  is_active: boolean
  created_at?: string
  updated_at?: string
  _optimistic?: boolean
}

export interface TableFormData {
  number: number
  code: string
  sector_id: string
  capacity: number
  status: TableStatus
  branch_id: string
  is_active: boolean
}

// ---------------------------------------------------------------------------
// Staff (User with roles)
// ---------------------------------------------------------------------------

export interface UserBranchAssignment {
  branch_id: string
  branch_name: string
  role: Role
}

export interface StaffUser {
  id: string
  email: string
  first_name: string
  last_name: string
  is_active: boolean
  assignments: UserBranchAssignment[]
  _optimistic?: boolean
}

/** Full name derived from first_name + last_name */
export function getFullName(user: Pick<StaffUser, 'first_name' | 'last_name'>): string {
  return `${user.first_name} ${user.last_name}`.trim()
}

export interface StaffFormData {
  email: string
  first_name: string
  last_name: string
  password?: string
  is_active: boolean
}

// ---------------------------------------------------------------------------
// WaiterAssignment (daily sector assignment)
// ---------------------------------------------------------------------------

/** Mini user reference for denormalized assignment display */
export interface UserMini {
  id: string
  email: string
  first_name: string
  last_name: string
}

/** Mini sector reference for denormalized assignment display */
export interface SectorMini {
  id: string
  name: string
}

export interface WaiterAssignment {
  id: string
  user_id: string
  sector_id: string
  date: string    // YYYY-MM-DD
  user?: UserMini
  sector?: SectorMini
}

export interface WaiterAssignmentFormData {
  user_id: string
  sector_id: string
  date: string
}

// ---------------------------------------------------------------------------
// Kitchen Display
// ---------------------------------------------------------------------------

export interface KitchenRoundItem {
  product_name: string
  quantity: number
  notes?: string
  is_voided: boolean
}

export type KitchenRoundStatus = 'SUBMITTED' | 'IN_KITCHEN' | 'READY'

export interface KitchenRound {
  id: string
  session_id: string
  branch_id: string
  status: KitchenRoundStatus
  submitted_at: string    // ISO 8601
  table_number: number
  sector_name: string
  diner_count: number
  items: KitchenRoundItem[]
}

// ---------------------------------------------------------------------------
// Sales KPIs
// ---------------------------------------------------------------------------

export interface DailyKPIs {
  revenue_cents: number
  orders: number
  average_ticket_cents: number
  diners: number
}

export interface TopProduct {
  product_id: string
  product_name: string
  quantity_sold: number
  revenue_cents: number
}

// ---------------------------------------------------------------------------
// WebSocket event types for operations (extends menu.ts WSEventType)
// ---------------------------------------------------------------------------

/** Additional WS event types for operations domain (C-16). */
export type OperationsWSEventType =
  | 'ROUND_PENDING'
  | 'ROUND_CONFIRMED'
  | 'ROUND_SUBMITTED'
  | 'ROUND_IN_KITCHEN'
  | 'ROUND_READY'
  | 'ROUND_SERVED'
  | 'ROUND_CANCELED'
  | 'TABLE_STATUS_CHANGED'
  | 'TABLE_SESSION_STARTED'
  | 'TABLE_CLEARED'

// ---------------------------------------------------------------------------
// Admin Orders (C-25)
// ---------------------------------------------------------------------------

/** All 7 possible round states. */
export type RoundStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'SUBMITTED'
  | 'IN_KITCHEN'
  | 'READY'
  | 'SERVED'
  | 'CANCELED'

/** A single round item (non-kitchen-facing — includes voided state). */
export interface RoundItem {
  id: string
  round_id: string
  product_id: string
  diner_id: string | null
  quantity: number
  notes: string | null
  price_cents_snapshot: number
  is_voided: boolean
  void_reason: string | null
  voided_at: string | null
  created_at: string
  updated_at: string
}

/** Admin-enriched round (denormalized for UI — no N+1 needed). */
export interface Round {
  id: string
  round_number: number
  session_id: string
  branch_id: string
  status: RoundStatus
  // Denorm for UI
  table_id: string
  table_code: string
  table_number: number
  sector_id: string | null
  sector_name: string | null
  diner_id: string | null
  diner_name: string | null
  items_count: number
  total_cents: number
  // State-machine timestamps
  pending_at: string
  confirmed_at: string | null
  submitted_at: string | null
  in_kitchen_at: string | null
  ready_at: string | null
  served_at: string | null
  canceled_at: string | null
  cancel_reason: string | null
  created_by_role: string
  created_at: string
  updated_at: string
  // Detail (only when fetched individually)
  items?: RoundItem[]
}

/** Active filters for the admin rounds list. */
export interface RoundFilters {
  branch_id: string
  date: string          // YYYY-MM-DD
  sector_id?: string
  status?: RoundStatus
  table_code?: string
  limit: number
  offset: number
}

/** Paginated list response for GET /api/admin/rounds. */
export interface RoundListResponse {
  items: Round[]
  total: number
  limit: number
  offset: number
}

/** View mode for the Orders page — persisted to localStorage. */
export type ViewMode = 'columns' | 'list'
