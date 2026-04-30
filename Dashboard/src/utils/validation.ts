/**
 * Centralized validation utilities for Dashboard forms.
 *
 * Rules:
 * - One validateX() function per entity (add them as pages are implemented)
 * - Never write validation logic inline inside useActionState actions
 * - ValidationErrors<T> is Partial<Record<keyof T, string>> — one message per field
 * - All error values are i18n keys (e.g. 'validation.required')
 *
 * Skill: react19-form-pattern, dashboard-crud-page
 */

import type { ValidationErrors } from '@/types/form'
import type {
  CategoryFormData,
  SubcategoryFormData,
  ProductFormData,
  AllergenFormData,
  IngredientGroupFormData,
  IngredientFormData,
  SubIngredientFormData,
  RecipeFormData,
  AllergenSeverity,
} from '@/types/menu'
import type {
  TableFormData,
  SectorFormData,
  StaffFormData,
  WaiterAssignmentFormData,
} from '@/types/operations'
import type { PromotionFormData } from '@/types/menu'

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface ValidationResult<T> {
  isValid: boolean
  errors: ValidationErrors<T>
}

// ---------------------------------------------------------------------------
// Number helpers — always use these, never inline NaN checks
// ---------------------------------------------------------------------------

/** Returns true when value is a finite number (not NaN, not Infinity). */
export function isValidNumber(value: number): boolean {
  return Number.isFinite(value)
}

/** Returns true when value is a finite positive number (> 0). */
export function isPositiveNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

/** Returns true when value is a finite non-negative number (>= 0). */
export function isNonNegativeNumber(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

// ---------------------------------------------------------------------------
// String helpers
// ---------------------------------------------------------------------------

/** Returns true when the string is not blank (after trim). */
export function isNonBlank(value: string): boolean {
  return value.trim().length > 0
}

// ---------------------------------------------------------------------------
// Image URL validator — anti-SSRF rules (mirrors backend validation)
// ---------------------------------------------------------------------------

/**
 * Validates an image URL for anti-SSRF safety.
 *
 * Rules:
 * - Must start with https://
 * - Must not be an IP address (private or loopback)
 * - Must not have non-standard ports
 * - Empty string is considered valid (optional field)
 */
export function validateImageUrl(url: string): boolean {
  if (!url || url.trim().length === 0) return true

  // Must be HTTPS
  if (!url.startsWith('https://')) return false

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  const hostname = parsed.hostname.toLowerCase()

  // Reject non-standard ports
  if (parsed.port && parsed.port !== '443') return false

  // Reject loopback
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return false

  // Reject private IPv4 ranges
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4Match) {
    const [, a, b] = ipv4Match
    const aNum = parseInt(a!, 10)
    const bNum = parseInt(b!, 10)

    // 10.0.0.0/8
    if (aNum === 10) return false
    // 172.16.0.0/12
    if (aNum === 172 && bNum >= 16 && bNum <= 31) return false
    // 192.168.0.0/16
    if (aNum === 192 && bNum === 168) return false
    // 169.254.0.0/16 (link-local / AWS metadata)
    if (aNum === 169 && bNum === 254) return false
  }

  return true
}

// ---------------------------------------------------------------------------
// Valid enum values
// ---------------------------------------------------------------------------

const VALID_SEVERITIES: AllergenSeverity[] = ['mild', 'moderate', 'severe', 'critical']
const VALID_PRESENCE_TYPES = ['contains', 'may_contain', 'free_from'] as const
const VALID_RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const

// ---------------------------------------------------------------------------
// Category validator
// ---------------------------------------------------------------------------

export function validateCategory(data: CategoryFormData): ValidationResult<CategoryFormData> {
  const errors: ValidationErrors<CategoryFormData> = {}

  if (!isNonBlank(data.name)) {
    errors.name = 'validation.required'
  } else if (data.name.trim().length > 255) {
    errors.name = 'validation.maxLength'
  }

  if (!isNonNegativeNumber(data.order)) {
    errors.order = 'validation.invalidNumber'
  }

  if (data.image && !validateImageUrl(data.image)) {
    errors.image = 'validation.invalidImageUrl'
  }

  return { isValid: Object.keys(errors).length === 0, errors }
}

// ---------------------------------------------------------------------------
// Subcategory validator
// ---------------------------------------------------------------------------

export function validateSubcategory(data: SubcategoryFormData): ValidationResult<SubcategoryFormData> {
  const errors: ValidationErrors<SubcategoryFormData> = {}

  if (!isNonBlank(data.name)) {
    errors.name = 'validation.required'
  } else if (data.name.trim().length > 255) {
    errors.name = 'validation.maxLength'
  }

  if (!isNonNegativeNumber(data.order)) {
    errors.order = 'validation.invalidNumber'
  }

  if (!isNonBlank(data.category_id)) {
    errors.category_id = 'validation.required'
  }

  if (data.image && !validateImageUrl(data.image)) {
    errors.image = 'validation.invalidImageUrl'
  }

  return { isValid: Object.keys(errors).length === 0, errors }
}

