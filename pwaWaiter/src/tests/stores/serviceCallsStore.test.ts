/**
 * serviceCallsStore tests — hydrate, upsert, remove, filters.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  useServiceCallsStore,
  useActiveCalls,
  useCallsByTable,
  useCallsBySector,
} from '@/stores/serviceCallsStore'
import type { ServiceCallDTO } from '@/services/waiter'

const CALL_1: ServiceCallDTO = {
  id: 'c-1',
  tableId: 't-3',
  sectorId: 's-5',
  status: 'OPEN',
  createdAt: '2026-04-18T10:00:00Z',
  ackedAt: null,
}

const CALL_2: ServiceCallDTO = {
  id: 'c-2',
  tableId: 't-4',
  sectorId: 's-6',
  status: 'ACKED',
  createdAt: '2026-04-18T10:01:00Z',
  ackedAt: '2026-04-18T10:02:00Z',
}

describe('serviceCallsStore', () => {
  beforeEach(() => {
    useServiceCallsStore.setState({ byId: {} })
  })

  it('hydrate replaces all entries', () => {
    useServiceCallsStore.getState().hydrate([CALL_1, CALL_2])
    const { byId } = useServiceCallsStore.getState()
    expect(Object.keys(byId)).toHaveLength(2)
    expect(byId['c-1']).toEqual(CALL_1)
    expect(byId['c-2']).toEqual(CALL_2)
  })

  it('upsert inserts a new call', () => {
    useServiceCallsStore.getState().upsert(CALL_1)
    expect(useServiceCallsStore.getState().byId['c-1']).toEqual(CALL_1)
  })

  it('upsert updates an existing call (idempotent by id)', () => {
    useServiceCallsStore.getState().upsert(CALL_1)
    const updated: ServiceCallDTO = { ...CALL_1, status: 'ACKED', ackedAt: '2026-04-18T10:01:00Z' }
    useServiceCallsStore.getState().upsert(updated)

    expect(useServiceCallsStore.getState().byId['c-1']?.status).toBe('ACKED')
  })

  it('remove deletes a call by id', () => {
    useServiceCallsStore.getState().hydrate([CALL_1, CALL_2])
    useServiceCallsStore.getState().remove('c-1')

    const { byId } = useServiceCallsStore.getState()
    expect('c-1' in byId).toBe(false)
    expect('c-2' in byId).toBe(true)
  })

  it('useActiveCalls returns non-CLOSED calls', () => {
    useServiceCallsStore.getState().hydrate([
      CALL_1, // OPEN
      CALL_2, // ACKED
      { ...CALL_1, id: 'c-3', status: 'CLOSED' },
    ])

    const { result } = renderHook(() => useActiveCalls())
    expect(result.current).toHaveLength(2) // OPEN + ACKED
    expect(result.current.every((c) => c.status !== 'CLOSED')).toBe(true)
  })

  it('useCallsByTable filters by tableId and excludes CLOSED', () => {
    useServiceCallsStore.getState().hydrate([CALL_1, CALL_2])

    const { result } = renderHook(() => useCallsByTable('t-3'))
    expect(result.current).toHaveLength(1)
    expect(result.current[0]?.tableId).toBe('t-3')
  })

  it('useCallsBySector filters by sectorId and excludes CLOSED', () => {
    useServiceCallsStore.getState().hydrate([CALL_1, CALL_2])

    const { result } = renderHook(() => useCallsBySector('s-5'))
    expect(result.current).toHaveLength(1)
    expect(result.current[0]?.sectorId).toBe('s-5')
  })
})
