/**
 * Settings types for C-28 dashboard-settings.
 *
 * Design decisions:
 *  - IDs are string on the frontend (number on backend — converted at API boundary)
 *  - Prices in cents (int) — not applicable here
 *  - SLUG_REGEX exported as const so frontend and backend share the same literal
 *  - OpeningHoursWeek uses DayKey as index for type safety
 */

// ---------------------------------------------------------------------------
// Opening hours
// ---------------------------------------------------------------------------

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export const DAY_KEYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

export const DAY_LABELS: Record<DayKey, string> = {
  mon: 'Lunes',
  tue: 'Martes',
  wed: 'Miércoles',
  thu: 'Jueves',
  fri: 'Viernes',
  sat: 'Sábado',
  sun: 'Domingo',
}

export interface OpeningHoursInterval {
  open: string  // HH:MM
  close: string // HH:MM or 24:00
}

export type OpeningHoursWeek = Record<DayKey, OpeningHoursInterval[]>

export function emptyOpeningHoursWeek(): OpeningHoursWeek {
  return {
    mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [],
  }
}

// ---------------------------------------------------------------------------
// Slug validation (shared between frontend and backend)
// ---------------------------------------------------------------------------

/** Slug must match this regex — same as backend BranchSettingsUpdate validator */
export const SLUG_REGEX = /^[a-z0-9-]+$/

export function isValidSlug(slug: string): boolean {
  return slug.length >= 3 && slug.length <= 60 && SLUG_REGEX.test(slug)
}

// ---------------------------------------------------------------------------
// Branch settings
// ---------------------------------------------------------------------------

export interface BranchSettings {
  id: string            // converted from number at API boundary
  tenant_id: string
  name: string
  address: string
  slug: string
  phone: string | null
  timezone: string
  opening_hours: OpeningHoursWeek | null
}

// ---------------------------------------------------------------------------
// Tenant settings
// ---------------------------------------------------------------------------

export interface TenantSettings {
  id: string
  name: string
  // NOTE: privacy_salt is NEVER included — excluded by backend schema
}

// ---------------------------------------------------------------------------
// Common IANA timezone list (fallback if Intl.supportedValuesOf is unavailable)
// ---------------------------------------------------------------------------

export const COMMON_TIMEZONES = [
  'America/Argentina/Buenos_Aires',
  'America/Argentina/Cordoba',
  'America/Argentina/Mendoza',
  'America/Argentina/Salta',
  'America/Bogota',
  'America/Lima',
  'America/Santiago',
  'America/Sao_Paulo',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/Madrid',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'UTC',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney',
] as const

/** Get the full list of IANA timezones (with Intl fallback to COMMON_TIMEZONES). */
export function getSupportedTimezones(): string[] {
  try {
    // Available in Chrome 99+, Safari 15.4+, Firefox 86+
    if (typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl) {
      return Intl.supportedValuesOf('timeZone')
    }
  } catch {
    // Ignore errors — fallback below
  }
  return [...COMMON_TIMEZONES]
}
