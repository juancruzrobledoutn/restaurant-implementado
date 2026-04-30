/**
 * Waiter-branch assignment types.
 *
 * The backend endpoint GET /api/waiter/verify-branch-assignment?branch_id={id}
 * ALWAYS returns HTTP 200 with the same shape (design decision D-03 in C-13):
 *   - { assigned: true, sector_id, sector_name } when assigned today
 *   - { assigned: false } when not assigned
 * This prevents enumeration of sectors/branches across tenants.
 */

/** Raw DTO as returned by the backend. */
export interface VerifyBranchAssignmentResponse {
  assigned: boolean
  sector_id?: number
  sector_name?: string
}

/**
 * Frontend-side representation with discriminated union.
 * IDs converted to strings at the boundary.
 */
export type WaiterAssignment =
  | {
      assigned: true
      sectorId: string
      sectorName: string
    }
  | { assigned: false }
