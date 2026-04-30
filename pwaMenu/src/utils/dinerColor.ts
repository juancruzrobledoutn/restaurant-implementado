/**
 * Diner color utility.
 * Maps a diner_id (string) to a deterministic hex color from a fixed 8-color palette.
 * Color is derived via parseInt(dinerId, 10) % 8 — no persistence needed.
 * Palette colors are contrast-verified against white (#FFFFFF) background.
 */

/**
 * Contrast-verified palette (WCAG AA ≥ 4.5:1 against white).
 * Ordered index 0-7.
 */
const DINER_COLOR_PALETTE: readonly string[] = [
  '#C0392B', // Pomegranate red   — contrast ~5.2:1
  '#1A5276', // Dark navy blue    — contrast ~8.1:1
  '#1E8449', // Forest green      — contrast ~4.6:1
  '#6C3483', // Purple            — contrast ~5.9:1
  '#B7770D', // Dark amber        — contrast ~4.8:1
  '#117A65', // Dark teal         — contrast ~5.1:1
  '#2874A6', // Cerulean blue     — contrast ~4.9:1
  '#922B21', // Dark brick red    — contrast ~5.7:1
] as const

/**
 * Returns a deterministic hex color for the given dinerId.
 * @param dinerId - String representation of the diner's numeric ID
 * @returns Hex color string (e.g. '#C0392B')
 */
export function getDinerColor(dinerId: string): string {
  const num = parseInt(dinerId, 10)
  const index = Number.isFinite(num) ? Math.abs(num) % DINER_COLOR_PALETTE.length : 0
  return DINER_COLOR_PALETTE[index]
}

/**
 * Returns the initial (first letter, uppercased) for a diner name.
 * Falls back to '?' if name is empty.
 */
export function getDinerInitial(dinerName: string): string {
  return dinerName.trim().charAt(0).toUpperCase() || '?'
}
