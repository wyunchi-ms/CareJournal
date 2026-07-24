import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CalendarPage } from '../pages/CalendarPage'
import type { TreatmentEvent } from '../types'

const saveEvents = vi.fn(async () => undefined)
const saveEvent = vi.fn(async () => undefined)
const currentDate = new Date().toISOString().slice(0, 10)

const event = (id: string, type: TreatmentEvent['type']): TreatmentEvent => ({
  id,
  type,
  title: `${type}-${id}`,
  startDate: '2026-07-22',
  endDate: '2026-07-22',
  allDay: true,
  tags: [],
  linkedRecordIds: [],
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
})

vi.mock('../store/AppContext', () => ({
  useApp: () => ({
    events: [
      event('1', 'chemotherapy'),
      event('2', 'chemotherapy'),
      event('3', 'surgery'),
      { ...event('linked-exam', 'examination'), startDate: currentDate, endDate: currentDate, linkedRecordIds: ['record-1'] },
    ],
    chemotherapyTemplates: [{
      id: 'template-1',
      templateType: 'chemotherapy',
      name: '21 天测试方案',
      cycleLengthDays: 21,
      administrationDays: [1, 8],
      defaultCycleCount: 2,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    }, {
      id: 'template-2',
      templateType: 'radiotherapy',
      name: '放疗模板',
      cycleLengthDays: 7,
      administrationDays: [1, 2, 3, 4, 5],
      defaultCycleCount: 1,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    }],
    vocabulary: { hospitals: [], departments: [] },
    saveEvent,
    saveEvents,
  }),
}))

function RecordsDestination() {
  const location = useLocation()
  return <div data-testid="records-destination">{location.search} {JSON.stringify(location.state)}</div>
}

afterEach(() => {
  cleanup()
  saveEvents.mockClear()
  saveEvent.mockClear()
})

