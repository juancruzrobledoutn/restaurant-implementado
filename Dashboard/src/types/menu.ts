/**
 * Menu domain types for Dashboard.
 *
 * Convention:
 * - All IDs are strings in the frontend (backend returns numbers — convert at boundary)
 * - Prices are integers in cents (12550 = $125.50)
 * - FormData types are used for create/edit modal state
 */

// ---------------------------------------------------------------------------
// Category
// ---------------------------------------------------------------------------

export interface Category {
  id: string
  tenant_id: string
  branch_id: string
  name: string
  order: number
  icon?: string
  image?: string
  is_active: boolean
  created_at?: string
  updated_at?: string
  /** Optimistic insert flag — true while the HTTP request is in flight */
  _optimistic?: boolean
}

export interface CategoryFormData {
  name: string
  order: number
  icon: string
  image: string
  is_active: boolean
  branch_id: string
}

// ---------------------------------------------------------------------------
// Subcategory
// ---------------------------------------------------------------------------

export interface Subcategory {
  id: string
  tenant_id: string
  branch_id: string
  category_id: string
  name: string
  order: number
  image?: string
  is_active: boolean
  created_at?: string
  updated_at?: string
  _optimistic?: boolean
}

export interface SubcategoryFormData {
  name: string
  order: number
  image: string
  is_active: boolean
  category_id: string
  branch_id: string
}

// ---------------------------------------------------------------------------
// Product
// ---------------------------------------------------------------------------

export interface Product {
  id: string
  tenant_id: string
  branch_id: string
  subcategory_id: string
  name: string
  description: string
  price_cents: number
  image?: string
  featured: boolean
  popular: boolean
  is_active: boolean
  created_at?: string
  updated_at?: string
  _optimistic?: boolean
}

export interface ProductFormData {
  name: string
  description: string
  price_cents: number
  image: string
  featured: boolean
  popular: boolean
  is_active: boolean
  subcategory_id: string
  branch_id: string
}

// ---------------------------------------------------------------------------
// BranchProduct — per-branch availability + pricing override
// ---------------------------------------------------------------------------

export interface BranchProduct {
  id: string
  product_id: string
  branch_id: string
  price_override_cents?: number
  is_available: boolean
  created_at?: string
  updated_at?: string
  _optimistic?: boolean
}

export interface BranchProductFormData {
  product_id: string
  branch_id: string
  price_override_cents?: number
  is_available: boolean
}

// ---------------------------------------------------------------------------
// Allergen
// ---------------------------------------------------------------------------

export type AllergenSeverity = 'mild' | 'moderate' | 'severe' | 'critical'

export interface Allergen {
  id: string
  tenant_id: string
  name: string
  icon?: string
  description?: string
  is_mandatory: boolean
  severity: AllergenSeverity
  is_active: boolean
  created_at?: string
  updated_at?: string
  _optimistic?: boolean
}

export interface AllergenFormData {
  name: string
  icon: string
  description: string
  is_mandatory: boolean
  severity: AllergenSeverity
  is_active: boolean
}

// ---------------------------------------------------------------------------
// ProductAllergen — linking table
// ---------------------------------------------------------------------------

export type PresenceType = 'contains' | 'may_contain' | 'free_from'
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface ProductAllergen {
  id: string
  product_id: string
  allergen_id: string
  presence_type: PresenceType
  risk_level: RiskLevel
}

export interface ProductAllergenFormData {
  allergen_id: string
  presence_type: PresenceType
  risk_level: RiskLevel
}

// ---------------------------------------------------------------------------
// AllergenCrossReaction
// ---------------------------------------------------------------------------

export interface AllergenCrossReaction {
  id: string
  allergen_id: string
  related_allergen_id: string
}

// ---------------------------------------------------------------------------
// IngredientGroup
// ---------------------------------------------------------------------------

export interface IngredientGroup {
  id: string
  tenant_id: string
  name: string
  is_active: boolean
  created_at?: string
  updated_at?: string
  _optimistic?: boolean
}

export interface IngredientGroupFormData {
  name: string
  is_active: boolean
}

// ---------------------------------------------------------------------------
// Ingredient
// ---------------------------------------------------------------------------

