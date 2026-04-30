/**
 * Web Push notification types for pwaWaiter.
 *
 * The backend expects { endpoint, p256dh_key, auth_key } on
 * POST /api/waiter/notifications/subscribe (schema PushSubscriptionIn).
 * Keys are base64url-encoded strings extracted from PushSubscription.getKey().
 */

export interface PushSubscriptionPayload {
  endpoint: string
  p256dh_key: string
  auth_key: string
}

/** Possible outcomes of registerPushSubscription(). */
export type RegisterPushResult =
  | { success: true }
  | {
      success: false
      reason:
        | 'not_supported' // ServiceWorker or PushManager missing (older browsers, iOS < 16.4)
        | 'no_vapid_key' // VITE_VAPID_PUBLIC_KEY is empty
        | 'permission_denied' // User clicked "Block" on the permission prompt
        | 'api_error' // Backend rejected the subscription
    }