describe('calendar event filter', () => {
  it('shows the total count for every event type', () => {
    render(<MemoryRouter><CalendarPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /事件筛选：全部事件/ }))

    const chemotherapy = screen.getByRole('checkbox', { name: /化疗/ })
    const surgery = screen.getByRole('checkbox', { name: /手术/ })
    expect(within(chemotherapy).getByLabelText('2 个事件')).toHaveTextContent('2')
    expect(within(surgery).getByLabelText('1 个事件')).toHaveTextContent('1')
    expect(within(screen.getByRole('checkbox', { name: /放疗/ })).getByLabelText('0 个事件')).toHaveTextContent('0')
    fireEvent.click(chemotherapy)
    fireEvent.click(surgery)
    expect(chemotherapy).toHaveAttribute('aria-checked', 'true')
    expect(surgery).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    expect(screen.getByRole('button', { name: /已选 2 类/ })).toBeInTheDocument()
  })

  it('opens the linked examination record from the agenda', () => {
    render(<MemoryRouter initialEntries={['/calendar']}>
      <Routes>
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/records" element={<RecordsDestination />} />
      </Routes>
    </MemoryRouter>)

    fireEvent.click(within(screen.getByRole('region', { name: '选中日期的事件' }))
      .getByRole('button', { name: /examination-linked-exam/ }))

    expect(screen.getByTestId('records-destination')).toHaveTextContent('?recordId=record-1')
    expect(screen.getByTestId('records-destination')).toHaveTextContent('"recordDetailOrigin":"/calendar"')
  })

  it('keeps calendar controls in the calendar card and places the agenda below it', () => {
    render(<MemoryRouter><CalendarPage /></MemoryRouter>)
    const calendar = screen.getByRole('region', { name: '月历' })
    const toolbar = calendar.querySelector('.calendar-toolbar')!
    const filterButton = screen.getByRole('button', { name: /事件筛选：全部事件/ })
    const createButton = screen.getByRole('button', { name: '新建事件' })
    const agenda = screen.getByRole('region', { name: '选中日期的事件' })

    expect(toolbar).toContainElement(screen.getByRole('button', { name: '上个月' }))
    expect(toolbar).toContainElement(filterButton)
    expect(toolbar).toContainElement(createButton)
    expect(within(calendar).queryByRole('button', { name: '管理化疗方案' })).not.toBeInTheDocument()
    expect(filterButton.querySelector('.choice-picker-summary')).not.toBeInTheDocument()
    expect(within(createButton).queryByText('新建事件')).not.toBeInTheDocument()
    expect(calendar.compareDocumentPosition(agenda) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('switches months on a deliberate horizontal swipe without hijacking vertical scrolling', () => {
    render(<MemoryRouter><CalendarPage /></MemoryRouter>)
    const calendar = screen.getByRole('region', { name: '月历' })
    const getMonthLabel = () => calendar.querySelector('.calendar-month-label')!
    const initialMonth = getMonthLabel().textContent

    fireEvent.touchStart(calendar, { touches: [{ clientX: 280, clientY: 180 }] })
    fireEvent.touchEnd(calendar, { changedTouches: [{ clientX: 120, clientY: 188 }] })
    expect(getMonthLabel().textContent).not.toBe(initialMonth)
    expect(calendar.querySelector('.month-grid')).toHaveClass('calendar-slide-next')

    fireEvent.touchStart(calendar, { touches: [{ clientX: 120, clientY: 180 }] })
    fireEvent.touchEnd(calendar, { changedTouches: [{ clientX: 280, clientY: 188 }] })
    expect(getMonthLabel()).toHaveTextContent(initialMonth!)
    expect(calendar.querySelector('.month-grid')).toHaveClass('calendar-slide-previous')

    fireEvent.touchStart(calendar, { touches: [{ clientX: 180, clientY: 120 }] })
    fireEvent.touchEnd(calendar, { changedTouches: [{ clientX: 190, clientY: 260 }] })
    expect(getMonthLabel()).toHaveTextContent(initialMonth!)
  })

  it('creates all cycle administration events from a chemotherapy template', async () => {
    render(<MemoryRouter><CalendarPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '新建事件' }))

    expect(screen.getByRole('button', { name: /创建方式：按模板创建/ })).toBeInTheDocument()
    expect(screen.getByText('将创建 4 个给药事件')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /化疗模板：21 天测试方案/ }))
    expect(screen.queryByRole('radio', { name: /放疗模板/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /21 天测试方案/ }))
    fireEvent.click(screen.getByRole('button', { name: '创建周期事件' }))

    expect(saveEvents).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ cycleNumber: 1, administrationDay: 1 }),
      expect.objectContaining({ cycleNumber: 1, administrationDay: 8 }),
      expect.objectContaining({ cycleNumber: 2, administrationDay: 1 }),
      expect.objectContaining({ cycleNumber: 2, administrationDay: 8 }),
    ]))
  })

  it('selects a matching treatment plan template while keeping free text input', async () => {
    render(<MemoryRouter><CalendarPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '新建事件' }))
    fireEvent.click(screen.getByRole('button', { name: /创建方式：按模板创建/ }))
    fireEvent.click(screen.getByRole('radio', { name: /单次记录/ }))

    const regimenInput = screen.getByRole('combobox', { name: '治疗方案' })
    fireEvent.focus(regimenInput)
    expect(screen.getByRole('listbox', { name: '治疗方案模板' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /21 天测试方案.*化疗.*21 天一周期/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /放疗模板/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: /21 天测试方案/ }))
    expect(regimenInput).toHaveValue('21 天测试方案')

    fireEvent.change(regimenInput, { target: { value: '医生临时调整方案' } })
    fireEvent.change(screen.getByRole('textbox', { name: '标题' }), { target: { value: '单次化疗' } })
    fireEvent.click(screen.getByRole('button', { name: '保存事件' }))
    await waitFor(() => expect(saveEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'chemotherapy',
      regimen: '医生临时调整方案',
    })))
  })

  it('shows radiotherapy plans only for a radiotherapy event', () => {
    render(<MemoryRouter><CalendarPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '新建事件' }))
    fireEvent.click(screen.getByRole('button', { name: /事件类型：化疗/ }))
    fireEvent.click(screen.getByRole('radio', { name: '放疗' }))

    const regimenInput = screen.getByRole('combobox', { name: '治疗方案' })
    fireEvent.focus(regimenInput)
    expect(screen.getByRole('option', { name: /放疗模板.*放疗.*7 天一周期/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /21 天测试方案/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: /放疗模板/ }))
    expect(regimenInput).toHaveValue('放疗模板')
  })
})
