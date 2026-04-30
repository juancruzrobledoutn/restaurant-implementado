/**
 * Domain types for session (frontend — IDs are strings).
 */

export interface Session {
  id: string
  branchSlug: string
  tableCode: string
  status: 'active' | 'closed' | 'expired'
}

export interface Diner {
  id: string
  name: string
  color: string
}
