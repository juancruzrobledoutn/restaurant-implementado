/**
 * Web Push VAPID helpers.
 *
 * Flow:
 *   1. User clicks "Activar notificaciones" in TablesPage
 *   2. registerPushSubscription() requests Notification permission
 *   3. Subscribes via the active service worker registration using VAPID key
 *   4. Sends { endpoint, p256dh_key, auth_key } to POST /api/waiter/notifications/subscribe
 *
 * Graceful degradation (design.md D-05):
 *   - Returns { success: false, reason: ... } instead of throwing
 *   - Missing VAPID key → no-op (dev without config)
 *   - Permission denied → no attempt to subscribe
 */

import { env } from '@/config/env'
import { logger } from '@/utils/logger'
import { fetchAPI } from './api'
import {
  arrayBufferToBase64Url,
  urlBase64ToUint8Array,
} from '@/utils/urlBase64'
import type { PushSubscriptionPayload, RegisterPushResult } from '@/types/push'

// ---------------------------------------------------------------------------
// Feature detection
// ---------------------------------------------------------------------------

function isPushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/** Extract the base64url-encoded PushSubscription key (or null if missing). */
function getKeyAsBase64Url(
  subscription: PushSubscription,
  name: 'p256dh' | 'auth',
): string | null {
  const buf = subscription.getKey(name)
  if (!buf) return null
  return arrayBufferToBase64Url(buf)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Request Notification permission, subscribe to the push service, and POST
 * the subscription payload to the backend.
 *
 * MUST be called from a user gesture (button click) — browsers block
 * Notification.requestPermission() when called on boot without interaction.
 */
export async function registerPushSubscription(): Promise<RegisterPushResult> {
  if (!isPushSupported()) {
    logger.warn('push: platform does not support Service Worker + PushManager')
    return { success: false, reason: 'not_supported' }
  }

  if (!env.VAPID_PUBLIC_KEY) {
    logger.warn('push: VITE_VAPID_PUBLIC_KEY is empty — skipping registration')
    return { success: false, reason: 'no_vapid_key' }
  }

  let permission: NotificationPermission
  try {
    permission = await Notification.requestPermission()
  } catch (err) {
    logger.error('push: Notification.requestPermission threw', err)
    return { success: false, reason: 'permission_denied' }
  }

  if (permission !== 'granted') {
    logger.info(`push: permission result=${permission}`)
    return { success: false, reason: 'permission_denied' }
  }

  try {
    const registration = await navigator.serviceWorker.ready

    const applicationServerKey = urlBase64ToUint8Array(env.VAPID_PUBLIC_KEY)
    // Cast to BufferSource-compatible — browsers accept Uint8Array here.
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey as unknown as BufferSource,
    })

    const p256dh = getKeyAsBase64Url(subscription, 'p256dh')
    const auth = getKeyAsBase64Url(subscription, 'auth')

    if (!p256dh || !auth) {
      logger.error('push: subscription keys missing (p256dh or auth)')
      return { success: false, reason: 'api_error' }
    }

    const payload: PushSubscriptionPayload = {
      endpoint: subscription.endpoint,
      p256dh_key: p256dh,
      auth_key: auth,
    }

    await fetchAPI('/api/waiter/notifications/subscribe', {
      method: 'POST',
      body: payload,
    })

    logger.info('push: subscription registered with backend')
    return { success: true }
  } catch (err) {
    logger.error('push: registration failed', err)
    return { success: false, reason: 'api_error' }
  }
}

/**
 * Unsubscribe the current push subscription from the backend AND the browser.
 * Called on logout. Errors are logged but not propagated.
 */
export async function unregisterPushSubscription(): Promise<void> {
  if (!isPushSupported()) return

  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) return

    const endpoint = subscription.endpoint

    try {
      const search = new URLSearchParams({ endpoint })
      await fetchAPI(
        `/api/waiter/notifications/subscribe?${search.toString()}`,
        { method: 'DELETE' },
      )
    } catch (err) {
      logger.warn('push: backend unsubscribe failed (continuing)', err)
    }

    try {
      await subscription.unsubscribe()
    } catch (err) {
      logger.warn('push: browser unsubscribe failed', err)
    }
  } catch (err) {
    logger.warn('push: unregister flow threw', err)
  }
}
