import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import ReactECharts from 'echarts-for-react'
import { Bookmark, BookmarkCheck, BookmarkX, ChartNoAxesCombined, ChevronRight, RotateCcw, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ChoicePicker } from '../components/ChoicePicker'
import { IndicatorPicker } from '../components/IndicatorPicker'
import { Modal } from '../components/Modal'
import { sortChartIndicators } from '../services/chartIndicators'
import { useApp } from '../store/AppContext'
import { EVENT_TYPES, newId, type ChartPin } from '../types'

const seriesColors = ['#0891b2', '#7a5af8', '#e45756', '#f59e0b', '#16a34a', '#2563eb']

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
  const chemoEvents = useMemo(() => events.filter((event) => event.type === 'chemotherapy').sort((a, b) => a.startDate.localeCompare(b.startDate)), [events])
  const [mode, setMode] = useState<'trend' | 'cycle'>('trend')
  const [selectedCode, setSelectedCode] = useState('')
  const [selectedCycles, setSelectedCycles] = useState<string[]>([])
  const [savedChartsOpen, setSavedChartsOpen] = useState(false)
  const [savedQuery, setSavedQuery] = useState('')

  const currentCode = indicators.some((item) => item.code === selectedCode) ? selectedCode : indicators[0]?.code ?? ''
  const currentCycles = selectedCycles.length ? selectedCycles : chemoEvents.map((event) => event.id)
  const currentIndicator = indicators.find((item) => item.code === currentCode)
  const currentIndicatorName = currentIndicator?.name || currentCode || '检查指标'
  const currentChartTitle = mode === 'trend'
    ? `${currentIndicatorName}趋势`
    : `${currentIndicatorName}周期对比`
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
      markLine: { silent: true, data: events.filter((event) => ['chemotherapy', 'surgery', 'hospitalization'].includes(event.type)).map((event) => ({ xAxis: event.startDate, label: { formatter: event.title, position: 'insideEndTop' }, lineStyle: { color: EVENT_TYPES[event.type].color, opacity: 0.45, type: 'dashed' } })) },
    }] : [],
  }), [currentCode, currentIndicator, records, events])

  const cycleOption = useMemo(() => {
    const code = currentCode
    const meta = currentIndicator
    return {
      color: seriesColors,
      tooltip: { trigger: 'axis' },
      legend: { top: 0, type: 'scroll' },
      grid: { left: 48, right: 28, top: 52, bottom: 48 },
      xAxis: { type: 'value', name: '相对 Day 1（天）', min: 0, minInterval: 1, axisLabel: { formatter: (value: number) => value === 0 ? 'D1' : `D+${value}` } },
      yAxis: { type: 'value', name: meta?.unit ?? '', scale: true, splitLine: { lineStyle: { color: '#dbe6e9' } } },
      series: chemoEvents.filter((event) => currentCycles.includes(event.id)).map((event, index) => {
        const dayOne = parseISO(event.cycleDayOne || event.startDate)
        const nextCycle = chemoEvents[index + 1]
        const maxDay = nextCycle ? differenceInCalendarDays(parseISO(nextCycle.cycleDayOne || nextCycle.startDate), dayOne) - 1 : 42
        const data = records.flatMap((record) => record.indicators.filter((item) => item.normalizedCode === code && item.value !== null).map((item) => ({ day: differenceInCalendarDays(parseISO(record.examDate), dayOne), value: item.value }))).filter((item) => item.day >= 0 && item.day <= maxDay).sort((a, b) => a.day - b.day).map((item) => [item.day, item.value])
        const values = data.map((item) => item[1] as number)
        const min = values.length ? Math.min(...values) : null
        return { name: event.cycleNumber ? `第 ${event.cycleNumber} 周期` : event.title, type: 'line', symbolSize: 8, data, markPoint: min === null ? undefined : { symbolSize: 42, data: [{ type: 'min', name: '最低点' }] } }
      }),
    }
  }, [currentCode, currentCycles, chemoEvents, currentIndicator, records])

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
        {filteredPins.map((pin) => <div className="saved-chart-row" key={pin.id}>
          <button type="button" className="saved-chart-apply" onClick={() => applyPin(pin)}>
            <span className="saved-chart-icon"><Bookmark aria-hidden="true" /></span>
            <span className="saved-chart-copy">
              <strong>{pin.title}</strong>
              <small>{pin.mode === 'trend' ? '实际日期趋势' : `化疗周期叠加 · ${pin.cycleEventIds.length} 个周期`}</small>
            </span>
            <ChevronRight aria-hidden="true" />
          </button>
          <button type="button" className="saved-chart-delete" aria-label={`删除已保存图表 ${pin.title}`} onClick={() => void deletePin(pin.id)}><BookmarkX /></button>
        </div>)}
        {filteredPins.length === 0 && <div className="empty-inline"><Search /><strong>没有匹配的图表</strong><p>换个指标名称或图表模式试试。</p></div>}
      </div>
    </Modal>}
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
        {mode === 'cycle' && <ChoicePicker label="叠加周期" multiple allLabel="全部周期" options={chemoEvents.map((event) => ({ value: event.id, label: event.cycleNumber ? `第 ${event.cycleNumber} 周期` : event.title, description: `Day 1：${event.cycleDayOne || event.startDate}` }))} value={currentCycles} onChange={(value) => setSelectedCycles(value as string[])} emptyText="暂无化疗周期" />}
      </div>
    </section>
    <section className="chart-card card">
      <div className="chart-card-header">
        <div className="chart-card-heading">
          <span>{mode === 'trend' ? '实际日期趋势' : '化疗周期叠加'}</span>
          <h2>{currentChartTitle}</h2>
        </div>
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
      {indicators.length === 0 ? <div className="empty-state"><ChartNoAxesCombined /><h3>还没有可绘制的指标</h3><p>导入含数值指标的检查报告后，趋势图会自动出现。</p></div> : mode === 'cycle' && chemoEvents.length === 0 ? <div className="empty-state"><RotateCcw /><h3>还没有化疗周期</h3><p>先在病程日历中创建化疗事件并设置 Day 1。</p></div> : <ReactECharts option={mode === 'trend' ? trendOption : cycleOption} style={{ height: 460 }} notMerge />}
    </section>
  </>
}
