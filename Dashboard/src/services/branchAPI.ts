/**
 * branchAPI — REST client for the public branches endpoint.
 *
 * Endpoint: GET /api/public/branches (no auth required — public endpoint)
 * ID convention: backend returns number IDs; we keep them as numbers here and
 * convert to string at the Zustand boundary (branchStore.setSelectedBranch).
 *
 * Skill: vercel-react-best-practices, zustand-store-pattern
 */

import { fetchAPI } from '@/services/api'
import type { Branch } from '@/types/branch'

interface BackendBranch {
  id: number
  name: string
  address: string
  slug: string
}

function toBranch(b: BackendBranch): Branch {
  return {
    id: b.id,
    name: b.name,
    address: b.address,
    slug: b.slug,
  }
}

export const branchAPI = {
  /**
   * Fetch all active branches from the tenant.
   * Auth is skipped — this is a public endpoint.
   */
  getBranches: async (): Promise<Branch[]> => {
    const data = await fetchAPI<BackendBranch[]>('/api/public/branches', {
      skipAuth: true,
    })
    return data.map(toBranch)
  },
}
