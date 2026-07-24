import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChemotherapyTemplateSection } from '../components/ChemotherapyTemplateSection'
import type { ChemotherapyTemplate } from '../types'

const saveChemotherapyTemplate = vi.fn(async () => undefined)
const reorderChemotherapyTemplates = vi.fn(async () => undefined)
const deleteChemotherapyTemplate = vi.fn(async () => undefined)
let chemotherapyTemplates: ChemotherapyTemplate[] = []

vi.mock('../store/AppContext', () => ({
  useApp: () => ({
    chemotherapyTemplates,
    vocabulary: { hospitals: [], departments: [] },
    saveChemotherapyTemplate,
    reorderChemotherapyTemplates,
    deleteChemotherapyTemplate,
  }),
}))

afterEach(() => {
  cleanup()
  saveChemotherapyTemplate.mockClear()
  reorderChemotherapyTemplates.mockClear()
  deleteChemotherapyTemplate.mockClear()
  chemotherapyTemplates = []
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('chemotherapy template daily medication editor', () => {
  it('creates collapsible consecutive days and copies the previous day medication', () => {
    render(<ChemotherapyTemplateSection />)
    fireEvent.click(screen.getByRole('button', { name: /创建第一个治疗方案/ }))
    fireEvent.change(screen.getByRole('spinbutton', { name: '本周期给药天数' }), { target: { value: '3' } })

    expect(screen.getByRole('textbox', { name: 'D1 第1种药物名称' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'D2 第1种药物名称' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'D3 第1种药物名称' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '收起 D1 每日用药' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: '展开 D2 每日用药' })).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByRole('button', { name: '展开 D3 每日用药' }))
    expect(screen.getByRole('textbox', { name: 'D3 第1种药物名称' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '收起 D3 每日用药' }))
    const detailsButton = screen.getByRole('button', { name: '展开 D1 第1种药物的用法和备注' })
    expect(detailsButton).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(detailsButton)
    expect(screen.getByRole('button', { name: '收起 D1 第1种药物的用法和备注' })).toHaveAttribute('aria-expanded', 'true')

    fireEvent.change(screen.getByRole('textbox', { name: 'D1 第1种药物名称' }), { target: { value: '卡铂' } })
    fireEvent.click(screen.getAllByRole('button', { name: '添加药物' })[0])
    fireEvent.change(screen.getByRole('textbox', { name: 'D1 第2种药物名称' }), { target: { value: '依托泊苷' } })
    fireEvent.click(screen.getByRole('button', { name: '从 D1 复制安排到 D2' }))

    expect(screen.getByRole('button', { name: '收起 D2 每日用药' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('textbox', { name: 'D2 第1种药物名称' })).toHaveValue('卡铂')
    expect(screen.getByRole('textbox', { name: 'D2 第2种药物名称' })).toHaveValue('依托泊苷')
    expect(screen.getByRole('status')).toHaveTextContent('已将 D1 的用药表复制到 D2')
  })

  it('saves medication and dosage independently for every treatment day', async () => {
    render(<ChemotherapyTemplateSection />)
    fireEvent.click(screen.getByRole('button', { name: /创建第一个治疗方案/ }))
    fireEvent.change(screen.getByRole('textbox', { name: '方案名称' }), { target: { value: '三天不同用药方案' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: '本周期给药天数' }), { target: { value: '2' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'D1 第1种药物名称' }), { target: { value: '长春新碱' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'D1 第1种药物剂量' }), { target: { value: '1.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'D1 第1种药物单位：选择单位' }))
    expect(screen.getByRole('radio', { name: /mg\/m².*按体表面积/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /AUC.*目标暴露量/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /mg\/m².*按体表面积/ }))
    fireEvent.click(screen.getByRole('button', { name: '展开 D2 每日用药' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'D2 第1种药物名称' }), { target: { value: '依托泊苷' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'D2 第1种药物用法或给药途径' }), { target: { value: '静滴' } })
    fireEvent.click(screen.getByRole('button', { name: '保存模板' }))

    await waitFor(() => expect(saveChemotherapyTemplate).toHaveBeenCalledWith(expect.objectContaining({
      administrationDays: [1, 2],
      dayPlans: [
        expect.objectContaining({
          day: 1,
          medicationItems: [expect.objectContaining({ name: '长春新碱', dose: '1.5', unit: 'mg/m²' })],
          medications: '长春新碱',
        }),
        expect.objectContaining({
          day: 2,
          medicationItems: [expect.objectContaining({ name: '依托泊苷', administration: '静滴' })],
          medications: '依托泊苷',
        }),
      ],
    })))
  })

  it('creates a radiotherapy plan with daily arrangements instead of medication rows', async () => {
    render(<ChemotherapyTemplateSection />)
    fireEvent.click(screen.getByRole('button', { name: /创建第一个治疗方案/ }))
    fireEvent.click(screen.getByRole('button', { name: '方案类型：化疗' }))
    fireEvent.click(screen.getByRole('radio', { name: /放疗.*维护放疗周期和每日安排/ }))

    expect(screen.getByRole('spinbutton', { name: '本周期治疗天数' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('spinbutton', { name: '本周期治疗天数' }), { target: { value: '2' } })
    expect(screen.queryByRole('textbox', { name: 'D1 第1种药物名称' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '方案名称' }), { target: { value: '盆腔放疗' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'D1 放疗部位' }), { target: { value: '盆腔' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'D1 放疗剂量' }), { target: { value: '2.0' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'D1 当日备注' }), { target: { value: '首次定位复核' } })
    fireEvent.click(screen.getByRole('button', { name: '从 D1 复制安排到 D2' }))
    expect(screen.getByRole('textbox', { name: 'D2 放疗部位' })).toHaveValue('盆腔')
    expect(screen.getByRole('textbox', { name: 'D2 放疗剂量' })).toHaveValue('2.0')
    fireEvent.click(screen.getByRole('button', { name: '保存模板' }))

    await waitFor(() => expect(saveChemotherapyTemplate).toHaveBeenCalledWith(expect.objectContaining({
      templateType: 'radiotherapy',
      name: '盆腔放疗',
      dayPlans: [
        expect.objectContaining({ day: 1, radiotherapySite: '盆腔', radiotherapyDoseGy: '2.0', notes: '首次定位复核', medicationItems: [] }),
        expect.objectContaining({ day: 2, radiotherapySite: '盆腔', radiotherapyDoseGy: '2.0', notes: '首次定位复核', medicationItems: [] }),
      ],
    })))
  })

  it('requires an explicit confirmation before deleting a treatment plan', async () => {
    chemotherapyTemplates = [{
      id: 'template-1',
      templateType: 'maintenance',
      name: '维持方案',
      cycleLengthDays: 28,
      administrationDays: [1],
      dayPlans: [{ id: 'day-1', day: 1, medicationItems: [{ id: 'med-1', name: '维持药' }] }],
      defaultCycleCount: 6,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    }]
    render(<ChemotherapyTemplateSection />)

    expect(screen.getByText('维持治疗')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '删除方案 维持方案' }))
    expect(screen.getByRole('dialog', { name: '确认删除治疗方案' })).toBeInTheDocument()
    expect(deleteChemotherapyTemplate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(deleteChemotherapyTemplate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '删除方案 维持方案' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(deleteChemotherapyTemplate).toHaveBeenCalledWith('template-1'))
  })

  it('opens editing from the treatment plan card without a redundant edit icon', () => {
    chemotherapyTemplates = [{
      id: 'template-edit',
      templateType: 'chemotherapy',
      name: 'ICE',
      cycleLengthDays: 21,
      administrationDays: [1],
      dayPlans: [{ id: 'day-1', day: 1, medicationItems: [{ id: 'med-1', name: '卡铂' }] }],
      defaultCycleCount: 6,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    }]
    render(<ChemotherapyTemplateSection />)

    expect(screen.queryByRole('button', { name: '编辑方案 ICE' })).not.toBeInTheDocument()
    const card = screen.getByText('ICE').closest('article')!
    expect(card.querySelectorAll('.template-row-actions .icon-button')).toHaveLength(2)
    fireEvent.click(screen.getByText('ICE').closest('button')!)
    expect(screen.getByRole('dialog', { name: '编辑治疗方案' })).toBeInTheDocument()
  })

  it('enters reorder mode after a long press and saves the dragged order', async () => {
    vi.useFakeTimers()
    chemotherapyTemplates = [{
      id: 'template-a',
      name: '方案 A',
      cycleLengthDays: 21,
      administrationDays: [1],
      defaultCycleCount: 1,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-02T00:00:00.000Z',
    }, {
      id: 'template-b',
      name: '方案 B',
      cycleLengthDays: 21,
      administrationDays: [1],
      defaultCycleCount: 1,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    }]
    render(<ChemotherapyTemplateSection />)

    const firstPlan = screen.getByText('方案 A').closest('button')!
    fireEvent.pointerDown(firstPlan, { button: 0, clientX: 20, clientY: 20 })
    act(() => vi.advanceTimersByTime(500))
    expect(screen.getByText('调整方案顺序')).toBeInTheDocument()

    fireEvent.keyDown(screen.getByRole('button', { name: '拖动排序 方案 A' }), { key: 'ArrowDown' })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '完成' }))
      await Promise.resolve()
    })
    expect(reorderChemotherapyTemplates).toHaveBeenCalledWith(['template-b', 'template-a'])
  })

  it('lifts the dragged treatment plan into a floating preview and keeps a placeholder', () => {
    vi.useFakeTimers()
    chemotherapyTemplates = [{
      id: 'template-floating',
      templateType: 'radiotherapy',
      name: '浮空方案',
      cycleLengthDays: 14,
      administrationDays: [1, 2],
      dayPlans: [
        { id: 'day-1', day: 1, radiotherapySite: '胸部', radiotherapyDoseGy: '2', medicationItems: [] },
        { id: 'day-2', day: 2, radiotherapySite: '胸部', radiotherapyDoseGy: '2', medicationItems: [] },
      ],
      defaultCycleCount: 1,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    }]
    render(<ChemotherapyTemplateSection />)

    const planButton = screen.getByText('浮空方案').closest('button')!
    fireEvent.pointerDown(planButton, { button: 0, clientX: 20, clientY: 20 })
    act(() => vi.advanceTimersByTime(500))

    const row = screen.getByText('浮空方案').closest('article')!
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
      x: 16,
      y: 90,
      top: 90,
      left: 16,
      right: 336,
      bottom: 158,
      width: 320,
      height: 68,
      toJSON: () => ({}),
    })
    const handle = screen.getByRole('button', { name: '拖动排序 浮空方案' })
    Object.defineProperty(handle, 'setPointerCapture', { configurable: true, value: vi.fn() })
    Object.defineProperty(handle, 'hasPointerCapture', { configurable: true, value: vi.fn(() => false) })
    fireEvent.pointerDown(handle, { pointerId: 7, clientX: 30, clientY: 110 })

    expect(row).toHaveClass('dragging')
    expect(document.querySelector('.template-drag-preview')).toHaveTextContent('浮空方案')
    expect(document.querySelector('.template-drag-preview')).toHaveTextContent('共 2 次放疗')

    fireEvent.pointerUp(window, { pointerId: 7, clientX: 30, clientY: 110 })
    expect(row).not.toHaveClass('dragging')
    expect(document.querySelector('.template-drag-preview')).not.toBeInTheDocument()
  })

  it('reorders smoothly past the dragged placeholder and keeps the preview inside the list', () => {
    vi.useFakeTimers()
    chemotherapyTemplates = ['A', 'B', 'C'].map((name) => ({
      id: `template-${name.toLowerCase()}`,
      name: `方案 ${name}`,
      cycleLengthDays: 21,
      administrationDays: [1],
      defaultCycleCount: 1,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    }))
    let scheduledFrame: FrameRequestCallback | undefined
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      scheduledFrame = callback
      return 1
    })
    render(<ChemotherapyTemplateSection />)

    const firstPlan = screen.getByText('方案 A').closest('button')!
    fireEvent.pointerDown(firstPlan, { button: 0, clientX: 20, clientY: 110 })
    act(() => vi.advanceTimersByTime(500))

    const list = document.querySelector<HTMLElement>('.template-list')!
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({
      x: 16,
      y: 100,
      top: 100,
      left: 16,
      right: 336,
      bottom: 300,
      width: 320,
      height: 200,
      toJSON: () => ({}),
    })
    Array.from(list.querySelectorAll<HTMLElement>('[data-template-id]')).forEach((row) => {
      vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => {
        const index = Array.from(list.querySelectorAll('[data-template-id]')).indexOf(row)
        const top = 100 + index * 70
        return {
          x: 16,
          y: top,
          top,
          left: 16,
          right: 336,
          bottom: top + 60,
          width: 320,
          height: 60,
          toJSON: () => ({}),
        }
      })
    })
    const handle = screen.getByRole('button', { name: '拖动排序 方案 A' })
    Object.defineProperty(handle, 'setPointerCapture', { configurable: true, value: vi.fn() })
    Object.defineProperty(handle, 'hasPointerCapture', { configurable: true, value: vi.fn(() => false) })
    fireEvent.pointerDown(handle, { pointerId: 8, clientX: 30, clientY: 110 })
    fireEvent(handle, new Event('lostpointercapture', { bubbles: true }))
    expect(document.querySelector('.template-drag-preview')).toBeInTheDocument()

    fireEvent.pointerMove(window, { pointerId: 8, clientX: 30, clientY: 220 })
    act(() => scheduledFrame?.(0))
    expect(Array.from(list.querySelectorAll<HTMLElement>('[data-template-id]')).map((row) => row.dataset.templateId))
      .toEqual(['template-b', 'template-a', 'template-c'])

    fireEvent.pointerMove(window, { pointerId: 8, clientX: 30, clientY: 1000 })
    act(() => scheduledFrame?.(16))
    expect(Array.from(list.querySelectorAll<HTMLElement>('[data-template-id]')).map((row) => row.dataset.templateId))
      .toEqual(['template-b', 'template-c', 'template-a'])
    expect(document.querySelector<HTMLElement>('.template-drag-preview-positioner')?.style.transform)
      .toBe('translate3d(0, 138px, 0)')

    fireEvent.pointerMove(window, { pointerId: 8, clientX: 30, clientY: -100 })
    act(() => scheduledFrame?.(32))
    expect(Array.from(list.querySelectorAll<HTMLElement>('[data-template-id]')).map((row) => row.dataset.templateId))
      .toEqual(['template-a', 'template-b', 'template-c'])
    expect(document.querySelector<HTMLElement>('.template-drag-preview-positioner')?.style.transform)
      .toBe('translate3d(0, 2px, 0)')

    fireEvent.pointerUp(window, { pointerId: 8 })
    expect(document.querySelector('.template-drag-preview')).not.toBeInTheDocument()
  })
})
