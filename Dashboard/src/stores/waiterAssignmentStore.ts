/**
 * waiterAssignmentStore — daily waiter sector assignment management (C-16).
 *
 * Skill: zustand-store-pattern
 * State: { assignments, selectedDate, isLoading }
 * No edit — create/delete only (ephemeral daily records).
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import { STORAGE_KEYS, STORE_VERSIONS } from '@/utils/constants'
import { waiterAssignmentAPI } from '@/services/waiterAssignmentAPI'
import { toast } from '@/stores/toastStore'
import { handleError } from '@/utils/logger'
import type { WaiterAssignment } from '@/types/operations'

const EMPTY_ASSIGNMENTS: WaiterAssignment[] = []

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

interface WaiterAssignmentState {
  assignments: WaiterAssignment[]
  selectedDate: string
  isLoading: boolean
  error: string | null

  fetchByDate: (date: string, branchId?: string) => Promise<void>
  createAsync: (sectorId: string, userId: string, date: string) => Promise<WaiterAssignment>
  deleteAsync: (assignmentId: string) => Promise<void>
  setDate: (date: string) => void
}

export const useWaiterAssignmentStore = create<WaiterAssignmentState>()(
  persist(
    (set, get) => ({
      assignments: EMPTY_ASSIGNMENTS,
      selectedDate: todayISO(),
      isLoading: false,
      error: null,

      fetchByDate: async (date, branchId) => {
        set({ isLoading: true, error: null })
        try {
          const data = await waiterAssignmentAPI.list(date, branchId)
          set({ assignments: data, isLoading: false, selectedDate: date })
        } catch (err) {
          set({ isLoading: false, error: handleError(err, 'waiterAssignmentStore.fetchByDate') })
        }
      },

      createAsync: async (sectorId, userId, date) => {
        try {
          const created = await waiterAssignmentAPI.create(sectorId, userId, date)
          set((s) => ({ assignments: [...s.assignments, created] }))
          toast.success('Asignacion creada correctamente')
          return created
        } catch (err) {
          set({ error: handleError(err, 'waiterAssignmentStore.createAsync') })
          toast.error('Error al crear la asignacion')
          throw err
        }
      },

      deleteAsync: async (assignmentId) => {
        const previous = get().assignments
        set((s) => ({ assignments: s.assignments.filter((a) => a.id !== assignmentId) }))
        try {
          await waiterAssignmentAPI.delete(assignmentId)
          toast.success('Asignacion eliminada correctamente')
        } catch (err) {
          set({ assignments: previous, error: handleError(err, 'waiterAssignmentStore.deleteAsync') })
          toast.error('Error al eliminar la asignacion')
          throw err
        }
      },

      setDate: (date) => {
        set({ selectedDate: date })
      },
    }),
    {
      name: STORAGE_KEYS.WAITER_ASSIGNMENT_STORE,
      version: STORE_VERSIONS.WAITER_ASSIGNMENT_STORE,
      partialize: (state) => ({ selectedDate: state.selectedDate }),
      migrate: (_persistedState: unknown): WaiterAssignmentState => {
        return {
          assignments: EMPTY_ASSIGNMENTS,
          selectedDate: todayISO(),
          isLoading: false,
          error: null,
        } as WaiterAssignmentState
      },
    },
  ),
)

export const selectAssignments = (s: WaiterAssignmentState) => s.assignments ?? EMPTY_ASSIGNMENTS
export const selectSelectedDate = (s: WaiterAssignmentState) => s.selectedDate
export const selectWaiterAssignmentIsLoading = (s: WaiterAssignmentState) => s.isLoading

export const useWaiterAssignmentActions = () =>
  useWaiterAssignmentStore(
    useShallow((s) => ({
      fetchByDate: s.fetchByDate,
      createAsync: s.createAsync,
      deleteAsync: s.deleteAsync,
      setDate: s.setDate,
    })),
  )
