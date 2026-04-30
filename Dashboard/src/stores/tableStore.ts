/**
 * tableStore — branch-scoped table management with WebSocket support (C-16).
 *
 * Skill: zustand-store-pattern
 * Extra: handleTableStatusChanged patches only the 'status' field for real-time updates.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import { STORAGE_KEYS, STORE_VERSIONS } from '@/utils/constants'
import { tableAPI } from '@/services/tableAPI'
import { toast } from '@/stores/toastStore'
import { handleError } from '@/utils/logger'
import type { Table, TableFormData, TableStatus } from '@/types/operations'
import type { WSEvent } from '@/types/menu'

const EMPTY_TABLES: Table[] = []

interface TableState {
  items: Table[]
  isLoading: boolean
  error: string | null

  fetchByBranch: (branchId: string) => Promise<void>
  createTableAsync: (data: TableFormData) => Promise<Table>
  updateTableAsync: (id: string, data: TableFormData) => Promise<void>
  deleteTableAsync: (id: string) => Promise<void>

  /** Patch only the status field when a TABLE_STATUS_CHANGED WS event arrives. */
  handleTableStatusChanged: (event: WSEvent) => void

  /** Clear all branch-scoped data — called by branchStore on branch switch (C-29). */
  clearAll: () => void
}

export const useTableStore = create<TableState>()(
  persist(
    (set, get) => ({
      items: EMPTY_TABLES,
      isLoading: false,
      error: null,

      fetchByBranch: async (branchId) => {
        set({ isLoading: true, error: null })
        try {
          const data = await tableAPI.list(branchId)
          set({ items: data, isLoading: false })
        } catch (err) {
          set({ isLoading: false, error: handleError(err, 'tableStore.fetchByBranch') })
        }
      },

      createTableAsync: async (data) => {
        try {
          const created = await tableAPI.create(data)
          set((s) => ({ items: [...s.items, created] }))
          toast.success('Mesa creada correctamente')
          return created
        } catch (err) {
          set({ error: handleError(err, 'tableStore.createTableAsync') })
          toast.error('Error al crear la mesa')
          throw err
        }
      },

      updateTableAsync: async (id, data) => {
        const previous = get().items
        set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...data } : i)) }))
        try {
          const updated = await tableAPI.update(id, data)
          set((s) => ({ items: s.items.map((i) => (i.id === id ? updated : i)) }))
          toast.success('Mesa actualizada correctamente')
        } catch (err) {
          set({ items: previous, error: handleError(err, 'tableStore.updateTableAsync') })
          toast.error('Error al actualizar la mesa')
          throw err
        }
      },

      deleteTableAsync: async (id) => {
        const previous = get().items
        set((s) => ({ items: s.items.filter((i) => i.id !== id) }))
        try {
          await tableAPI.delete(id)
          toast.success('Mesa eliminada correctamente')
        } catch (err) {
          set({ items: previous, error: handleError(err, 'tableStore.deleteTableAsync') })
          toast.error('Error al eliminar la mesa')
          throw err
        }
      },

      handleTableStatusChanged: (event) => {
        const id = String((event.data as { id?: number })?.id ?? event.id ?? '')
        const newStatus = (event.data as { status?: string })?.status as TableStatus | undefined
        if (!id || !newStatus) return
        set((s) => ({
          items: s.items.map((t) => (t.id === id ? { ...t, status: newStatus } : t)),
        }))
      },

      clearAll: () => {
        set({ items: EMPTY_TABLES, isLoading: false, error: null })
      },
    }),
    {
      name: STORAGE_KEYS.TABLE_STORE,
      version: STORE_VERSIONS.TABLE_STORE,
      partialize: (state) => ({ items: state.items }),
      migrate: (persistedState: unknown): TableState => {
        if (!persistedState || typeof persistedState !== 'object') {
          return { items: EMPTY_TABLES, isLoading: false, error: null } as TableState
        }
        const state = persistedState as { items?: unknown }
        return {
          items: Array.isArray(state.items) ? (state.items as Table[]) : EMPTY_TABLES,
          isLoading: false,
          error: null,
        } as TableState
      },
    },
  ),
)

export const selectTables = (s: TableState) => s.items ?? EMPTY_TABLES
export const selectTableIsLoading = (s: TableState) => s.isLoading

/** C-30: count active (is_active) tables that are currently OCCUPIED */
export const selectActiveTablesCount = (s: TableState): number =>
  s.items.filter((t) => t.status === 'OCCUPIED' && t.is_active).length

/** C-30: count all is_active tables (regardless of status) */
export const selectTotalTablesCount = (s: TableState): number =>
  s.items.filter((t) => t.is_active).length

export const useTablesByBranch = (branchId: string) =>
  useTableStore(useShallow((s) => s.items.filter((t) => t.branch_id === branchId && t.is_active)))

export const useTableActions = () =>
  useTableStore(
    useShallow((s) => ({
      fetchByBranch: s.fetchByBranch,
      createTableAsync: s.createTableAsync,
      updateTableAsync: s.updateTableAsync,
      deleteTableAsync: s.deleteTableAsync,
      handleTableStatusChanged: s.handleTableStatusChanged,
      clearAll: s.clearAll,
    })),
  )
