import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

interface DragPoint {
  readonly clientX: number
  readonly clientY: number
  readonly sourceId: string
  readonly listElement: HTMLElement
}

export interface SortableDragPreviewState {
  readonly itemId: string
  readonly top: number
  readonly left: number
  readonly width: number
}

interface UseSortableDragLiftOptions {
  readonly enabled: boolean
  readonly layoutKey: string
  readonly onDragMove: (point: DragPoint) => void
  readonly onDragEnd?: () => void
}

export function useSortableDragLift({ enabled, layoutKey, onDragMove, onDragEnd }: UseSortableDragLiftOptions) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [preview, setPreview] = useState<SortableDragPreviewState | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const positionerRef = useRef<HTMLDivElement>(null)
  const draggingIdRef = useRef<string | null>(null)
  const pointerIdRef = useRef<number | null>(null)
  const pointerOffsetYRef = useRef(0)
  const previewOriginTopRef = useRef(0)
  const previewHeightRef = useRef(0)
  const previewOffsetRef = useRef(0)
  const previewFrameRef = useRef<number | null>(null)
  const rowPositionsRef = useRef<Map<string, number>>(new Map())
  const rowAnimationsRef = useRef<Map<string, Animation>>(new Map())
  const onDragMoveRef = useRef(onDragMove)
  const onDragEndRef = useRef(onDragEnd)

  useLayoutEffect(() => {
    onDragMoveRef.current = onDragMove
    onDragEndRef.current = onDragEnd
  }, [onDragEnd, onDragMove])

  const finishDrag = useCallback(() => {
    const wasDragging = draggingIdRef.current !== null
    if (previewFrameRef.current !== null) {
      window.cancelAnimationFrame(previewFrameRef.current)
      previewFrameRef.current = null
    }
    if (positionerRef.current) positionerRef.current.style.display = 'none'
    draggingIdRef.current = null
    pointerIdRef.current = null
    previewOffsetRef.current = 0
    setDraggingId(null)
    setPreview(null)
    if (wasDragging) onDragEndRef.current?.()
  }, [])

  const updateDrag = useCallback((clientX: number, clientY: number) => {
    const sourceId = draggingIdRef.current
    const listElement = listRef.current
    if (!sourceId || !listElement) return
    const listBounds = listElement.getBoundingClientRect()
    const minimumTop = listBounds.top + 2
    const maximumTop = Math.max(minimumTop, listBounds.bottom - previewHeightRef.current - 2)
    const requestedTop = clientY - pointerOffsetYRef.current
    const boundedTop = Math.min(maximumTop, Math.max(minimumTop, requestedTop))
    previewOffsetRef.current = boundedTop - previewOriginTopRef.current
    if (previewFrameRef.current === null) {
      previewFrameRef.current = window.requestAnimationFrame(() => {
        previewFrameRef.current = null
        if (positionerRef.current) positionerRef.current.style.transform = `translate3d(0, ${previewOffsetRef.current}px, 0)`
      })
    }
    onDragMoveRef.current({ clientX, clientY, sourceId, listElement })
  }, [])

  useEffect(() => {
    const moveFromWindow = (event: PointerEvent) => {
      if (pointerIdRef.current === null || event.pointerId !== pointerIdRef.current) return
      event.preventDefault()
      updateDrag(event.clientX, event.clientY)
    }
    const finishFromWindow = (event: PointerEvent) => {
      if (pointerIdRef.current === null || event.pointerId !== pointerIdRef.current) return
      finishDrag()
    }
    window.addEventListener('pointermove', moveFromWindow, { capture: true, passive: false })
    window.addEventListener('pointerup', finishFromWindow, true)
    window.addEventListener('pointercancel', finishFromWindow, true)
    return () => {
      window.removeEventListener('pointermove', moveFromWindow, true)
      window.removeEventListener('pointerup', finishFromWindow, true)
      window.removeEventListener('pointercancel', finishFromWindow, true)
    }
  }, [finishDrag, updateDrag])

  useLayoutEffect(() => {
    const listElement = listRef.current
    if (!enabled || !listElement) {
      rowAnimationsRef.current.forEach((animation) => animation.cancel())
      rowAnimationsRef.current.clear()
      rowPositionsRef.current.clear()
      return
    }
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const nextPositions = new Map<string, number>()
    listElement.querySelectorAll<HTMLElement>('[data-list-item-id]').forEach((row) => {
      const itemId = row.dataset.listItemId
      if (!itemId) return
      const activeAnimation = rowAnimationsRef.current.get(itemId)
      const visualTop = row.getBoundingClientRect().top
      activeAnimation?.cancel()
      const layoutTop = row.getBoundingClientRect().top
      const previousTop = rowPositionsRef.current.get(itemId)
      const offset = activeAnimation ? visualTop - layoutTop : previousTop === undefined ? 0 : previousTop - layoutTop
      if (!reduceMotion && itemId !== draggingId && Math.abs(offset) > 1 && typeof row.animate === 'function') {
        const animation = row.animate(
          [{ transform: `translate3d(0, ${offset}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
          { duration: 190, easing: 'cubic-bezier(.2, .8, .2, 1)' },
        )
        rowAnimationsRef.current.set(itemId, animation)
        const clearAnimation = () => {
          if (rowAnimationsRef.current.get(itemId) === animation) rowAnimationsRef.current.delete(itemId)
        }
        animation.onfinish = clearAnimation
        animation.oncancel = clearAnimation
      }
      nextPositions.set(itemId, layoutTop)
    })
    rowPositionsRef.current = nextPositions
  }, [draggingId, enabled, layoutKey])

  function beginDrag(event: ReactPointerEvent<HTMLButtonElement>, itemId: string) {
    if (!enabled) return
    event.preventDefault()
    const row = event.currentTarget.closest<HTMLElement>('[data-list-item-id]')
    if (!row) return
    const bounds = row.getBoundingClientRect()
    draggingIdRef.current = itemId
    pointerIdRef.current = event.pointerId
    pointerOffsetYRef.current = event.clientY - bounds.top
    previewOriginTopRef.current = bounds.top
    previewHeightRef.current = bounds.height
    previewOffsetRef.current = 0
    setDraggingId(itemId)
    setPreview({ itemId, top: bounds.top, left: bounds.left, width: bounds.width })
    navigator.vibrate?.(12)
  }

  return { beginDrag, draggingId, finishDrag, listRef, positionerRef, preview }
}
