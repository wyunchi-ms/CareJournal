import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChoicePicker } from '../components/ChoicePicker'
import { HistoryCombobox } from '../components/HistoryCombobox'
import { getRecentChoices, RECENT_CHOICE_LIMIT, rememberRecentChoice } from '../services/recentChoices'

describe('unified choice controls', () => {
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('filters and selects historical text while keeping free input available', () => {
    const onChange = vi.fn()
    const { rerender } = render(<HistoryCombobox label="医院" value="" onChange={onChange} options={['协和医院', '人民医院', '协和医院']} />)

    const input = screen.getByRole('combobox', { name: '医院' })
    fireEvent.focus(input)
    expect(screen.getAllByRole('option')).toHaveLength(2)

    fireEvent.change(input, { target: { value: '协和' } })
    expect(onChange).toHaveBeenLastCalledWith('协和')
    rerender(<HistoryCombobox label="医院" value="协和" onChange={onChange} options={['协和医院', '人民医院', '协和医院']} />)
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.click(screen.getByRole('option', { name: '协和医院' }))
    expect(onChange).toHaveBeenLastCalledWith('协和医院')
  })

  it('uses the same picker for single and multiple selections', () => {
    const singleChange = vi.fn()
    const multiChange = vi.fn()
    render(<>
      <ChoicePicker label="事件类型" value="surgery" onChange={singleChange} options={[{ value: 'surgery', label: '手术' }, { value: 'exam', label: '检查' }]} />
      <ChoicePicker label="检查类型" multiple value={['lab']} onChange={multiChange} options={[{ value: 'lab', label: '实验室检查' }, { value: 'mri', label: '磁共振' }]} />
    </>)

    fireEvent.click(screen.getByRole('button', { name: '事件类型：手术' }))
    expect(document.body.style.position).toBe('fixed')
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.click(screen.getByRole('radio', { name: '检查' }))
    expect(singleChange).toHaveBeenCalledWith('exam')
    expect(screen.queryByRole('dialog', { name: '事件类型' })).not.toBeInTheDocument()
    expect(document.body.style.position).toBe('')

    fireEvent.click(screen.getByRole('button', { name: '检查类型：实验室检查' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '磁共振' }))
    expect(multiChange).toHaveBeenCalledWith(['lab', 'mri'])
    expect(screen.getByRole('dialog', { name: '检查类型（可多选）' })).toBeInTheDocument()
    expect(document.documentElement.style.overflow).toBe('hidden')
    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    expect(document.documentElement.style.overflow).toBe('')
  })

  it('moves the most recently selected choices to the front', () => {
    render(<ChoicePicker
      label="排序测试"
      value="first"
      onChange={vi.fn()}
      options={[
        { value: 'first', label: '第一个' },
        { value: 'second', label: '第二个' },
        { value: 'third', label: '第三个' },
      ]}
    />)

    fireEvent.click(screen.getByRole('button', { name: '排序测试：第一个' }))
    fireEvent.click(screen.getByRole('radio', { name: '第三个' }))
    fireEvent.click(screen.getByRole('button', { name: '排序测试：第一个' }))

    expect(screen.getAllByRole('radio').map((option) => option.textContent)).toEqual(['第三个', '第一个', '第二个'])
  })

  it('shares recent text choices across fields with the same history key', () => {
    const firstRender = render(<HistoryCombobox
      label="医院"
      historyKey="hospital"
      value=""
      onChange={vi.fn()}
      options={['协和医院', '人民医院']}
    />)

    fireEvent.focus(screen.getByRole('combobox', { name: '医院' }))
    fireEvent.click(screen.getByRole('option', { name: '人民医院' }))
    firstRender.unmount()

    render(<HistoryCombobox
      label="就诊医院"
      historyKey="hospital"
      value=""
      onChange={vi.fn()}
      options={['协和医院', '人民医院']}
    />)
    fireEvent.focus(screen.getByRole('combobox', { name: '就诊医院' }))

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['人民医院', '协和医院'])
  })

  it('keeps only the five latest distinct values', () => {
    for (let index = 0; index < RECENT_CHOICE_LIMIT + 2; index += 1) {
      rememberRecentChoice('检查类型', `类型 ${index}`)
    }
    rememberRecentChoice('检查类型', '类型 4')

    expect(getRecentChoices('检查类型')).toEqual(['类型 4', '类型 6', '类型 5', '类型 3', '类型 2'])
  })
})
