/**
 * receiptAPI — client for the check receipt endpoint (C-16).
 *
 * Resolution for OQ-1 (design.md):
 * ─────────────────────────────────
 * The receipt endpoint returns HTML. Because the JWT lives in memory (not in
 * cookies), a bare window.open(url) would not include the Authorization header
 * and would receive a 401.
 *
 * Decision: use `fetch + blob + URL.createObjectURL + window.open` pattern.
 * This allows the Authorization header to be sent with the request, and the
 * resulting blob URL is opened in a new tab. The new tab then calls
 * window.print() via a print button in the HTML or programmatically.
 *
 * Fallback consideration: blob URLs work in all modern browsers. The
 * window.print() dialog works from blob URLs in Chrome/Firefox/Safari.
 * Edge cases (e.g., popup blocked) are handled by catching the null return
 * from window.open().
 *
 * Chosen approach: fetch + blob + createObjectURL (documented here per OQ-1).
 */

import { env } from '@/config/env'
import { logger } from '@/utils/logger'

// Lazy import to avoid circular deps — same pattern as api.ts
function getAccessToken(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = (window as any).__authStoreRef
    return store?.getAccessToken?.() ?? null
  } catch {
    return null
  }
}

export const receiptAPI = {
  /**
   * Open a printable receipt for the given checkId in a new browser tab.
   *
   * Fetches the HTML receipt with Authorization header, creates a blob URL,
   * opens it in a new tab, and triggers the print dialog.
   *
   * @param checkId - The check ID (string — converted to int at boundary)
   */
  openReceipt: async (checkId: string): Promise<void> => {
    const token = getAccessToken()
    if (!token) {
      logger.warn('receiptAPI.openReceipt: no access token available')
      return
    }

    const url = `${env.API_URL}/api/admin/checks/${parseInt(checkId, 10)}/receipt`

    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!response.ok) {
        logger.error('receiptAPI.openReceipt: HTTP %d', response.status)
        return
      }

      const html = await response.text()
      const blob = new Blob([html], { type: 'text/html; charset=utf-8' })
      const blobUrl = URL.createObjectURL(blob)

      const newTab = window.open(blobUrl, '_blank', 'width=480,height=700')
      if (!newTab) {
        logger.warn('receiptAPI.openReceipt: popup blocked by browser')
        // Fallback: download the file
        const a = document.createElement('a')
        a.href = blobUrl
        a.download = `recibo-${checkId}.html`
        a.click()
        return
      }

      // The receipt HTML includes a print button; auto-print after load
      newTab.addEventListener('load', () => {
        try {
          newTab.print()
        } catch {
          // Some browsers block print() — user can use the button in the page
        }
        // Revoke the blob URL after print dialog has been shown
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
      })
    } catch (err) {
      logger.error('receiptAPI.openReceipt: error', err)
    }
  },
}
