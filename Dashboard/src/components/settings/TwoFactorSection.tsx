/**
 * TwoFactorSection — 2FA management UI with local state machine.
 *
 * Skills: react19-form-pattern, dashboard-crud-page
 *
 * States:
 * - disabled: 2FA not enabled — shows "Enable 2FA" button
 * - setup-pending: setup called — shows QR code + secret + TOTP input to verify
 * - enabled: 2FA is active — shows "Disable 2FA" button + TOTP input
 *
 * Uses authAPI.ts wrappers: setup2FA, verify2FA, disable2FA
 * No global store needed — this is local transient state per-session.
 *
 * NOTE: The backend returns totp_enabled on the /me endpoint. Since User type
 * doesn't currently include it, we derive initial state from the login response
 * behavior: assume disabled on first render, let user self-discover.
 */

import { useState, useId, useCallback } from 'react'
import { ShieldCheck, ShieldOff, QrCode } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { setup2FA, verify2FA, disable2FA } from '@/services/authAPI'
import { useAuthStore, selectUser, selectSetTotpEnabled } from '@/stores/authStore'
import { toast } from '@/stores/toastStore'
import { handleError } from '@/utils/logger'

type TwoFactorState = 'disabled' | 'setup-pending' | 'enabled'

interface SetupData {
  secret: string
  provisioningUri: string
}

