import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChartsPage } from '../pages/ChartsPage'
import { DEFAULT_PREFERENCES, type ChartPin, type TreatmentEvent } from '../types'

const savePreferences = vi.fn(async () => undefined)
const savePin = vi.fn(async () => undefined)
const deletePin = vi.fn(async () => undefined)
const { dispatchChartAction } = vi.hoisted(() => ({ dispatchChartAction: vi.fn() }))
let pins: ChartPin[] = []
let events: TreatmentEvent[] = []

vi.mock('echarts-for-react', () => ({
  default: ({ option, onChartReady }: { option: { color?: string[]; series?: Array<{ data?: unknown[]; name?: string; markLine?: { data?: unknown[] } }>; legend?: { itemWidth?: number; type?: string; formatter?: (name: string) => string }; xAxis?: { min?: number; name?: string; axisLabel?: { formatter?: (value: number) => string } } }; onChartReady?: (instance: { dispatchAction: typeof dispatchChartAction }) => void }) => {
    onChartReady?.({ dispatchAction: dispatchChartAction })
    return <div
      data-testid="chart"
      data-colors={JSON.stringify(option.color ?? [])}
      data-series-count={option.series?.length ?? 0}
      data-series-names={JSON.stringify(option.series?.map((series) => series.name) ?? [])}
      data-legend-labels={JSON.stringify(option.series?.map((series) => option.legend?.formatter?.(series.name ?? '') ?? series.name) ?? [])}
      data-series-data={JSON.stringify(option.series?.[0]?.data ?? [])}
      data-marker-count={option.series?.[0]?.markLine?.data?.length ?? 0}
      data-legend-item-width={option.legend?.itemWidth ?? ''}
      data-legend-type={option.legend?.type ?? ''}
      data-x-axis-min={option.xAxis?.min ?? ''}
      data-x-axis-name={option.xAxis?.name ?? ''}
      data-x-axis-labels={JSON.stringify([0, 20, 40].map((value) => option.xAxis?.axisLabel?.formatter?.(value) ?? value))}
    />
  },
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
  window.localStorage.clear()
  savePreferences.mockClear()
  savePin.mockClear()
  deletePin.mockClear()
  dispatchChartAction.mockClear()
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
    fireEvent.keyDown(screen.getByRole('radio', { name: /血红蛋白/ }), { key: 'ArrowLeft' })
    fireEvent.click(screen.getByRole('button', { name: '置顶：血红蛋白' }))

    expect(savePreferences).toHaveBeenCalledWith(expect.objectContaining({ chartPinnedIndicatorCodes: ['HGB'] }))
  })

  it('dismisses the active chart tooltip when switching indicators', () => {
    render(<ChartsPage />)
    dispatchChartAction.mockClear()

    fireEvent.click(screen.getByRole('button', { name: '检查指标：白细胞计数' }))
    fireEvent.click(screen.getByRole('radio', { name: /血红蛋白/ }))

    expect(dispatchChartAction).toHaveBeenCalledWith({ type: 'hideTip' })
    expect(screen.getByRole('button', { name: '检查指标：血红蛋白' })).toBeInTheDocument()
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

  it('hides treatment-event markers by default and shows them on demand', () => {
    events = [{
      id: 'cycle-marker',
      type: 'chemotherapy',
      title: '第 1 周期化疗',
      startDate: '2026-07-01',
      endDate: '2026-07-01',
      allDay: true,
      tags: [],
      linkedRecordIds: [],
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    }]
    render(<ChartsPage />)

    expect(screen.getByTestId('chart')).toHaveAttribute('data-marker-count', '0')
    expect(screen.getByRole('button', { name: '显示病程标记' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('chart')).toHaveAttribute('data-series-count', '1')
    fireEvent.click(screen.getByRole('button', { name: '显示病程标记' }))

    expect(screen.getByTestId('chart')).toHaveAttribute('data-marker-count', '1')
    expect(screen.getByRole('button', { name: '隐藏病程标记' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('uses a searchable saved-chart picker, icon-only bookmark state, and bottom-sheet deletion', async () => {
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

    fireEvent.keyDown(within(dialog).getByRole('button', { name: /血红蛋白周期对比.*化疗周期叠加/ }), { key: 'ArrowLeft' })
    fireEvent.click(within(dialog).getByRole('button', { name: '删除已保存图表 血红蛋白周期对比' }))
    const confirmation = screen.getByRole('dialog', { name: '删除已保存图表' })
    expect(confirmation).toHaveClass('bottom-sheet')
    expect(deletePin).not.toHaveBeenCalled()
    fireEvent.click(within(confirmation).getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(deletePin).toHaveBeenCalledWith('cycle-pin'))
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
    expect(screen.getByTestId('chart')).toHaveAttribute('data-x-axis-name', '')
    expect(screen.getByTestId('chart')).toHaveAttribute('data-x-axis-labels', '["1","21","41"]')
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
    expect(screen.getByTestId('chart')).toHaveAttribute('data-series-names', '["C1"]')
    expect(screen.getByTestId('chart')).toHaveAttribute('data-legend-type', 'plain')
    expect(screen.getByTestId('chart')).toHaveAttribute('data-legend-item-width', '16')
    fireEvent.click(screen.getByRole('button', { name: '叠加周期：第 1 周期' }))
    expect(screen.getByRole('checkbox', { name: /第 1 周期/ })).toHaveTextContent('2 次给药')
  })

  it('sorts selectable cycles from newest to oldest and keeps duplicate cycle numbers', () => {
    const common = {
      type: 'chemotherapy' as const,
      allDay: true,
      tags: [],
      linkedRecordIds: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    }
    events = [
      { ...common, id: 'old-c1', title: '旧疗程第一周期', startDate: '2024-07-11', endDate: '2024-07-11', cycleNumber: 1, cycleDayOne: '2024-07-11' },
      { ...common, id: 'new-c1', title: '新疗程第一周期', startDate: '2026-02-24', endDate: '2026-02-24', cycleNumber: 1, cycleDayOne: '2026-02-24' },
      { ...common, id: 'middle-c2', title: '中间疗程第二周期', startDate: '2025-03-16', endDate: '2025-03-16', cycleNumber: 2, cycleDayOne: '2025-03-16' },
    ]
    render(<ChartsPage />)

    fireEvent.click(screen.getByRole('button', { name: '化疗周期叠加' }))
    expect(screen.getByTestId('chart')).toHaveAttribute('data-series-names', '["C1·260224","C2","C1·240711"]')
    expect(screen.getByTestId('chart')).toHaveAttribute('data-legend-labels', '["C1","C2","C1"]')
    fireEvent.click(screen.getByRole('button', { name: /叠加周期：已选 3 项/ }))
    const cycleOptions = screen.getAllByRole('checkbox')

    expect(cycleOptions).toHaveLength(3)
    expect(cycleOptions[0]).toHaveTextContent('2026-02-24')
    expect(cycleOptions[1]).toHaveTextContent('2025-03-16')
    expect(cycleOptions[2]).toHaveTextContent('2024-07-11')
  })

  it('assigns every displayed cycle a distinct stable color', () => {
    events = Array.from({ length: 14 }, (_, index) => {
      const day = String(index + 1).padStart(2, '0')
      return {
        id: `cycle-${index + 1}`,
        type: 'chemotherapy' as const,
        title: `第 ${index + 1} 周期`,
        startDate: `2026-01-${day}`,
        endDate: `2026-01-${day}`,
        allDay: true,
        cycleNumber: index + 1,
        cycleDayOne: `2026-01-${day}`,
        tags: [],
        linkedRecordIds: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
    })
    render(<ChartsPage />)

    fireEvent.click(screen.getByRole('button', { name: '化疗周期叠加' }))
    const colors = JSON.parse(screen.getByTestId('chart').getAttribute('data-colors') ?? '[]') as string[]

    expect(colors).toHaveLength(14)
    expect(new Set(colors).size).toBe(14)
  })
})
