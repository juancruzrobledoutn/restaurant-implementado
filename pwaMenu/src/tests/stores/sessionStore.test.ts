/**
 * Unit tests for sessionStore.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useSessionStore, hydrateSessionFromStorage } from '../../stores/sessionStore'

const STORAGE_KEY = 'pwamenu-session'

function resetStore() {
  useSessionStore.setState({
    token: null,
    branchSlug: null,
    tableCode: null,
    sessionId: null,
    expiresAt: null,
  })
}

describe('sessionStore', () => {
  beforeEach(() => {
    resetStore()
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('valid session survives reload', () => {
    const futureExpiry = Date.now() + 1_000_000
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        token: 'tok123',
        branchSlug: 'my-branch',
        tableCode: 'mesa-1',
        sessionId: null,
        expiresAt: futureExpiry,
      }),
    )

    const hydrated = hydrateSessionFromStorage()
    expect(hydrated).not.toBeNull()
    expect(hydrated?.token).toBe('tok123')
    expect(hydrated?.branchSlug).toBe('my-branch')
  })

  it('expired session clears on hydrate', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        token: 'oldtok',
        branchSlug: 'branch',
        tableCode: 'mesa-2',
        sessionId: null,
        expiresAt: Date.now() - 1_000, // past
      }),
    )

    const hydrated = hydrateSessionFromStorage()
    expect(hydrated).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('localStorage unavailable fallback — store accepts change in memory and logs warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('SecurityError', 'SecurityError')
    })

    expect(() => {
      useSessionStore.getState().activate({
        token: 'tok',
        branchSlug: 'b',
        tableCode: 'tc',
      })
    }).not.toThrow()

    // In-memory state should be updated even if localStorage fails
    expect(useSessionStore.getState().token).toBe('tok')
    expect(warnSpy).toHaveBeenCalled()
  })

  it('activate() sets expiresAt ~8h in the future', () => {
    const before = Date.now()
    useSessionStore.getState().activate({
      token: 'abc',
      branchSlug: 'br',
      tableCode: 'tc',
    })
    const after = Date.now()
    const { expiresAt } = useSessionStore.getState()
    const expected = 8 * 60 * 60 * 1000

    expect(expiresAt).toBeGreaterThanOrEqual(before + expected - 60_000)
    expect(expiresAt).toBeLessThanOrEqual(after + expected + 60_000)
  })

  it('clear() wipes localStorage', () => {
    useSessionStore.getState().activate({
      token: 'tok',
      branchSlug: 'br',
      tableCode: 'tc',
    })
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull()

    useSessionStore.getState().clear()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(useSessionStore.getState().token).toBeNull()
  })

  it('isExpired() returns true when expiresAt is null', () => {
    expect(useSessionStore.getState().isExpired()).toBe(true)
  })

  it('isExpired() returns false for a fresh session', () => {
    useSessionStore.getState().activate({
      token: 'tok',
      branchSlug: 'br',
      tableCode: 'tc',
    })
    expect(useSessionStore.getState().isExpired()).toBe(false)
  })
})
