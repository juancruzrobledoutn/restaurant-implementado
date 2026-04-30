/**
 * Domain types for menu (frontend — IDs are strings, prices in cents as integers).
 */

export interface Allergen {
  id: string
  code: string
  name: string
}

export interface Product {
  id: string
  name: string
  description: string | null
  priceCents: number
  imageUrl: string | null
  isAvailable: boolean
  allergens: Allergen[]
}

export interface Subcategory {
  id: string
  name: string
  products: Product[]
}

export interface Category {
  id: string
  name: string
  subcategories: Subcategory[]
}

// ---- DTOs — raw backend response shapes ----

export interface AllergenDTO {
  id: number
  code: string
  name: string
}

export interface ProductDTO {
  id: number
  name: string
  description: string | null
  price_cents: number
  image_url: string | null
  is_available: boolean
  allergens: AllergenDTO[]
}

export interface SubcategoryDTO {
  id: number
  name: string
  products: ProductDTO[]
}

export interface CategoryDTO {
  id: number
  name: string
  subcategories: SubcategoryDTO[]
}
