/**
 * Application-wide constants.
 *
 * Zustand rule: NEVER use inline `?? []` in selectors.
 * Use these stable EMPTY_* references instead.
 */

// ---------------------------------------------------------------------------
// Stable empty fallbacks — prevents re-renders from new reference creation
// ---------------------------------------------------------------------------

export const EMPTY_ARRAY: readonly never[] = Object.freeze([])

export const EMPTY_STRING_ARRAY: readonly string[] = Object.freeze([])

/** Stable empty object — use as selector fallback to avoid new references */
export const EMPTY_OBJECT: Readonly<Record<string, never>> = Object.freeze({})

/** Stable empty string constant */
export const EMPTY_STRING = '' as const

// ---------------------------------------------------------------------------
// Auth timing constants
// ---------------------------------------------------------------------------

/** Proactive refresh interval — 14 minutes in ms (token expires at 15 min) */
export const REFRESH_INTERVAL_MS = 840_000

/** Show idle warning after 25 minutes of inactivity */
export const IDLE_WARNING_MS = 1_500_000

/** Force logout after 30 minutes of inactivity */
export const IDLE_LOGOUT_MS = 1_800_000

// ---------------------------------------------------------------------------
// Storage keys — all localStorage keys in one place
// ---------------------------------------------------------------------------

export const SIDEBAR_COLLAPSED_KEY = 'sidebar-collapsed'
export const LANG_KEY = 'dashboard-language'

export const STORAGE_KEYS = {
  /** Dashboard UI language preference */
  LANGUAGE: LANG_KEY,
  /** Sidebar collapsed state */
  SIDEBAR_COLLAPSED: SIDEBAR_COLLAPSED_KEY,
  // C-15 menu stores
  CATEGORY: 'dashboard-category-store',
  SUBCATEGORY: 'dashboard-subcategory-store',
  PRODUCT: 'dashboard-product-store',
  ALLERGEN: 'dashboard-allergen-store',
  INGREDIENT: 'dashboard-ingredient-store',
  RECIPE: 'dashboard-recipe-store',
  SELECTED_BRANCH: 'dashboard-selected-branch',
  // C-16 operations stores
  TABLE_STORE: 'integrador.dashboard.tables',
  SECTOR_STORE: 'integrador.dashboard.sectors',
  STAFF_STORE: 'integrador.dashboard.staff',
  WAITER_ASSIGNMENT_STORE: 'integrador.dashboard.waiter-assignments',
  SALES_STORE: 'integrador.dashboard.sales',
  // NOTE: kitchenDisplayStore is NOT persisted — intentionally omitted (see design.md D4)
  // C-27 promotions store
  PROMOTION: 'dashboard-promotion-store',
  // C-26 billing admin store
  BILLING_ADMIN: 'billing-admin',
} as const

// ---------------------------------------------------------------------------
// Store versions — increment when state shape changes and add migrate()
// ---------------------------------------------------------------------------
//
// NOTE: authStore does NOT use persist() — tokens must never be stored in
// localStorage for security reasons. STORE_VERSIONS.AUTH is reserved for
// future stores that do persist auth-adjacent data (e.g. UI preferences).
// Add new entries here as persisted stores are created.

export const STORE_VERSIONS = {
  AUTH: 1,
  // C-15 menu stores — increment and add migrate() branch when shape changes
  CATEGORY: 1,
  SUBCATEGORY: 1,
  PRODUCT: 1,
  ALLERGEN: 1,
  INGREDIENT: 1,
  RECIPE: 1,
  BRANCH: 1,
  // C-16 operations stores
  TABLE_STORE: 1,
  SECTOR_STORE: 1,
  STAFF_STORE: 1,
  WAITER_ASSIGNMENT_STORE: 1,
  SALES_STORE: 1,
  // NOTE: KITCHEN_DISPLAY_STORE intentionally omitted — not persisted (design.md D4)
  // C-27 promotions store
  PROMOTION: 1,
  // C-26 billing admin store
  BILLING_ADMIN: 1,
} as const

// ---------------------------------------------------------------------------
// Kitchen Display urgency thresholds — used by UrgencyBadge component
// ---------------------------------------------------------------------------

/** Minutes elapsed since SUBMITTED_AT that trigger urgency color changes. */
export const KITCHEN_URGENCY_THRESHOLDS_MIN = {
  /** Below warning — green badge */
  warning: 5,
  /** Warning to high — yellow badge */
  high: 10,
  /** High to critical — orange badge */
  critical: 15,
} as const
