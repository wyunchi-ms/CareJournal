import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { init, setPlatformAPI } from 'echarts'
import { ChartsPage } from '../pages/ChartsPage'
import { DEFAULT_PREFERENCES, type ChartPin, type ExamRecord, type TreatmentEvent } from '../types'

const savePreferences = vi.fn(async () => undefined)
const savePin = vi.fn(async () => undefined)
const reorderPins = vi.fn(async () => undefined)
const deletePin = vi.fn(async () => undefined)
const { dispatchChartAction, captureChartOption } = vi.hoisted(() => ({
  dispatchChartAction: vi.fn(),
  captureChartOption: vi.fn<(option: object) => void>(),
}))
let pins: ChartPin[] = []
let events: TreatmentEvent[] = []
let extraRecords: ExamRecord[] = []

vi.mock('echarts-for-react', () => ({
  default: ({ option, onChartReady }: { option: {
    color?: string[]
    tooltip?: { renderMode?: string }
    dataZoom?: Array<{ filterMode?: string; startValue?: string; endValue?: string; height?: number; handleSize?: number }>
    series?: Array<{ data?: unknown[]; name?: string; markLine?: { data?: unknown[] }; tooltip?: { valueFormatter?: (value: number) => string } }>
    legend?: { itemWidth?: number; type?: string; formatter?: (name: string) => string }
    xAxis?: { min?: number; name?: string; axisLabel?: { formatter?: (value: number) => string } }
    yAxis?: { name?: string; axisLabel?: { formatter?: (value: number) => string } }
  }; onChartReady?: (instance: { dispatchAction: typeof dispatchChartAction }) => void }) => {
    captureChartOption(option)
    onChartReady?.({ dispatchAction: dispatchChartAction })
    return <div
      data-testid="chart"
      data-colors={JSON.stringify(option.color ?? [])}
      data-series-count={option.series?.length ?? 0}
      data-series-names={JSON.stringify(option.series?.map((series) => series.name) ?? [])}
      data-legend-labels={JSON.stringify(option.series?.map((series) => option.legend?.formatter?.(series.name ?? '') ?? series.name) ?? [])}
      data-series-data={JSON.stringify(option.series?.[0]?.data ?? [])}
      data-series-value-label={option.series?.[0]?.tooltip?.valueFormatter?.(63.2) ?? ''}
      data-marker-count={option.series?.[0]?.markLine?.data?.length ?? 0}
      data-legend-item-width={option.legend?.itemWidth ?? ''}
      data-legend-type={option.legend?.type ?? ''}
      data-x-axis-min={option.xAxis?.min ?? ''}
      data-x-axis-name={option.xAxis?.name ?? ''}
      data-y-axis-name={option.yAxis?.name ?? ''}
      data-y-axis-value-label={option.yAxis?.axisLabel?.formatter?.(63.2) ?? ''}
      data-x-axis-labels={JSON.stringify([0, 20, 40].map((value) => option.xAxis?.axisLabel?.formatter?.(value) ?? value))}
      data-tooltip-render-mode={option.tooltip?.renderMode ?? ''}
      data-zoom-start={option.dataZoom?.[0]?.startValue ?? ''}
      data-zoom-end={option.dataZoom?.[0]?.endValue ?? ''}
      data-slider-height={option.dataZoom?.[1]?.height ?? ''}
      data-slider-handle-size={option.dataZoom?.[1]?.handleSize ?? ''}
      data-zoom-filter-modes={JSON.stringify(option.dataZoom?.map((zoom) => zoom.filterMode) ?? [])}
    />
  },
}))

