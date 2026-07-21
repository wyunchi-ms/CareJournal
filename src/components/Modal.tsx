import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode, type TouchEvent } from 'react'

export function Modal({ title, onClose, children, wide = false, swipeToClose = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; swipeToClose?: boolean }) {
  const touchStart = useRef<{ x: number; y: number; enabled: boolean } | null>(null)
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const startSwipe = (event: TouchEvent<HTMLElement>) => {
    if (!swipeToClose || event.touches.length !== 1) return
    const target = event.target instanceof Element ? event.target : null
    const scroller = target?.closest('.indicator-table-wrap')
    const enabled = !target?.closest('.image-preview-backdrop') && (!(scroller instanceof HTMLElement) || scroller.scrollLeft === 0)
    touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY, enabled }
  }

  const finishSwipe = (event: TouchEvent<HTMLElement>) => {
    const start = touchStart.current
    touchStart.current = null
    if (!start?.enabled || event.changedTouches.length !== 1) return
    const deltaX = event.changedTouches[0].clientX - start.x
    const deltaY = event.changedTouches[0].clientY - start.y
    if (deltaX >= 90 && Math.abs(deltaX) > Math.abs(deltaY) * 1.35) onClose()
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className={`modal-card${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" onTouchStart={startSwipe} onTouchEnd={finishSwipe}>
        <header className="modal-header">
          <h2 id="modal-title">{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="关闭"><X /></button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  )
}
