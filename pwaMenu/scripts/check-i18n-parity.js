#!/usr/bin/env node
/**
 * check-i18n-parity.js — i18n key parity check for pwaMenu (C-19 / Task 10.4).
 *
 * Fails CI if any key present in the reference locale (es.json) is missing
 * from any other locale (en.json, pt.json).
 *
 * Runs key-level deep check — ensures billing, customer, consent, and all
 * existing namespaces remain in sync across locales.
 *
 * Usage:
 *   node scripts/check-i18n-parity.js
 *   # or via npm: npm run check:i18n
 *
 * Exit codes:
 *   0 — all locales have all keys
 *   1 — one or more keys are missing
 */

import { readFileSync, existsSync } from 'fs'
import { resolve, join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ── Config ────────────────────────────────────────────────────────────────────

const LOCALES_DIR = resolve(__dirname, '../src/i18n/locales')
const REFERENCE_LOCALE = 'es'
const CHECK_LOCALES = ['en', 'pt']

// Namespaces that must be present — fail fast if any is absent from a locale
const REQUIRED_NAMESPACES = [
  'check',
  'payment',
  'customer',
  'consent',
  'errors',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Recursively flatten a nested object into dot-notation keys.
 *
 * @param {object} obj
 * @param {string} prefix
 * @returns {string[]}
 */
function flattenKeys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) => {
    const fullKey = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      return flattenKeys(v, fullKey)
    }
    return [fullKey]
  })
}

/**
 * Load a locale JSON file.
 *
 * @param {string} locale — e.g. 'es'
 * @returns {object}
 */
function loadLocale(locale) {
  const filePath = join(LOCALES_DIR, `${locale}.json`)
  if (!existsSync(filePath)) {
    console.error(`ERROR: Locale file not found: ${filePath}`)
    process.exit(1)
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (err) {
    console.error(`ERROR: Failed to parse ${filePath}: ${err.message}`)
    process.exit(1)
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const reference = loadLocale(REFERENCE_LOCALE)
const referenceKeys = flattenKeys(reference)

let totalMissing = 0

for (const locale of CHECK_LOCALES) {
  const data = loadLocale(locale)
  const localeKeys = new Set(flattenKeys(data))

  // Check required namespaces first (fast-fail hint)
  for (const ns of REQUIRED_NAMESPACES) {
    if (!(ns in data)) {
      console.error(`\n❌  MISSING NAMESPACE in ${locale}.json: "${ns}"`)
      console.error(`   Required namespace "${ns}" is absent entirely.`)
      totalMissing++
    }
  }

  // Full key diff
  const missing = referenceKeys.filter((k) => !localeKeys.has(k))

  if (missing.length > 0) {
    console.error(`\n⚠️  MISSING KEYS in ${locale}.json (${missing.length}):`)
    missing.forEach((k) => console.error(`   - ${k}`))
    totalMissing += missing.length
  } else {
    console.log(`✅  ${locale}.json — all ${referenceKeys.length} keys present`)
  }
}

if (totalMissing > 0) {
  console.error(
    `\n❌  BUILD BLOCKED: ${totalMissing} missing key(s) across locale files.`,
  )
  console.error(
    `   Every key in ${REFERENCE_LOCALE}.json must exist in all other locales.`,
  )
  console.error(
    `   Affected namespaces: check/*, payment/*, customer/*, consent/*, errors.billing.*`,
  )
  process.exit(1)
}

console.log(
  `\n✅  i18n parity check passed: all locales have all ${referenceKeys.length} keys.`,
)
process.exit(0)
