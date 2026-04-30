/**
 * SubcategorySection — renders a subcategory with its filtered products.
 */
import { ProductCard } from './ProductCard'
import type { Subcategory } from '../../types/menu'

interface SubcategorySectionProps {
  subcategory: Subcategory
}

export function SubcategorySection({ subcategory }: SubcategorySectionProps) {
  if (subcategory.products.length === 0) return null

  return (
    <section className="mb-6">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
        {subcategory.name}
      </h3>
      <div className="space-y-3">
        {subcategory.products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  )
}
