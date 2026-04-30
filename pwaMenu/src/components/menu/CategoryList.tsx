/**
 * CategoryList — renders a list of categories with their subcategories and products.
 * Applies search + allergen filters.
 */
import { useMemo } from 'react'
import { SubcategorySection } from './SubcategorySection'
import type { Category, Product } from '../../types/menu'
import type { AllergenCode } from './AllergenFilter'

interface CategoryListProps {
  categories: Category[]
  searchQuery: string
  excludedAllergens: Set<AllergenCode>
}

function filterProduct(product: Product, query: string, excluded: Set<AllergenCode>): boolean {
  if (!product.isAvailable) return false
  if (query && !product.name.toLowerCase().includes(query.toLowerCase())) return false
  if (excluded.size > 0) {
    const hasExcluded = product.allergens.some((a) => excluded.has(a.code as AllergenCode))
    if (hasExcluded) return false
  }
  return true
}

export function CategoryList({ categories, searchQuery, excludedAllergens }: CategoryListProps) {
  const filtered = useMemo(() => {
    return categories
      .map((cat) => ({
        ...cat,
        subcategories: cat.subcategories
          .map((sub) => ({
            ...sub,
            products: sub.products.filter((p) => filterProduct(p, searchQuery, excludedAllergens)),
          }))
          .filter((sub) => sub.products.length > 0),
      }))
      .filter((cat) => cat.subcategories.length > 0)
  }, [categories, searchQuery, excludedAllergens])

  return (
    <div>
      {filtered.map((cat) => (
        <section key={cat.id} className="mb-8">
          <h2 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b border-gray-100">
            {cat.name}
          </h2>
          {cat.subcategories.map((sub) => (
            <SubcategorySection key={sub.id} subcategory={sub} />
          ))}
        </section>
      ))}
    </div>
  )
}
