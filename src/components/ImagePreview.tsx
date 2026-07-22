import { Maximize2, Minus, Plus, RotateCcw, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'

interface PreviewTransform {
  scale: number
  x: number
  y: number
}

interface Point {
  x: number
  y: number
}

interface GestureStart {
  transform: PreviewTransform
  points: Point[]
}

const INITIAL_TRANSFORM: PreviewTransform = { scale: 1, x: 0, y: 0 }
const MIN_SCALE = 1
const MAX_SCALE = 5

function distance([first, second]: Point[]) {
  return Math.hypot(second.x - first.x, second.y - first.y)
}

function midpoint([first, second]: Point[]) {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
}

export function ImagePreview({ src, alt, className = '' }: { src: string; alt: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<PreviewTransform>(INITIAL_TRANSFORM)
  const viewRef = useRef<PreviewTransform>(INITIAL_TRANSFORM)
  const stageRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const pointersRef = useRef(new Map<number, Point>())
  const gestureRef = useRef<GestureStart | null>(null)

  const constrain = useCallback((next: PreviewTransform): PreviewTransform => {
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next.scale))
    if (scale === MIN_SCALE) return INITIAL_TRANSFORM

    const stage = stageRef.current
    const image = imageRef.current
    if (!stage || !image) return { ...next, scale }

    const maxX = Math.max(0, (image.offsetWidth * scale - stage.clientWidth) / 2)
    const maxY = Math.max(0, (image.offsetHeight * scale - stage.clientHeight) / 2)
    return {
      scale,
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    }
  }, [])

  const updateView = useCallback((next: PreviewTransform) => {
    const constrained = constrain(next)
    viewRef.current = constrained
    setView(constrained)
    return constrained
  }, [constrain])

  const resetView = useCallback(() => {
    pointersRef.current.clear()
    gestureRef.current = null
    viewRef.current = INITIAL_TRANSFORM
    setView(INITIAL_TRANSFORM)
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    resetView()
  }, [resetView])

  const changeScale = useCallback((requestedScale: number, clientPoint?: Point) => {
    const current = viewRef.current
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, requestedScale))
    if (scale === MIN_SCALE) {
      updateView(INITIAL_TRANSFORM)
      return
    }

    const stage = stageRef.current
    if (!stage || !clientPoint) {
      updateView({ ...current, scale })
      return
    }

    const rect = stage.getBoundingClientRect()
    const focalX = clientPoint.x - rect.left - rect.width / 2
    const focalY = clientPoint.y - rect.top - rect.height / 2
    const ratio = scale / current.scale
    updateView({
      scale,
      x: focalX - ratio * (focalX - current.x),
      y: focalY - ratio * (focalY - current.y),
    })
  }, [updateView])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    const handleResize = () => updateView(viewRef.current)
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', handleResize)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', handleResize)
    }
  }, [close, open, updateView])

  const startGesture = () => {
    gestureRef.current = {
      transform: { ...viewRef.current },
      points: Array.from(pointersRef.current.values()),
    }
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    startGesture()
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId) || !gestureRef.current) return
    event.preventDefault()
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const currentPoints = Array.from(pointersRef.current.values())
    const start = gestureRef.current

    if (currentPoints.length >= 2 && start.points.length >= 2) {
      const startDistance = distance(start.points)
      if (!startDistance) return
      const requestedScale = start.transform.scale * distance(currentPoints) / startDistance
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, requestedScale))
      const startMiddle = midpoint(start.points)
      const currentMiddle = midpoint(currentPoints)
      const stage = stageRef.current
      if (!stage) return
      const rect = stage.getBoundingClientRect()
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      const ratio = scale / start.transform.scale
      const requested = {
        scale,
        x: currentMiddle.x - center.x - ratio * (startMiddle.x - center.x - start.transform.x),
        y: currentMiddle.y - center.y - ratio * (startMiddle.y - center.y - start.transform.y),
      }
      const applied = updateView(requested)
      if (requestedScale !== scale || applied.x !== requested.x || applied.y !== requested.y) {
        gestureRef.current = { transform: applied, points: currentPoints }
      }
      return
    }

    if (currentPoints.length === 1 && start.points.length === 1 && start.transform.scale > MIN_SCALE) {
      const requested = {
        ...start.transform,
        x: start.transform.x + currentPoints[0].x - start.points[0].x,
        y: start.transform.y + currentPoints[0].y - start.points[0].y,
      }
      const applied = updateView(requested)
      if (applied.x !== requested.x || applied.y !== requested.y) {
        gestureRef.current = { transform: applied, points: currentPoints }
      }
    }
  }

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId)
    if (pointersRef.current.size) startGesture()
    else gestureRef.current = null
  }

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const factor = Math.exp(-event.deltaY * 0.002)
    changeScale(viewRef.current.scale * factor, { x: event.clientX, y: event.clientY })
  }

  return <>
    <button type="button" className={`image-thumbnail ${className}`.trim()} onClick={() => setOpen(true)} aria-label={`放大预览：${alt}`}>
      <img src={src} alt={alt} loading="lazy" />
      <span className="image-thumbnail-hint" aria-hidden="true"><Maximize2 /></span>
    </button>
    {open && <div className="image-preview-backdrop" role="dialog" aria-modal="true" aria-label="图片预览" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
      <div className="image-preview-toolbar">
        <span>{Math.round(view.scale * 100)}%</span>
        <button type="button" className="icon-button" onClick={() => changeScale(view.scale - .5)} disabled={view.scale <= MIN_SCALE} aria-label="缩小图片"><Minus /></button>
        <button type="button" className="icon-button" onClick={() => changeScale(view.scale + .5)} disabled={view.scale >= MAX_SCALE} aria-label="放大图片"><Plus /></button>
        <button type="button" className="icon-button" onClick={resetView} aria-label="恢复原始缩放"><RotateCcw /></button>
        <button type="button" className="icon-button" onClick={close} aria-label="关闭图片预览"><X /></button>
      </div>
      <div
        ref={stageRef}
        className={`image-preview-stage${view.scale > MIN_SCALE ? ' is-zoomed' : ''}`}
        aria-label="图片手势区域"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onDoubleClick={(event) => changeScale(view.scale === MIN_SCALE ? 2 : MIN_SCALE, { x: event.clientX, y: event.clientY })}
        onWheel={handleWheel}
      >
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          draggable={false}
          onLoad={() => updateView(viewRef.current)}
          style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` }}
        />
      </div>
      <p>双指缩放，放大后单指拖动；双击可快速切换</p>
    </div>}
  </>
}
