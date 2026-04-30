/**
 * ImagePreview — live preview of an image URL input.
 *
 * Skill: dashboard-crud-page
 */

import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import { parseImageUrl } from '@/utils/formatters'

interface ImagePreviewProps {
  src?: string
  alt?: string
  className?: string
}

export function ImagePreview({ src, alt = 'Vista previa', className = '' }: ImagePreviewProps) {
  const [hasError, setHasError] = useState(false)
  const safeSrc = parseImageUrl(src)

  if (!safeSrc) return null

  return (
    <div
      className={[
        'relative mt-2 overflow-hidden rounded-md border border-gray-700 bg-gray-800',
        'h-32 w-full flex items-center justify-center',
        className,
      ].join(' ')}
    >
      {hasError ? (
        <div className="flex flex-col items-center gap-2 text-gray-500">
          <ImageOff className="h-8 w-8" aria-hidden="true" />
          <p className="text-xs">No se pudo cargar la imagen</p>
        </div>
      ) : (
        <img
          src={safeSrc}
          alt={alt}
          className="max-h-full max-w-full object-contain"
          onError={() => setHasError(true)}
          onLoad={() => setHasError(false)}
        />
      )}
    </div>
  )
}
