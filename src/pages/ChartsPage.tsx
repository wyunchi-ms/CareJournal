import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import type { EChartsType } from 'echarts'
import ReactECharts from 'echarts-for-react'
import { Bookmark, BookmarkCheck, BookmarkX, ChartNoAxesCombined, ChevronRight, Eye, EyeOff, RotateCcw, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChoicePicker } from '../components/ChoicePicker'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { IndicatorPicker } from '../components/IndicatorPicker'
import { Modal } from '../components/Modal'
import { SwipeableListItem } from '../components/SwipeableListItem'
import { sortChartIndicators } from '../services/chartIndicators'
import { groupChemotherapyCycles } from '../services/chemotherapy'
import { useApp } from '../store/AppContext'
import { EVENT_TYPES, newId, type ChartPin } from '../types'

const seriesColors = ['#0891b2', '#7a5af8', '#e45756', '#f59e0b', '#16a34a', '#2563eb']
const cycleSeriesColors = ['#0072b2', '#e69f00', '#009e73', '#cc79a7', '#d55e00', '#56b4e9', '#7a3e9d', '#6b7a00', '#8c564b', '#17becf', '#e83e8c', '#4d7c0f']

function cycleSeriesColor(index: number) {
  if (index < cycleSeriesColors.length) return cycleSeriesColors[index]
  const hue = Math.round((index * 137.508 + 25) % 360)
  const lightness = 42 + (Math.floor(index / cycleSeriesColors.length) % 2) * 8
  return `hsl(${hue}, 72%, ${lightness}%)`
}

