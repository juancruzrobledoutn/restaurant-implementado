/**
 * ProfileForm — tab Perfil: password change + 2FA section.
 *
 * Composes PasswordChangeForm and TwoFactorSection.
 * Accessible to all roles (ADMIN, MANAGER, KITCHEN, WAITER).
 *
 * Skill: dashboard-crud-page
 */

import { PasswordChangeForm } from '@/components/settings/PasswordChangeForm'
import { TwoFactorSection } from '@/components/settings/TwoFactorSection'

export function ProfileForm() {
  return (
    <div className="space-y-8 max-w-xl">
      {/* Password change */}
      <section aria-labelledby="password-section-title">
        <h3
          id="password-section-title"
          className="text-base font-semibold text-white mb-4"
        >
          Cambiar contraseña
        </h3>
        <PasswordChangeForm />
      </section>

      <hr className="border-gray-700" />

      {/* 2FA */}
      <section aria-labelledby="2fa-section-title">
        <h3
          id="2fa-section-title"
          className="text-base font-semibold text-white mb-4"
        >
          Autenticación de dos factores
        </h3>
        <TwoFactorSection />
      </section>
    </div>
  )
}
