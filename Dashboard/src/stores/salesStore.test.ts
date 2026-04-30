/**
 * salesStore unit tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSalesStore } from './salesStore'
import type { DailyKPIs, TopProduct } from '@/types/operations'

vi.mock('@/services/api', () => ({ fetchAPI: vi.fn() }))
vi.mock('@/utils/logger', () => ({
  handleError: vi.fn((_e: unknown, ctx: string) => `error:${ctx}`),
}))

import { fetchAPI } from '@/services/api'
const mockFetchAPI = fetchAPI as ReturnType<typeof vi.fn>

const sampleKPIs: DailyKPIs = {
  revenue_cents: 50000,
  orders: 10,
  average_ticket_cents: 5000,
  diners: 25,
}

const sampleTopProducts: TopProduct[] = [
  { product_id: '1', product_name: 'Milanesa', quantity_sold: 5, revenue_cents: 12500 },
]

beforeEach(() => {
  useSalesStore.setState({
    daily: null,
    topProducts: [],
    isLoading: false,
    selectedDate: '2026-01-01',
    error: null,
  })
  vi.clearAllMocks()
})

describe('initial_state', () => {
  it('starts with null daily and empty products', () => {
    const state = useSalesStore.getState()
    expect(state.daily).toBeNull()
    expect(state.topProducts).toHaveLength(0)
    expect(state.isLoading).toBe(false)
  })
})

describe('fetchDaily', () => {
  it('populates daily KPIs on success', async () => {
    mockFetchAPI.mockResolvedValueOnce(sampleKPIs)
    await useSalesStore.getState().fetchDaily('100', '2026-01-01')
    expect(useSalesStore.getState().daily).toEqual(sampleKPIs)
    expect(useSalesStore.getState().isLoading).toBe(false)
  })

  it('sets error on failure', async () => {
    mockFetchAPI.mockRejectedValueOnce(new Error('net'))
    await useSalesStore.getState().fetchDaily('100', '2026-01-01')
    expect(useSalesStore.getState().daily).toBeNull()
    expect(useSalesStore.getState().error).toBe('error:salesStore.fetchDaily')
  })
})

describe('fetchTopProducts', () => {
  it('populates topProducts on success', async () => {
    mockFetchAPI.mockResolvedValueOnce(sampleTopProducts)
    await useSalesStore.getState().fetchTopProducts('100', '2026-01-01', 10)
    expect(useSalesStore.getState().topProducts).toHaveLength(1)
    expect(useSalesStore.getState().topProducts[0]!.product_name).toBe('Milanesa')
  })
})

describe('setDate', () => {
  it('updates selectedDate', () => {
    useSalesStore.getState().setDate('2026-04-01')
    expect(useSalesStore.getState().selectedDate).toBe('2026-04-01')
  })
})

describe('reset', () => {
  it('clears daily and topProducts', () => {
    useSalesStore.setState({ daily: sampleKPIs, topProducts: sampleTopProducts })
    useSalesStore.getState().reset()
    expect(useSalesStore.getState().daily).toBeNull()
    expect(useSalesStore.getState().topProducts).toHaveLength(0)
  })
})
