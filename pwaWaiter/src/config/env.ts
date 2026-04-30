/**
 * Typed access to Vite environment variables for pwaWaiter.
 * All variables must be prefixed with VITE_ to be exposed to the client.
 *
 * Defaults:
 * - API_URL / WS_URL: sensible dev defaults so the app can boot without a .env
 * - VAPID_PUBLIC_KEY: empty string — registerPushSubscription() handles this case
 *   gracefully (returns { success: false, reason: 'no_vapid_key' }) without crashing.
 */

export const env = {
  /** Backend REST API base URL — e.g. http://localhost:8000 (no trailing slash, no /api) */
  API_URL: import.meta.env.VITE_API_URL ?? 'http://localhost:8000',
  /** WebSocket gateway URL — e.g. ws://localhost:8001 */
  WS_URL: import.meta.env.VITE_WS_URL ?? 'ws://localhost:8001',
  /** VAPID public key for Web Push. Empty string in dev is acceptable (push register fails soft). */
  VAPID_PUBLIC_KEY: import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '',
} as const
