/**
 * Branch domain types for pwaWaiter.
 *
 * Backend returns numeric IDs under snake_case names; the frontend uses string
 * IDs and camelCase. Conversion happens at the services layer.
 */

/** Frontend representation of a branch (after conversion). */
export interface Branch {
  id: string
  name: string
  slug: string
  address: string
}

/** Raw DTO as returned by GET /api/public/branches. */
export interface BranchDTO {
  id: number
  name: string
  slug: string
  address: string
}
