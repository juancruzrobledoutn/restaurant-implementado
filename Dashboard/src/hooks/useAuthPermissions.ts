/**
 * useAuthPermissions — derives RBAC permissions from authStore.
 *
 * Centralizes RBAC logic so individual pages don't duplicate it.
 *
 * RBAC rules (per spec):
 * - ADMIN: create, edit, delete (full autonomy)
 * - MANAGER: create, edit (cannot delete)
 * - KITCHEN, WAITER: read-only (no create, edit, or delete)
 *
 * Skill: dashboard-crud-page
 */

import { useAuthStore, selectUser } from '@/stores/authStore'

export interface AuthPermissions {
  isAdmin: boolean
  isManager: boolean
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
  // C-27 promotions — specific promotion permissions
  canManagePromotions: boolean   // ADMIN + MANAGER
  canDeletePromotion: boolean    // ADMIN only (backend enforces 403 for MANAGER)
}

export function useAuthPermissions(): AuthPermissions {
  const user = useAuthStore(selectUser)

  const roles = user?.roles ?? []
  const isAdmin = roles.includes('ADMIN')
  const isManager = roles.includes('MANAGER')

  return {
    isAdmin,
    isManager,
    canCreate: isAdmin || isManager,
    canEdit: isAdmin || isManager,
    canDelete: isAdmin, // MANAGER cannot delete — backend enforces 403
    canManagePromotions: isAdmin || isManager,
    canDeletePromotion: isAdmin,
  }
}
