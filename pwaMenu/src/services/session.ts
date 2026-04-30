/**
 * Session service — diner-authenticated endpoint.
 * Converts DTOs → domain types.
 */
import { apiGet } from './api'
import { toStringId } from '../utils/idConversion'
import type { Session } from '../types/session'

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

export async function getDinerSession(signal?: AbortSignal): Promise<Session> {
  const dto = await apiGet<DinerSessionViewDTO>('/api/diner/session', { signal })
  return {
    id: toStringId(dto.session.id),
    branchSlug: dto.branch_slug,
    tableCode: dto.table.code,
    status: dto.session.status,
  }
}
