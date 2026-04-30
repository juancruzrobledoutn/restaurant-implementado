/**
 * VAPID applicationServerKey helper.
 *
 * The Push API's subscribe() expects a Uint8Array as applicationServerKey,
 * but VAPID public keys are typically shared as URL-safe base64 strings.
 * This helper decodes that format to the required Uint8Array.
 */

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')

  const rawData = atob(base64)
  const output = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i)
  }
  return output
}

/**
 * Encode an ArrayBuffer as a URL-safe base64 string.
 * Used to serialize PushSubscription keys (p256dh, auth) for backend storage.
 */
export function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  const base64 = btoa(binary)
  // Standard base64url encoding: replace + with -, / with _, strip trailing =
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
