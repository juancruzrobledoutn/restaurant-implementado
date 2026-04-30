/**
 * Price formatting utility.
 * All prices in the system are stored as integer cents (e.g. 12550 = $125.50).
 */

const DEFAULT_LOCALE = (import.meta.env.VITE_LOCALE as string | undefined) ?? 'es-AR'
const DEFAULT_CURRENCY = (import.meta.env.VITE_CURRENCY as string | undefined) ?? 'ARS'

export function formatPrice(
  cents: number,
  locale: string = DEFAULT_LOCALE,
  currency: string = DEFAULT_CURRENCY,
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100)
}

/**
 * Formats the subtotal for a cart item (priceCents * quantity).
 * @param priceCents - Unit price in integer cents
 * @param qty - Quantity
 * @param locale - BCP 47 locale (e.g. 'es-AR')
 * @param currency - ISO 4217 currency code (e.g. 'ARS')
 */
export function formatCartItemSubtotal(
  priceCents: number,
  qty: number,
  locale: string = DEFAULT_LOCALE,
  currency: string = DEFAULT_CURRENCY,
): string {
  return formatPrice(priceCents * qty, locale, currency)
}
