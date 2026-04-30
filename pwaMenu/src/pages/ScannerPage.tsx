/**
 * ScannerPage — QR scanner with manual fallback.
 *
 * Flow:
 * 1. Try camera with @zxing/browser BrowserQRCodeReader
 * 2. On decode: parse URL, extract branchSlug + tableCode + token, navigate to /t/:branchSlug/:tableCode?token=...
 * 3. On camera permission denied: show manual form
 * 4. On ?reason=expired: show session expired banner
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { IScannerControls } from '@zxing/browser'
import { AppShell } from '../components/layout/AppShell'
import { logger } from '../utils/logger'

function parseQrUrl(raw: string): { branchSlug: string; tableCode: string; token: string } | null {
  try {
    const url = new URL(raw)
    // Expected format: https://domain/t/:branchSlug/:tableCode?token=...
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length < 3 || parts[0] !== 't') return null
    const branchSlug = parts[1]
    const tableCode = parts[2]
    const token = url.searchParams.get('token')
    if (!branchSlug || !tableCode || !token) return null
    return { branchSlug, tableCode, token }
  } catch {
    return null
  }
}

export default function ScannerPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const videoRef = useRef<HTMLVideoElement>(null)
  const scannerControlsRef = useRef<IScannerControls | null>(null)

  const [cameraError, setCameraError] = useState(false)
  const [manualBranchSlug, setManualBranchSlug] = useState('')
  const [manualTableCode, setManualTableCode] = useState('')
  const [manualToken, setManualToken] = useState('')
  const [invalidQr, setInvalidQr] = useState(false)

  const isExpiredReason = searchParams.get('reason') === 'expired'

  useEffect(() => {
    let cancelled = false

    async function startScanner() {
      try {
        const { BrowserQRCodeReader } = await import('@zxing/browser')
        const reader = new BrowserQRCodeReader()

        if (!videoRef.current) return

        const controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current,
          (result, err) => {
            if (cancelled) return
            if (result) {
              const text = result.getText()
              const parsed = parseQrUrl(text)
              if (parsed) {
                void navigate(
                  `/t/${parsed.branchSlug}/${parsed.tableCode}?token=${encodeURIComponent(parsed.token)}`,
                )
              } else {
                setInvalidQr(true)
              }
            }
            if (err) {
              // NotFoundException fires continuously when no QR in view — ignore
              const errName = (err as Error).name
              if (errName !== 'NotFoundException') {
                logger.warn('QR reader error', err)
              }
            }
          },
        )
        scannerControlsRef.current = controls
      } catch (err) {
        logger.warn('Camera access failed', err)
        setCameraError(true)
      }
    }

    void startScanner()

    return () => {
      cancelled = true
      scannerControlsRef.current?.stop()
    }
  }, [navigate])

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!manualBranchSlug || !manualTableCode || !manualToken) return
    void navigate(
      `/t/${encodeURIComponent(manualBranchSlug)}/${encodeURIComponent(manualTableCode)}?token=${encodeURIComponent(manualToken)}`,
    )
  }

  return (
    <AppShell className="bg-gray-50 flex flex-col items-center justify-center px-6 py-8">
      {isExpiredReason && (
        <div className="w-full max-w-sm mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-800 text-sm text-center">
          {t('scanner.sessionExpired')}
        </div>
      )}

      {invalidQr && (
        <div className="w-full max-w-sm mb-4 bg-red-50 border border-red-200 rounded-lg p-3 text-red-800 text-sm text-center">
          {t('scanner.invalidQr')}
        </div>
      )}

      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-gray-900 mb-2 text-center">{t('scanner.title')}</h1>
        <p className="text-gray-500 text-sm text-center mb-6">{t('scanner.instructions')}</p>

        {!cameraError ? (
          <div className="relative rounded-2xl overflow-hidden bg-black aspect-square mb-4">
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
            {/* Scanning frame overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-48 h-48 border-4 border-primary rounded-xl opacity-70" />
            </div>
          </div>
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-800 text-sm text-center mb-4">
            {t('scanner.permissionDenied')}
          </div>
        )}

        <p className="text-gray-400 text-xs text-center mb-4">{t('scanner.manualFallback')}</p>

        <form onSubmit={handleManualSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="branchSlug">
              {t('scanner.manualBranchSlug')}
            </label>
            <input
              id="branchSlug"
              type="text"
              value={manualBranchSlug}
              onChange={(e) => setManualBranchSlug(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="mi-sucursal"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="tableCode">
              {t('scanner.manualTableCode')}
            </label>
            <input
              id="tableCode"
              type="text"
              value={manualTableCode}
              onChange={(e) => setManualTableCode(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="mesa-1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="manualToken">
              {t('scanner.manualToken')}
            </label>
            <input
              id="manualToken"
              type="text"
              value={manualToken}
              onChange={(e) => setManualToken(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="abc123..."
            />
          </div>
          <button
            type="submit"
            className="w-full bg-primary text-white py-3 rounded-lg font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
            disabled={!manualBranchSlug || !manualTableCode || !manualToken}
          >
            {t('scanner.manualSubmit')}
          </button>
        </form>

        <p className="text-gray-400 text-xs text-center mt-4">{t('scanner.askWaiter')}</p>
      </div>
    </AppShell>
  )
}
