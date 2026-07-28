import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

export interface SwipeableListAction {
  id: string
  label: string
  accessibilityLabel?: string
  icon: ReactNode
  tone?: 'default' | 'primary' | 'danger'
  disabled?: boolean
  onSelect: () => void
}

interface SwipeableListItemProps {
  itemId: string
  label: string
  actions?: SwipeableListAction[]
  children: ReactNode
  className?: string
  surfaceClassName?: string
  editMode?: boolean
  revealed?: boolean
  onRevealedChange?: (revealed: boolean) => void
  onLongPress?: () => void
  longPressDelay?: number
  itemDataAttribute?: `data-${string}`
  as?: 'div' | 'article'
}

const ACTION_WIDTH = 76
const REVEAL_THRESHOLD = .45

export function SwipeableListItem({
  itemId,
  label,
  actions = [],
  children,
  className = '',
  surfaceClassName = '',
  editMode = false,
  revealed,
  onRevealedChange,
  onLongPress,
  longPressDelay = 500,
  itemDataAttribute,
  as: Element = 'div',
}: SwipeableListItemProps) {
  const [internalRevealed, setInternalRevealed] = useState(false)
  const [dragOffset, setDragOffset] = useState<number | null>(null)
  const startRef = useRef<{ x: number; y: number; offset: number } | null>(null)
  const offsetRef = useRef(0)
  const movedRef = useRef(false)
  const suppressClickRef = useRef(false)
  const longPressTimerRef = useRef<number | null>(null)
  const isRevealed = revealed ?? internalRevealed
  const actionWidth = actions.length * ACTION_WIDTH

  function setRevealed(next: boolean) {
    if (revealed === undefined) setInternalRevealed(next)
    onRevealedChange?.(next)
  }

  function clearLongPress() {
    if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = null
  }

  useEffect(() => () => clearLongPress(), [])

  function start(event: ReactPointerEvent<HTMLDivElement>) {
    if (editMode || event.pointerType === 'mouse' && event.button !== 0) return
    if ((event.target as HTMLElement).closest('[data-list-gesture-ignore]')) return
    const offset = isRevealed ? -actionWidth : 0
    startRef.current = { x: event.clientX, y: event.clientY, offset }
    offsetRef.current = offset
    movedRef.current = false
    if (onLongPress) {
      clearLongPress()
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null
        suppressClickRef.current = true
        startRef.current = null
        setDragOffset(null)
        setRevealed(false)
        navigator.vibrate?.(20)
        onLongPress()
      }, longPressDelay)
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const startPoint = startRef.current
    if (!startPoint) return
    const deltaX = event.clientX - startPoint.x
    const deltaY = event.clientY - startPoint.y
    if (Math.hypot(deltaX, deltaY) > 9) clearLongPress()
    if (!actions.length || Math.abs(deltaX) < 8 || Math.abs(deltaX) <= Math.abs(deltaY)) return
    event.preventDefault()
    movedRef.current = true
    suppressClickRef.current = true
    const offset = Math.max(-actionWidth, Math.min(0, startPoint.offset + deltaX))
    offsetRef.current = offset
    setDragOffset(offset)
  }

  function end(event: ReactPointerEvent<HTMLDivElement>) {
    clearLongPress()
    if (startRef.current && movedRef.current && actionWidth) {
      setRevealed(offsetRef.current <= -actionWidth * REVEAL_THRESHOLD)
    }
    startRef.current = null
    setDragOffset(null)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  function handleClickCapture(event: React.MouseEvent<HTMLDivElement>) {
    if (!suppressClickRef.current) return
    suppressClickRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (editMode || !actions.length) return
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setRevealed(true)
    } else if (event.key === 'ArrowRight' || event.key === 'Escape') {
      event.preventDefault()
      setRevealed(false)
    }
  }

  const offset = editMode ? 0 : dragOffset ?? (isRevealed ? -actionWidth : 0)
  const style = {
    '--swipe-action-count': actions.length,
    '--swipe-action-width': `${actionWidth}px`,
  } as CSSProperties

  return <Element
    className={`swipeable-list-item${editMode ? ' editing' : ''}${isRevealed ? ' revealed' : ''}${className ? ` ${className}` : ''}`}
    data-list-item-id={itemId}
    {...(itemDataAttribute ? { [itemDataAttribute]: itemId } : {})}
    style={style}
  >
    {!editMode && actions.length > 0 && <div
      className="swipeable-list-actions"
      aria-label={`${label}操作`}
      aria-hidden={!isRevealed}
    >
      {actions.map((action) => <button
        type="button"
        className={`swipeable-list-action ${action.tone ?? 'default'}`}
        key={action.id}
        tabIndex={isRevealed ? 0 : -1}
        disabled={action.disabled}
        aria-label={action.accessibilityLabel ?? `${action.label}：${label}`}
        onClick={() => {
          action.onSelect()
          setRevealed(false)
        }}
      >{action.icon}<span>{action.label}</span></button>)}
    </div>}
    <div
      className={`swipeable-list-surface${dragOffset !== null ? ' dragging' : ''}${surfaceClassName ? ` ${surfaceClassName}` : ''}`}
      style={{ transform: `translate3d(${offset}px, 0, 0)` }}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onClickCapture={handleClickCapture}
      onContextMenu={(event) => {
        if (!editMode && onLongPress) {
          event.preventDefault()
          suppressClickRef.current = true
          setRevealed(false)
          onLongPress()
        }
      }}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
  </Element>
}
