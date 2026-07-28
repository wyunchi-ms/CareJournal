import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Trash2 } from 'lucide-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SwipeableListItem } from '../components/SwipeableListItem'

describe('SwipeableListItem', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('reveals configured actions after a left swipe', () => {
    render(<SwipeableListItem
      itemId="one"
      label="第一项"
      actions={[{ id: 'delete', label: '删除', icon: <Trash2 />, tone: 'danger', onSelect: vi.fn() }]}
    ><button type="button">打开第一项</button></SwipeableListItem>)
    const surface = document.querySelector('.swipeable-list-surface')!

    fireEvent.pointerDown(surface, { pointerId: 1, pointerType: 'touch', clientX: 220, clientY: 100 })
    fireEvent.pointerMove(surface, { pointerId: 1, pointerType: 'touch', clientX: 110, clientY: 102 })
    fireEvent.pointerUp(surface, { pointerId: 1, pointerType: 'touch', clientX: 110, clientY: 102 })

    expect(screen.getByRole('button', { name: '删除：第一项' })).toHaveAttribute('tabindex', '0')
    expect(document.querySelector('.swipeable-list-item')).toHaveClass('revealed')
  })

  it('uses long press to enter edit mode without activating the row', () => {
    vi.useFakeTimers()
    const onLongPress = vi.fn()
    const onOpen = vi.fn()
    render(<SwipeableListItem itemId="one" label="第一项" onLongPress={onLongPress}>
      <button type="button" onClick={onOpen}>打开第一项</button>
    </SwipeableListItem>)
    const surface = document.querySelector('.swipeable-list-surface')!

    fireEvent.pointerDown(surface, { pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 100 })
    act(() => vi.advanceTimersByTime(550))
    fireEvent.click(screen.getByRole('button', { name: '打开第一项' }))

    expect(onLongPress).toHaveBeenCalledOnce()
    expect(onOpen).not.toHaveBeenCalled()
  })
})
