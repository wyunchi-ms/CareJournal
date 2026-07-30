import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { format, subMonths } from 'date-fns'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CalendarPage } from '../pages/CalendarPage'
import type { TreatmentEvent } from '../types'

const saveEvents = vi.fn(async () => undefined)
const saveEvent = vi.fn(async () => undefined)
const deleteEvent = vi.fn(async () => undefined)
const currentDate = new Date().toISOString().slice(0, 10)
const previousMonthDate = format(subMonths(new Date(), 1), 'yyyy-MM-15')

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
      event('body', 'bodyMeasurement'),
      event('diary', 'treatmentDiary'),
      event('medication', 'medication'),
      { ...event('linked-exam', 'examination'), startDate: currentDate, endDate: currentDate, linkedRecordIds: ['record-1'] },
      { ...event('historic-exam', 'examination'), startDate: previousMonthDate, endDate: previousMonthDate, linkedRecordIds: ['record-2'] },
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
    deleteEvent,
  }),
}))

function RecordsDestination() {
  const location = useLocation()
  const navigate = useNavigate()
  return <div data-testid="records-destination">{location.search} {JSON.stringify(location.state)}<button onClick={() => navigate(-1)}>返回病程</button></div>
}

afterEach(() => {
  cleanup()
  saveEvents.mockClear()
  saveEvent.mockClear()
  deleteEvent.mockClear()
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

  it('shows at most four compact labels and prioritizes distinct event types', () => {
    render(<MemoryRouter><CalendarPage /></MemoryRouter>)
    const eventDay = screen.getByRole('button', { name: '7月22日，6 个事件' })
    const labels = Array.from(eventDay.querySelectorAll('.event-chip')).map((label) => label.textContent)

    expect(labels).toEqual(['化疗', '手术', '身体', '日记'])
    expect(labels).toHaveLength(4)
    expect(eventDay).toHaveAttribute('data-label-count', '4')
    expect(screen.getByRole('button', { name: '7月21日，无事件' })).toHaveAttribute('data-label-count', '0')
  })

  it('keeps selected-day agenda cards to a title and one metadata line', () => {
    render(<MemoryRouter><CalendarPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '7月22日，6 个事件' }))

    const cards = screen.getByRole('region', { name: '选中日期的事件' }).querySelectorAll('.agenda-item')
    expect(cards).toHaveLength(6)
    for (const card of cards) {
      expect(card.querySelectorAll('strong')).toHaveLength(1)
      expect(card.querySelectorAll('small')).toHaveLength(1)
      expect(card.querySelector('.agenda-marker')).toBeInTheDocument()
    }
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

  it('restores the viewed month and selected date after returning from an examination detail', () => {
    render(<MemoryRouter initialEntries={['/calendar']}>
      <Routes>
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/records" element={<RecordsDestination />} />
      </Routes>
    </MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: '上个月' }))
    const calendar = screen.getByRole('region', { name: '月历' })
    const viewedMonth = calendar.querySelector('.calendar-month-label')?.textContent
    const targetDay = Array.from(calendar.querySelectorAll<HTMLButtonElement>('.day-cell:not(.muted)'))
      .find((day) => day.querySelector('.day-number')?.textContent === '15')
    expect(targetDay).toBeDefined()
    fireEvent.click(targetDay!)
    fireEvent.click(within(screen.getByRole('region', { name: '选中日期的事件' }))
      .getByRole('button', { name: /examination-historic-exam/ }))

    expect(screen.getByTestId('records-destination')).toHaveTextContent(`"recordDetailOrigin":"/calendar?month=${previousMonthDate.slice(0, 7)}&date=${previousMonthDate}"`)
    fireEvent.click(screen.getByRole('button', { name: '返回病程' }))

    expect(screen.getByRole('region', { name: '月历' }).querySelector('.calendar-month-label')).toHaveTextContent(viewedMonth!)
    expect(within(screen.getByRole('region', { name: '选中日期的事件' }))
      .getByRole('button', { name: /examination-historic-exam/ })).toBeInTheDocument()
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

  it('defaults chemotherapy creation to one cycle without the event-count preview card', async () => {
    render(<MemoryRouter><CalendarPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '新建事件' }))

    expect(screen.getByRole('button', { name: /创建方式：按模板创建/ })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: '创建周期数' })).toHaveValue(1)
    expect(screen.queryByText(/将创建 \d+ 个给药事件/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /化疗模板：21 天测试方案/ }))
    expect(screen.queryByRole('radio', { name: /放疗模板/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /21 天测试方案/ }))
    expect(screen.getByRole('spinbutton', { name: '创建周期数' })).toHaveValue(1)
    fireEvent.click(screen.getByRole('button', { name: '创建周期事件' }))

    await waitFor(() => expect(saveEvents).toHaveBeenCalled())
    const createdEvents = (saveEvents.mock.calls[0] as unknown as [TreatmentEvent[]])[0]
    expect(createdEvents).toHaveLength(2)
    expect(createdEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ cycleNumber: 1, administrationDay: 1 }),
      expect.objectContaining({ cycleNumber: 1, administrationDay: 8 }),
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

  it('creates a structured body measurement record', async () => {
    render(<MemoryRouter><CalendarPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '新建事件' }))
    fireEvent.click(screen.getByRole('button', { name: /事件类型：化疗/ }))
    fireEvent.click(screen.getByRole('radio', { name: '身体记录' }))

    expect(screen.queryByRole('textbox', { name: '标题' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('spinbutton', { name: '身高（cm）' }), { target: { value: '171.5' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: '体重（kg）' }), { target: { value: '63.2' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: '收缩压（mmHg）' }), { target: { value: '118' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: '舒张压（mmHg）' }), { target: { value: '76' } })
    fireEvent.click(screen.getByRole('button', { name: '保存事件' }))

    await waitFor(() => expect(saveEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'bodyMeasurement',
      title: '身体记录',
      bodyMeasurements: expect.objectContaining({
        heightCm: 171.5,
        weightKg: 63.2,
        systolicBp: 118,
        diastolicBp: 76,
      }),
    })))
    const saved = (saveEvent.mock.calls[0] as unknown as [TreatmentEvent])[0]
    expect(saved.endDate).toBe(saved.startDate)
  })

  it('creates a treatment diary covering a date range', async () => {
    render(<MemoryRouter><CalendarPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '新建事件' }))
    fireEvent.click(screen.getByRole('button', { name: /事件类型：化疗/ }))
    fireEvent.click(screen.getByRole('radio', { name: '治疗日记' }))

    fireEvent.change(screen.getByRole('textbox', { name: '治疗阶段 / 标题' }), { target: { value: '化疗后第 1 周' } })
    fireEvent.change(screen.getByRole('textbox', { name: '这一阶段的治疗反应' }), { target: { value: '前两天乏力，第 4 天开始缓解。' } })
    fireEvent.click(screen.getByRole('button', { name: '保存事件' }))

    await waitFor(() => expect(saveEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'treatmentDiary',
      title: '化疗后第 1 周',
      treatmentReaction: '前两天乏力，第 4 天开始缓解。',
    })))
  })

  it('confirms event deletion with the shared bottom sheet', async () => {
    render(<MemoryRouter><CalendarPage /></MemoryRouter>)
    const calendar = screen.getByRole('region', { name: '月历' })
    const eventDay = Array.from(calendar.querySelectorAll<HTMLButtonElement>('.day-cell:not(.muted)'))
      .find((day) => day.querySelector('.day-number')?.textContent === '22')
    expect(eventDay).toBeDefined()
    fireEvent.click(eventDay!)
    fireEvent.click(within(screen.getByRole('region', { name: '选中日期的事件' })).getByRole('button', { name: /chemotherapy-1/ }))

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    const confirmation = screen.getByRole('dialog', { name: '删除病程事件' })
    expect(confirmation).toHaveClass('bottom-sheet')
    expect(deleteEvent).not.toHaveBeenCalled()

    fireEvent.click(within(confirmation).getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(deleteEvent).toHaveBeenCalledWith('1'))
  })
})
