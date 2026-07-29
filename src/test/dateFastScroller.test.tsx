import { act, fireEvent, render, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { DateFastScroller } from '../components/DateFastScroller'

function rect(top: number): DOMRect {
  return {
    top,
    bottom: top + 200,
    left: 0,
    right: 0,
    width: 0,
    height: 200,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }
}

it('keeps the active date synchronized with normal page scrolling', () => {
  let nextFrame: FrameRequestCallback | undefined
  const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    nextFrame = callback
    return 1
  })
  const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
  const items = [
    { date: '2026-07-21', targetId: 'fast-scroll-first' },
    { date: '2026-06-12', targetId: 'fast-scroll-second' },
    { date: '2025-12-30', targetId: 'fast-scroll-third' },
  ]
  const { container, unmount } = render(
    <>
      <div id={items[0].targetId} />
      <div id={items[1].targetId} />
      <div id={items[2].targetId} />
      <DateFastScroller items={items} />
    </>,
  )
  act(() => nextFrame?.(0))

  document.getElementById(items[0].targetId)!.getBoundingClientRect = () => rect(-320)
  document.getElementById(items[1].targetId)!.getBoundingClientRect = () => rect(12)
  document.getElementById(items[2].targetId)!.getBoundingClientRect = () => rect(260)

  fireEvent.scroll(window)
  act(() => nextFrame?.(16))

  expect(within(container).getByRole('slider', { name: '按日期快速滑动' })).toHaveAttribute('aria-valuetext', '2026-06-12')
  unmount()
  requestAnimationFrame.mockRestore()
  cancelAnimationFrame.mockRestore()
})
