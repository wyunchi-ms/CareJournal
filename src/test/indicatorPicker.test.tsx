import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IndicatorPicker } from '../components/IndicatorPicker'

const options = [
  { code: 'WBC', name: '白细胞计数', unit: '10^9/L', count: 12 },
  { code: 'HGB', name: '血红蛋白', unit: 'g/L', count: 8 },
  { code: 'PLT', name: '血小板计数', unit: '10^9/L', count: 10 },
]

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('indicator picker', () => {
  it('is single-select and exposes occurrence counts and indicator pinning', () => {
    const onChange = vi.fn()
    const onPinnedChange = vi.fn()
    render(<IndicatorPicker options={options} value="WBC" pinnedCodes={[]} onChange={onChange} onPinnedChange={onPinnedChange} onOrderChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '检查指标：白细胞计数' }))

    expect(screen.getByRole('dialog', { name: '检查指标（单选）' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /拖动排序/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/常用指标优先/)).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '搜索检查指标' })).toHaveAttribute('placeholder', '搜索指标，长按条目排序')
    expect(screen.getAllByText('10^9/L · 出现 12 次')).toHaveLength(2)
    fireEvent.keyDown(screen.getByRole('radio', { name: /血红蛋白/ }), { key: 'ArrowLeft' })
    fireEvent.click(screen.getByRole('button', { name: '置顶：血红蛋白' }))
    expect(onPinnedChange).toHaveBeenCalledWith(['HGB'])
    fireEvent.click(screen.getByRole('radio', { name: /血红蛋白/ }))
    expect(onChange).toHaveBeenCalledWith('HGB')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('filters indicators by name, code, or unit', () => {
    render(<IndicatorPicker options={options} value="WBC" pinnedCodes={[]} onChange={vi.fn()} onPinnedChange={vi.fn()} onOrderChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '检查指标：白细胞计数' }))

    fireEvent.change(screen.getByRole('textbox', { name: '搜索检查指标' }), { target: { value: 'HGB' } })

    expect(screen.getAllByRole('radio')).toHaveLength(1)
    expect(screen.getByRole('radio', { name: /血红蛋白/ })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /白细胞计数/ })).not.toBeInTheDocument()
  })

  it('enters reorder mode only after a long press and supports keyboard reordering', () => {
    vi.useFakeTimers()
    const onOrderChange = vi.fn()
    render(<IndicatorPicker options={options} value="WBC" pinnedCodes={[]} onChange={vi.fn()} onPinnedChange={vi.fn()} onOrderChange={onOrderChange} />)
    fireEvent.click(screen.getByRole('button', { name: '检查指标：白细胞计数' }))

    const hemoglobin = screen.getByRole('radio', { name: /血红蛋白/ })
    fireEvent.pointerDown(hemoglobin, { button: 0, clientX: 12, clientY: 12, pointerId: 1 })
    act(() => vi.advanceTimersByTime(500))

    expect(screen.getByRole('dialog', { name: '检查指标（排序）' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /拖动排序/ })).toHaveLength(3)
    fireEvent.keyDown(screen.getByRole('button', { name: '拖动排序：血红蛋白' }), { key: 'ArrowDown' })

    expect(onOrderChange).toHaveBeenCalledWith(['WBC', 'PLT', 'HGB'], [])
    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    expect(screen.getByRole('dialog', { name: '检查指标（单选）' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /拖动排序/ })).not.toBeInTheDocument()
  })

  it('lifts a dragged indicator while keeping its row as a placeholder', () => {
    vi.useFakeTimers()
    render(<IndicatorPicker options={options} value="WBC" pinnedCodes={[]} onChange={vi.fn()} onPinnedChange={vi.fn()} onOrderChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '检查指标：白细胞计数' }))
    fireEvent.pointerDown(screen.getByRole('radio', { name: /血红蛋白/ }), { button: 0, pointerId: 1, clientX: 12, clientY: 12 })
    act(() => vi.advanceTimersByTime(500))

    const row = screen.getByRole('radio', { name: /血红蛋白/ }).closest<HTMLElement>('[data-indicator-code]')!
    const handle = screen.getByRole('button', { name: '拖动排序：血红蛋白' })
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ x: 16, y: 90, top: 90, left: 16, right: 336, bottom: 154, width: 320, height: 64, toJSON: () => ({}) })

    fireEvent.pointerDown(handle, { pointerId: 9, clientX: 24, clientY: 110 })

    expect(row).toHaveClass('sortable-drag-placeholder')
    expect(document.querySelector('.sortable-drag-preview')).toHaveTextContent('血红蛋白')
    fireEvent.pointerUp(window, { pointerId: 9, clientX: 24, clientY: 110 })
    expect(document.querySelector('.sortable-drag-preview')).not.toBeInTheDocument()
  })
})