// ---------------------------------------------------------------------------
// Product validator
// ---------------------------------------------------------------------------

export function validateProduct(data: ProductFormData): ValidationResult<ProductFormData> {
  const errors: ValidationErrors<ProductFormData> = {}

  if (!isNonBlank(data.name)) {
    errors.name = 'validation.required'
  } else if (data.name.trim().length > 255) {
    errors.name = 'validation.maxLength'
  }

  if (!isNonNegativeNumber(data.price_cents)) {
    errors.price_cents = 'validation.invalidPrice'
  }

  if (!isNonBlank(data.subcategory_id)) {
    errors.subcategory_id = 'validation.required'
  }

  if (data.image && !validateImageUrl(data.image)) {
    errors.image = 'validation.invalidImageUrl'
  }

  return { isValid: Object.keys(errors).length === 0, errors }
}

// ---------------------------------------------------------------------------
// Allergen validator
// ---------------------------------------------------------------------------

export function validateAllergen(data: AllergenFormData): ValidationResult<AllergenFormData> {
  const errors: ValidationErrors<AllergenFormData> = {}

  if (!isNonBlank(data.name)) {
    errors.name = 'validation.required'
  } else if (data.name.trim().length > 255) {
    errors.name = 'validation.maxLength'
  }

  if (!VALID_SEVERITIES.includes(data.severity)) {
    errors.severity = 'validation.invalidSeverity'
  }

  return { isValid: Object.keys(errors).length === 0, errors }
}

// ---------------------------------------------------------------------------
// IngredientGroup validator
// ---------------------------------------------------------------------------

export function validateIngredientGroup(data: IngredientGroupFormData): ValidationResult<IngredientGroupFormData> {
  const errors: ValidationErrors<IngredientGroupFormData> = {}

  if (!isNonBlank(data.name)) {
    errors.name = 'validation.required'
  } else if (data.name.trim().length > 255) {
    errors.name = 'validation.maxLength'
  }

  return { isValid: Object.keys(errors).length === 0, errors }
}

// ---------------------------------------------------------------------------
// Ingredient validator
// ---------------------------------------------------------------------------

export function validateIngredient(data: IngredientFormData): ValidationResult<IngredientFormData> {
  const errors: ValidationErrors<IngredientFormData> = {}

  if (!isNonBlank(data.name)) {
    errors.name = 'validation.required'
  } else if (data.name.trim().length > 255) {
    errors.name = 'validation.maxLength'
  }

  if (!isNonBlank(data.group_id)) {
    errors.group_id = 'validation.required'
  }

  return { isValid: Object.keys(errors).length === 0, errors }
}

// ---------------------------------------------------------------------------
// SubIngredient validator
// ---------------------------------------------------------------------------

export function validateSubIngredient(data: SubIngredientFormData): ValidationResult<SubIngredientFormData> {
  const errors: ValidationErrors<SubIngredientFormData> = {}

  if (!isNonBlank(data.name)) {
    errors.name = 'validation.required'
  } else if (data.name.trim().length > 255) {
    errors.name = 'validation.maxLength'
  }

  if (!isNonBlank(data.ingredient_id)) {
    errors.ingredient_id = 'validation.required'
  }

  if (data.quantity !== undefined && !isNonNegativeNumber(data.quantity)) {
    errors.quantity = 'validation.invalidNumber'
  }

  return { isValid: Object.keys(errors).length === 0, errors }
}

// ---------------------------------------------------------------------------
// Recipe validator
// ---------------------------------------------------------------------------

export function validateRecipe(data: RecipeFormData): ValidationResult<RecipeFormData> {
  const errors: ValidationErrors<RecipeFormData> = {}

  if (!isNonBlank(data.name)) {
    errors.name = 'validation.required'
  } else if (data.name.trim().length > 255) {
    errors.name = 'validation.maxLength'
  }

  if (!isNonBlank(data.product_id)) {
    errors.product_id = 'validation.required'
  }

  return { isValid: Object.keys(errors).length === 0, errors }
}

// ---------------------------------------------------------------------------
// ProductAllergen validator (for linking UI)
// ---------------------------------------------------------------------------

export interface ProductAllergenLinkFormData {
  allergen_id: string
  presence_type: string
  risk_level: string
}

export function validateProductAllergenLink(
  data: ProductAllergenLinkFormData,
): ValidationResult<ProductAllergenLinkFormData> {
  const errors: ValidationErrors<ProductAllergenLinkFormData> = {}

  if (!isNonBlank(data.allergen_id)) {
    errors.allergen_id = 'validation.required'
  }

  if (!(VALID_PRESENCE_TYPES as readonly string[]).includes(data.presence_type)) {
    errors.presence_type = 'validation.invalidPresenceType'
  }

  if (!(VALID_RISK_LEVELS as readonly string[]).includes(data.risk_level)) {
    errors.risk_level = 'validation.invalidRiskLevel'
  }

  return { isValid: Object.keys(errors).length === 0, errors }
}