vi.mock('../store/AppContext', () => ({
  useApp: () => ({
    records: [
      { id: 'record-old', reportType: '血常规', normalizedReportType: '血常规', sampleDate: '2024-07-01', hospital: '浙江大学儿童医院', indicators: [
        { id: 'old-wbc', normalizedCode: 'WBC', normalizedName: '白细胞计数', unit: '10^9/L', value: 5.2, rawValue: '5.20 10^9/L ↑', referenceLow: 3, referenceHigh: 5, abnormalFlag: 'normal' },
      ] },
      { id: 'record-1', reportType: '血常规', normalizedReportType: '血常规', sampleDate: '2026-07-01', hospital: '浙江大学儿童医院', indicators: [
        { id: 'wbc-1', normalizedCode: 'WBC', normalizedName: '白细胞计数', unit: '10^9/L', value: 3.2, rawValue: '3.2', referenceLow: 3.5, referenceHigh: 9.5, abnormalFlag: 'normal' },
        { id: 'hgb-1', normalizedCode: 'HGB', normalizedName: '血红蛋白', unit: 'g/L', value: 96, rawValue: '96', referenceLow: 115, referenceHigh: 150, abnormalFlag: 'low' },
      ] },
      { id: 'record-2', reportType: '血常规', normalizedReportType: '血常规', sampleDate: '2026-07-08', hospital: '浙江大学儿童医院', indicators: [
        { id: 'wbc-2', normalizedCode: 'WBC', normalizedName: '白细胞计数', unit: '10^9/L', value: 4.1, rawValue: '4.1', referenceLow: 3.5, referenceHigh: 9.5, abnormalFlag: 'normal' },
      ] },
      ...extraRecords,
    ],
    events,
    pins,
    preferences: DEFAULT_PREFERENCES,
    savePin,
    reorderPins,
    deletePin,
    savePreferences,
  }),
}))

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  savePreferences.mockClear()
  savePin.mockClear()
  reorderPins.mockClear()
  deletePin.mockClear()
  dispatchChartAction.mockClear()
  captureChartOption.mockClear()
  pins = []
  events = []
  extraRecords = []
})