export function ChartsPage() {
  const { records, events, pins, preferences, savePin, deletePin, savePreferences } = useApp()
  const indicatorOrder = preferences.chartIndicatorOrder
  const pinnedIndicatorCodes = preferences.chartPinnedIndicatorCodes
  const indicators = useMemo(() => {
    const map = new Map<string, { code: string; name: string; unit: string; count: number }>()
    records.flatMap((record) => record.indicators).filter((item) => item.value !== null).forEach((item) => {
      const current = map.get(item.normalizedCode)
      map.set(item.normalizedCode, {
        code: item.normalizedCode,
        name: item.normalizedName,
        unit: item.unit || current?.unit || '',
        count: (current?.count ?? 0) + 1,
      })
    })
    return sortChartIndicators([...map.values()], indicatorOrder, pinnedIndicatorCodes)
  }, [records, indicatorOrder, pinnedIndicatorCodes])
  const chemotherapyCycles = useMemo(() => groupChemotherapyCycles(events), [events])
  const cyclesNewestFirst = useMemo(() => [...chemotherapyCycles].sort((first, second) => second.dayOne.localeCompare(first.dayOne)), [chemotherapyCycles])
  const [mode, setMode] = useState<'trend' | 'cycle'>('trend')
  const [selectedCode, setSelectedCode] = useState('')
  const [selectedCycles, setSelectedCycles] = useState<string[]>([])
  const [savedChartsOpen, setSavedChartsOpen] = useState(false)
  const [savedQuery, setSavedQuery] = useState('')
  const [deletingPin, setDeletingPin] = useState<ChartPin | null>(null)
  const [deletePinBusy, setDeletePinBusy] = useState(false)
  const [deletePinError, setDeletePinError] = useState('')
  const [showEventMarkers, setShowEventMarkers] = useState(false)
  const chartInstanceRef = useRef<EChartsType | null>(null)

  const currentCode = indicators.some((item) => item.code === selectedCode) ? selectedCode : indicators[0]?.code ?? ''
  const currentCycles = selectedCycles.length ? selectedCycles : chemotherapyCycles.map((cycle) => cycle.id)
  const currentIndicator = indicators.find((item) => item.code === currentCode)
  const currentIndicatorName = currentIndicator?.name || currentCode || '检查指标'
  const currentChartTitle = mode === 'trend'
    ? `${currentIndicatorName}趋势`
    : `${currentIndicatorName}周期对比`

  useEffect(() => {
    chartInstanceRef.current?.dispatchAction({ type: 'hideTip' })
  }, [currentCode, mode])
  const currentPin = pins.find((pin) => (
    pin.mode === mode
    && pin.indicatorCodes[0] === currentCode
    && (mode === 'trend' || (
      pin.cycleEventIds.length === currentCycles.length
      && pin.cycleEventIds.every((id) => currentCycles.includes(id))
    ))
  ))
  const filteredPins = useMemo(() => {
    const query = savedQuery.trim().toLocaleLowerCase('zh-CN')
    return [...pins]
      .sort((first, second) => second.createdAt.localeCompare(first.createdAt))
      .filter((pin) => {
        if (!query) return true
        const modeLabel = pin.mode === 'trend' ? '实际日期趋势' : '化疗周期叠加'
        return `${pin.title} ${modeLabel}`.toLocaleLowerCase('zh-CN').includes(query)
      })
  }, [pins, savedQuery])

  const trendOption = useMemo(() => ({
    color: seriesColors,
    tooltip: { trigger: 'axis' },
    grid: { left: 48, right: 28, top: 28, bottom: 62 },
    xAxis: { type: 'time', axisLabel: { formatter: (value: number) => format(new Date(value), 'MM-dd') } },
    yAxis: { type: 'value', name: currentIndicator?.unit ?? '', scale: true, splitLine: { lineStyle: { color: '#dbe6e9' } } },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 20, bottom: 14 }],
    series: currentCode ? [{
      name: `${currentIndicator?.name ?? currentCode}${currentIndicator?.unit ? ` (${currentIndicator.unit})` : ''}`,
      type: 'line',
      smooth: false,
      connectNulls: false,
      symbolSize: 8,
      data: records.flatMap((record) => record.indicators.filter((item) => item.normalizedCode === currentCode && item.value !== null).map((item) => ({ value: [record.examDate, item.value], record, item }))).sort((a, b) => String(a.value[0]).localeCompare(String(b.value[0]))),
      markLine: showEventMarkers ? { silent: true, data: events.filter((event) => ['chemotherapy', 'surgery', 'hospitalization'].includes(event.type)).map((event) => ({ xAxis: event.startDate, label: { formatter: event.title, position: 'insideEndTop' }, lineStyle: { color: EVENT_TYPES[event.type].color, opacity: 0.45, type: 'dashed' } })) } : undefined,
    }] : [],
  }), [currentCode, currentIndicator, records, events, showEventMarkers])

  const cycleOption = useMemo(() => {
    const code = currentCode
    const meta = currentIndicator
    const displayedCycles = cyclesNewestFirst.filter((cycle) => currentCycles.includes(cycle.id))
    const legendRows = Math.max(1, Math.ceil(displayedCycles.length / 7))
    return {
      color: displayedCycles.map((cycle) => cycleSeriesColor(chemotherapyCycles.findIndex((item) => item.id === cycle.id))),
      tooltip: { trigger: 'axis' },
      legend: {
        top: 0,
        left: 0,
        right: 0,
        type: 'plain',
        itemWidth: 16,
        itemHeight: 8,
        itemGap: 9,
        textStyle: { fontSize: 12 },
        formatter: (name: string) => name.split('·', 1)[0],
      },
      grid: { left: 44, right: 18, top: 26 + legendRows * 18, bottom: 34 },
      xAxis: { type: 'value', min: 0, minInterval: 1, axisLabel: { formatter: (value: number) => String(value + 1) } },
      yAxis: { type: 'value', name: meta?.unit ?? '', scale: true, splitLine: { lineStyle: { color: '#dbe6e9' } } },
      series: displayedCycles.map((cycle) => {
        const dayOne = parseISO(cycle.dayOne)
        const cycleIndex = chemotherapyCycles.findIndex((item) => item.id === cycle.id)
        const cycleNumber = cycle.cycleNumber ?? cycleIndex + 1
        const duplicateCycleNumber = cycle.cycleNumber !== undefined
          && chemotherapyCycles.filter((item) => item.cycleNumber === cycle.cycleNumber).length > 1
        const cycleLabel = `C${cycleNumber}${duplicateCycleNumber ? `·${format(dayOne, 'yyMMdd')}` : ''}`
        const nextCycle = chemotherapyCycles[cycleIndex + 1]
        const maxDay = nextCycle ? differenceInCalendarDays(parseISO(nextCycle.dayOne), dayOne) - 1 : 42
        const data = records.flatMap((record) => record.indicators.filter((item) => item.normalizedCode === code && item.value !== null).map((item) => ({ day: differenceInCalendarDays(parseISO(record.examDate), dayOne), value: item.value }))).filter((item) => item.day >= 0 && item.day <= maxDay).sort((a, b) => a.day - b.day).map((item) => [item.day, item.value])
        const values = data.map((item) => item[1] as number)
        const min = values.length ? Math.min(...values) : null
        return { name: cycleLabel, type: 'line', symbolSize: 8, data, markPoint: min === null ? undefined : { symbolSize: 42, data: [{ type: 'min', name: '最低点' }] } }
      }),
    }
  }, [currentCode, currentCycles, chemotherapyCycles, currentIndicator, cyclesNewestFirst, records])

  function persistIndicatorLayout(nextOrder: string[], nextPinned: string[]) {
    void savePreferences({ ...preferences, chartIndicatorOrder: nextOrder, chartPinnedIndicatorCodes: nextPinned })
  }

  async function pinCurrent() {
    if (!currentCode) return
    if (currentPin) {
      await deletePin(currentPin.id)
      return
    }
    const pin: ChartPin = { id: newId(), title: currentChartTitle, mode, indicatorCodes: [currentCode], cycleEventIds: mode === 'cycle' ? currentCycles : [], createdAt: new Date().toISOString() }
    await savePin(pin)
  }

  async function confirmDeletePin() {
    if (!deletingPin) return
    setDeletePinBusy(true)
    setDeletePinError('')
    try {
      await deletePin(deletingPin.id)
      setDeletingPin(null)
    } catch (error) {
      setDeletePinError(error instanceof Error ? error.message : '删除失败，请重试')
    } finally {
      setDeletePinBusy(false)
    }
  }

  function applyPin(pin: ChartPin) {
    setMode(pin.mode)
    setSelectedCode(pin.indicatorCodes[0] ?? '')
    setSelectedCycles(pin.cycleEventIds)
    setSavedChartsOpen(false)
  }

  return <>
    {pins.length > 0 && <div className="saved-charts-access">
      <button
        type="button"
        className="saved-charts-trigger"
        aria-label={`打开已保存图表，共 ${pins.length} 个`}
        onClick={() => { setSavedQuery(''); setSavedChartsOpen(true) }}
      >
        <BookmarkCheck aria-hidden="true" />
        <span>已保存图表</span>
        <small>{pins.length}</small>
        <ChevronRight aria-hidden="true" />
      </button>
    </div>}
    {savedChartsOpen && <Modal title={`已保存图表（${pins.length}）`} onClose={() => setSavedChartsOpen(false)}>
      <label className="search-box saved-chart-search">
        <Search aria-hidden="true" />
        <span className="sr-only">搜索已保存图表</span>
        <input value={savedQuery} onChange={(event) => setSavedQuery(event.target.value)} placeholder="搜索指标或图表模式" autoFocus />
      </label>
      <div className="saved-chart-list">
        {filteredPins.map((pin) => <SwipeableListItem
          itemId={pin.id}
          label={pin.title}
          className="saved-chart-row"
          surfaceClassName="saved-chart-surface"
          actions={[{
            id: 'delete',
            label: '删除',
            accessibilityLabel: `删除已保存图表 ${pin.title}`,
            icon: <BookmarkX />,
            tone: 'danger',
            onSelect: () => { setDeletePinError(''); setDeletingPin(pin) },
          }]}
          key={pin.id}
        >
          <button type="button" className="saved-chart-apply" onClick={() => applyPin(pin)}>
            <span className="saved-chart-icon"><Bookmark aria-hidden="true" /></span>
            <span className="saved-chart-copy">
              <strong>{pin.title}</strong>
              <small>{pin.mode === 'trend' ? '实际日期趋势' : `化疗周期叠加 · ${pin.cycleEventIds.length} 个周期`}</small>
            </span>
            <ChevronRight aria-hidden="true" />
          </button>
        </SwipeableListItem>)}
        {filteredPins.length === 0 && <div className="empty-inline"><Search /><strong>没有匹配的图表</strong><p>换个指标名称或图表模式试试。</p></div>}
      </div>
    </Modal>}
    {deletingPin && <ConfirmSheet
      title="删除已保存图表"
      message={`确定删除“${deletingPin.title}”？`}
      description="删除后不会影响检查记录和病程数据。"
      busy={deletePinBusy}
      error={deletePinError}
      onCancel={() => setDeletingPin(null)}
      onConfirm={() => void confirmDeletePin()}
    />}
    <section className="chart-controls card">
      <div className="chart-controls-toolbar"><div className="segmented" role="group" aria-label="图表模式"><button className={mode === 'trend' ? 'active' : ''} onClick={() => setMode('trend')}>实际日期趋势</button><button className={mode === 'cycle' ? 'active' : ''} onClick={() => setMode('cycle')}>化疗周期叠加</button></div></div>
      <div className="control-groups">
        <IndicatorPicker
          options={indicators}
          value={currentCode}
          pinnedCodes={pinnedIndicatorCodes}
          onChange={setSelectedCode}
          onPinnedChange={(nextPinned) => persistIndicatorLayout(indicatorOrder, nextPinned)}
          onOrderChange={persistIndicatorLayout}
        />
        {mode === 'cycle' && <ChoicePicker label="叠加周期" multiple allLabel="全部周期" orderByRecent={false} options={cyclesNewestFirst.map((cycle) => ({ value: cycle.id, label: cycle.title, description: `Day 1：${cycle.dayOne}${cycle.events.length > 1 ? ` · ${cycle.events.length} 次给药` : ''}` }))} value={currentCycles} onChange={(value) => setSelectedCycles(value as string[])} emptyText="暂无化疗周期" />}
      </div>
    </section>
    <section className="chart-card card">
      <div className="chart-card-header">
        <div className="chart-card-heading">
          <span>{mode === 'trend' ? '实际日期趋势' : '化疗周期叠加'}</span>
          <h2>{currentChartTitle}</h2>
        </div>
        <div className="chart-card-actions">
          {mode === 'trend' && events.some((event) => ['chemotherapy', 'surgery', 'hospitalization'].includes(event.type)) && <button
            className="icon-button chart-marker-toggle"
            type="button"
            aria-label={showEventMarkers ? '隐藏病程标记' : '显示病程标记'}
            aria-pressed={showEventMarkers}
            title={showEventMarkers ? '隐藏病程标记' : '显示病程标记'}
            onClick={() => setShowEventMarkers((current) => !current)}
          >
            {showEventMarkers ? <EyeOff /> : <Eye />}
          </button>}
          <button
            className="icon-button chart-bookmark-button"
            type="button"
            aria-label={currentPin ? '取消保存当前图表' : '保存当前图表'}
            aria-pressed={Boolean(currentPin)}
            title={currentPin ? '取消保存当前图表' : '保存当前图表'}
            disabled={!currentCode}
            onClick={() => void pinCurrent()}
          >
            {currentPin ? <BookmarkCheck /> : <Bookmark />}
          </button>
        </div>
      </div>
      {indicators.length === 0 ? <div className="empty-state"><ChartNoAxesCombined /><h3>还没有可绘制的指标</h3><p>导入含数值指标的检查报告后，趋势图会自动出现。</p></div> : mode === 'cycle' && chemotherapyCycles.length === 0 ? <div className="empty-state"><RotateCcw /><h3>还没有化疗周期</h3><p>先在病程日历中创建化疗事件并设置 Day 1。</p></div> : <ReactECharts option={mode === 'trend' ? trendOption : cycleOption} style={{ height: 460 }} notMerge onChartReady={(instance) => { chartInstanceRef.current = instance }} />}
    </section>
  </>
}
