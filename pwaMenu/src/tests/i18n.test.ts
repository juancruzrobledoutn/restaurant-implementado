/**
 * i18n snapshot tests for C-19 billing/customer/consent namespaces (Task 10.5).
 *
 * Tests:
 *   - Required C-19 namespaces (check, payment, customer, consent, errors.billing)
 *     exist in ALL locales
 *   - All top-level keys of each C-19 namespace are present in en and pt
 *   - Consent legal texts carry [LEGAL REVIEW REQUIRED] prefix in ALL locales
 *     (guard: removing prefix before legal approval would break this test)
 *   - Full key parity: en and pt contain every key defined in es for C-19 namespaces
 *
 * The [LEGAL REVIEW REQUIRED] tests are intentional:
 *   They MUST pass to confirm the prefix is still present (un-reviewed state).
 *   After legal team sign-off, remove the prefix AND update these assertions.
 */
import { describe, it, expect } from 'vitest'
import es from '../i18n/locales/es.json'
import en from '../i18n/locales/en.json'
import pt from '../i18n/locales/pt.json'

// ── Type helpers ──────────────────────────────────────────────────────────────

type LocaleData = typeof es

type JsonObject = { [key: string]: JsonValue }
type JsonValue = string | number | boolean | null | JsonObject | JsonValue[]

function flattenKeys(obj: JsonObject, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const fullKey = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      return flattenKeys(v as JsonObject, fullKey)
    }
    return [fullKey]
  })
}

// Keys from es that belong to C-19 namespaces
const C19_NAMESPACES = ['check', 'payment', 'customer', 'consent', 'errors'] as const

function getC19Keys(locale: JsonObject): string[] {
  return flattenKeys(locale).filter((k) =>
    C19_NAMESPACES.some(
      (ns) => k === ns || k.startsWith(`${ns}.`),
    ),
  )
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const esC19Keys = new Set(getC19Keys(es as JsonObject))
const enAllKeys = new Set(flattenKeys(en as JsonObject))
const ptAllKeys = new Set(flattenKeys(pt as JsonObject))

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('i18n C-19 namespace presence', () => {
  const locales: Array<{ name: string; data: LocaleData }> = [
    { name: 'es', data: es },
    { name: 'en', data: en },
    { name: 'pt', data: pt },
  ]

  it.each(locales)('$name.json contains "check" namespace', ({ data }) => {
    expect(data).toHaveProperty('check')
    expect(typeof (data as Record<string, unknown>).check).toBe('object')
  })

  it.each(locales)('$name.json contains "payment" namespace', ({ data }) => {
    expect(data).toHaveProperty('payment')
    expect(typeof (data as Record<string, unknown>).payment).toBe('object')
  })

  it.each(locales)('$name.json contains "customer" namespace', ({ data }) => {
    expect(data).toHaveProperty('customer')
    expect(typeof (data as Record<string, unknown>).customer).toBe('object')
  })

  it.each(locales)('$name.json contains "consent" namespace', ({ data }) => {
    expect(data).toHaveProperty('consent')
    expect(typeof (data as Record<string, unknown>).consent).toBe('object')
  })

  it.each(locales)('$name.json contains "errors.billing" sub-namespace', ({ data }) => {
    const errors = (data as Record<string, unknown>).errors
    expect(errors).toBeDefined()
    expect(typeof errors).toBe('object')
    expect(errors).toHaveProperty('billing')
  })
})

describe('i18n C-19 key parity — en.json', () => {
  it('en.json has all C-19 keys from es.json', () => {
    const missing = [...esC19Keys].filter((k) => !enAllKeys.has(k))
    expect(
      missing,
      `Missing C-19 keys in en.json:\n${missing.map((k) => `  - ${k}`).join('\n')}`,
    ).toHaveLength(0)
  })
})

describe('i18n C-19 key parity — pt.json', () => {
  it('pt.json has all C-19 keys from es.json', () => {
    const missing = [...esC19Keys].filter((k) => !ptAllKeys.has(k))
    expect(
      missing,
      `Missing C-19 keys in pt.json:\n${missing.map((k) => `  - ${k}`).join('\n')}`,
    ).toHaveLength(0)
  })
})

describe('i18n legal placeholder guard', () => {
  /**
   * IMPORTANT: These tests verify the [LEGAL REVIEW REQUIRED] prefix IS present.
   * They MUST pass to confirm texts have NOT been prematurely published.
   * After legal sign-off, remove the prefix from locale files AND update these tests.
   *
   * [BLOQUEANTE — review legal required]
   */
  const LEGAL_PREFIX = '[LEGAL REVIEW REQUIRED]'

  const locales: Array<{ name: string; data: LocaleData }> = [
    { name: 'es', data: es },
    { name: 'en', data: en },
    { name: 'pt', data: pt },
  ]

  it.each(locales)(
    '$name.json consent.legalText still has legal review prefix',
    ({ data }) => {
      const consent = (data as unknown as Record<string, Record<string, string>>).consent
      expect(consent.legalText).toContain(LEGAL_PREFIX)
    },
  )

  it.each(locales)(
    '$name.json consent.body still has legal review prefix',
    ({ data }) => {
      const consent = (data as unknown as Record<string, Record<string, string>>).consent
      expect(consent.body).toContain(LEGAL_PREFIX)
    },
  )
})

describe('i18n C-19 required keys snapshot', () => {
  /**
   * Snapshot of the exact C-19 keys that must exist in every locale.
   * If a key is removed from es.json, this test fails — preventing silent regressions.
   */
  const REQUIRED_BILLING_KEYS = [
    'errors.billing.request_failed',
    'errors.billing.session_not_open',
    'errors.billing.check_conflict',
    'errors.billing.preference_error',
    'errors.billing.payment_mismatch',
  ]

  const REQUIRED_CONSENT_KEYS = [
    'consent.title',
    'consent.checkboxLabel',
    'consent.legalText',
    'consent.body',
    'consent.version',
    'consent.required',
    'consent.privacy',
  ]

  const REQUIRED_CUSTOMER_OPTIN_KEYS = [
    'customer.optin.title',
    'customer.optin.subtitle',
    'customer.optin.name',
    'customer.optin.email',
    'customer.optin.submit',
    'customer.optin.success',
    'customer.optin.alreadyOptedIn',
    'customer.optin.errors.nameRequired',
    'customer.optin.errors.emailInvalid',
    'customer.optin.errors.consentRequired',
  ]

  const ALL_REQUIRED = [
    ...REQUIRED_BILLING_KEYS,
    ...REQUIRED_CONSENT_KEYS,
    ...REQUIRED_CUSTOMER_OPTIN_KEYS,
  ]

  const locales: Array<{ name: string; keys: Set<string> }> = [
    { name: 'es', keys: new Set(flattenKeys(es as JsonObject)) },
    { name: 'en', keys: enAllKeys },
    { name: 'pt', keys: ptAllKeys },
  ]

  it.each(locales)('$name.json has all required C-19 keys', ({ name, keys }) => {
    const missing = ALL_REQUIRED.filter((k) => !keys.has(k))
    expect(
      missing,
      `Missing required C-19 keys in ${name}.json:\n${missing.map((k) => `  - ${k}`).join('\n')}`,
    ).toHaveLength(0)
  })
})
