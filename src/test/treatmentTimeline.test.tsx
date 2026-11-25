import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TreatmentTimelinePage } from '../pages/TreatmentTimelinePage'
import { buildTreatmentTimeline } from '../services/treatmentTimeline'
import type { TreatmentEvent } from '../types'

function event(id: string, type: TreatmentEvent['type'], date: string, extra?: Partial<TreatmentEvent>): TreatmentEvent {
  return {
    id, type, title: id, startDate: date, endDate: date, allDay: true,
    tags: [], linkedRecordIds: [], createdAt: '', updatedAt: '', ...extra,
  }
}

const chemo = { chemotherapyCourseId: 'course-a', chemotherapyCycleId: 'cycle-1', cycleNumber: 1, regimen: '测试方案' }
const events = [
  event('化疗 D8', 'chemotherapy', '2026-10-28', { ...chemo, administrationDay: 8, plannedStartDate: '2026-10-27' }),
  event('化疗 D1', 'chemotherapy', '2026-10-21', { ...chemo, administrationDay: 1 }),
  event('放疗 D1', 'radiotherapy', '2026-10-25', { chemotherapyCycleId: 'rt-1', cycleNumber: 1 }),
  event('手动化疗', 'chemotherapy', '2026-10-11', { cycleNumber: 1, regimen: '测试方案' }),
  event('检查记录', 'examination', '2026-10-29'),
]
const crossYearEvent = event('跨年维持治疗', 'maintenance', '2025-12-31', { endDate: '2026-01-02' })

vi.mock('../store/AppContext', () => ({
  useApp: () => ({ events: [...events, crossYearEvent], preferences: { locale: { language: 'zh-CN' } } }),
}))

afterEach(cleanup)

describe('treatment timeline', () => {
  it('uses recorded treatment dates, not the original plan, and does not infer a cycle for manual events', () => {
    const stages = buildTreatmentTimeline([...events,
      event('另一疗程 D1', 'chemotherapy', '2026-11-03', { ...chemo, chemotherapyCourseId: 'course-b' }),
    ])
    expect(stages).toHaveLength(4)
    const cycle = stages.find((stage) => stage.events.length === 2)
    expect(cycle).toMatchObject({ startDate: '2026-10-21', endDate: '2026-10-28', cycleNumber: 1 })
    expect(cycle?.events.map((item) => item.title)).toEqual(['化疗 D1', '化疗 D8'])
    expect(stages.find((stage) => stage.title === '手动化疗')?.cycleNumber).toBeUndefined()
  })

  it('merges daily radiotherapy over a weekend, but separates a different site, a break, or an explicit course', () => {
    const chest = { radiotherapySite: '胸部' }
    const stages = buildTreatmentTimeline([
      event('monday', 'radiotherapy', '2026-10-26', chest),
      event('friday', 'radiotherapy', '2026-10-23', chest),
      event('thursday', 'radiotherapy', '2026-10-22', chest),
      event('other-site', 'radiotherapy', '2026-10-26', { radiotherapySite: '头部' }),
      event('after-break', 'radiotherapy', '2026-10-29', chest),
      event('course', 'radiotherapy', '2026-10-27', { ...chest, chemotherapyCycleId: 'rt-2', cycleNumber: 2 }),
    ])
    expect(stages).toHaveLength(4)
    expect(stages[0]).toMatchObject({ startDate: '2026-10-22', endDate: '2026-10-26' })
    expect(stages[0].events.map((item) => item.id)).toEqual(['thursday', 'friday', 'monday'])
    expect(stages.slice(1).map((stage) => stage.events[0].id)).toEqual(['other-site', 'course', 'after-break'])
  })

  it('always shows a compact oldest-first list and links an expanded event to its exact journal date and ID', () => {
    render(<MemoryRouter initialEntries={['/timeline?order=desc&type=radiotherapy']}><TreatmentTimelinePage /></MemoryRouter>)
    const stages = () => Array.from(screen.getByRole('list', { name: '2026 年' }).children)
    expect(stages()).toHaveLength(3)
    expect(stages()[0]).toHaveTextContent('手动化疗')
    expect(stages()[2]).toHaveTextContent('第 1 疗程 · 放疗')
    expect(screen.queryByRole('heading', { name: '治疗时间线' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '放疗' })).not.toBeInTheDocument()
    expect(screen.queryByText(/个安排日/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('第 1 周期 · 化疗 · 测试方案'))
    const eventLink = screen.getByRole('link', { name: /化疗 D8/ })
    expect(eventLink).toHaveAttribute('href', `/calendar?${new URLSearchParams({ month: '2026-10', date: '2026-10-28', eventId: '化疗 D8' })}`)
  })

  it('groups entries under ascending years and keeps both years visible on a cross-year range', () => {
    render(<MemoryRouter><TreatmentTimelinePage /></MemoryRouter>)
    expect(screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent)).toEqual(['2025 年', '2026 年'])
    expect(screen.getByRole('list', { name: '2025 年' })).toHaveTextContent('2025年12月31日 – 2026年1月2日')
    expect(screen.getByText('10月21日 – 10月28日')).toBeInTheDocument()
  })
})
