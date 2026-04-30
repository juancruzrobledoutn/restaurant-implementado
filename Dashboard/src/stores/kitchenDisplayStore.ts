/**
 * kitchenDisplayStore — in-memory kitchen display state (C-16).
 *
 * Skill: zustand-store-pattern
 *
 * Design decision (design.md D4):
 *   NO persist() — kitchen data changes in seconds; stale snapshots confuse users.
 *   audioEnabled persists directly to localStorage (key: 'kitchenDisplay.audio').
 *   On reconnect, fetchSnapshot() is called to get the current state.
 *
 * Event handlers (upsert by round.id + status):
 *   handleRoundSubmitted   → upsert round in SUBMITTED state
 *   handleRoundInKitchen   → update existing round to IN_KITCHEN
 *   handleRoundReady       → update existing round to READY
 *   handleRoundCanceled    → remove round from list
 */

import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { kitchenAPI } from '@/services/kitchenAPI'
import { handleError } from '@/utils/logger'
import type { KitchenRound, KitchenRoundStatus } from '@/types/operations'
import type { WSEvent } from '@/types/menu'

const EMPTY_ROUNDS: KitchenRound[] = []

const AUDIO_KEY = 'kitchenDisplay.audio'

function getStoredAudio(): boolean {
  try {
    return localStorage.getItem(AUDIO_KEY) === 'true'
  } catch {
    return false
  }
}

function setStoredAudio(enabled: boolean): void {
  try {
    localStorage.setItem(AUDIO_KEY, String(enabled))
  } catch {
    // localStorage may be blocked
  }
}

interface KitchenDisplayState {
  rounds: KitchenRound[]
  isLoading: boolean
  audioEnabled: boolean
  error: string | null

  fetchSnapshot: (branchId: string) => Promise<void>
  handleRoundSubmitted: (event: WSEvent) => void
  handleRoundInKitchen: (event: WSEvent) => void
  handleRoundReady: (event: WSEvent) => void
  handleRoundCanceled: (event: WSEvent) => void
  toggleAudio: () => void
  reset: () => void
}

export const useKitchenDisplayStore = create<KitchenDisplayState>()((set, get) => ({
  rounds: EMPTY_ROUNDS,
  isLoading: false,
  audioEnabled: getStoredAudio(),
  error: null,

  fetchSnapshot: async (branchId) => {
    set({ isLoading: true, error: null })
    try {
      const data = await kitchenAPI.listRounds(branchId)
      set({ rounds: data, isLoading: false })
    } catch (err) {
      set({ isLoading: false, error: handleError(err, 'kitchenDisplayStore.fetchSnapshot') })
    }
  },

  handleRoundSubmitted: (event) => {
    const round = _extractRound(event, 'SUBMITTED')
    if (!round) return
    set((s) => ({
      rounds: s.rounds.some((r) => r.id === round.id)
        ? s.rounds.map((r) => (r.id === round.id ? round : r))
        : [...s.rounds, round],
    }))
  },

  handleRoundInKitchen: (event) => {
    const id = _extractId(event)
    if (!id) return
    set((s) => ({
      rounds: s.rounds.map((r) =>
        r.id === id ? { ...r, status: 'IN_KITCHEN' as KitchenRoundStatus } : r,
      ),
    }))
  },

  handleRoundReady: (event) => {
    const id = _extractId(event)
    if (!id) return
    set((s) => ({
      rounds: s.rounds.map((r) =>
        r.id === id ? { ...r, status: 'READY' as KitchenRoundStatus } : r,
      ),
    }))
  },

  handleRoundCanceled: (event) => {
    const id = _extractId(event)
    if (!id) return
    set((s) => ({ rounds: s.rounds.filter((r) => r.id !== id) }))
  },

  toggleAudio: () => {
    const next = !get().audioEnabled
    setStoredAudio(next)
    set({ audioEnabled: next })
  },

  reset: () => {
    set({ rounds: EMPTY_ROUNDS, isLoading: false, error: null })
  },
}))

// ---------------------------------------------------------------------------
// Private helpers — extract data from WS events
// ---------------------------------------------------------------------------

function _extractId(event: WSEvent): string | null {
  const idRaw = (event.data as { id?: number | string })?.id ?? event.id
  return idRaw ? String(idRaw) : null
}

function _extractRound(event: WSEvent, status: KitchenRoundStatus): KitchenRound | null {
  const data = event.data as Record<string, unknown> | undefined
  if (!data?.id) return null

  return {
    id: String(data.id),
    session_id: String(data.session_id ?? ''),
    branch_id: String(data.branch_id ?? event.branch_id ?? ''),
    status,
    submitted_at: String(data.submitted_at ?? new Date().toISOString()),
    table_number: Number(data.table_number ?? 0),
    sector_name: String(data.sector_name ?? ''),
    diner_count: Number(data.diner_count ?? 0),
    items: (data.items as KitchenRound['items']) ?? [],
  }
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const selectKitchenRounds = (s: KitchenDisplayState) => s.rounds ?? EMPTY_ROUNDS
export const selectAudioEnabled = (s: KitchenDisplayState) => s.audioEnabled
export const selectKitchenIsLoading = (s: KitchenDisplayState) => s.isLoading

export const useKitchenDisplayActions = () =>
  useKitchenDisplayStore(
    useShallow((s) => ({
      fetchSnapshot: s.fetchSnapshot,
      handleRoundSubmitted: s.handleRoundSubmitted,
      handleRoundInKitchen: s.handleRoundInKitchen,
      handleRoundReady: s.handleRoundReady,
      handleRoundCanceled: s.handleRoundCanceled,
      toggleAudio: s.toggleAudio,
      reset: s.reset,
    })),
  )
