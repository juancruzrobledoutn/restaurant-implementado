/**
 * salesAPI — REST client for sales reporting endpoints (C-16).
 *
 * Endpoint base: /api/admin/sales
 * date parameter: YYYY-MM-DD string
 */

import { fetchAPI } from '@/services/api'
import type { DailyKPIs, TopProduct } from '@/types/operations'

interface BackendTopProduct {
  product_id: number
  product_name: string
  quantity_sold: number
  revenue_cents: number
}

function toTopProduct(b: BackendTopProduct): TopProduct {
  return {
    ...b,
    product_id: String(b.product_id),
  }
}

export const salesAPI = {
  /**
   * Fetch daily KPIs for a branch on a specific date.
   * date: YYYY-MM-DD
   */
  getDailyKPIs: async (branchId: string, date: string): Promise<DailyKPIs> => {
    return fetchAPI<DailyKPIs>(
      `/api/admin/sales/daily?branch_id=${parseInt(branchId, 10)}&date=${date}`,
    )
  },

  /**
   * Fetch top products by revenue for a branch on a specific date.
   * date: YYYY-MM-DD, limit: 1–50 (default 10)
   */
  getTopProducts: async (
    branchId: string,
    date: string,
    limit = 10,
  ): Promise<TopProduct[]> => {
    const data = await fetchAPI<BackendTopProduct[]>(
      `/api/admin/sales/top-products?branch_id=${parseInt(branchId, 10)}&date=${date}&limit=${limit}`,
    )
    return data.map(toTopProduct)
  },
}
