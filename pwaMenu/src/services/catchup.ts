/**
 * Session catch-up service.
 * Fetches missed WS events from the backend after a reconnection.
 * Endpoint: GET /ws/catchup/session?session_id=...&since=...
 * Auth: X-Table-Token header (injected by apiGet via sessionStore)
 */
import { apiGet } from './api'
import type { WsEvent } from '../types/wsEvents'
import { logger } from '../utils/logger'

export interface CatchupOkResponse {
  status: 'ok'
  events: WsEvent[]
}

export interface CatchupTooOldResponse {
  status: 'too_old'
}

export type CatchupResponse = CatchupOkResponse | CatchupTooOldResponse

interface CatchupDTO {
  status: 'ok' | 'too_old'
  events?: WsEvent[]
}

export async function fetchSessionCatchup(
  sessionId: string,
  since: string,
  signal?: AbortSignal,
): Promise<CatchupResponse> {
  try {
    const params = new URLSearchParams({ session_id: sessionId, since })
    const dto = await apiGet<CatchupDTO>(
      `/ws/catchup/session?${params.toString()}`,
      { signal },
    )

    if (dto.status === 'too_old') {
      logger.info('catchup: too_old response, fallback to full rehydration')
      return { status: 'too_old' }
    }

    logger.info('catchup: received events', { count: dto.events?.length ?? 0 })
    return { status: 'ok', events: dto.events ?? [] }
  } catch (err) {
    logger.error('catchup: failed to fetch', err)
    // On network error, treat as too_old to trigger full rehydration
    return { status: 'too_old' }
  }
}
