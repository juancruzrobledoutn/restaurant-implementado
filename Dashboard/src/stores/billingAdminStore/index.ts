/**
 * billingAdminStore — re-export barrel (C-26).
 *
 * Import from here: `import { useBillingAdminStore, selectChecks } from '@/stores/billingAdminStore'`
 */

export { useBillingAdminStore, EMPTY_CHECKS, EMPTY_PAYMENTS } from './store'
export {
  selectChecks,
  selectChecksTotal,
  selectChecksIsLoading,
  selectChecksError,
  selectChecksFilter,
  selectPayments,
  selectPaymentsTotal,
  selectPaymentsIsLoading,
  selectPaymentsError,
  selectPaymentsFilter,
  useChecksKPIs,
  usePaymentsByMethodSummary,
  useBillingAdminActions,
} from './selectors'
export type { BillingAdminState, ChecksFilter, PaymentsFilter } from './types'
