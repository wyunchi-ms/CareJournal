import { useEffect, useState, type KeyboardEvent, type PointerEvent } from 'react'

export interface DateFastScrollItem {
  date: string
  targetId: string
}

export function DateFastScroller({ items }: { items: DateFastScrollItem[] }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (items.length < 2) return

    let animationFrame = 0

    function syncWithPageScroll() {
      animationFrame = 0
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight
      const scrollTop = window.scrollY || document.documentElement.scrollTop
      const scrollHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)
      const isAtPageBottom = scrollHeight > viewportHeight && scrollTop >= scrollHeight - viewportHeight - 2
      const activationLine = Math.min(24, viewportHeight * 0.08)
      let nextIndex = 0

      for (let index = 0; index < items.length; index += 1) {
        const target = document.getElementById(items[index].targetId)
        if (!target) continue
        if (target.getBoundingClientRect().top <= activationLine) nextIndex = index
        else break
      }

      if (isAtPageBottom) nextIndex = items.length - 1
      setActiveIndex((current) => current === nextIndex ? current : nextIndex)
    }

    function scheduleSync() {
      if (animationFrame) return
      animationFrame = window.requestAnimationFrame(syncWithPageScroll)
    }

    scheduleSync()
    window.addEventListener('scroll', scheduleSync, { passive: true })
    window.addEventListener('resize', scheduleSync)

    return () => {
      window.removeEventListener('scroll', scheduleSync)
      window.removeEventListener('resize', scheduleSync)
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
    }
  }, [items])

  function jump(index: number, smooth = true) {
    const nextIndex = Math.max(0, Math.min(items.length - 1, index))
    setActiveIndex(nextIndex)
    document.getElementById(items[nextIndex]?.targetId)?.scrollIntoView?.({
      block: 'start',
      behavior: smooth ? 'smooth' : 'auto',
    })
  }

  function indexAtPointer(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const position = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top))
    return Math.min(items.length - 1, Math.floor((position / Math.max(bounds.height, 1)) * items.length))
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowDown' || event.key === 'PageDown') {
      event.preventDefault()
      jump(activeIndex + 1)
    } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
      event.preventDefault()
      jump(activeIndex - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      jump(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      jump(items.length - 1)
    }
  }

  if (items.length < 2) return null
  const activeDate = items[activeIndex]?.date ?? items[0].date
  const markerCount = Math.min(items.length, 24)
  const activeMarkerIndex = markerCount <= 1
    ? 0
    : Math.round(activeIndex / (items.length - 1) * (markerCount - 1))

  return (
    <div
      className={`date-fast-scroller${dragging ? ' dragging' : ''}`}
      role="slider"
      tabIndex={0}
      aria-label="按日期快速滑动"
      aria-valuemin={1}
      aria-valuemax={items.length}
      aria-valuenow={activeIndex + 1}
      aria-valuetext={activeDate}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
        jump(indexAtPointer(event), false)
      }}
      onPointerMove={(event) => {
        if (!dragging) return
        jump(indexAtPointer(event), false)
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId)
        setDragging(false)
      }}
      onPointerCancel={() => setDragging(false)}
    >
      <span className="date-fast-bubble" aria-hidden="true">{activeDate.replace(/-/g, '/')}</span>
      <span className="date-fast-rail" aria-hidden="true">
        {Array.from({ length: markerCount }, (_, index) => <i key={index} className={index === activeMarkerIndex ? 'active' : ''} />)}
      </span>
    </div>
  )
}
