/**
 * Formatter utilities for the Dashboard.
 *
 * Rules:
 * - Prices are integers in cents in the store (12550 = $125.50)
 * - Format only at the JSX layer — never in stores or actions
 * - ID conversions happen at the API boundary (in store fetch/create actions)
 */

// ---------------------------------------------------------------------------
// Price formatter
// ---------------------------------------------------------------------------

/**
 * Converts a price in cents to a formatted currency string.
 *
 * Examples:
 *   formatPrice(12550) → "$125.50"
 *   formatPrice(0)     → "$0.00"
 *   formatPrice(100)   → "$1.00"
 */
export function formatPrice(cents: number): string {
  if (!Number.isFinite(cents) || cents < 0) return '$0.00'
  const dollars = cents / 100
  return dollars.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Parses a user-entered price string (e.g. "125.50") into cents integer.
 *
 * Examples:
 *   parsePriceToCents("125.50") → 12550
 *   parsePriceToCents("10")     → 1000
 *   parsePriceToCents("")       → 0
 */
export function parsePriceToCents(value: string): number {
  const cleaned = value.replace(/[^0-9.]/g, '')
  if (!cleaned) return 0
  const parsed = parseFloat(cleaned)
  if (!Number.isFinite(parsed)) return 0
  return Math.round(parsed * 100)
}

// ---------------------------------------------------------------------------
// ID conversion helpers
// ---------------------------------------------------------------------------

/**
 * Converts a backend numeric ID to a frontend string ID.
 * Used at API boundaries in store fetch/create/update actions.
 */
export function toStringId(id: number | string): string {
  return String(id)
}

/**
 * Converts a frontend string ID to a backend numeric ID.
 * Used when sending IDs to the backend.
 */
export function toNumberId(id: string): number {
  return parseInt(id, 10)
}

// ---------------------------------------------------------------------------
// Image URL parser
// ---------------------------------------------------------------------------

/**
 * Returns a safe image URL or empty string for display.
 * Prevents XSS by allowing only https:// URLs.
 */
export function parseImageUrl(url: string | undefined | null): string {
  if (!url || !url.startsWith('https://')) return ''
  return url
}

// ---------------------------------------------------------------------------
// Promotion validity formatters — C-27
// ---------------------------------------------------------------------------

type DateTimeRange = {
  start_date: string
  start_time: string
  end_date: string
  end_time: string
}

/**
 * Formats a promotion's date-time range as "DD/MM HH:mm → DD/MM HH:mm".
 *
 * Example:
 *   formatPromotionValidity({ start_date: '2025-06-15', start_time: '18:00:00',
 *                             end_date: '2025-06-15', end_time: '22:00:00' })
 *   → "15/06 18:00 → 15/06 22:00"
 */
export function formatPromotionValidity(p: DateTimeRange): string {
  const startD = p.start_date.split('-').reverse().slice(0, 2).join('/')  // "15/06"
  const startT = p.start_time.slice(0, 5)                                  // "18:00"
  const endD = p.end_date.split('-').reverse().slice(0, 2).join('/')
  const endT = p.end_time.slice(0, 5)
  return `${startD} ${startT} → ${endD} ${endT}`
}

/**
 * Returns the validity status of a promotion relative to a reference time.
 *
 * @param p - Promotion with start/end date and time
 * @param now - Reference date (default: new Date()). Inject for determinism in tests.
 * @returns 'scheduled' | 'active' | 'expired'
 */
export function getPromotionStatus(
  p: DateTimeRange,
  now: Date = new Date(),
): 'scheduled' | 'active' | 'expired' {
  const start = new Date(`${p.start_date}T${p.start_time}`)
  const end = new Date(`${p.end_date}T${p.end_time}`)
  if (now < start) return 'scheduled'
  if (now > end) return 'expired'
  return 'active'
}

/**
 * Returns true when the promotion is currently valid (not scheduled, not expired).
 *
 * @param p - Promotion with start/end date and time
 * @param now - Reference date (default: new Date()). Inject for determinism in tests.
 */
export function isPromotionActiveNow(p: DateTimeRange, now: Date = new Date()): boolean {
  return getPromotionStatus(p, now) === 'active'
}
