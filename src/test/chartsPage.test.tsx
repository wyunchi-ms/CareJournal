import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChartsPage } from '../pages/ChartsPage'
import { DEFAULT_PREFERENCES, type ChartPin, type TreatmentEvent } from '../types'

const savePreferences = vi.fn(async () => undefined)
const savePin = vi.fn(async () => undefined)
const deletePin = vi.fn(async () => undefined)
let pins: ChartPin[] = []
let events: TreatmentEvent[] = []

vi.mock('echarts-for-react', () => ({
  default: ({ option }: { option: { series?: Array<{ data?: unknown[] }>; xAxis?: { min?: number } } }) => <div data-testid="chart" data-series-count={option.series?.length ?? 0} data-series-data={JSON.stringify(option.series?.[0]?.data ?? [])} data-x-axis-min={option.xAxis?.min ?? ''} />,
}))

vi.mock('../store/AppContext', () => ({
  useApp: () => ({
    records: [
      { examDate: '2026-07-01', indicators: [
        { normalizedCode: 'WBC', normalizedName: '白细胞计数', unit: '10^9/L', value: 3.2 },
        { normalizedCode: 'HGB', normalizedName: '血红蛋白', unit: 'g/L', value: 96 },
      ] },
      { examDate: '2026-07-08', indicators: [{ normalizedCode: 'WBC', normalizedName: '白细胞计数', unit: '10^9/L', value: 4.1 }] },
    ],
    events,
    pins,
    preferences: DEFAULT_PREFERENCES,
    savePin,
    deletePin,
    savePreferences,
  }),
}))

afterEach(() => {
  cleanup()
  savePreferences.mockClear()
  savePin.mockClear()
  deletePin.mockClear()
  pins = []
  events = []
})

describe('charts page indicator selection', () => {
  it('renders one indicator series and persists indicator priority pins', () => {
    render(<ChartsPage />)
    expect(screen.getByTestId('chart')).toHaveAttribute('data-series-count', '1')

    fireEvent.click(screen.getByRole('button', { name: '检查指标：白细胞计数' }))
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '置顶：血红蛋白' }))

    expect(savePreferences).toHaveBeenCalledWith(expect.objectContaining({ chartPinnedIndicatorCodes: ['HGB'] }))
  })

  it('places the save action in the chart card instead of the mode controls', () => {
    render(<ChartsPage />)

    const bookmark = screen.getByRole('button', { name: '保存当前图表' })
    expect(bookmark.closest('.chart-card')).not.toBeNull()
    expect(bookmark.closest('.chart-controls')).toBeNull()

    fireEvent.click(bookmark)
    expect(savePin).toHaveBeenCalledWith(expect.objectContaining({
      title: '白细胞计数趋势',
      mode: 'trend',
      indicatorCodes: ['WBC'],
      cycleEventIds: [],
    }))
  })

  it('uses a searchable saved-chart picker and icon-only bookmark state', () => {
    pins = [
      { id: 'trend-pin', title: '白细胞计数趋势', mode: 'trend', indicatorCodes: ['WBC'], cycleEventIds: [], createdAt: '2026-07-20T10:00:00.000Z' },
      { id: 'cycle-pin', title: '血红蛋白周期对比', mode: 'cycle', indicatorCodes: ['HGB'], cycleEventIds: ['cycle-1', 'cycle-2'], createdAt: '2026-07-21T10:00:00.000Z' },
    ]
    render(<ChartsPage />)

    const activeBookmark = screen.getByRole('button', { name: '取消保存当前图表' })
    expect(activeBookmark).toHaveAttribute('aria-pressed', 'true')
    expect(activeBookmark).not.toHaveClass('active')

    fireEvent.click(screen.getByRole('button', { name: '打开已保存图表，共 2 个' }))
    const dialog = screen.getByRole('dialog', { name: '已保存图表（2）' })

    fireEvent.change(screen.getByRole('textbox', { name: '搜索已保存图表' }), { target: { value: '周期' } })
    expect(within(dialog).getByText('血红蛋白周期对比')).toBeInTheDocument()
    expect(within(dialog).queryByText('白细胞计数趋势')).not.toBeInTheDocument()
  })

  it('starts chemotherapy cycle series at Day 1 and excludes earlier results', () => {
    events = [{
      id: 'cycle-1',
      type: 'chemotherapy',
      title: '第一周期化疗',
      startDate: '2026-07-04',
      endDate: '2026-07-04',
      allDay: true,
      cycleDayOne: '2026-07-04',
      tags: [],
      linkedRecordIds: [],
      createdAt: '2026-07-04T00:00:00.000Z',
      updatedAt: '2026-07-04T00:00:00.000Z',
    }]
    render(<ChartsPage />)

    fireEvent.click(screen.getByRole('button', { name: '化疗周期叠加' }))
    expect(screen.getByTestId('chart')).toHaveAttribute('data-x-axis-min', '0')
    expect(JSON.parse(screen.getByTestId('chart').getAttribute('data-series-data') ?? '[]')).toEqual([[4, 4.1]])
  })

  it('treats multiple administration events in one generated cycle as one chart series', () => {
    const common = {
      type: 'chemotherapy' as const,
      allDay: true,
      cycleNumber: 1,
      cycleDayOne: '2026-07-01',
      chemotherapyCourseId: 'course-1',
      chemotherapyCycleId: 'generated-cycle-1',
      tags: [],
      linkedRecordIds: [],
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    }
    events = [
      { ...common, id: 'd1', title: '第 1 周期 D1 化疗', startDate: '2026-07-01', endDate: '2026-07-01', administrationDay: 1 },
      { ...common, id: 'd8', title: '第 1 周期 D8 化疗', startDate: '2026-07-08', endDate: '2026-07-08', administrationDay: 8 },
    ]
    render(<ChartsPage />)

    fireEvent.click(screen.getByRole('button', { name: '化疗周期叠加' }))
    expect(screen.getByTestId('chart')).toHaveAttribute('data-series-count', '1')
    fireEvent.click(screen.getByRole('button', { name: '叠加周期：第 1 周期' }))
    expect(screen.getByRole('checkbox', { name: /第 1 周期/ })).toHaveTextContent('2 次给药')
  })
})
