/**
 * Tests for formatter utilities.
 *
 * Skill: test-driven-development
 */

import { describe, it, expect } from 'vitest'
import {
  formatPrice,
  parsePriceToCents,
  toStringId,
  toNumberId,
  parseImageUrl,
  formatPromotionValidity,
  getPromotionStatus,
  isPromotionActiveNow,
} from './formatters'

describe('formatPrice', () => {
  it('formats cents to currency string', () => {
    expect(formatPrice(12550)).toBe('$125.50')
  })

  it('formats zero cents', () => {
    expect(formatPrice(0)).toBe('$0.00')
  })

  it('formats 100 cents as $1.00', () => {
    expect(formatPrice(100)).toBe('$1.00')
  })

  it('formats large price', () => {
    expect(formatPrice(100000)).toBe('$1,000.00')
  })

  it('returns $0.00 for negative value', () => {
    expect(formatPrice(-100)).toBe('$0.00')
  })

  it('returns $0.00 for NaN', () => {
    expect(formatPrice(NaN)).toBe('$0.00')
  })
})

describe('parsePriceToCents', () => {
  it('parses "125.50" to 12550', () => {
    expect(parsePriceToCents('125.50')).toBe(12550)
  })

  it('parses "10" to 1000', () => {
    expect(parsePriceToCents('10')).toBe(1000)
  })

  it('parses empty string to 0', () => {
    expect(parsePriceToCents('')).toBe(0)
  })

  it('strips non-numeric characters', () => {
    expect(parsePriceToCents('$12.50')).toBe(1250)
  })
})

describe('toStringId', () => {
  it('converts number to string', () => {
    expect(toStringId(42)).toBe('42')
  })

  it('keeps string as string', () => {
    expect(toStringId('42')).toBe('42')
  })
})

describe('toNumberId', () => {
  it('converts string to number', () => {
    expect(toNumberId('42')).toBe(42)
  })
})

describe('parseImageUrl', () => {
  it('returns https URL unchanged', () => {
    expect(parseImageUrl('https://cdn.example.com/img.jpg')).toBe('https://cdn.example.com/img.jpg')
  })

  it('returns empty string for http URL', () => {
    expect(parseImageUrl('http://example.com/img.jpg')).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(parseImageUrl(undefined)).toBe('')
  })

  it('returns empty string for null', () => {
    expect(parseImageUrl(null)).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Promotion formatters — C-27
// ---------------------------------------------------------------------------

const samplePromo = {
  start_date: '2025-06-15',
  start_time: '18:00:00',
  end_date: '2025-06-15',
  end_time: '22:00:00',
}

describe('formatPromotionValidity', () => {
  it('formats start and end as DD/MM HH:mm → DD/MM HH:mm', () => {
    expect(formatPromotionValidity(samplePromo)).toBe('15/06 18:00 → 15/06 22:00')
  })

  it('formats cross-day range correctly', () => {
    expect(
      formatPromotionValidity({
        start_date: '2025-01-01',
        start_time: '10:30:00',
        end_date: '2025-01-02',
        end_time: '08:00:00',
      }),
    ).toBe('01/01 10:30 → 02/01 08:00')
  })
})

describe('getPromotionStatus', () => {
  it('returns scheduled when now is before start', () => {
    const now = new Date('2025-06-15T17:00:00')
    expect(getPromotionStatus(samplePromo, now)).toBe('scheduled')
  })

  it('returns active when now is within the range', () => {
    const now = new Date('2025-06-15T20:00:00')
    expect(getPromotionStatus(samplePromo, now)).toBe('active')
  })

  it('returns expired when now is after end', () => {
    const now = new Date('2025-06-15T23:00:00')
    expect(getPromotionStatus(samplePromo, now)).toBe('expired')
  })

  it('returns active exactly at start boundary', () => {
    const now = new Date('2025-06-15T18:00:00')
    expect(getPromotionStatus(samplePromo, now)).toBe('active')
  })
})

describe('isPromotionActiveNow', () => {
  it('returns true when active', () => {
    const now = new Date('2025-06-15T20:00:00')
    expect(isPromotionActiveNow(samplePromo, now)).toBe(true)
  })

  it('returns false when scheduled', () => {
    const now = new Date('2025-06-15T17:00:00')
    expect(isPromotionActiveNow(samplePromo, now)).toBe(false)
  })

  it('returns false when expired', () => {
    const now = new Date('2025-06-15T23:00:00')
    expect(isPromotionActiveNow(samplePromo, now)).toBe(false)
  })
})
