/**
 * salesStore — daily sales KPIs and top products state (C-16).
 *
 * Skill: zustand-store-pattern
 * State: { daily, topProducts, isLoading, selectedDate }
 * The store persists only selectedDate — the KPI data is refetched on mount.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import { STORAGE_KEYS, STORE_VERSIONS } from '@/utils/constants'
import { salesAPI } from '@/services/salesAPI'
import { handleError } from '@/utils/logger'
import type { DailyKPIs, TopProduct } from '@/types/operations'

const EMPTY_TOP_PRODUCTS: TopProduct[] = []

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

interface SalesState {
  daily: DailyKPIs | null
  topProducts: TopProduct[]
  isLoading: boolean
  selectedDate: string
  error: string | null

  fetchDaily: (branchId: string, date: string) => Promise<void>
  fetchTopProducts: (branchId: string, date: string, limit?: number) => Promise<void>
  setDate: (date: string) => void
  reset: () => void
}

export const useSalesStore = create<SalesState>()(
  persist(
    (set) => ({
      daily: null,
      topProducts: EMPTY_TOP_PRODUCTS,
      isLoading: false,
      selectedDate: todayISO(),
      error: null,

      fetchDaily: async (branchId, date) => {
        set({ isLoading: true, error: null })
        try {
          const data = await salesAPI.getDailyKPIs(branchId, date)
          set({ daily: data, isLoading: false })
        } catch (err) {
          set({ isLoading: false, error: handleError(err, 'salesStore.fetchDaily') })
        }
      },

      fetchTopProducts: async (branchId, date, limit = 10) => {
        set({ isLoading: true, error: null })
        try {
          const data = await salesAPI.getTopProducts(branchId, date, limit)
          set({ topProducts: data, isLoading: false })
        } catch (err) {
          set({ isLoading: false, error: handleError(err, 'salesStore.fetchTopProducts') })
        }
      },

      setDate: (date) => {
        set({ selectedDate: date })
      },

      reset: () => {
        set({
          daily: null,
          topProducts: EMPTY_TOP_PRODUCTS,
          isLoading: false,
          error: null,
        })
      },
    }),
    {
      name: STORAGE_KEYS.SALES_STORE,
      version: STORE_VERSIONS.SALES_STORE,
      // Only persist selectedDate — KPI data is always refetched on mount
      partialize: (state) => ({ selectedDate: state.selectedDate }),
      migrate: (persistedState: unknown): SalesState => {
        const state = persistedState as { selectedDate?: string } | undefined
        return {
          daily: null,
          topProducts: EMPTY_TOP_PRODUCTS,
          isLoading: false,
          selectedDate: state?.selectedDate ?? todayISO(),
          error: null,
        } as SalesState
      },
    },
  ),
)

export const selectDailyKPIs = (s: SalesState) => s.daily
export const selectTopProducts = (s: SalesState) => s.topProducts ?? EMPTY_TOP_PRODUCTS
export const selectSalesSelectedDate = (s: SalesState) => s.selectedDate
export const selectSalesIsLoading = (s: SalesState) => s.isLoading

export const useSalesActions = () =>
  useSalesStore(
    useShallow((s) => ({
      fetchDaily: s.fetchDaily,
      fetchTopProducts: s.fetchTopProducts,
      setDate: s.setDate,
      reset: s.reset,
    })),
  )
