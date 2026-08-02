import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { SortableDragPreviewState } from './SortableDragLift'

interface SortableDragOverlayProps {
  readonly preview: SortableDragPreviewState | null
  readonly positionerRef: RefObject<HTMLDivElement | null>
  readonly children: ReactNode
}

export function SortableDragOverlay({ preview, positionerRef, children }: SortableDragOverlayProps) {
  if (!preview) return null
  return createPortal(
    <div
      ref={positionerRef}
      className="sortable-drag-preview-positioner"
      style={{ top: preview.top, left: preview.left, width: preview.width }}
      aria-hidden="true"
    >
      <div className="sortable-drag-preview">{children}</div>
    </div>,
    document.body,
  )
}
