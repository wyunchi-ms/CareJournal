import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IndicatorPicker } from '../components/IndicatorPicker'

const options = [
  { code: 'WBC', name: '白细胞计数', unit: '10^9/L', count: 12 },
  { code: 'HGB', name: '血红蛋白', unit: 'g/L', count: 8 },
  { code: 'PLT', name: '血小板计数', unit: '10^9/L', count: 10 },
]

afterEach(cleanup)

describe('indicator picker', () => {
  it('is single-select and exposes occurrence counts and indicator pinning', () => {
    const onChange = vi.fn()
    const onPinnedChange = vi.fn()
    render(<IndicatorPicker options={options} value="WBC" pinnedCodes={[]} onChange={onChange} onPinnedChange={onPinnedChange} onOrderChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '检查指标：白细胞计数' }))

    expect(screen.getByRole('dialog', { name: '检查指标（单选）' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getAllByText('10^9/L · 出现 12 次')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '置顶：血红蛋白' }))
    expect(onPinnedChange).toHaveBeenCalledWith(['HGB'])
    fireEvent.click(screen.getByRole('radio', { name: /血红蛋白/ }))
    expect(onChange).toHaveBeenCalledWith('HGB')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('supports keyboard reordering inside the same priority group', () => {
    const onOrderChange = vi.fn()
    render(<IndicatorPicker options={options} value="WBC" pinnedCodes={[]} onChange={vi.fn()} onPinnedChange={vi.fn()} onOrderChange={onOrderChange} />)
    fireEvent.click(screen.getByRole('button', { name: '检查指标：白细胞计数' }))

    fireEvent.keyDown(screen.getByRole('button', { name: '拖动排序：血红蛋白' }), { key: 'ArrowDown' })

    expect(onOrderChange).toHaveBeenCalledWith(['WBC', 'PLT', 'HGB'], [])
  })
})
