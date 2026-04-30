/**
 * Unit tests for OptInForm component (C-19 / Task 9.7).
 *
 * Tests:
 *   - Consent checkbox is NOT pre-checked on mount (GDPR art. 7)
 *   - Submit without consent shows consent error — does NOT call API
 *   - Submit with valid data + consent calls API and invokes onSuccess
 *   - AlreadyOptedInError from API shows global error — does NOT call onSuccess
 *
 * React 19 useActionState note:
 *   In jsdom, React sets form.action to a throw-error guard. Form submission
 *   must go through fireEvent.submit(form) — NOT fireEvent.click(submit button).
 *   This triggers React's synthetic form submission which dispatches the action.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { OptInForm } from '../../../components/billing/OptInForm'
import type { CustomerProfile } from '../../../types/billing'

// ─── Mock i18next ─────────────────────────────────────────────────────────────
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// ─── Stable mock for customerApi ──────────────────────────────────────────────
const mockOptIn = vi.fn()

vi.mock('../../../services/customerApi', () => {
  class AlreadyOptedInError extends Error {
    constructor() {
      super('already_opted_in')
      this.name = 'AlreadyOptedInError'
    }
  }
  class ConsentRequiredError extends Error {
    constructor() {
      super('consent_required')
      this.name = 'ConsentRequiredError'
    }
  }
  return {
    customerApi: { optIn: (...args: unknown[]) => mockOptIn(...args) },
    AlreadyOptedInError,
    ConsentRequiredError,
  }
})

// ─── Mock customerStore — setProfile ──────────────────────────────────────────
const mockSetProfile = vi.fn()

vi.mock('../../../stores/customerStore', () => ({
  useCustomerStore: (selector: (s: { setProfile: typeof mockSetProfile }) => unknown) =>
    selector({ setProfile: mockSetProfile }),
}))

// ─── Mock logger — prevent noise ──────────────────────────────────────────────
vi.mock('../../../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────
const MOCK_PROFILE: CustomerProfile = {
  id: '99',
  deviceHint: 'dev-test',
  name: 'Ana García',
  email: 'ana@example.com',
  optedIn: true,
  consentVersion: 'v1',
}

/**
 * Fill the form fields by targeting input elements by name attribute.
 * (label contains a nested <span> with '*', making getByLabelText unreliable)
 */
function fillName(container: HTMLElement, name = 'Ana García') {
  const input = container.querySelector<HTMLInputElement>('input[name="name"]')!
  fireEvent.change(input, { target: { value: name } })
}

function fillEmail(container: HTMLElement, email = 'ana@example.com') {
  const input = container.querySelector<HTMLInputElement>('input[name="email"]')!
  fireEvent.change(input, { target: { value: email } })
}

function checkConsent(container: HTMLElement) {
  const checkbox = container.querySelector<HTMLInputElement>('input[name="consent_granted"]')!
  fireEvent.click(checkbox)
}

/**
 * Submit the form by calling fireEvent.submit on the <form> element.
 * This triggers React 19's synthetic form submission dispatching the action.
 */
