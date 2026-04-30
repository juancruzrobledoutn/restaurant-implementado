/**
 * Frontend/backend ID boundary helpers.
 *
 * Convention: backend returns numeric IDs (int/bigint). Frontend uses strings
 * everywhere (stable React keys, URL params, form inputs). Convert at the
 * boundary — in services / API adapters.
 */

export function toStringId(n: number): string {
  return String(n)
}

export function toNumberId(s: string): number {
  const n = Number(s)
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`toNumberId: invalid id "${s}"`)
  }
  return n
}
