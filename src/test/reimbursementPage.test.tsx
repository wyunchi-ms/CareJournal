import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReimbursementPage } from '../pages/ReimbursementPage'
import type { ExamRecord, ReimbursementPlan, TreatmentEvent } from '../types'

const event: TreatmentEvent = {
  id: 'event-1',
  type: 'radiotherapy',
  title: '放疗第 1 次',
  startDate: '2026-07-20',
  endDate: '2026-07-20',
  allDay: true,
  hospital: '测试医院',
  tags: [],
  linkedRecordIds: ['record-1'],
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
}

const record: ExamRecord = {
  id: 'record-1',
  reportType: 'CT',
  sampleDate: '2026-07-20',
  hospital: '测试医院',
  indicators: [],
  images: [{ id: 'image-1', name: 'CT报告.jpg', mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,YQ==', sha256: 'image-1' }],
  linkedEventIds: ['event-1'],
  fingerprint: 'record-1',
  ocrStatus: 'completed',
  ocrAttempts: 1,
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
}

const plan: ReimbursementPlan = {
  id: 'plan-1',
  eventId: event.id,
  eventType: event.type,
  eventTitle: event.title,
  eventDate: event.startDate,
  hospital: event.hospital,
  coverage: 'commercial',
  materials: [
    {
      id: 'material-1',
      kind: 'imaging_report',
      label: '影像／内镜检查报告',
      required: false,
      completed: true,
      attachments: [
        { ...record.images[0], id: 'attachment-1', source: 'record', sourceRecordId: record.id, createdAt: '2026-07-20T00:00:00.000Z' },
        { id: 'attachment-pdf', name: '收费票据.pdf', mimeType: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0xLjQ=', sha256: 'attachment-pdf', source: 'upload', createdAt: '2026-07-20T00:00:00.000Z' },
      ],
    },
    {
      id: 'material-2',
      kind: 'invoice',
      label: '医疗收费票据／发票',
      required: true,
      completed: false,
      attachments: [],
    },
  ],
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
}

const saveReimbursementPlan = vi.fn<(plan: ReimbursementPlan) => Promise<void>>(async () => undefined)
const deleteReimbursementPlan = vi.fn<(id: string) => Promise<void>>(async () => undefined)
let mockPlans = [plan]

vi.mock('../store/AppContext', () => ({
  useApp: () => ({
    events: [event],
    records: [record],
    reimbursementPlans: mockPlans,
    saveReimbursementPlan,
    deleteReimbursementPlan,
  }),
}))

describe('ReimbursementPage', () => {
  beforeEach(() => {
    cleanup()
    mockPlans = [plan]
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    saveReimbursementPlan.mockClear()
    deleteReimbursementPlan.mockClear()
  })

  it('shows checklist progress, reused sources and image/PDF/camera inputs', () => {
    render(<MemoryRouter><ReimbursementPage /></MemoryRouter>)

    expect(screen.getByRole('textbox', { name: '搜索报销计划' })).toBeInTheDocument()
    expect(screen.getByText('0/1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /打开报销计划：放疗第 1 次/ }))
    expect(screen.getByText('来自检查记录')).toBeInTheDocument()
    expect(screen.getByText('CT报告.jpg')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '导入图片/PDF' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: '拍照' })).toHaveLength(2)
    expect(document.querySelector<HTMLInputElement>('input[accept="image/*,application/pdf,.pdf"]')).toHaveAttribute('multiple')
    expect(document.querySelector<HTMLInputElement>('input[capture="environment"]')).toHaveAttribute('accept', 'image/*')
  })

  it('filters reimbursement plans from the compact toolbar', () => {
    render(<MemoryRouter><ReimbursementPage /></MemoryRouter>)

    fireEvent.change(screen.getByRole('textbox', { name: '搜索报销计划' }), { target: { value: '不存在的医院' } })
    expect(screen.queryByRole('button', { name: /打开报销计划：放疗第 1 次/ })).not.toBeInTheDocument()
    expect(screen.getByText('没有符合条件的报销计划')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: '搜索报销计划' }), { target: { value: '测试医院' } })
    expect(screen.getByRole('button', { name: /打开报销计划：放疗第 1 次/ })).toBeInTheDocument()
  })

  it('filters by reimbursement type and gives each type a stable tag tone', () => {
    mockPlans = [
      plan,
      {
        ...plan,
        id: 'plan-public',
        eventTitle: '医保计划',
        coverage: 'public_medical',
      },
    ]
    render(<MemoryRouter><ReimbursementPage /></MemoryRouter>)

    expect(screen.getByText('商业保险').closest('.coverage-badge')).toHaveAttribute('data-coverage', 'commercial')
    expect(screen.getByText('基本医保').closest('.coverage-badge')).toHaveAttribute('data-coverage', 'public_medical')
    fireEvent.click(screen.getByRole('button', { name: '报销类型：全部类型' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /商业保险/ }))
    fireEvent.click(screen.getByRole('button', { name: '完成' }))

    expect(screen.getByRole('button', { name: /打开报销计划：放疗第 1 次/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /打开报销计划：医保计划/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '移除筛选：商业保险' })).toHaveAttribute('data-coverage', 'commercial')
  })

  it('shows only the empty-state creation action when there are no plans', () => {
    mockPlans = []
    render(<MemoryRouter><ReimbursementPage /></MemoryRouter>)

    expect(screen.queryByRole('button', { name: '新建报销计划' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '创建第一个计划' })).toBeInTheDocument()
  })

  it('previews reimbursement images when their thumbnail is clicked', () => {
    render(<MemoryRouter><ReimbursementPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /打开报销计划：放疗第 1 次/ }))

    fireEvent.click(screen.getByRole('button', { name: '放大预览：报销材料：CT报告.jpg' }))

    expect(screen.getByRole('dialog', { name: '图片预览' })).toBeInTheDocument()
  })

  it('previews reimbursement PDFs inside the app', () => {
    render(<MemoryRouter><ReimbursementPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /打开报销计划：放疗第 1 次/ }))

    fireEvent.click(screen.getByRole('button', { name: '预览 PDF：收费票据.pdf' }))

    expect(screen.getByRole('dialog', { name: 'PDF 预览' })).toBeInTheDocument()
  })

  it('enters batch selection on long press and keeps it hidden by default', () => {
    vi.useFakeTimers()
    render(<MemoryRouter><ReimbursementPage /></MemoryRouter>)
    const planButton = screen.getByRole('button', { name: /打开报销计划：放疗第 1 次/ })

    expect(screen.queryByRole('region', { name: '批量导出' })).not.toBeInTheDocument()
    fireEvent.pointerDown(planButton, { pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 200 })
    act(() => vi.advanceTimersByTime(550))

    expect(screen.getByRole('region', { name: '批量导出' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '选择导出：放疗第 1 次' })).toBeChecked()
  })

  it('treats an unmarked plan as pending and marks it reimbursed on the first swipe action', () => {
    render(<MemoryRouter><ReimbursementPage /></MemoryRouter>)
    const planButton = screen.getByRole('button', { name: /打开报销计划：放疗第 1 次/ })
    fireEvent.keyDown(planButton, { key: 'ArrowLeft' })

    expect(planButton.closest('.reimbursement-plan-card')).not.toHaveClass('status-pending')
    expect(within(planButton.closest('.reimbursement-plan-card') as HTMLElement).queryByText('待报销')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '标记已报销：放疗第 1 次' }))

    expect(saveReimbursementPlan).toHaveBeenCalledOnce()
    expect(saveReimbursementPlan.mock.calls[0][0]).toMatchObject({
      id: 'plan-1',
      reimbursementStatus: 'reimbursed',
      reimbursedAt: expect.any(String),
    })
  })

  it('keeps pending reimbursement visually neutral and advances it to reimbursed', () => {
    mockPlans = [{ ...plan, reimbursementStatus: 'pending' }]
    render(<MemoryRouter><ReimbursementPage /></MemoryRouter>)
    const planButton = screen.getByRole('button', { name: /打开报销计划：放疗第 1 次/ })
    const card = planButton.closest('.reimbursement-plan-card')

    expect(card).not.toHaveClass('status-pending')
    expect(within(card as HTMLElement).queryByText('待报销')).not.toBeInTheDocument()
    expect(card?.querySelector('.reimbursement-plan-icon')).not.toBeInTheDocument()

    fireEvent.keyDown(planButton, { key: 'ArrowLeft' })
    fireEvent.click(screen.getByRole('button', { name: '标记已报销：放疗第 1 次' }))

    expect(saveReimbursementPlan.mock.calls[0][0]).toMatchObject({
      reimbursementStatus: 'reimbursed',
      reimbursedAt: expect.any(String),
    })
  })

  it('keeps legacy reimbursedAt data compatible and can move it back to pending', () => {
    mockPlans = [{ ...plan, reimbursedAt: '2026-07-25T00:00:00.000Z' }]
    render(<MemoryRouter><ReimbursementPage /></MemoryRouter>)
    const planButton = screen.getByRole('button', { name: /打开报销计划：放疗第 1 次/ })

    expect(planButton.closest('.reimbursement-plan-card')).toHaveClass('status-reimbursed')
    expect(screen.getByText('已报销')).toHaveClass('reimbursement-status-badge', 'reimbursed')

    fireEvent.keyDown(planButton, { key: 'ArrowLeft' })
    fireEvent.click(screen.getByRole('button', { name: '改为待报销：放疗第 1 次' }))

    expect(saveReimbursementPlan.mock.calls[0][0]).toMatchObject({
      reimbursementStatus: 'pending',
      reimbursedAt: undefined,
    })
  })

  it('reveals plan actions after swiping the list item left', () => {
    render(<MemoryRouter><ReimbursementPage /></MemoryRouter>)
    const planButton = screen.getByRole('button', { name: /打开报销计划：放疗第 1 次/ })

    fireEvent.pointerDown(planButton, { pointerId: 1, pointerType: 'touch', clientX: 280, clientY: 200 })
    fireEvent.pointerMove(planButton, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 202 })
    fireEvent.pointerUp(planButton, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 202 })

    expect(planButton.closest('.swipeable-list-item')).toHaveClass('revealed')
    expect(screen.getByRole('button', { name: '标记已报销：放疗第 1 次' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('button', { name: '删除报销计划：放疗第 1 次' })).toHaveAttribute('tabindex', '0')
  })

  it('uses a bottom sheet before deleting a plan', () => {
    render(<MemoryRouter><ReimbursementPage /></MemoryRouter>)
    fireEvent.keyDown(screen.getByRole('button', { name: /打开报销计划：放疗第 1 次/ }), { key: 'ArrowLeft' })

    fireEvent.click(screen.getByRole('button', { name: '删除报销计划：放疗第 1 次' }))
    const sheet = screen.getByRole('dialog', { name: '删除报销计划' })
    expect(sheet).toHaveClass('bottom-sheet')
    expect(within(sheet).getByText('确定删除这个报销计划吗？')).toBeInTheDocument()
    expect(deleteReimbursementPlan).not.toHaveBeenCalled()
  })
})
