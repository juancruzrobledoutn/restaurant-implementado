/**
 * ID conversion helpers for the frontend/backend boundary.
 * Frontend uses string IDs; backend uses numeric IDs.
 */

export function toStringId(n: number): string {
  return String(n)
}

export function toNumberId(s: string): number {
  const n = Number(s)
  if (!Number.isFinite(n)) {
    throw new Error(`Cannot convert "${s}" to a numeric ID`)
  }
  return n
}
