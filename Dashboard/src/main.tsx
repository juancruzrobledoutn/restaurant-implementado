// i18n must be initialized before rendering the app
import './i18n'
// authStore self-registers with api.ts on import — must be imported early
import './stores/authStore'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { env } from '@/config/env'
import { logger } from '@/utils/logger'

/**
 * Silent auth probe — runs before the first render to restore session state.
 *
 * Sequence:
 * 1. POST /api/auth/refresh (reads HttpOnly cookie, no access token needed)
 * 2. If 200 → GET /api/auth/me with new token → hydrate authStore
 * 3. If 401 → start unauthenticated (store initial state is already unauthenticated)
 *
 * This avoids a flash of the login page for already-authenticated users
 * who just reloaded the tab.
 */
async function silentAuthProbe(): Promise<void> {
  try {
    // Step 1: Try to refresh — HttpOnly cookie is sent automatically
    const refreshResponse = await fetch(`${env.API_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })

    if (!refreshResponse.ok) {
      logger.debug('main: silent probe — no active session')
      return
    }

    const refreshData = (await refreshResponse.json()) as { access_token: string }
    const accessToken = refreshData.access_token

    // Step 2: Fetch user profile with the fresh token
    const meResponse = await fetch(`${env.API_URL}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    })

    if (!meResponse.ok) {
      logger.warn('main: silent probe — /me failed after refresh')
      return
    }

    type MeResponse = {
      id: number
      email: string
      full_name: string
      tenant_id: number
      branch_ids: number[]
      roles: string[]
      is_2fa_enabled: boolean
    }

    const userData = (await meResponse.json()) as MeResponse

    // Step 3: Hydrate the auth store
    // authStore is already imported above — use dynamic import to get its exports
    const { useAuthStore } = await import('@/stores/authStore')
    const { registerAuthStore } = await import('@/services/api')

    // Register the recovered token with the api module
    // (authStore registers itself on module load, but we need to set the token first)
    let _token = accessToken
    registerAuthStore({
      getAccessToken: () => _token,
      isLoggingOut: () => useAuthStore.getState().isLoggingOut,
      logout: () => useAuthStore.getState().logout(),
      setAccessToken: (t: string) => { _token = t },
    })

    // Hydrate store state — bypass login action to skip the POST /login call
    useAuthStore.setState({
      isAuthenticated: true,
      user: {
        id: String(userData.id),
        email: userData.email,
        fullName: userData.full_name,
        tenantId: String(userData.tenant_id),
        branchIds: userData.branch_ids.map(String),
        roles: userData.roles,
        totpEnabled: userData.is_2fa_enabled,
      },
      isLoading: false,
      error: null,
      requires2fa: false,
      isLoggingOut: false,
    })

    logger.info('main: session restored via silent probe', { email: userData.email })

  } catch (err) {
    // Network failure — start unauthenticated; the 401 interceptor will handle the rest
    logger.warn('main: silent probe network error', err)
  }
}

// Run probe then render — the app mounts after the probe resolves
silentAuthProbe().finally(() => {
  const rootElement = document.getElementById('root')
  if (!rootElement) {
    throw new Error('[Dashboard] Root element #root not found in index.html')
  }

  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
