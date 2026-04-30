/**
 * sectorStore — branch-scoped sector management (C-16).
 *
 * Skill: zustand-store-pattern
 * Pattern: same as categoryStore — persist, version, migrate stub, useShallow selectors
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import { STORAGE_KEYS, STORE_VERSIONS } from '@/utils/constants'
import { sectorAPI } from '@/services/sectorAPI'
import { toast } from '@/stores/toastStore'
import { handleError } from '@/utils/logger'
import type { Sector, SectorFormData } from '@/types/operations'

const EMPTY_SECTORS: Sector[] = []

interface SectorState {
  items: Sector[]
  isLoading: boolean
  error: string | null

  fetchByBranch: (branchId: string) => Promise<void>
  createSectorAsync: (data: SectorFormData) => Promise<Sector>
  updateSectorAsync: (id: string, data: SectorFormData) => Promise<void>
  deleteSectorAsync: (id: string) => Promise<void>
}

export const useSectorStore = create<SectorState>()(
  persist(
    (set, get) => ({
      items: EMPTY_SECTORS,
      isLoading: false,
      error: null,

      fetchByBranch: async (branchId) => {
        set({ isLoading: true, error: null })
        try {
          const data = await sectorAPI.list(branchId)
          set({ items: data, isLoading: false })
        } catch (err) {
          set({ isLoading: false, error: handleError(err, 'sectorStore.fetchByBranch') })
        }
      },

      createSectorAsync: async (data) => {
        try {
          const created = await sectorAPI.create(data)
          set((s) => ({ items: [...s.items, created] }))
          toast.success('Sector creado correctamente')
          return created
        } catch (err) {
          set({ error: handleError(err, 'sectorStore.createSectorAsync') })
          toast.error('Error al crear el sector')
          throw err
        }
      },

      updateSectorAsync: async (id, data) => {
        const previous = get().items
        set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...data } : i)) }))
        try {
          const updated = await sectorAPI.update(id, data)
          set((s) => ({ items: s.items.map((i) => (i.id === id ? updated : i)) }))
          toast.success('Sector actualizado correctamente')
        } catch (err) {
          set({ items: previous, error: handleError(err, 'sectorStore.updateSectorAsync') })
          toast.error('Error al actualizar el sector')
          throw err
        }
      },

      deleteSectorAsync: async (id) => {
        const previous = get().items
        set((s) => ({ items: s.items.filter((i) => i.id !== id) }))
        try {
          await sectorAPI.delete(id)
          toast.success('Sector eliminado correctamente')
        } catch (err) {
          set({ items: previous, error: handleError(err, 'sectorStore.deleteSectorAsync') })
          toast.error('Error al eliminar el sector')
          throw err
        }
      },
    }),
    {
      name: STORAGE_KEYS.SECTOR_STORE,
      version: STORE_VERSIONS.SECTOR_STORE,
      partialize: (state) => ({ items: state.items }),
      migrate: (persistedState: unknown): SectorState => {
        if (!persistedState || typeof persistedState !== 'object') {
          return { items: EMPTY_SECTORS, isLoading: false, error: null } as SectorState
        }
        const state = persistedState as { items?: unknown }
        return {
          items: Array.isArray(state.items) ? (state.items as Sector[]) : EMPTY_SECTORS,
          isLoading: false,
          error: null,
        } as SectorState
      },
    },
  ),
)

export const selectSectors = (s: SectorState) => s.items ?? EMPTY_SECTORS
export const selectSectorIsLoading = (s: SectorState) => s.isLoading

export const useSectorsByBranch = (branchId: string) =>
  useSectorStore(useShallow((s) => s.items.filter((sec) => sec.branch_id === branchId && sec.is_active)))

export const useSectorActions = () =>
  useSectorStore(
    useShallow((s) => ({
      fetchByBranch: s.fetchByBranch,
      createSectorAsync: s.createSectorAsync,
      updateSectorAsync: s.updateSectorAsync,
      deleteSectorAsync: s.deleteSectorAsync,
    })),
  )