describe('charts page indicator selection', () => {
  it.each(['trend', 'cycle'] as const)('renders numeric y-axis ticks in %s builders, saved charts, and details', (mode) => {
    events = [{
      id: 'cycle-1', type: 'chemotherapy', title: '第一周期化疗', startDate: '2026-07-01', endDate: '2026-07-01', allDay: true,
      tags: [], linkedRecordIds: [], createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
    }]
    const builder = render(<MemoryRouter><ChartsPage /></MemoryRouter>)
    if (mode === 'cycle') fireEvent.click(screen.getByRole('tab', { name: '化疗周期叠加' }))
    builder.unmount()

    pins = [{ id: 'wbc-pin', title: '白细胞图表', mode, indicatorCodes: ['WBC'], cycleEventIds: ['cycle-1'], createdAt: '2026-07-01T00:00:00.000Z' }]
    render(<MemoryRouter><ChartsPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '查看图表详情：白细胞图表' }))

    setPlatformAPI({ measureText: (text) => ({ width: text.length * 7 }) })
    expect(captureChartOption.mock.calls.length).toBeGreaterThanOrEqual(4)
    for (const [option] of captureChartOption.mock.calls) {
      const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 360, height: 400 })
      try {
        chart.setOption({ ...option, animation: false })
        const svg = new DOMParser().parseFromString(chart.renderToSVGString(), 'image/svg+xml')
        const ticks = [...svg.querySelectorAll('text[text-anchor="end"]')].map((tick) => tick.textContent)
        expect(ticks.length).toBeGreaterThan(2)
        expect(ticks).toContain('4')
      } finally {
        chart.dispose()
      }
    }
  })

  it('shows only date and value with directional status icons in compact related-report rows', () => {
    pins = [{ id: 'wbc-pin', title: '白细胞计数趋势', mode: 'trend', indicatorCodes: ['WBC'], cycleEventIds: [], createdAt: '2026-07-01T00:00:00.000Z' }]
    render(<MemoryRouter><ChartsPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '查看图表详情：白细胞计数趋势' }))

    const dialog = screen.getByRole('dialog', { name: '白细胞计数趋势' })
    const lowReport = within(dialog).getByRole('link', { name: '打开相关检查报告：2026-07-01' })
    const lowValue = within(lowReport).getByText('3.2').closest('.chart-report-value')
    expect(lowValue).toHaveClass('low')
    expect(lowValue?.querySelector('svg')).toHaveClass('lucide-arrow-down')
    expect(lowReport).toHaveAccessibleDescription('3.2，偏低')
    expect(lowReport).not.toHaveTextContent('血红蛋白')
    expect(lowReport).not.toHaveTextContent('白细胞计数')
    expect(lowReport).not.toHaveTextContent('10^9/L')
    expect(lowReport).not.toHaveTextContent('项指标')
    expect(lowReport).not.toHaveTextContent('项异常')
    expect(lowReport).not.toHaveTextContent('血常规')
    expect(lowReport).toHaveTextContent('2026-07-01')
    expect(lowReport).not.toHaveTextContent('浙江大学儿童医院')
    expect(lowReport.querySelector('time')).toHaveAttribute('datetime', '2026-07-01')
    expect(lowReport.children).toHaveLength(2)
    expect(within(lowReport).getByText('，偏低')).toHaveClass('sr-only')
    expect(lowReport).toHaveAttribute('href', '/records?recordId=record-1')
    const normalValue = within(dialog).getByText('4.1').closest('.chart-report-value')
    expect(normalValue).toHaveClass('normal')
    expect(normalValue?.querySelector('svg')).not.toBeInTheDocument()
    const highValue = within(dialog).getByText('5.20').closest('.chart-report-value')
    expect(highValue).toHaveClass('high')
    expect(highValue?.querySelector('svg')).toHaveClass('lucide-arrow-up')
  })

  it('keeps each plotted result attached to its exact indicator when one report repeats a code', () => {
    extraRecords = [{
      id: 'repeated-code', reportType: '血常规', sampleDate: '2026-07-15',
      indicators: [2, 12].map((value) => ({
        id: `wbc-${value}`, rawName: 'WBC', normalizedCode: 'WBC', normalizedName: '白细胞计数', unit: 'G/L',
        value, rawValue: '', referenceLow: 3.5, referenceHigh: 9.5, referenceText: '3.5–9.5', abnormalFlag: 'unknown',
      })),
      images: [], linkedEventIds: [], fingerprint: '', ocrStatus: 'completed', ocrAttempts: 1,
      createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z',
    }]
    pins = [{ id: 'wbc-pin', title: '白细胞计数趋势', mode: 'trend', indicatorCodes: ['WBC'], cycleEventIds: [], createdAt: '2026-07-01T00:00:00.000Z' }]
    render(<MemoryRouter><ChartsPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '查看图表详情：白细胞计数趋势' }))

    const dialog = screen.getByRole('dialog', { name: '白细胞计数趋势' })
    expect(within(dialog).getByText('2').closest('.chart-report-value')).toHaveClass('low')
    expect(within(dialog).getByText('12').closest('.chart-report-value')).toHaveClass('high')
  })

  it.each([
    { value: 1, referenceLow: 3.5, referenceHigh: 9.5, flag: 'critical' as const, icon: 'lucide-arrow-down' },
    { value: 12, referenceLow: 3.5, referenceHigh: 9.5, flag: 'critical' as const, icon: 'lucide-arrow-up' },
    { value: 4, referenceLow: null, referenceHigh: null, flag: 'unknown' as const, icon: null },
    { value: 4, referenceLow: null, referenceHigh: null, flag: 'critical' as const, icon: null },
  ])('preserves $flag highlighting without guessing an arrow for value $value', ({ value, referenceLow, referenceHigh, flag, icon }) => {
    extraRecords = [{
      id: 'flagged-record', reportType: '血常规', sampleDate: '2026-07-15',
      indicators: [{
        id: 'flagged-wbc', rawName: 'WBC', normalizedCode: 'WBC', normalizedName: '白细胞计数',
        value, rawValue: '', unit: '10^9/L', referenceLow, referenceHigh, referenceText: '', abnormalFlag: flag,
      }],
      images: [], linkedEventIds: [], fingerprint: '', ocrStatus: 'completed', ocrAttempts: 1,
      createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z',
    }]
    pins = [{ id: 'wbc-pin', title: '白细胞计数趋势', mode: 'trend', indicatorCodes: ['WBC'], cycleEventIds: [], createdAt: '2026-07-01T00:00:00.000Z' }]
    render(<MemoryRouter><ChartsPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '查看图表详情：白细胞计数趋势' }))

    const source = screen.getByRole('link', { name: '打开相关检查报告：2026-07-15' })
    const result = within(source).getByText(String(value)).closest('.chart-report-value')
    expect(result).toHaveClass(flag)
    if (icon) expect(result?.querySelector('svg')).toHaveClass(icon)
    else expect(result?.querySelector('svg')).not.toBeInTheDocument()
    if (flag === 'critical') expect(source).toHaveAccessibleDescription(`${value}，危急`)
  })

  it('renders one indicator series and persists indicator priority pins', () => {
    render(<ChartsPage />)
    expect(screen.getByTestId('chart')).toHaveAttribute('data-series-count', '1')
    expect(screen.getByTestId('chart').closest('.chart-canvas-gesture')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '图表指标：白细胞计数' }))
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('radio', { name: /血红蛋白/ }), { key: 'ArrowLeft' })
    fireEvent.click(screen.getByRole('button', { name: '置顶：血红蛋白' }))

    expect(savePreferences).toHaveBeenCalledWith(expect.objectContaining({ chartPinnedIndicatorCodes: ['HGB'] }))
  })

  it('offers recorded body measurements as chart metrics and formats weight to two decimals', () => {
    events = [
      {
        id: 'body-1', type: 'bodyMeasurement', title: '身体记录', startDate: '2026-07-03', endDate: '2026-07-03', allDay: true,
        bodyMeasurements: { heightCm: 171.5, weightKg: 63.2 }, tags: [], linkedRecordIds: [], createdAt: '2026-07-03T00:00:00.000Z', updatedAt: '2026-07-03T00:00:00.000Z',
      },
      {
        id: 'body-2', type: 'bodyMeasurement', title: '身体记录', startDate: '2026-07-10', endDate: '2026-07-10', allDay: true,
        bodyMeasurements: { weightKg: 63.25, heartRateBpm: 72 }, tags: [], linkedRecordIds: [], createdAt: '2026-07-10T00:00:00.000Z', updatedAt: '2026-07-10T00:00:00.000Z',
      },
    ]
    render(<ChartsPage />)

    fireEvent.click(screen.getByRole('button', { name: '图表指标：白细胞计数' }))
    expect(screen.getByRole('radio', { name: /身高/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /体重/ })).toHaveTextContent('出现 2 次')
    expect(screen.getByRole('radio', { name: /心率/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /体重/ }))

    expect(screen.getByRole('button', { name: '图表指标：体重' })).toBeInTheDocument()
    expect(screen.getByTestId('chart')).toHaveAttribute('data-series-data', '[["2026-07-03",63.2],["2026-07-10",63.25]]')
    expect(screen.getByTestId('chart')).toHaveAttribute('data-y-axis-name', 'kg')
    expect(screen.getByTestId('chart')).toHaveAttribute('data-series-value-label', '63.20 kg')
    expect(screen.getByTestId('chart')).toHaveAttribute('data-y-axis-value-label', '63.20')
  })

  it('opens a saved body metric chart and links its sources back to the calendar date', () => {
    pins = [{ id: 'weight-pin', title: '体重趋势', mode: 'trend', indicatorCodes: ['BODY_WEIGHT_KG'], cycleEventIds: [], createdAt: '2026-07-20T10:00:00.000Z' }]
    events = [{
      id: 'body-1', type: 'bodyMeasurement', title: '身体记录', startDate: '2026-07-03', endDate: '2026-07-03', allDay: true,
      bodyMeasurements: { weightKg: 63.2 }, tags: [], linkedRecordIds: [], createdAt: '2026-07-03T00:00:00.000Z', updatedAt: '2026-07-03T00:00:00.000Z',
    }]
    render(<MemoryRouter><ChartsPage /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: '查看图表详情：体重趋势' }))
    const dialog = screen.getByRole('dialog', { name: '体重趋势' })
    expect(within(dialog).getByRole('heading', { name: '相关身体记录' })).toBeInTheDocument()
    const source = within(dialog).getByRole('link', { name: '打开相关身体记录：2026-07-03' })
    expect(within(source).getByText('63.20')).toBeInTheDocument()
    expect(source).not.toHaveTextContent('体重')
    expect(source).not.toHaveTextContent('kg')
    expect(source).not.toHaveTextContent('身体记录')
    expect(source.querySelector('time')).toHaveTextContent('2026-07-03')
    expect(source.children).toHaveLength(2)
    expect(source.querySelector('svg')).not.toBeInTheDocument()
    expect(source).toHaveAttribute('href', '/calendar?date=2026-07-03')
  })

  it('dismisses the active chart tooltip when switching indicators', () => {
    render(<ChartsPage />)
    dispatchChartAction.mockClear()

    fireEvent.click(screen.getByRole('button', { name: '图表指标：白细胞计数' }))
    fireEvent.click(screen.getByRole('radio', { name: /血红蛋白/ }))

    expect(dispatchChartAction).toHaveBeenCalledWith({ type: 'hideTip' })
    expect(screen.getByRole('button', { name: '图表指标：血红蛋白' })).toBeInTheDocument()
  })

  it('confines tooltips to each canvas and clears them before opening chart detail', () => {
    pins = [{
      id: 'trend-pin',
      title: '白细胞计数趋势',
      mode: 'trend',
      indicatorCodes: ['WBC'],
      cycleEventIds: [],
      createdAt: '2026-07-21T10:00:00.000Z',
    }]
    render(<MemoryRouter><ChartsPage /></MemoryRouter>)
    expect(screen.getByTestId('chart')).toHaveAttribute('data-tooltip-render-mode', 'richText')
    dispatchChartAction.mockClear()

    fireEvent.click(screen.getByRole('button', { name: '查看图表详情：白细胞计数趋势' }))

    expect(dispatchChartAction).toHaveBeenCalledWith({ type: 'hideTip' })
    expect(within(screen.getByRole('dialog', { name: '白细胞计数趋势' })).getByTestId('chart')).toHaveAttribute('data-tooltip-render-mode', 'richText')
  })

  it('defaults long trend details to six months and offers larger range controls', () => {
    pins = [{
      id: 'trend-pin',
      title: '白细胞计数趋势',
      mode: 'trend',
      indicatorCodes: ['WBC'],
      cycleEventIds: [],
      createdAt: '2026-07-21T10:00:00.000Z',
    }]
    render(<MemoryRouter><ChartsPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '查看图表详情：白细胞计数趋势' }))

    const dialog = screen.getByRole('dialog', { name: '白细胞计数趋势' })
    expect(within(dialog).getByRole('button', { name: '6个月' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(dialog).getByTestId('chart')).toHaveAttribute('data-zoom-start', '2026-01-08')
    expect(within(dialog).getByTestId('chart')).toHaveAttribute('data-zoom-end', '2026-07-08')
    expect(within(dialog).getByTestId('chart')).toHaveAttribute('data-slider-height', '28')
    expect(within(dialog).getByTestId('chart')).toHaveAttribute('data-slider-handle-size', '22')
    expect(within(dialog).getByTestId('chart')).toHaveAttribute('data-zoom-filter-modes', '["filter","filter"]')

    fireEvent.click(within(dialog).getByRole('button', { name: '1年' }))
    expect(within(dialog).getByTestId('chart')).toHaveAttribute('data-zoom-start', '2025-07-08')

    fireEvent.click(within(dialog).getByRole('button', { name: '全部' }))
    expect(within(dialog).getByTestId('chart')).toHaveAttribute('data-zoom-start', '')
  })

  it('places the save action in the chart card instead of the mode controls', () => {
    render(<ChartsPage />)

    const bookmark = screen.getByRole('button', { name: '添加当前图表到收藏' })
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

  it('shows saved charts first, opens the builder on demand, and supports management deletion', async () => {
    pins = [
      { id: 'trend-pin', title: '白细胞计数趋势', mode: 'trend', indicatorCodes: ['WBC'], cycleEventIds: [], createdAt: '2026-07-20T10:00:00.000Z' },
      { id: 'cycle-pin', title: '血红蛋白周期对比', mode: 'cycle', indicatorCodes: ['HGB'], cycleEventIds: ['cycle-1', 'cycle-2'], createdAt: '2026-07-21T10:00:00.000Z' },
    ]
    render(<ChartsPage />)

    expect(screen.getAllByTestId('chart')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: '图表指标：白细胞计数' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '添加图表' }))
    const dashboard = screen.getByRole('region', { name: '收藏图表' })
    const modeTabs = screen.getByRole('tablist', { name: '图表模式' })
    expect(within(modeTabs).getByRole('tab', { name: '实际日期趋势' })).toHaveAttribute('aria-selected', 'true')
    expect(dashboard.querySelector('.saved-chart-dashboard-header')!.compareDocumentPosition(modeTabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(dashboard.querySelector('.saved-chart-grid')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '查看图表详情：白细胞计数趋势' })).not.toBeInTheDocument()
    const activeBookmark = screen.getByRole('button', { name: '当前图表已收藏' })
    expect(activeBookmark).toHaveAttribute('aria-pressed', 'true')
    expect(activeBookmark).toBeDisabled()

    expect(screen.getByRole('region', { name: '收藏图表' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '收藏图表' })).not.toBeInTheDocument()
    expect(screen.getAllByTestId('chart')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '收起' }))
    expect(screen.queryByRole('tablist', { name: '图表模式' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看图表详情：白细胞计数趋势' })).toBeInTheDocument()
    const savedChartsTrigger = screen.getByRole('button', { name: '管理已保存图表，共 2 个' })
    expect(savedChartsTrigger.closest('.saved-chart-dashboard-header')).not.toBeNull()
    fireEvent.click(savedChartsTrigger)
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

  it('opens a saved cycle chart detail, persists visible lines, and lists related reports', async () => {
    pins = [{
      id: 'cycle-pin',
      title: '白细胞计数周期对比',
      mode: 'cycle',
      indicatorCodes: ['WBC'],
      cycleEventIds: ['cycle-1', 'cycle-2'],
      createdAt: '2026-07-21T10:00:00.000Z',
    }]
    const common = {
      type: 'chemotherapy' as const,
      allDay: true,
      tags: [],
      linkedRecordIds: [],
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    }
    events = [
      { ...common, id: 'cycle-1', title: '第 1 周期', startDate: '2026-07-01', endDate: '2026-07-01', cycleNumber: 1, cycleDayOne: '2026-07-01' },
      { ...common, id: 'cycle-2', title: '第 2 周期', startDate: '2026-07-08', endDate: '2026-07-08', cycleNumber: 2, cycleDayOne: '2026-07-08' },
    ]

    render(<MemoryRouter><ChartsPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '查看图表详情：白细胞计数周期对比' }))

    const dialog = screen.getByRole('dialog', { name: '白细胞计数周期对比' })
    expect(within(dialog).getByText('默认显示周期')).toBeInTheDocument()
    expect(within(dialog).getByTestId('chart')).toHaveAttribute('data-series-count', '2')
    expect(within(dialog).getAllByRole('link')).toHaveLength(2)
    expect(within(dialog).getByText('3.2').closest('.chart-report-value')).toHaveClass('low')
    expect(within(dialog).getByText('4.1').closest('.chart-report-value')).toHaveClass('normal')

    fireEvent.click(within(dialog).getByRole('checkbox', { name: /第 2 周期/ }))

    await waitFor(() => expect(savePin).toHaveBeenCalledWith(expect.objectContaining({
      id: 'cycle-pin',
      cycleEventIds: ['cycle-1'],
    })))
    expect(within(dialog).getByTestId('chart')).toHaveAttribute('data-series-count', '1')
    expect(within(dialog).getAllByRole('link')).toHaveLength(1)
    expect(within(dialog).queryByText('4.1')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: '打开相关检查报告：2026-07-01' })).toHaveAttribute('href', '/records?recordId=record-1')
  })

  it('enters saved-chart ordering on long press and persists keyboard reordering', async () => {
    pins = [
      { id: 'trend-pin', title: '白细胞计数趋势', mode: 'trend', indicatorCodes: ['WBC'], cycleEventIds: [], createdAt: '2026-07-20T10:00:00.000Z' },
      { id: 'cycle-pin', title: '血红蛋白周期对比', mode: 'cycle', indicatorCodes: ['HGB'], cycleEventIds: ['cycle-1'], createdAt: '2026-07-21T10:00:00.000Z' },
    ]
    render(<ChartsPage />)
    fireEvent.click(screen.getByRole('button', { name: '管理已保存图表，共 2 个' }))

    fireEvent.contextMenu(screen.getByRole('button', { name: /血红蛋白周期对比.*化疗周期叠加/ }))

    const orderingDialog = screen.getByRole('dialog', { name: '已保存图表（排序）' })
    expect(within(orderingDialog).getByText('拖动调整图表顺序')).toBeInTheDocument()
    const cycleHandle = within(orderingDialog).getByRole('button', { name: '拖动排序：血红蛋白周期对比' })
    fireEvent.keyDown(cycleHandle, { key: 'ArrowDown' })

    await waitFor(() => expect(reorderPins).toHaveBeenCalledWith(['trend-pin', 'cycle-pin']))
    expect(within(orderingDialog).getAllByRole('button', { name: /拖动排序：/ }).map((button) => button.getAttribute('aria-label'))).toEqual([
      '拖动排序：白细胞计数趋势',
      '拖动排序：血红蛋白周期对比',
    ])
    fireEvent.click(within(orderingDialog).getByRole('button', { name: '完成' }))
    expect(screen.getByRole('dialog', { name: '已保存图表（2）' })).toBeInTheDocument()
  })

  it('reorders saved charts by dragging the edit-mode handle', async () => {
    pins = [
      { id: 'trend-pin', title: '白细胞计数趋势', mode: 'trend', indicatorCodes: ['WBC'], cycleEventIds: [], createdAt: '2026-07-20T10:00:00.000Z' },
      { id: 'cycle-pin', title: '血红蛋白周期对比', mode: 'cycle', indicatorCodes: ['HGB'], cycleEventIds: ['cycle-1'], createdAt: '2026-07-21T10:00:00.000Z' },
    ]
    render(<ChartsPage />)
    fireEvent.click(screen.getByRole('button', { name: '管理已保存图表，共 2 个' }))
    fireEvent.contextMenu(screen.getByRole('button', { name: /血红蛋白周期对比.*化疗周期叠加/ }))

    const dialog = screen.getByRole('dialog', { name: '已保存图表（排序）' })
    const cycleHandle = within(dialog).getByRole('button', { name: '拖动排序：血红蛋白周期对比' })
    const cycleRow = within(dialog).getByText('血红蛋白周期对比').closest<HTMLElement>('[data-saved-chart-id]')!
    const trendRow = within(dialog).getByText('白细胞计数趋势').closest<HTMLElement>('[data-saved-chart-id]')!
    const originalElementFromPoint = document.elementFromPoint
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => trendRow) })
    try {
      fireEvent.pointerDown(cycleHandle, { pointerId: 7, clientX: 10, clientY: 10 })
      expect(cycleRow).toHaveClass('sortable-drag-placeholder')
      expect(document.querySelector('.sortable-drag-preview')).toHaveTextContent('血红蛋白周期对比')
      fireEvent.pointerMove(window, { pointerId: 7, clientX: 10, clientY: 100 })
      fireEvent.pointerUp(window, { pointerId: 7, clientX: 10, clientY: 100 })
    } finally {
      Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: originalElementFromPoint })
    }

    await waitFor(() => expect(reorderPins).toHaveBeenCalledWith(['trend-pin', 'cycle-pin']))
    expect(document.querySelector('.sortable-drag-preview')).not.toBeInTheDocument()
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

    fireEvent.click(screen.getByRole('tab', { name: '化疗周期叠加' }))
    expect(screen.getByTestId('chart')).toHaveAttribute('data-x-axis-min', '0')
    expect(screen.getByTestId('chart')).toHaveAttribute('data-zoom-filter-modes', '["filter"]')
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

    fireEvent.click(screen.getByRole('tab', { name: '化疗周期叠加' }))
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

    fireEvent.click(screen.getByRole('tab', { name: '化疗周期叠加' }))
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

    fireEvent.click(screen.getByRole('tab', { name: '化疗周期叠加' }))
    const colors = JSON.parse(screen.getByTestId('chart').getAttribute('data-colors') ?? '[]') as string[]

    expect(colors).toHaveLength(14)
    expect(new Set(colors).size).toBe(14)
  })
})