function submitForm(container: HTMLElement) {
  const form = container.querySelector<HTMLFormElement>('form#optin-form')!
  fireEvent.submit(form)
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('OptInForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('consent checkbox is NOT pre-checked on mount', () => {
      const { container } = render(<OptInForm />)

      const checkbox = container.querySelector<HTMLInputElement>('input[name="consent_granted"]')!
      expect(checkbox).toBeInTheDocument()
      expect(checkbox.checked).toBe(false)
    })

    it('renders name and email inputs', () => {
      const { container } = render(<OptInForm />)

      expect(container.querySelector('input[name="name"]')).toBeInTheDocument()
      expect(container.querySelector('input[name="email"]')).toBeInTheDocument()
    })

    it('submit button is present and enabled initially', () => {
      const { container } = render(<OptInForm />)

      const btn = container.querySelector<HTMLButtonElement>('button[type="submit"]')!
      expect(btn).toBeInTheDocument()
      expect(btn.disabled).toBe(false)
    })
  })

  describe('validation — submit without consent', () => {
    it('shows consent error when checkbox is unchecked and does NOT call API', async () => {
      const { container } = render(<OptInForm />)

      fillName(container)
      fillEmail(container)
      // Do NOT check consent checkbox
      await act(async () => {
        submitForm(container)
      })

      await waitFor(() => {
        expect(screen.getByText('customer.optin.errors.consentRequired')).toBeInTheDocument()
      })

      expect(mockOptIn).not.toHaveBeenCalled()
    })

    it('shows name error when name is too short', async () => {
      const { container } = render(<OptInForm />)

      fillName(container, 'A') // too short
      fillEmail(container, 'a@b.com')
      await act(async () => {
        submitForm(container)
      })

      await waitFor(() => {
        expect(screen.getByText('customer.optin.errors.nameRequired')).toBeInTheDocument()
      })

      expect(mockOptIn).not.toHaveBeenCalled()
    })

    it('shows email error when email is invalid', async () => {
      const { container } = render(<OptInForm />)

      fillName(container)
      fillEmail(container, 'not-an-email')
      await act(async () => {
        submitForm(container)
      })

      await waitFor(() => {
        expect(screen.getByText('customer.optin.errors.emailInvalid')).toBeInTheDocument()
      })

      expect(mockOptIn).not.toHaveBeenCalled()
    })
  })

  describe('successful submission', () => {
    it('calls API and invokes onSuccess when form is valid and consent is checked', async () => {
      mockOptIn.mockResolvedValue(MOCK_PROFILE)
      const onSuccess = vi.fn()

      const { container } = render(<OptInForm onSuccess={onSuccess} />)

      fillName(container)
      fillEmail(container)
      await act(async () => {
        checkConsent(container)
      })

      await act(async () => {
        submitForm(container)
      })

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledTimes(1)
      })

      expect(mockOptIn).toHaveBeenCalledWith({
        name: 'Ana García',
        email: 'ana@example.com',
        consent_version: 'v1',
        consent_granted: true,
      })

      expect(mockSetProfile).toHaveBeenCalledWith(MOCK_PROFILE)
    })

    it('normalizes email to lowercase before submitting', async () => {
      mockOptIn.mockResolvedValue(MOCK_PROFILE)
      const onSuccess = vi.fn()

      const { container } = render(<OptInForm onSuccess={onSuccess} />)

      fillName(container)
      fillEmail(container, 'ANA@EXAMPLE.COM')
      await act(async () => {
        checkConsent(container)
      })

      await act(async () => {
        submitForm(container)
      })

      await waitFor(() => {
        expect(mockOptIn).toHaveBeenCalledWith(
          expect.objectContaining({ email: 'ana@example.com' }),
        )
      })
    })
  })

  describe('API error handling', () => {
    it('shows global error and does NOT call onSuccess on AlreadyOptedInError', async () => {
      const { AlreadyOptedInError } = await import('../../../services/customerApi')
      mockOptIn.mockRejectedValue(new AlreadyOptedInError())
      const onSuccess = vi.fn()

      const { container } = render(<OptInForm onSuccess={onSuccess} />)

      fillName(container)
      fillEmail(container)
      await act(async () => {
        checkConsent(container)
      })

      await act(async () => {
        submitForm(container)
      })

      await waitFor(() => {
        // Global error renders in the alert div with role="alert"
        const alerts = screen.getAllByRole('alert')
        const found = alerts.some((el) => el.textContent?.includes('customer.optin.alreadyOptedIn'))
        expect(found).toBe(true)
      })

      expect(onSuccess).not.toHaveBeenCalled()
    })

    it('shows generic error on unexpected API failure', async () => {
      mockOptIn.mockRejectedValue(new Error('Network error'))
      const onSuccess = vi.fn()

      const { container } = render(<OptInForm onSuccess={onSuccess} />)

      fillName(container)
      fillEmail(container)
      await act(async () => {
        checkConsent(container)
      })

      await act(async () => {
        submitForm(container)
      })

      await waitFor(() => {
        const alerts = screen.getAllByRole('alert')
        const found = alerts.some((el) => el.textContent?.includes('error.unknown'))
        expect(found).toBe(true)
      })

      expect(onSuccess).not.toHaveBeenCalled()
    })
  })
})