export interface Ingredient {
  id: string
  group_id: string
  tenant_id: string
  name: string
  unit?: string
  is_active: boolean
  created_at?: string
  updated_at?: string
  _optimistic?: boolean
}

export interface IngredientFormData {
  name: string
  unit: string
  is_active: boolean
  group_id: string
}

// ---------------------------------------------------------------------------
// SubIngredient
// ---------------------------------------------------------------------------

export interface SubIngredient {
  id: string
  ingredient_id: string
  tenant_id: string
  name: string
  quantity?: number
  unit?: string
  is_active: boolean
  created_at?: string
  updated_at?: string
  _optimistic?: boolean
}

export interface SubIngredientFormData {
  name: string
  quantity: number
  unit: string
  is_active: boolean
  ingredient_id: string
}

// ---------------------------------------------------------------------------
// Recipe
// ---------------------------------------------------------------------------

export interface RecipeIngredient {
  ingredient_id: string
  quantity: number
  unit: string
}

export interface Recipe {
  id: string
  tenant_id: string
  product_id: string
  name: string
  ingredients: RecipeIngredient[]
  is_active: boolean
  created_at?: string
  updated_at?: string
  _optimistic?: boolean
}

export interface RecipeFormData {
  name: string
  product_id: string
  ingredients: RecipeIngredient[]
  is_active: boolean
}

// ---------------------------------------------------------------------------
// Cascade preview types
// ---------------------------------------------------------------------------

export interface CascadePreviewItem {
  label: string
  count: number
}

export interface CascadePreview {
  totalItems: number
  items: CascadePreviewItem[]
}

// ---------------------------------------------------------------------------
// Promotion — C-27
// ---------------------------------------------------------------------------

export interface PromotionBranch {
  branch_id: string
  branch_name: string
}

export interface PromotionItem {
  product_id: string
  product_name: string
}

export interface PromotionType {
  id: string
  name: string
}

export interface Promotion {
  id: string
  tenant_id: string
  name: string
  description?: string
  /** Price in cents (12550 = $125.50) */
  price: number
  start_date: string   // "YYYY-MM-DD"
  start_time: string   // "HH:mm:ss"
  end_date: string     // "YYYY-MM-DD"
  end_time: string     // "HH:mm:ss"
  promotion_type_id?: string
  is_active: boolean
  created_at: string
  updated_at: string
  branches: PromotionBranch[]
  items: PromotionItem[]
  _optimistic?: boolean
}

export interface PromotionFormData {
  name: string
  description: string
  /** Price in cents */
  price: number
  start_date: string
  start_time: string
  end_date: string
  end_time: string
  promotion_type_id: string | null
  branch_ids: string[]
  product_ids: string[]
  is_active: boolean
}

// ---------------------------------------------------------------------------
// WebSocket event types
// ---------------------------------------------------------------------------

export type WSEntityType =
  | 'category'
  | 'subcategory'
  | 'product'
  | 'branch_product'
  | 'product_allergen'
  | 'allergen'
  | 'ingredient_group'
  | 'ingredient'
  | 'sub_ingredient'
  | 'recipe'
  | 'promotion'

export type WSEventType =
  | 'ENTITY_CREATED'
  | 'ENTITY_UPDATED'
  | 'ENTITY_DELETED'
  | 'CASCADE_DELETE'
  // C-16: operations events
  | 'ROUND_PENDING'
  | 'ROUND_CONFIRMED'
  | 'ROUND_SUBMITTED'
  | 'ROUND_IN_KITCHEN'
  | 'ROUND_READY'
  | 'ROUND_SERVED'
  | 'ROUND_CANCELED'
  | 'TABLE_STATUS_CHANGED'
  | 'TABLE_SESSION_STARTED'
  | 'TABLE_CLEARED'
  // C-26: billing events (Outbox)
  | 'CHECK_REQUESTED'
  | 'CHECK_PAID'
  | 'PAYMENT_APPROVED'
  | 'PAYMENT_REJECTED'

export interface WSEvent {
  type: WSEventType
  entity?: WSEntityType
  id?: string
  data?: Record<string, unknown>
  /** C-26: billing Outbox events carry their data in payload (not data) */
  payload?: Record<string, unknown>
  branch_id?: string
  affected?: Record<string, number>
  timestamp?: string
}
