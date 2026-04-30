/**
 * DinerAvatar — displays a colored circle with the diner's initial.
 * Color is derived deterministically from dinerId.
 */
import { getDinerColor, getDinerInitial } from '../../utils/dinerColor'

interface DinerAvatarProps {
  dinerId: string
  dinerName: string
  size?: 'sm' | 'md'
}

export function DinerAvatar({ dinerId, dinerName, size = 'sm' }: DinerAvatarProps) {
  const color = getDinerColor(dinerId)
  const initial = getDinerInitial(dinerName)

  const sizeClass = size === 'sm' ? 'w-6 h-6 text-xs' : 'w-8 h-8 text-sm'

  return (
    <div
      className={`${sizeClass} rounded-full flex items-center justify-center font-semibold text-white flex-shrink-0`}
      style={{ backgroundColor: color }}
      aria-label={dinerName}
      title={dinerName}
    >
      {initial}
    </div>
  )
}
