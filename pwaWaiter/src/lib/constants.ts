/**
 * Shared constants for pwaWaiter (lib layer — no React/Zustand imports).
 *
 * EMPTY_ARRAY: stable reference used by all store selectors as fallback.
 * NEVER use `?? []` inline inside a selector — that creates a new array
 * reference on every render and causes infinite re-render loops.
 */

// ---------------------------------------------------------------------------
// Stable empty array fallbacks — prevent re-renders from new array references
// ---------------------------------------------------------------------------

/** Typed as `readonly []` so the compiler will catch accidental mutation.
 * Object.freeze prevents runtime mutation in addition to TypeScript's readonly.
 * Assignable to `readonly T[]` without cast.
 */
export const EMPTY_ARRAY: readonly never[] = Object.freeze([])
