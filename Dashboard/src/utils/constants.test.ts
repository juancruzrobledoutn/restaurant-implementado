/**
 * constants.test.ts
 *
 * Verifies that EMPTY_ARRAY, EMPTY_OBJECT, and EMPTY_STRING_ARRAY are frozen
 * (immutable) and that the same stable reference is returned on every access.
 */

import { describe, it, expect } from 'vitest'
import { EMPTY_ARRAY, EMPTY_OBJECT, EMPTY_STRING_ARRAY, EMPTY_STRING, STORAGE_KEYS, SIDEBAR_COLLAPSED_KEY, LANG_KEY } from './constants'

describe('EMPTY_ARRAY', () => {
  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(EMPTY_ARRAY)).toBe(true)
  })

  it('returns the same stable reference every access', () => {
    // Importing the same constant twice must yield identical reference
    const ref1 = EMPTY_ARRAY
    const ref2 = EMPTY_ARRAY
    expect(ref1).toBe(ref2)
  })

  it('is an empty array', () => {
    expect(EMPTY_ARRAY).toHaveLength(0)
  })
})

describe('EMPTY_OBJECT', () => {
  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(EMPTY_OBJECT)).toBe(true)
  })

  it('returns the same stable reference every access', () => {
    const ref1 = EMPTY_OBJECT
    const ref2 = EMPTY_OBJECT
    expect(ref1).toBe(ref2)
  })

  it('has no own properties', () => {
    expect(Object.keys(EMPTY_OBJECT)).toHaveLength(0)
  })
})

describe('EMPTY_STRING_ARRAY', () => {
  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(EMPTY_STRING_ARRAY)).toBe(true)
  })

  it('returns the same stable reference every access', () => {
    const ref1 = EMPTY_STRING_ARRAY
    const ref2 = EMPTY_STRING_ARRAY
    expect(ref1).toBe(ref2)
  })

  it('is an empty array', () => {
    expect(EMPTY_STRING_ARRAY).toHaveLength(0)
  })
})

describe('EMPTY_STRING', () => {
  it('is an empty string', () => {
    expect(EMPTY_STRING).toBe('')
  })
})

describe('STORAGE_KEYS', () => {
  it('SIDEBAR_COLLAPSED key matches standalone export', () => {
    expect(STORAGE_KEYS.SIDEBAR_COLLAPSED).toBe(SIDEBAR_COLLAPSED_KEY)
    expect(STORAGE_KEYS.SIDEBAR_COLLAPSED).toBe('sidebar-collapsed')
  })

  it('LANGUAGE key matches standalone export', () => {
    expect(STORAGE_KEYS.LANGUAGE).toBe(LANG_KEY)
    expect(STORAGE_KEYS.LANGUAGE).toBe('dashboard-language')
  })
})
