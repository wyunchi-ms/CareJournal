import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { RecordsPage } from '../pages/RecordsPage'
import type { ExamRecord } from '../types'

const { deleteRecordMock, saveRecordMock } = vi.hoisted(() => ({ deleteRecordMock: vi.fn(async () => undefined), saveRecordMock: vi.fn(async (record: ExamRecord) => { void record }) }))
const rerecognizeRecordMock = vi.fn(async (id: string) => ({
  ...record(id, '实验室检验'),
  summary: '重新识别后的结论',
  images: records[0].images,
}))

const record = (id: string, reportType: string): ExamRecord => ({
  id,
  reportType,
  examDate: '2026-07-21',
  hospital: '测试医院',
  summary: id === '1' ? '测试报告结论' : undefined,
  indicators: id === '1' ? [{
    id: 'indicator-1',
    rawName: '白细胞',
    normalizedCode: 'WBC',
    normalizedName: '白细胞计数',
    value: 4.2,
    rawValue: '4.2 ↓ g/L',
    unit: 'g/L',
    referenceLow: 5,
    referenceHigh: 10,
    referenceText: '5–10',
    abnormalFlag: 'low',
  }] : [],
  images: id === '1' ? [
    { id: 'image-1', name: '报告.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', sha256: 'image-1' },
    { id: 'pdf-1', name: '报告.pdf', mimeType: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0xLjQ=', sha256: 'pdf-1' },
  ] : [],
  linkedEventIds: [],
  fingerprint: id,
  ocrStatus: 'completed',
  ocrAttempts: 1,
  createdAt: '2026-07-21T00:00:00.000Z',
  updatedAt: '2026-07-21T00:00:00.000Z',
})

const records = [
  record('1', '实验室检验'),
  record('2', '实验室检验报告'),
  { ...record('3', 'MRI'), examDate: '2026-06-12' },
  { ...record('4', 'CT'), examDate: '2025-12-30' },
]

vi.mock('../store/AppContext', () => ({
  useApp: () => ({
    ready: true,
    storageError: null,
    ocrQueueStats: { queued: 0, processing: 0, completed: 0, failed: 0, progress: 0 },
    events: [],
    records,
    deleteRecord: deleteRecordMock,
    saveRecord: saveRecordMock,
    rerecognizeRecord: rerecognizeRecordMock,
    vocabulary: { hospitals: ['测试医院', '历史医院'], departments: ['肿瘤科'] },
  }),
}))

describe('record type filter', () => {
  beforeEach(() => { deleteRecordMock.mockClear(); saveRecordMock.mockClear(); rerecognizeRecordMock.mockClear() })

  it('groups aliases and allows selecting multiple normalized types', () => {
    render(<MemoryRouter><RecordsPage /></MemoryRouter>)

    const importLink = screen.getByRole('link', { name: '导入报告' })
    expect(importLink).toHaveAttribute('href', '/import')
    expect(importLink).toHaveClass('icon-button')
    expect(document.querySelector('.records-toolbar')).toContainElement(importLink)
    expect(within(importLink).queryByText('导入报告')).not.toBeInTheDocument()
    const filterButton = screen.getByRole('button', { name: /检查类型：全部类型/ })
    expect(filterButton.querySelector('.choice-picker-summary')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: '只看异常' })).not.toBeInTheDocument()
    expect(document.querySelector('.records-grid')).not.toBeInTheDocument()
    expect(document.querySelector('.page-header .eyebrow')).not.toBeInTheDocument()

    fireEvent.click(filterButton)
    const laboratory = screen.getByRole('checkbox', { name: /实验室检查.*2 份记录/ })
    const mri = screen.getByRole('checkbox', { name: /磁共振（MRI）.*1 份记录/ })

    fireEvent.click(laboratory)
    fireEvent.click(mri)
    expect(laboratory).toHaveAttribute('aria-checked', 'true')
    expect(mri).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    expect(screen.getByRole('button', { name: /已选 2 类/ })).toBeInTheDocument()
    expect(screen.getByText('显示 3 条')).toBeInTheDocument()
    expect(screen.queryByText('CT', { selector: '.record-main strong' })).not.toBeInTheDocument()
  })

  it('groups records by year, month and day and exposes a date fast scroller', () => {
    const { container } = render(<MemoryRouter><RecordsPage /></MemoryRouter>)
    const page = within(container)

    expect(page.getByText('2026年7月21日')).toBeInTheDocument()
    expect(page.getByText('2026年6月12日')).toBeInTheDocument()
    expect(page.getByText('2025年12月30日')).toBeInTheDocument()
    const scroller = page.getByRole('slider', { name: '按日期快速滑动' })
    expect(scroller).toHaveAttribute('aria-valuemax', '3')
    fireEvent.keyDown(scroller, { key: 'End' })
    expect(scroller).toHaveAttribute('aria-valuetext', '2025-12-30')
    expect(page.getByText('2025/12/30')).toBeInTheDocument()
  })

  it('uses the simplified table, previews images, and confirms deletion twice', async () => {
    render(<MemoryRouter><RecordsPage /></MemoryRouter>)
    fireEvent.click(document.querySelector('.record-row')!)

    expect(screen.queryByText('OCR')).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: '状态' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '关闭' })).toHaveLength(1)
    const editButton = screen.getByRole('button', { name: '编辑报告' })
    expect(editButton).toHaveClass('icon-button')
    expect(within(editButton).queryByText('编辑报告')).not.toBeInTheDocument()
    expect(document.querySelector('.record-section-heading')).toContainElement(editButton)
    const detailActions = document.querySelector('.record-detail-actions')!
    expect(detailActions).toContainElement(screen.getByRole('button', { name: '删除记录' }))
    expect(detailActions).toContainElement(screen.getByRole('button', { name: '重新识别' }))

    const indicatorRow = screen.getByRole('row', { name: /白细胞计数，偏低/ })
    const cells = within(indicatorRow).getAllByRole('cell')
    expect(indicatorRow).toHaveClass('low')
    expect(cells[0]).toHaveTextContent(/^白细胞计数（g\/L）$/)
    expect(cells[0]).not.toHaveTextContent('白细胞白细胞计数')
    expect(cells[1]).toHaveTextContent(/^4.2偏低$/)
    expect(cells[1]).not.toHaveTextContent('↓')
    expect(cells[1]).not.toHaveTextContent('g/L')

    fireEvent.click(screen.getByRole('button', { name: /放大预览/ }))
    expect(screen.getByRole('dialog', { name: '图片预览' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '关闭图片预览' }))

    fireEvent.click(screen.getByRole('button', { name: '预览 PDF：报告.pdf' }))
    expect(screen.getByRole('dialog', { name: 'PDF 预览' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '关闭 PDF 预览' }))

    fireEvent.click(screen.getByRole('button', { name: '删除记录' }))
    expect(deleteRecordMock).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: '删除检查记录' })).toHaveClass('bottom-sheet')
    expect(screen.getByText('确定删除这份记录吗？')).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('dialog', { name: '删除检查记录' })).getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '删除检查记录' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '删除记录' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '删除检查记录' })).getByRole('button', { name: '确认删除' }))
    expect(deleteRecordMock).toHaveBeenCalledWith('1')
  })

  it('opens a requested record detail from the route query', () => {
    render(<MemoryRouter initialEntries={['/records?recordId=1']}><RecordsPage /></MemoryRouter>)

    expect(screen.getByRole('dialog', { name: '实验室检查' })).toBeInTheDocument()
    expect(screen.getByText('测试报告结论')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(screen.queryByRole('dialog', { name: '实验室检查' })).not.toBeInTheDocument()
  })

  it('returns to the route that opened a linked examination detail', () => {
    render(
      <MemoryRouter
        initialEntries={[
          '/calendar',
          { pathname: '/records', search: '?recordId=1', state: { recordDetailOrigin: '/calendar' } },
        ]}
        initialIndex={1}
      >
        <Routes>
          <Route path="/calendar" element={<h1>病程页面</h1>} />
          <Route path="/records" element={<RecordsPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('dialog', { name: '实验室检查' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(screen.getByRole('heading', { name: '病程页面' })).toBeInTheDocument()
  })

  it('re-recognizes the current report and replaces the visible detail', async () => {
    render(<MemoryRouter><RecordsPage /></MemoryRouter>)
    fireEvent.click(document.querySelector('.record-row')!)
    fireEvent.click(screen.getByRole('button', { name: '重新识别' }))

    await waitFor(() => expect(rerecognizeRecordMock).toHaveBeenCalledWith('1'))
    expect(screen.getByText('重新识别后的结论')).toBeInTheDocument()
  })

  it('closes report detail on a left-to-right swipe', () => {
    render(<MemoryRouter><RecordsPage /></MemoryRouter>)
    fireEvent.click(document.querySelector('.record-row')!)
    const detail = screen.getByRole('dialog', { name: '实验室检查' })

    fireEvent.touchStart(detail, { touches: [{ clientX: 20, clientY: 220 }] })
    fireEvent.touchEnd(detail, { changedTouches: [{ clientX: 150, clientY: 225 }] })

    expect(screen.queryByRole('dialog', { name: '实验室检查' })).not.toBeInTheDocument()
  })

  it('edits report details and indicators', async () => {
    render(<MemoryRouter><RecordsPage /></MemoryRouter>)
    fireEvent.click(document.querySelector('.record-row')!)
    fireEvent.click(screen.getByRole('button', { name: '编辑报告' }))

    expect(screen.getByRole('dialog', { name: '编辑检查报告' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('医院原报告名称'), { target: { value: '血常规报告' } })
    fireEvent.change(screen.getByLabelText('医院'), { target: { value: '历史医院' } })
    fireEvent.change(screen.getByLabelText('结果（数值或文字）'), { target: { value: '5.6' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    await vi.waitFor(() => expect(saveRecordMock).toHaveBeenCalledTimes(1))
    expect(saveRecordMock.mock.calls[0][0]).toMatchObject({ reportType: '血常规报告', hospital: '历史医院' })
    expect(saveRecordMock.mock.calls[0][0].indicators[0]).toMatchObject({ rawValue: '5.6', value: 5.6 })
    expect(screen.getByRole('button', { name: '编辑报告' })).toBeInTheDocument()
  })

  it('moves import out of the main navigation and keeps it on the records page', () => {
    render(<MemoryRouter initialEntries={['/records']}><App /></MemoryRouter>)
    const navigation = screen.getByRole('navigation', { name: '主导航' })
    const links = within(navigation).getAllByRole('link')
    expect(links).toHaveLength(6)
    expect(links.map((link) => link.textContent)).toEqual(['方案', '检查', '病程', '图表', '报销', '设置'])
    expect(within(navigation).getByRole('link', { name: '方案' })).toHaveAttribute('href', '/chemotherapy-templates')
    expect(within(navigation).getByRole('link', { name: '检查' })).toHaveClass('active')
    expect(within(navigation).queryByRole('link', { name: '导入' })).not.toBeInTheDocument()
    expect(screen.getByRole('main').querySelector('a[href="/import"]')).toBeInTheDocument()
  })

  it('animates bottom navigation according to page order', () => {
    const { container } = render(<MemoryRouter initialEntries={['/records']}><App /></MemoryRouter>)
    const navigation = within(container).getByRole('navigation', { name: '主导航' })
    const main = within(container).getByRole('main')
    const selection = navigation.querySelector('.nav-selection')

    expect(selection).toHaveClass('nav-selection-1')
    fireEvent.click(within(navigation).getByRole('link', { name: '病程' }))
    expect(main.querySelector('.page-transition')).toHaveClass('page-transition-forward')
    expect(selection).toHaveClass('nav-selection-2')

    fireEvent.click(within(navigation).getByRole('link', { name: '检查' }))
    expect(main.querySelector('.page-transition')).toHaveClass('page-transition-backward')
    expect(selection).toHaveClass('nav-selection-1')
    expect(navigation.querySelectorAll('.nav-item.active')).toHaveLength(1)

    fireEvent.click(within(navigation).getByRole('link', { name: '方案' }))
    expect(main.querySelector('.page-transition')).toHaveClass('page-transition-backward')
    expect(selection).toHaveClass('nav-selection-0')
  })
})
