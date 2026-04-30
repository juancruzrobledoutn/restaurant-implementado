/**
 * Menu service — public endpoint, no auth required.
 * Converts DTOs (backend shape) → domain types (frontend shape).
 */
import { apiGet } from './api'
import { toStringId } from '../utils/idConversion'
import type {
  Category,
  CategoryDTO,
  Subcategory,
  SubcategoryDTO,
  Product,
  ProductDTO,
  Allergen,
  AllergenDTO,
} from '../types/menu'

function toAllergen(dto: AllergenDTO): Allergen {
  return {
    id: toStringId(dto.id),
    code: dto.code,
    name: dto.name,
  }
}

function toProduct(dto: ProductDTO & { image?: string | null }): Product {
  return {
    id: toStringId(dto.id),
    name: dto.name,
    description: dto.description,
    priceCents: dto.price_cents,
    imageUrl: dto.image_url ?? dto.image ?? null,
    isAvailable: dto.is_available ?? true,
    allergens: (dto.allergens ?? []).map(toAllergen),
  }
}

function toSubcategory(dto: SubcategoryDTO): Subcategory {
  return {
    id: toStringId(dto.id),
    name: dto.name,
    products: dto.products.map(toProduct),
  }
}

function toCategory(dto: CategoryDTO): Category {
  return {
    id: toStringId(dto.id),
    name: dto.name,
    subcategories: dto.subcategories.map(toSubcategory),
  }
}

export async function getPublicMenu(slug: string, signal?: AbortSignal): Promise<Category[]> {
  const raw = await apiGet<CategoryDTO[] | { categories: CategoryDTO[] }>(
    `/api/public/menu/${slug}`,
    { skipAuth: true, signal },
  )
  const dtos: CategoryDTO[] = Array.isArray(raw) ? raw : (raw.categories ?? [])
  return dtos.map(toCategory)
}
