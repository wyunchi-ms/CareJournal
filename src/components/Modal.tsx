import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode, type TouchEvent } from 'react'
import { isTopModal, registerModal, unregisterModal } from './modalStack'

let scrollLockCount = 0
let scrollLockSnapshot: {
  scrollY: number
  htmlOverflow: string
  bodyOverflow: string
  bodyPosition: string
  bodyTop: string
  bodyLeft: string
  bodyRight: string
  bodyWidth: string
} | null = null

function lockPageScroll() {
  scrollLockCount += 1
  if (scrollLockCount > 1) return
  const { body, documentElement } = document
  scrollLockSnapshot = {
    scrollY: window.scrollY,
    htmlOverflow: documentElement.style.overflow,
    bodyOverflow: body.style.overflow,
    bodyPosition: body.style.position,
    bodyTop: body.style.top,
    bodyLeft: body.style.left,
    bodyRight: body.style.right,
    bodyWidth: body.style.width,
  }
  documentElement.style.overflow = 'hidden'
  body.style.overflow = 'hidden'
  body.style.position = 'fixed'
  body.style.top = `-${scrollLockSnapshot.scrollY}px`
  body.style.left = '0'
  body.style.right = '0'
  body.style.width = '100%'
}

function unlockPageScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1)
  if (scrollLockCount > 0 || !scrollLockSnapshot) return
  const snapshot = scrollLockSnapshot
  scrollLockSnapshot = null
  const { body, documentElement } = document
  documentElement.style.overflow = snapshot.htmlOverflow
  body.style.overflow = snapshot.bodyOverflow
  body.style.position = snapshot.bodyPosition
  body.style.top = snapshot.bodyTop
  body.style.left = snapshot.bodyLeft
  body.style.right = snapshot.bodyRight
  body.style.width = snapshot.bodyWidth
  if (snapshot.scrollY > 0) window.scrollTo(0, snapshot.scrollY)
}

export function Modal({ title, onClose, children, wide = false, swipeToClose = false, bottomSheet = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; swipeToClose?: boolean; bottomSheet?: boolean }) {
  const titleId = useId()
  const stackId = useRef(Symbol(title))
  const onCloseRef = useRef(onClose)
  const touchStart = useRef<{ x: number; y: number; enabled: boolean } | null>(null)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  useEffect(() => {
    const id = stackId.current
    registerModal(id, () => onCloseRef.current())
    lockPageScroll()
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape' && isTopModal(id)) onCloseRef.current() }
    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
      unregisterModal(id)
      unlockPageScroll()
    }
  }, [])

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
    <div className={`modal-backdrop${bottomSheet ? ' bottom-sheet-backdrop' : ''}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className={`modal-card${wide ? ' wide' : ''}${bottomSheet ? ' bottom-sheet' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} onTouchStart={startSwipe} onTouchEnd={finishSwipe}>
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="关闭" title="关闭"><X /></button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  )
}
