/**
 * i18n completeness test.
 * Verifies that es.json, en.json, and pt.json have exactly the same key set.
 * Fails if any key exists in one locale but not in others.
 */
import { describe, it, expect } from 'vitest'
import es from '../../i18n/locales/es.json'
import en from '../../i18n/locales/en.json'
import pt from '../../i18n/locales/pt.json'

type JsonObject = { [key: string]: JsonValue }
type JsonValue = string | number | boolean | null | JsonObject | JsonValue[]

function extractKeys(obj: JsonObject, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return extractKeys(value as JsonObject, fullKey)
    }
    return [fullKey]
  })
}

describe('i18n key completeness', () => {
  const esKeys = new Set(extractKeys(es as JsonObject))
  const enKeys = new Set(extractKeys(en as JsonObject))
  const ptKeys = new Set(extractKeys(pt as JsonObject))

  it('en.json has all keys from es.json', () => {
    const missing = [...esKeys].filter((k) => !enKeys.has(k))
    expect(missing, `Missing in en.json: ${missing.join(', ')}`).toHaveLength(0)
  })

  it('pt.json has all keys from es.json', () => {
    const missing = [...esKeys].filter((k) => !ptKeys.has(k))
    expect(missing, `Missing in pt.json: ${missing.join(', ')}`).toHaveLength(0)
  })

  it('es.json has all keys from en.json', () => {
    const missing = [...enKeys].filter((k) => !esKeys.has(k))
    expect(missing, `Missing in es.json (extra in en.json): ${missing.join(', ')}`).toHaveLength(0)
  })

  it('es.json has all keys from pt.json', () => {
    const missing = [...ptKeys].filter((k) => !esKeys.has(k))
    expect(missing, `Missing in es.json (extra in pt.json): ${missing.join(', ')}`).toHaveLength(0)
  })
})
