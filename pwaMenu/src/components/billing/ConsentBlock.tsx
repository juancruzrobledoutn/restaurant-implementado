/**
 * ConsentBlock — Legal text + checkbox for GDPR opt-in (C-19 / Task 9.5).
 *
 * HUMAN REVIEW REQUIRED — CRITICO:
 *   - consent.legalText and consent.body have [LEGAL REVIEW REQUIRED] prefix.
 *   - DO NOT remove the prefix until legal team has approved the final texts.
 *   - The post-build grep script (Task 11.5) will FAIL CI if prefix is missing.
 *
 * Usage (as controlled component):
 *   <ConsentBlock
 *     checked={false}
 *     onChange={setConsent}
 *     error={errors?.consent}
 *   />
 */
import { useTranslation } from 'react-i18next'

interface ConsentBlockProps {
  checked: boolean
  onChange: (checked: boolean) => void
  error?: string | null
}

export function ConsentBlock({ checked, onChange, error }: ConsentBlockProps) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-3 overflow-x-hidden w-full max-w-full">
      {/* Legal text — [LEGAL REVIEW REQUIRED] prefix kept until legal approval */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-xs text-gray-600 leading-relaxed">
        <p>{t('consent.legalText')}</p>
        <p className="mt-2">{t('consent.body')}</p>
      </div>

      {/* Consent checkbox — NOT pre-checked (GDPR art. 7 requires active consent) */}
      <label className="flex items-start gap-3 cursor-pointer group">
        <input
          type="checkbox"
          name="consent_granted"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-orange-500 focus:ring-orange-500"
          aria-describedby={error ? 'consent-error' : undefined}
        />
        <span className="text-sm text-gray-700 group-hover:text-gray-900">
          {t('consent.checkboxLabel')}
        </span>
      </label>

      {/* Inline error */}
      {error && (
        <p id="consent-error" className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
