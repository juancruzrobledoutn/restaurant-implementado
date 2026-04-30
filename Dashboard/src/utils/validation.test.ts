/**
 * Tests for validation utilities.
 *
 * Skill: test-driven-development, react19-form-pattern
 */

import { describe, it, expect } from 'vitest'
import {
  isValidNumber,
  isPositiveNumber,
  isNonNegativeNumber,
  validateImageUrl,
  validateCategory,
  validateSubcategory,
  validateProduct,
  validateAllergen,
  validateIngredientGroup,
  validateIngredient,
  validateSubIngredient,
  validateRecipe,
  validatePromotion,
} from './validation'

// ---------------------------------------------------------------------------
// Number helpers
// ---------------------------------------------------------------------------

describe('isValidNumber', () => {
  it('returns true for finite numbers', () => {
    expect(isValidNumber(0)).toBe(true)
    expect(isValidNumber(42)).toBe(true)
    expect(isValidNumber(-5)).toBe(true)
    expect(isValidNumber(3.14)).toBe(true)
  })

  it('returns false for NaN', () => {
    expect(isValidNumber(NaN)).toBe(false)
  })

  it('returns false for Infinity', () => {
    expect(isValidNumber(Infinity)).toBe(false)
    expect(isValidNumber(-Infinity)).toBe(false)
  })
})

describe('isPositiveNumber', () => {
  it('returns true for positive numbers', () => {
    expect(isPositiveNumber(1)).toBe(true)
    expect(isPositiveNumber(100)).toBe(true)
    expect(isPositiveNumber(0.01)).toBe(true)
  })

  it('returns false for zero', () => {
    expect(isPositiveNumber(0)).toBe(false)
  })

  it('returns false for negative numbers', () => {
    expect(isPositiveNumber(-1)).toBe(false)
  })

  it('returns false for NaN', () => {
    expect(isPositiveNumber(NaN)).toBe(false)
  })
})

