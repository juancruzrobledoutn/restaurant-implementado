/**
 * ReceiptButton — action button that opens a printable receipt for a check.
 *
 * Calls receiptAPI.openReceipt(checkId) which uses the
 * fetch + blob + createObjectURL pattern (OQ-1 resolved — see receiptAPI.ts).
 */

import { useState } from 'react'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { receiptAPI } from '@/services/receiptAPI'
import { handleError } from '@/utils/logger'
import { toast } from '@/stores/toastStore'

interface ReceiptButtonProps {
  checkId: string
}

export function ReceiptButton({ checkId }: ReceiptButtonProps) {
  const [isLoading, setIsLoading] = useState(false)

  async function handleClick() {
    setIsLoading(true)
    try {
      await receiptAPI.openReceipt(checkId)
    } catch (err) {
      handleError(err, 'ReceiptButton.handleClick')
      toast.error('No se pudo abrir el recibo')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      isLoading={isLoading}
      onClick={handleClick}
      aria-label="Imprimir recibo"
      title="Imprimir recibo"
    >
      <Printer className="h-4 w-4" aria-hidden="true" />
    </Button>
  )
}
