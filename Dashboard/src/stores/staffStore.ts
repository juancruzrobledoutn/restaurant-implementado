/**
 * staffStore — staff user management with role assignment support (C-16).
 *
 * Skill: zustand-store-pattern
 * Extra: assignRoleAsync / revokeRoleAsync mutate the local cache optimistically.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import { STORAGE_KEYS, STORE_VERSIONS } from '@/utils/constants'
import { staffAPI } from '@/services/staffAPI'
import { toast } from '@/stores/toastStore'
import { handleError } from '@/utils/logger'
import type { StaffUser, StaffFormData, Role } from '@/types/operations'

const EMPTY_STAFF: StaffUser[] = []

interface StaffState {
  items: StaffUser[]
  isLoading: boolean
  error: string | null

  fetchAll: (branchId?: string) => Promise<void>
  createStaffAsync: (data: StaffFormData) => Promise<StaffUser>
  updateStaffAsync: (id: string, data: Partial<StaffFormData>) => Promise<void>
  deleteStaffAsync: (id: string) => Promise<void>
  assignRoleAsync: (userId: string, branchId: string, role: Role) => Promise<void>
  revokeRoleAsync: (userId: string, branchId: string) => Promise<void>
}

export const useStaffStore = create<StaffState>()(
  persist(
    (set, get) => ({
      items: EMPTY_STAFF,
      isLoading: false,
      error: null,

      fetchAll: async (branchId) => {
        set({ isLoading: true, error: null })
        try {
          const data = await staffAPI.list(branchId)
          set({ items: data, isLoading: false })
        } catch (err) {
          set({ isLoading: false, error: handleError(err, 'staffStore.fetchAll') })
        }
      },

      createStaffAsync: async (data) => {
        try {
          const created = await staffAPI.create(data)
          set((s) => ({ items: [...s.items, created] }))
          toast.success('Usuario creado correctamente')
          return created
        } catch (err) {
          set({ error: handleError(err, 'staffStore.createStaffAsync') })
          toast.error('Error al crear el usuario')
          throw err
        }
      },

      updateStaffAsync: async (id, data) => {
        const previous = get().items
        set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...data } : i)) }))
        try {
          const updated = await staffAPI.update(id, data)
          set((s) => ({ items: s.items.map((i) => (i.id === id ? updated : i)) }))
          toast.success('Usuario actualizado correctamente')
        } catch (err) {
          set({ items: previous, error: handleError(err, 'staffStore.updateStaffAsync') })
          toast.error('Error al actualizar el usuario')
          throw err
        }
      },

      deleteStaffAsync: async (id) => {
        const previous = get().items
        set((s) => ({ items: s.items.filter((i) => i.id !== id) }))
        try {
          await staffAPI.delete(id)
          toast.success('Usuario eliminado correctamente')
        } catch (err) {
          set({ items: previous, error: handleError(err, 'staffStore.deleteStaffAsync') })
          toast.error('Error al eliminar el usuario')
          throw err
        }
      },

      assignRoleAsync: async (userId, branchId, role) => {
        try {
          await staffAPI.assignRole(userId, branchId, role)
          // Refresh to get updated assignments from server
          await get().fetchAll()
          toast.success('Rol asignado correctamente')
        } catch (err) {
          set({ error: handleError(err, 'staffStore.assignRoleAsync') })
          toast.error('Error al asignar el rol')
          throw err
        }
      },

      revokeRoleAsync: async (userId, branchId) => {
        try {
          await staffAPI.revokeRole(userId, branchId)
          // Refresh to get updated assignments from server
          await get().fetchAll()
          toast.success('Rol revocado correctamente')
        } catch (err) {
          set({ error: handleError(err, 'staffStore.revokeRoleAsync') })
          toast.error('Error al revocar el rol')
          throw err
        }
      },
    }),
    {
      name: STORAGE_KEYS.STAFF_STORE,
      version: STORE_VERSIONS.STAFF_STORE,
      partialize: (state) => ({ items: state.items }),
      migrate: (persistedState: unknown): StaffState => {
        if (!persistedState || typeof persistedState !== 'object') {
          return { items: EMPTY_STAFF, isLoading: false, error: null } as StaffState
        }
        const state = persistedState as { items?: unknown }
        return {
          items: Array.isArray(state.items) ? (state.items as StaffUser[]) : EMPTY_STAFF,
          isLoading: false,
          error: null,
        } as StaffState
      },
    },
  ),
)

export const selectStaff = (s: StaffState) => s.items ?? EMPTY_STAFF
export const selectStaffIsLoading = (s: StaffState) => s.isLoading

export const useStaffByBranch = (branchId: string) =>
  useStaffStore(
    useShallow((s) =>
      s.items.filter((u) =>
        u.assignments.some((a) => a.branch_id === branchId),
      ),
    ),
  )

export const useWaitersByBranch = (branchId: string) =>
  useStaffStore(
    useShallow((s) =>
      s.items.filter(
        (u) =>
          u.is_active &&
          u.assignments.some((a) => a.branch_id === branchId && a.role === 'WAITER'),
      ),
    ),
  )

export const useStaffActions = () =>
  useStaffStore(
    useShallow((s) => ({
      fetchAll: s.fetchAll,
      createStaffAsync: s.createStaffAsync,
      updateStaffAsync: s.updateStaffAsync,
      deleteStaffAsync: s.deleteStaffAsync,
      assignRoleAsync: s.assignRoleAsync,
      revokeRoleAsync: s.revokeRoleAsync,
    })),
  )