// ---------------------------------------------------------------------------
// Operations validators (C-16)
// ---------------------------------------------------------------------------

const VALID_TABLE_STATUSES = ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'OUT_OF_SERVICE'] as const

export function validateTable(data: TableFormData): ValidationResult<TableFormData> {
  const errors: ValidationErrors<TableFormData> = {}

  if (!isPositiveNumber(data.number)) {
    errors.number = 'validation.mustBePositive'
  }

  if (!isNonBlank(data.code)) {
    errors.code = 'validation.required'
  } else if (data.code.trim().length > 20) {
    errors.code = 'validation.maxLength'
  }

  if (!isNonBlank(data.sector_id)) {
    errors.sector_id = 'validation.required'
  }

  if (!isPositiveNumber(data.capacity)) {
    errors.capacity = 'validation.mustBePositive'
  }

  if (!(VALID_TABLE_STATUSES as readonly string[]).includes(data.status)) {
    errors.status = 'validation.selectOption'
  }

  return { isValid: Object.keys(errors).length === 0, errors }
}

export function validateSector(data: SectorFormData): ValidationResult<SectorFormData> {
  const errors: ValidationErrors<SectorFormData> = {}

  if (!isNonBlank(data.name)) {
    errors.name = 'validation.required'
  } else if (data.name.trim().length > 255) {
    errors.name = 'validation.maxLength'
  }

  if (!isNonBlank(data.branch_id)) {
    errors.branch_id = 'validation.required'
  }

  return { isValid: Object.keys(errors).length === 0, errors }
}

export function validateStaff(data: StaffFormData): ValidationResult<StaffFormData> {
  const errors: ValidationErrors<StaffFormData> = {}

  if (!isNonBlank(data.email)) {
    errors.email = 'validation.required'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) {
    errors.email = 'validation.invalidEmail'
  }

  if (!isNonBlank(data.first_name)) {
    errors.first_name = 'validation.required'
  }

  if (!isNonBlank(data.last_name)) {
    errors.last_name = 'validation.required'
  }

  return { isValid: Object.keys(errors).length === 0, errors }
}

// ---------------------------------------------------------------------------
// Promotion validator — C-27
// ---------------------------------------------------------------------------

export function validatePromotion(data: PromotionFormData): ValidationResult<PromotionFormData> {
  const errors: ValidationErrors<PromotionFormData> = {}

  // name: required + max 120
  if (!isNonBlank(data.name)) {
    errors.name = 'validation.required'
  } else if (data.name.trim().length > 120) {
    errors.name = 'validation.maxLength'
  }

  // description: max 500 (optional)
  if (data.description && data.description.trim().length > 500) {
    errors.description = 'validation.maxLength'
  }

  // price: valid number + >= 0
  if (!isValidNumber(data.price)) {
    errors.price = 'validation.required'
  } else if (!isNonNegativeNumber(data.price)) {
    errors.price = 'validation.priceNonNegative'
  }

  // date/time fields: all required
  if (!isNonBlank(data.start_date)) {
    errors.start_date = 'validation.required'
  }
  if (!isNonBlank(data.start_time)) {
    errors.start_time = 'validation.required'
  }
  if (!isNonBlank(data.end_date)) {
    errors.end_date = 'validation.required'
  }
  if (!isNonBlank(data.end_time)) {
    errors.end_time = 'validation.required'
  }

  // Combined end_datetime >= start_datetime
  if (
    isNonBlank(data.start_date) &&
    isNonBlank(data.start_time) &&
    isNonBlank(data.end_date) &&
    isNonBlank(data.end_time)
  ) {
    const start = new Date(`${data.start_date}T${data.start_time}`)
    const end = new Date(`${data.end_date}T${data.end_time}`)
    if (isValidNumber(start.getTime()) && isValidNumber(end.getTime()) && end < start) {
      errors.end_date = 'promotions.endBeforeStart'
    }
  }

  // branch_ids: at least 1 required
  if (!data.branch_ids || data.branch_ids.length === 0) {
    errors.branch_ids = 'promotions.noBranchesSelected'
  }

  return { isValid: Object.keys(errors).length === 0, errors }
}

export function validateWaiterAssignment(data: WaiterAssignmentFormData): ValidationResult<WaiterAssignmentFormData> {
  const errors: ValidationErrors<WaiterAssignmentFormData> = {}

  if (!isNonBlank(data.user_id)) {
    errors.user_id = 'validation.required'
  }

  if (!isNonBlank(data.sector_id)) {
    errors.sector_id = 'validation.required'
  }

  if (!isNonBlank(data.date)) {
    errors.date = 'validation.required'
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
    errors.date = 'validation.invalidDate'
  }

  return { isValid: Object.keys(errors).length === 0, errors }
}
