/**
 * useEnqueuedAction tests — happy path, enqueue-on-network-error, no-enqueue-on-4xx.
 *
 * Coverage (task 14.5):
 * - success: fn resolves → returns { status: 'success', data }
 * - enqueue on network error: fn rejects (non-4xx) → returns { status: 'queued' }
 * - no-enqueue on 4xx: fn rejects with APIError 400-499 → returns { status: 'failed' }
 * - queue full: fn rejects network, queue returns 'full' → returns { status: 'failed' }
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useEnqueuedAction } from '@/hooks/useEnqueuedAction'
import { useRetryQueueStore, __resetIdb, __clearAll } from '@/stores/retryQueueStore'
import { APIError } from '@/services/api'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  __resetIdb()
  await __clearAll()
  useRetryQueueStore.setState({ entries: [], isDraining: false })
})

// ---------------------------------------------------------------------------
// Helper — render the hook and invoke the returned action
// ---------------------------------------------------------------------------

async function invokeAction<TArgs, TResult>(
  options: Parameters<typeof useEnqueuedAction<TArgs, TResult>>[0],
  args: TArgs,
) {
  const { result } = renderHook(() => useEnqueuedAction<TArgs, TResult>(options))
  const action = result.current
  return action({ status: 'idle' }, args)
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('useEnqueuedAction — success', () => {
  it('returns { status: "success", data } when fn resolves', async () => {
    const fn = vi.fn().mockResolvedValue({ id: '42', name: 'test' })

    const result = await invokeAction(
      { op: 'createRound', userId: 'u-1', fn },
      { sessionId: 'sess-1' },
    )

    expect(result.status).toBe('success')
    expect(result.data).toEqual({ id: '42', name: 'test' })
    expect(fn).toHaveBeenCalledOnce()
  })

  it('does NOT enqueue anything on success', async () => {
    const fn = vi.fn().mockResolvedValue({})
    await invokeAction({ op: 'createRound', userId: 'u-1', fn }, {})

    expect(useRetryQueueStore.getState().entries).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Network error → enqueue
// ---------------------------------------------------------------------------

describe('useEnqueuedAction — enqueue on network error', () => {
  it('returns { status: "queued" } when fn rejects with a generic Error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Failed to fetch'))

    const result = await invokeAction(
      { op: 'confirmRound', userId: 'u-1', fn },
      { roundId: 'r-1' },
    )

    expect(result.status).toBe('queued')
    expect(result.message).toContain('sincronizará')
  })

  it('adds an entry to retryQueueStore on network error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('network'))

    await invokeAction(
      { op: 'requestCheck', userId: 'u-1', fn },
      { sessionId: 'sess-1' },
    )

    expect(useRetryQueueStore.getState().entries).toHaveLength(1)
    expect(useRetryQueueStore.getState().entries[0]?.op).toBe('requestCheck')
  })

  it('uses buildPayload to shape the stored payload', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('network'))
    const buildPayload = vi.fn().mockReturnValue({ custom: 'payload' })

    await invokeAction(
      { op: 'closeTable', userId: 'u-1', fn, buildPayload },
      { tableId: 't-1' },
    )

    expect(buildPayload).toHaveBeenCalledWith({ tableId: 't-1' })
    expect(useRetryQueueStore.getState().entries[0]?.payload).toEqual({ custom: 'payload' })
  })

  it('uses raw args as payload when buildPayload is not provided', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('network'))

    await invokeAction(
      { op: 'ackServiceCall', userId: 'u-1', fn },
      { callId: 'c-1' },
    )

    expect(useRetryQueueStore.getState().entries[0]?.payload).toEqual({ callId: 'c-1' })
  })
})

// ---------------------------------------------------------------------------
// 4xx error → no enqueue
// ---------------------------------------------------------------------------

describe('useEnqueuedAction — no enqueue on 4xx', () => {
  it('returns { status: "failed" } and does NOT enqueue on APIError 400', async () => {
    const fn = vi.fn().mockRejectedValue(new APIError(400, 'Bad Request — invalid data'))

    const result = await invokeAction(
      { op: 'submitManualPayment', userId: 'u-1', fn },
      { amount: -1 },
    )

    expect(result.status).toBe('failed')
    expect(result.message).toBeDefined()
    expect(useRetryQueueStore.getState().entries).toHaveLength(0)
  })

  it('returns { status: "failed" } and does NOT enqueue on APIError 422', async () => {
    const fn = vi.fn().mockRejectedValue(new APIError(422, 'Validation error'))

    const result = await invokeAction(
      { op: 'createRound', userId: 'u-1', fn },
      {},
    )

    expect(result.status).toBe('failed')
    expect(useRetryQueueStore.getState().entries).toHaveLength(0)
  })

  it('returns { status: "failed" } and does NOT enqueue on APIError 409 (conflict)', async () => {
    const fn = vi.fn().mockRejectedValue(new APIError(409, 'Conflict'))

    const result = await invokeAction(
      { op: 'confirmRound', userId: 'u-1', fn },
      {},
    )

    expect(result.status).toBe('failed')
    expect(useRetryQueueStore.getState().entries).toHaveLength(0)
  })

  it('DOES enqueue on APIError 500 (server error)', async () => {
    const fn = vi.fn().mockRejectedValue(new APIError(500, 'Internal Server Error'))

    const result = await invokeAction(
      { op: 'closeServiceCall', userId: 'u-1', fn },
      {},
    )

    expect(result.status).toBe('queued')
    expect(useRetryQueueStore.getState().entries).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Queue full
// ---------------------------------------------------------------------------

describe('useEnqueuedAction — queue full', () => {
  it('returns { status: "failed" } when enqueue returns "full"', async () => {
    // Mock the store's enqueue to return 'full'
    const enqueueSpy = vi.spyOn(useRetryQueueStore.getState(), 'enqueue')
    enqueueSpy.mockResolvedValue('full')

    const fn = vi.fn().mockRejectedValue(new Error('network'))
    const result = await invokeAction({ op: 'createRound', userId: 'u-1', fn }, {})

    expect(result.status).toBe('failed')
    expect(result.message).toContain('offline')

    enqueueSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Referential stability (task 3.1 — deps regression)
// ---------------------------------------------------------------------------

describe('useEnqueuedAction — referential stability', () => {
  it('returns the same function reference when options object literal changes identity but values are stable', () => {
    const fn = vi.fn()
    const buildPayload = vi.fn()

    // Simulate caller passing object literal each render (new identity each time)
    const { result, rerender } = renderHook(
      ({ userId }: { userId: string }) =>
        useEnqueuedAction({
          op: 'createRound',
          userId,
          fn,
          buildPayload,
        }),
      { initialProps: { userId: 'u-stable' } },
    )

    const firstRef = result.current

    // Re-render with same userId — options object literal gets new identity
    rerender({ userId: 'u-stable' })

    // The returned function should be the same reference (stable)
    expect(Object.is(result.current, firstRef)).toBe(true)
  })

  it('returns a new function when fn changes', () => {
    const fn1 = vi.fn()
    const fn2 = vi.fn()

    const { result, rerender } = renderHook(
      ({ fn }: { fn: () => Promise<void> }) =>
        useEnqueuedAction({ op: 'createRound', userId: 'u-1', fn }),
      { initialProps: { fn: fn1 } },
    )

    const firstRef = result.current
    rerender({ fn: fn2 })

    expect(Object.is(result.current, firstRef)).toBe(false)
  })
})
