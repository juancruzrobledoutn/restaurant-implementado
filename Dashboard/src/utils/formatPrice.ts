/**
 * formatPrice — converts integer cents to a formatted currency string.
 *
 * Convention: all prices in the backend are stored as integer cents.
 * 12550 cents = $125.50 ARS
 *
 * Uses Intl.NumberFormat for locale-aware formatting.
 * Locale: es-AR (Argentine Spanish), currency: ARS
 */

const _formatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * Formats integer cents as an ARS currency string.
 *
 * @example
 * formatPrice(12550) // "$125,50"
 * formatPrice(0)     // "$0,00"
 */
export function formatPrice(cents: number): string {
  return _formatter.format(cents / 100)
}
