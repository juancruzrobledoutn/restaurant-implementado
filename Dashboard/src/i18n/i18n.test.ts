/**
 * i18n.test.ts — parity check between es.json and en.json.
 *
 * Verifies that every key present in es.json exists in en.json and vice versa.
 * No orphaned keys allowed.
 */

import { describe, it, expect } from 'vitest'
import es from './locales/es.json'
import en from './locales/en.json'

/**
 * Recursively collect all dot-separated keys from a nested object.
 */
function collectKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = []
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...collectKeys(value as Record<string, unknown>, fullKey))
    } else {
      keys.push(fullKey)
    }
  }
  return keys
}

const esKeys = new Set(collectKeys(es as Record<string, unknown>))
const enKeys = new Set(collectKeys(en as Record<string, unknown>))

describe('i18n key parity', () => {
  it('es.json has at least 350 keys', () => {
    expect(esKeys.size).toBeGreaterThanOrEqual(350)
  })

  it('en.json has at least 350 keys', () => {
    expect(enKeys.size).toBeGreaterThanOrEqual(350)
  })

  it('all es.json keys exist in en.json (no orphaned es keys)', () => {
    const missingInEn = [...esKeys].filter((k) => !enKeys.has(k))
    expect(missingInEn, `Keys in es.json but missing in en.json: ${missingInEn.join(', ')}`).toHaveLength(0)
  })

  it('all en.json keys exist in es.json (no orphaned en keys)', () => {
    const missingInEs = [...enKeys].filter((k) => !esKeys.has(k))
    expect(missingInEs, `Keys in en.json but missing in es.json: ${missingInEs.join(', ')}`).toHaveLength(0)
  })

  it('common.save exists in both locales', () => {
    expect(esKeys.has('common.save')).toBe(true)
    expect(enKeys.has('common.save')).toBe(true)
  })

  it('auth.login.title exists in both locales', () => {
    expect(esKeys.has('auth.login.title')).toBe(true)
    expect(enKeys.has('auth.login.title')).toBe(true)
  })

  it('layout.sidebar.home exists in both locales', () => {
    expect(esKeys.has('layout.sidebar.home')).toBe(true)
    expect(enKeys.has('layout.sidebar.home')).toBe(true)
  })
})
