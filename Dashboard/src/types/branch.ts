/**
 * Branch domain types for the Dashboard.
 *
 * Convention: id is kept as number (backend type) — converted to string
 * only in Zustand selectors/boundaries via String(branch.id).
 *
 * C-29: dashboard-branch-selector
 */

export interface Branch {
  /** Branch ID — number (backend) — convert to string at selector boundary */
  id: number
  name: string
  address: string
  slug: string
}
