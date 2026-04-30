/**
 * PaymentMethodSummary — compact table at the foot of the /payments page (C-26).
 *
 * Shows: Method | Quantity | Total (APPROVED only)
 * Data comes from usePaymentsByMethodSummary selector (useMemo derived).
 *
 * Design D10: aggregated client-side from payments in store.
 */

import { usePaymentsByMethodSummary } from '@/stores/billingAdminStore'
import { formatPrice } from '@/utils/formatPrice'
import { PaymentMethodIcon } from '@/components/billing/PaymentMethodIcon'

export function PaymentMethodSummary() {
  const summary = usePaymentsByMethodSummary()

  if (summary.length === 0) return null

  return (
    <div className="mt-6">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
        Resumen por metodo (pagos aprobados)
      </h3>
      <div className="rounded-lg border border-gray-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-800/50">
              <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Metodo
              </th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Cantidad
              </th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {summary.map((row) => (
              <tr key={row.method} className="border-b border-gray-700/50 last:border-0">
                <td className="px-4 py-2.5">
                  <PaymentMethodIcon method={row.method} />
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-gray-300">
                  {row.count}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-white">
                  {formatPrice(row.total_cents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
