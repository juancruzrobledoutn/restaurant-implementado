/**
 * PaymentMethodIcon — icon + label for payment methods (C-26).
 *
 * Lucide icons per method:
 *   cash        → Banknote
 *   card        → CreditCard
 *   transfer    → ArrowRightLeft
 *   mercadopago → Wallet
 */

import { Banknote, CreditCard, ArrowRightLeft, Wallet } from 'lucide-react'
import type { PaymentMethod } from '@/types/billing'

interface PaymentMethodIconProps {
  method: PaymentMethod | string
  showLabel?: boolean
  className?: string
}

const METHOD_CONFIG: Record<string, { label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  cash:        { label: 'Efectivo',     Icon: Banknote },
  card:        { label: 'Tarjeta',      Icon: CreditCard },
  transfer:    { label: 'Transferencia', Icon: ArrowRightLeft },
  mercadopago: { label: 'MercadoPago',  Icon: Wallet },
}

export function PaymentMethodIcon({ method, showLabel = true, className = '' }: PaymentMethodIconProps) {
  const config = METHOD_CONFIG[method] ?? { label: method, Icon: Wallet }
  const { label, Icon } = config

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <Icon className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
      {showLabel && <span className="text-sm">{label}</span>}
    </span>
  )
}
