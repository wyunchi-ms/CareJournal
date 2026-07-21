import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RecordsPage } from '../pages/RecordsPage'
import type { ExamRecord } from '../types'

const { deleteRecordMock } = vi.hoisted(() => ({ deleteRecordMock: vi.fn(async () => undefined) }))

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
  images: id === '1' ? [{ id: 'image-1', name: '报告.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', sha256: 'image-1' }] : [],
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
  record('3', 'MRI'),
  record('4', 'CT'),
]

vi.mock('../store/AppContext', () => ({
  useApp: () => ({ records, deleteRecord: deleteRecordMock }),
}))

describe('record type filter', () => {
  beforeEach(() => deleteRecordMock.mockClear())

  it('groups aliases and allows selecting multiple normalized types', () => {
    render(<MemoryRouter><RecordsPage /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: /全部类型/ }))
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

  it('uses the simplified table, previews images, and confirms deletion twice', async () => {
    render(<MemoryRouter><RecordsPage /></MemoryRouter>)
    fireEvent.click(document.querySelector('.record-row')!)

    expect(screen.queryByText('OCR')).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: '状态' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '关闭' })).toHaveLength(1)

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

    fireEvent.click(screen.getByRole('button', { name: '删除记录' }))
    expect(deleteRecordMock).not.toHaveBeenCalled()
    expect(screen.getByText('确认删除这份记录？')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByText('确认删除这份记录？')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '删除记录' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    expect(deleteRecordMock).toHaveBeenCalledWith('1')
  })

  it('closes report detail on a left-to-right swipe', () => {
    render(<MemoryRouter><RecordsPage /></MemoryRouter>)
    fireEvent.click(document.querySelector('.record-row')!)
    const detail = screen.getByRole('dialog', { name: '实验室检查' })

    fireEvent.touchStart(detail, { touches: [{ clientX: 20, clientY: 220 }] })
    fireEvent.touchEnd(detail, { changedTouches: [{ clientX: 150, clientY: 225 }] })

    expect(screen.queryByRole('dialog', { name: '实验室检查' })).not.toBeInTheDocument()
  })
})