export function TwoFactorSection() {
  const user = useAuthStore(selectUser)
  const setTotpEnabled = useAuthStore(selectSetTotpEnabled)

  // Initialize from user's current totp state so returning users see correct status
  const [twoFAState, setTwoFAState] = useState<TwoFactorState>(
    user?.totpEnabled ? 'enabled' : 'disabled',
  )
  const [setupData, setSetupData] = useState<SetupData | null>(null)
  const [verifyCode, setVerifyCode] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()

  const clearError = () => setError(null)

  // ---------------------------------------------------------------------------
  // Start 2FA setup
  // ---------------------------------------------------------------------------
  const handleSetup = useCallback(async () => {
    setIsLoading(true)
    clearError()
    try {
      const data = await setup2FA()
      setSetupData({
        secret: data.secret,
        provisioningUri: data.provisioning_uri,
      })
      setTwoFAState('setup-pending')
    } catch (err) {
      const message = handleError(err, 'TwoFactorSection.handleSetup')
      setError(message)
      toast.error('Error al iniciar la configuración de 2FA')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Verify TOTP code and enable 2FA
  // ---------------------------------------------------------------------------
  const handleVerify = useCallback(async () => {
    if (!verifyCode.trim()) {
      setError('Ingresá el código de tu app autenticadora')
      return
    }
    setIsLoading(true)
    clearError()
    try {
      await verify2FA(verifyCode.trim())
      toast.success('2FA activado correctamente')
      setTotpEnabled(true)
      setTwoFAState('enabled')
      setSetupData(null)
      setVerifyCode('')
    } catch (err) {
      const message = handleError(err, 'TwoFactorSection.handleVerify')
      if (message.includes('400') || message.toLowerCase().includes('invalid') || message.toLowerCase().includes('inválido')) {
        setError('Código TOTP inválido o expirado. Intentá de nuevo.')
      } else {
        setError(message)
        toast.error('Error al verificar el código')
      }
    } finally {
      setIsLoading(false)
    }
  }, [verifyCode, setTotpEnabled])

  // ---------------------------------------------------------------------------
  // Disable 2FA
  // ---------------------------------------------------------------------------
  const handleDisable = useCallback(async () => {
    if (!disableCode.trim()) {
      setError('Ingresá tu código TOTP para deshabilitar 2FA')
      return
    }
    setIsLoading(true)
    clearError()
    try {
      await disable2FA(disableCode.trim())
      toast.success('2FA deshabilitado')
      setTotpEnabled(false)
      setTwoFAState('disabled')
      setDisableCode('')
    } catch (err) {
      const message = handleError(err, 'TwoFactorSection.handleDisable')
      if (message.includes('400') || message.toLowerCase().includes('invalid') || message.toLowerCase().includes('inválido')) {
        setError('Código TOTP inválido. Intentá de nuevo.')
      } else {
        setError(message)
        toast.error('Error al deshabilitar 2FA')
      }
    } finally {
      setIsLoading(false)
    }
  }, [disableCode, setTotpEnabled])

  // ---------------------------------------------------------------------------
  // Cancel setup
  // ---------------------------------------------------------------------------
  const handleCancelSetup = useCallback(() => {
    setTwoFAState('disabled')
    setSetupData(null)
    setVerifyCode('')
    clearError()
  }, [])

  return (
    <div
      className="space-y-4 max-w-md"
      aria-label="Autenticación de dos factores"
    >
      <div className="flex items-center gap-2 mb-2">
        {twoFAState === 'enabled' ? (
          <ShieldCheck className="h-5 w-5 text-green-400" aria-hidden="true" />
        ) : (
          <ShieldOff className="h-5 w-5 text-gray-500" aria-hidden="true" />
        )}
        <span className="text-sm font-medium text-gray-300">
          Autenticación de dos factores (TOTP)
        </span>
        <span
          className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
            twoFAState === 'enabled'
              ? 'bg-green-900/40 text-green-400'
              : 'bg-gray-700 text-gray-400'
          }`}
        >
          {twoFAState === 'enabled' ? 'Activo' : 'Inactivo'}
        </span>
      </div>

      {/* Error display */}
      {error && (
        <p role="alert" className="text-xs text-red-400 bg-red-900/20 border border-red-800 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {/* State: disabled */}
      {twoFAState === 'disabled' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-400">
            Agregá una capa extra de seguridad. Necesitarás una app autenticadora (Google Authenticator, Authy, etc.).
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void handleSetup()}
            isLoading={isLoading}
            disabled={isLoading}
          >
            <QrCode className="h-4 w-4" aria-hidden="true" />
            Activar 2FA
          </Button>
        </div>
      )}

      {/* State: setup-pending */}
      {twoFAState === 'setup-pending' && setupData && (
        <div className="space-y-4">
          <p className="text-sm text-gray-300">
            Escaneá este código QR con tu app autenticadora:
          </p>

          {/* QR code via Google Charts API */}
          <div className="flex justify-center">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(setupData.provisioningUri)}`}
              alt="Código QR para configurar 2FA"
              className="rounded-lg border border-gray-600 bg-white p-2"
              width={180}
              height={180}
            />
          </div>

          {/* Manual entry fallback */}
          <div className="rounded-md bg-gray-800 border border-gray-700 px-3 py-2">
            <p className="text-xs text-gray-500 mb-1">O ingresá la clave manualmente:</p>
            <code className="text-xs text-amber-400 break-all font-mono select-all">
              {setupData.secret}
            </code>
          </div>

          {/* TOTP verification */}
          <div className="space-y-2">
            <Input
              id={`${inputId}-verify`}
              label="Código de verificación"
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value)}
              placeholder="123456"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              disabled={isLoading}
              hint="Ingresá el código de 6 dígitos de tu app"
            />
          </div>

          <div className="flex gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={handleCancelSetup}
              disabled={isLoading}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => void handleVerify()}
              isLoading={isLoading}
              disabled={isLoading || verifyCode.length < 6}
            >
              Verificar y activar
            </Button>
          </div>
        </div>
      )}

      {/* State: enabled */}
      {twoFAState === 'enabled' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-400">
            2FA está activo. Para deshabilitarlo, ingresá un código TOTP válido de tu app.
          </p>
          <Input
            id={`${inputId}-disable`}
            label="Código TOTP para deshabilitar"
            value={disableCode}
            onChange={(e) => setDisableCode(e.target.value)}
            placeholder="123456"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            disabled={isLoading}
          />
          <Button
            type="button"
            variant="danger"
            onClick={() => void handleDisable()}
            isLoading={isLoading}
            disabled={isLoading || disableCode.length < 6}
          >
            Deshabilitar 2FA
          </Button>
        </div>
      )}
    </div>
  )
}