describe('isNonNegativeNumber', () => {
  it('returns true for zero and positive numbers', () => {
    expect(isNonNegativeNumber(0)).toBe(true)
    expect(isNonNegativeNumber(100)).toBe(true)
  })

  it('returns false for negative numbers', () => {
    expect(isNonNegativeNumber(-1)).toBe(false)
  })

  it('returns false for NaN', () => {
    expect(isNonNegativeNumber(NaN)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// validateImageUrl
// ---------------------------------------------------------------------------

describe('validateImageUrl', () => {
  it('returns true for valid https CDN URL', () => {
    expect(validateImageUrl('https://cdn.example.com/photo.jpg')).toBe(true)
  })

  it('returns true for empty string (optional field)', () => {
    expect(validateImageUrl('')).toBe(true)
  })

  it('returns false for http URL', () => {
    expect(validateImageUrl('http://example.com/image.jpg')).toBe(false)
  })

  it('returns false for private IP 192.168.x.x', () => {
    expect(validateImageUrl('https://192.168.1.1/image.png')).toBe(false)
  })

  it('returns false for private IP 10.x.x.x', () => {
    expect(validateImageUrl('https://10.0.0.1/image.png')).toBe(false)
  })

  it('returns false for private IP 172.16.x.x', () => {
    expect(validateImageUrl('https://172.16.0.1/image.png')).toBe(false)
  })

  it('returns false for loopback 127.0.0.1', () => {
    expect(validateImageUrl('https://127.0.0.1/image.png')).toBe(false)
  })

  it('returns false for link-local (AWS metadata) 169.254.x.x', () => {
    expect(validateImageUrl('http://169.254.169.254/latest/meta-data/')).toBe(false)
  })

  it('returns false for localhost', () => {
    expect(validateImageUrl('https://localhost/image.png')).toBe(false)
  })

  it('returns false for non-standard port', () => {
    expect(validateImageUrl('https://cdn.example.com:8080/photo.jpg')).toBe(false)
  })

  it('returns false for invalid URL', () => {
    expect(validateImageUrl('not-a-url')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// validateCategory
// ---------------------------------------------------------------------------

describe('validateCategory', () => {
  const validData = {
    name: 'Bebidas',
    order: 1,
    icon: '',
    image: '',
    is_active: true,
    branch_id: '1',
  }

  it('passes with valid data', () => {
    const result = validateCategory(validData)
    expect(result.isValid).toBe(true)
    expect(result.errors).toEqual({})
  })

  it('requires name', () => {
    const result = validateCategory({ ...validData, name: '' })
    expect(result.isValid).toBe(false)
    expect(result.errors.name).toBe('validation.required')
  })

  it('rejects name longer than 255 chars', () => {
    const result = validateCategory({ ...validData, name: 'a'.repeat(256) })
    expect(result.isValid).toBe(false)
    expect(result.errors.name).toBe('validation.maxLength')
  })

  it('rejects negative order', () => {
    const result = validateCategory({ ...validData, order: -1 })
    expect(result.isValid).toBe(false)
    expect(result.errors.order).toBe('validation.invalidNumber')
  })

  it('accepts zero order', () => {
    const result = validateCategory({ ...validData, order: 0 })
    expect(result.isValid).toBe(true)
  })

  it('rejects invalid image URL', () => {
    const result = validateCategory({ ...validData, image: 'http://192.168.1.1/image.png' })
    expect(result.isValid).toBe(false)
    expect(result.errors.image).toBe('validation.invalidImageUrl')
  })

  it('accepts valid image URL', () => {
    const result = validateCategory({ ...validData, image: 'https://cdn.example.com/photo.jpg' })
    expect(result.isValid).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// validateSubcategory
// ---------------------------------------------------------------------------

describe('validateSubcategory', () => {
  const validData = {
    name: 'Bebidas sin alcohol',
    order: 1,
    image: '',
    is_active: true,
    category_id: 'cat-1',
    branch_id: 'branch-1',
  }

  it('accepts valid subcategory', () => {
    const result = validateSubcategory(validData)
    expect(result.isValid).toBe(true)
  })

  it('rejects empty name', () => {
    const result = validateSubcategory({ ...validData, name: '' })
    expect(result.isValid).toBe(false)
    expect(result.errors.name).toBeDefined()
  })

  it('rejects missing category_id', () => {
    const result = validateSubcategory({ ...validData, category_id: '' })
    expect(result.isValid).toBe(false)
    expect(result.errors.category_id).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// validateProduct
// ---------------------------------------------------------------------------

describe('validateProduct', () => {
  const validData = {
    name: 'Caesar Salad',
    description: '',
    price_cents: 12550,
    image: '',
    featured: false,
    popular: false,
    is_active: true,
    subcategory_id: '5',
    branch_id: '1',
  }

  it('passes with valid data', () => {
    expect(validateProduct(validData).isValid).toBe(true)
  })

  it('requires name', () => {
    const result = validateProduct({ ...validData, name: '' })
    expect(result.errors.name).toBe('validation.required')
  })

  it('rejects negative price', () => {
    const result = validateProduct({ ...validData, price_cents: -100 })
    expect(result.isValid).toBe(false)
    expect(result.errors.price_cents).toBe('validation.invalidPrice')
  })

  it('accepts zero price', () => {
    const result = validateProduct({ ...validData, price_cents: 0 })
    expect(result.isValid).toBe(true)
  })

  it('requires subcategory_id', () => {
    const result = validateProduct({ ...validData, subcategory_id: '' })
    expect(result.errors.subcategory_id).toBe('validation.required')
  })

  it('rejects SSRF image URL', () => {
    const result = validateProduct({ ...validData, image: 'http://169.254.169.254/latest/meta-data/' })
    expect(result.errors.image).toBe('validation.invalidImageUrl')
  })
})

// ---------------------------------------------------------------------------
// validateAllergen
// ---------------------------------------------------------------------------

describe('validateAllergen', () => {
  const validData = {
    name: 'Gluten',
    icon: '',
    description: '',
    is_mandatory: true,
    severity: 'severe' as const,
    is_active: true,
  }

  it('passes with valid data', () => {
    expect(validateAllergen(validData).isValid).toBe(true)
  })

  it('requires name', () => {
    const result = validateAllergen({ ...validData, name: '' })
    expect(result.errors.name).toBe('validation.required')
  })

  it('rejects invalid severity', () => {
    const result = validateAllergen({ ...validData, severity: 'extreme' as never })
    expect(result.errors.severity).toBe('validation.invalidSeverity')
  })

  it('accepts all valid severity values', () => {
    for (const severity of ['mild', 'moderate', 'severe', 'critical'] as const) {
      expect(validateAllergen({ ...validData, severity }).isValid).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// validateIngredientGroup
// ---------------------------------------------------------------------------

describe('validateIngredientGroup', () => {
  it('passes with valid name', () => {
    expect(validateIngredientGroup({ name: 'Dairy', is_active: true }).isValid).toBe(true)
  })

  it('requires name', () => {
    const result = validateIngredientGroup({ name: '', is_active: true })
    expect(result.errors.name).toBe('validation.required')
  })
})

// ---------------------------------------------------------------------------
// validateIngredient
// ---------------------------------------------------------------------------

describe('validateIngredient', () => {
  const validData = { name: 'Whole Milk', unit: 'ml', is_active: true, group_id: '1' }

  it('passes with valid data', () => {
    expect(validateIngredient(validData).isValid).toBe(true)
  })

  it('requires name', () => {
    expect(validateIngredient({ ...validData, name: '' }).errors.name).toBe('validation.required')
  })

  it('requires group_id', () => {
    expect(validateIngredient({ ...validData, group_id: '' }).errors.group_id).toBe('validation.required')
  })
})

// ---------------------------------------------------------------------------
// validateSubIngredient
// ---------------------------------------------------------------------------

describe('validateSubIngredient', () => {
  const validData = { name: 'Fat', quantity: 3.5, unit: '%', is_active: true, ingredient_id: '2' }

  it('passes with valid data', () => {
    expect(validateSubIngredient(validData).isValid).toBe(true)
  })

  it('requires name', () => {
    expect(validateSubIngredient({ ...validData, name: '' }).errors.name).toBe('validation.required')
  })

  it('rejects negative quantity', () => {
    const result = validateSubIngredient({ ...validData, quantity: -1 })
    expect(result.errors.quantity).toBe('validation.invalidNumber')
  })
})

// ---------------------------------------------------------------------------
// validateRecipe
// ---------------------------------------------------------------------------

describe('validateRecipe', () => {
  const validData = {
    name: 'Classic Burger',
    product_id: '10',
    ingredients: [],
    is_active: true,
  }

  it('passes with valid data', () => {
    expect(validateRecipe(validData).isValid).toBe(true)
  })

  it('requires name', () => {
    expect(validateRecipe({ ...validData, name: '' }).errors.name).toBe('validation.required')
  })

  it('requires product_id', () => {
    expect(validateRecipe({ ...validData, product_id: '' }).errors.product_id).toBe('validation.required')
  })
})

// ---------------------------------------------------------------------------
// validatePromotion — C-27
// ---------------------------------------------------------------------------

describe('validatePromotion', () => {
  const validData = {
    name: 'Promo 2x1',
    description: '',
    price: 10000,
    start_date: '2025-06-15',
    start_time: '18:00',
    end_date: '2025-06-15',
    end_time: '22:00',
    promotion_type_id: null,
    branch_ids: ['1'],
    product_ids: [],
    is_active: true,
  }

  it('passes with valid data', () => {
    expect(validatePromotion(validData).isValid).toBe(true)
  })

  it('requires name', () => {
    expect(validatePromotion({ ...validData, name: '' }).errors.name).toBe('validation.required')
  })

  it('rejects name longer than 120 chars', () => {
    expect(
      validatePromotion({ ...validData, name: 'a'.repeat(121) }).errors.name,
    ).toBe('validation.maxLength')
  })

  it('rejects description longer than 500 chars', () => {
    expect(
      validatePromotion({ ...validData, description: 'x'.repeat(501) }).errors.description,
    ).toBe('validation.maxLength')
  })

  it('rejects negative price', () => {
    expect(validatePromotion({ ...validData, price: -1 }).errors.price).toBe('validation.priceNonNegative')
  })

  it('accepts price of 0', () => {
    expect(validatePromotion({ ...validData, price: 0 }).isValid).toBe(true)
  })

  it('rejects end before start', () => {
    expect(
      validatePromotion({
        ...validData,
        start_date: '2025-06-15',
        start_time: '22:00',
        end_date: '2025-06-15',
        end_time: '18:00',
      }).errors.end_date,
    ).toBe('promotions.endBeforeStart')
  })

  it('requires at least one branch', () => {
    expect(validatePromotion({ ...validData, branch_ids: [] }).errors.branch_ids).toBe(
      'promotions.noBranchesSelected',
    )
  })

  it('requires start_date', () => {
    expect(validatePromotion({ ...validData, start_date: '' }).errors.start_date).toBe('validation.required')
  })

  it('requires start_time', () => {
    expect(validatePromotion({ ...validData, start_time: '' }).errors.start_time).toBe('validation.required')
  })

  it('requires end_date', () => {
    expect(validatePromotion({ ...validData, end_date: '' }).errors.end_date).toBe('validation.required')
  })

  it('requires end_time', () => {
    expect(validatePromotion({ ...validData, end_time: '' }).errors.end_time).toBe('validation.required')
  })
})
