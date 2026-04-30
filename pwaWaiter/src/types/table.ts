/**
 * Table domain types for pwaWaiter.
 *
 * In C-20 (this change) tables are NOT fetched — C-21 will populate the store.
 * The types are defined here so that tableStore can be typed and tested.
 */

/**
 * Visual/logical status of a table in the waiter view.
 * - AVAILABLE:       free table, no session open
 * - OCCUPIED:        diners seated but waiter has not activated the session
 * - ACTIVE:          TableSession is OPEN (diners can order)
 * - PAYING:          TableSession is PAYING (check requested, awaiting payment)
 * - OUT_OF_SERVICE:  table is temporarily unavailable
 */
export type TableStatus = 'AVAILABLE' | 'OCCUPIED' | 'ACTIVE' | 'PAYING' | 'OUT_OF_SERVICE'

/** Frontend representation of a table (after conversion). C-21: added sessionId/sessionStatus. */
export interface Table {
  /** String ID — stable React key */
  id: string
  /** Alphanumeric table code visible to the waiter (e.g. "INT-01"). */
  code: string
  status: TableStatus
  sectorId: string
  sectorName: string
  /** Non-null when a TableSession is active for this table. */
  sessionId: string | null
  /** Session status string (e.g. 'OPEN', 'PAYING', 'PAID') or null. */
  sessionStatus: string | null
}

/** Raw DTO as returned by the backend (GET /api/waiter/tables). */
export interface TableDTO {
  id: number
  code: string
  status: TableStatus
  sector_id: number
  sector_name: string
  session_id: number | null
  session_status: string | null
}
