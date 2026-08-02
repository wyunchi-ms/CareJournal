import { differenceInCalendarDays, format, parseISO, subMonths } from 'date-fns'
import type { EChartsType } from 'echarts'
import ReactECharts from 'echarts-for-react'
import { Bookmark, BookmarkCheck, BookmarkX, CalendarPlus, ChartNoAxesCombined, ChevronRight, Eye, EyeOff, FileUp, GripVertical, Plus, RotateCcw, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { ChoicePicker } from '../components/ChoicePicker'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { IndicatorPicker } from '../components/IndicatorPicker'
import { Modal } from '../components/Modal'
import { RecordSummaryContent } from '../components/RecordSummaryContent'
import { useSortableDragLift } from '../components/SortableDragLift'
import { SortableDragOverlay } from '../components/SortableDragOverlay'
import { SwipeableListItem } from '../components/SwipeableListItem'
import { sortChartIndicators } from '../services/chartIndicators'
import { moveChartPin, sortChartPins } from '../services/chartPins'
import { groupChemotherapyCycles, type ChemotherapyCycle } from '../services/chemotherapy'
import { useApp } from '../store/AppContext'
import { EVENT_TYPES, newId, type ChartPin, type ExamRecord, type TreatmentEvent } from '../types'

const seriesColors = ['#0891b2', '#7a5af8', '#e45756', '#f59e0b', '#16a34a', '#2563eb']
const cycleSeriesColors = ['#0072b2', '#e69f00', '#009e73', '#cc79a7', '#d55e00', '#56b4e9', '#7a3e9d', '#6b7a00', '#8c564b', '#17becf', '#e83e8c', '#4d7c0f']
const hasRecordDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)

interface ChartIndicatorMeta {
  code: string
  name: string
  unit: string
}

type TrendRange = '3m' | '6m' | '1y' | 'all'

const trendRangeOptions: Array<{ value: TrendRange; label: string; months: number | null }> = [
  { value: '3m', label: '3个月', months: 3 },
  { value: '6m', label: '6个月', months: 6 },
  { value: '1y', label: '1年', months: 12 },
  { value: 'all', label: '全部', months: null },
]

function cycleSeriesColor(index: number) {
  if (index < cycleSeriesColors.length) return cycleSeriesColors[index]
  const hue = Math.round((index * 137.508 + 25) % 360)
  const lightness = 42 + (Math.floor(index / cycleSeriesColors.length) % 2) * 8
  return `hsl(${hue}, 72%, ${lightness}%)`
}

function buildTrendOption(
  records: ExamRecord[],
  events: TreatmentEvent[],
  code: string,
  meta: ChartIndicatorMeta | undefined,
  showEventMarkers: boolean,
  range: TrendRange = 'all',
) {
  const data = code
    ? records.filter((record) => hasRecordDate(record.sampleDate)).flatMap((record) => (
        record.indicators
          .filter((item) => item.normalizedCode === code && item.value !== null)
          .map((item) => ({ value: [record.sampleDate, item.value], record, item }))
      )).sort((a, b) => String(a.value[0]).localeCompare(String(b.value[0])))
    : []
  const firstDate = data[0]?.value[0] as string | undefined
  const lastDate = data.at(-1)?.value[0] as string | undefined
  const rangeMonths = trendRangeOptions.find((option) => option.value === range)?.months ?? null
  const requestedStart = lastDate && rangeMonths !== null
    ? format(subMonths(parseISO(lastDate), rangeMonths), 'yyyy-MM-dd')
    : undefined
  const startValue = requestedStart && firstDate && requestedStart > firstDate ? requestedStart : undefined
  const visibleSpanDays = firstDate && lastDate
    ? differenceInCalendarDays(parseISO(lastDate), parseISO(startValue ?? firstDate))
    : 0
  const zoomWindow = startValue && lastDate ? { startValue, endValue: lastDate } : {}
  return {
    color: seriesColors,
    tooltip: {
      trigger: 'axis',
      renderMode: 'richText',
      confine: true,
      enterable: false,
      alwaysShowContent: false,
      hideDelay: 0,
      transitionDuration: 0,
    },
    grid: { left: 48, right: 28, top: 28, bottom: 76 },
    xAxis: {
      type: 'time',
      splitNumber: 5,
      axisLabel: {
        hideOverlap: true,
        formatter: (value: number) => format(new Date(value), visibleSpanDays > 550 ? 'yy-MM' : 'MM-dd'),
      },
    },
    yAxis: { type: 'value', name: meta?.unit ?? '', scale: true, splitLine: { lineStyle: { color: '#dbe6e9' } } },
    dataZoom: [
      {
        type: 'inside',
        filterMode: 'filter',
        zoomOnMouseWheel: 'ctrl',
        moveOnMouseMove: true,
        moveOnMouseWheel: 'shift',
        preventDefaultMouseMove: false,
        ...zoomWindow,
      },
      {
        type: 'slider',
        filterMode: 'filter',
        height: 28,
        bottom: 10,
        handleSize: 22,
        moveHandleSize: 10,
        brushSelect: false,
        showDetail: false,
        ...zoomWindow,
      },
    ],
    series: code ? [{
      name: `${meta?.name ?? code}${meta?.unit ? ` (${meta.unit})` : ''}`,
      type: 'line',
      smooth: false,
      connectNulls: false,
      symbolSize: 8,
      data,
      markLine: showEventMarkers ? { silent: true, data: events.filter((event) => ['chemotherapy', 'surgery', 'hospitalization'].includes(event.type)).map((event) => ({ xAxis: event.startDate, label: { formatter: event.title, position: 'insideEndTop' }, lineStyle: { color: EVENT_TYPES[event.type].color, opacity: 0.45, type: 'dashed' } })) } : undefined,
    }] : [],
  }
}

function buildCycleOption(
  records: ExamRecord[],
  chemotherapyCycles: ChemotherapyCycle[],
  cyclesNewestFirst: ChemotherapyCycle[],
  selectedCycleIds: string[],
  code: string,
  meta: ChartIndicatorMeta | undefined,
) {
  const displayedCycles = cyclesNewestFirst.filter((cycle) => selectedCycleIds.includes(cycle.id))
  const legendRows = Math.max(1, Math.ceil(displayedCycles.length / 7))
  return {
    color: displayedCycles.map((cycle) => cycleSeriesColor(chemotherapyCycles.findIndex((item) => item.id === cycle.id))),
    tooltip: { trigger: 'axis', renderMode: 'richText', confine: true, enterable: false, alwaysShowContent: false, hideDelay: 0, transitionDuration: 0 },
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
    dataZoom: [{ type: 'inside', filterMode: 'filter' }],
    series: displayedCycles.map((cycle) => {
      const dayOne = parseISO(cycle.dayOne)
      const cycleIndex = chemotherapyCycles.findIndex((item) => item.id === cycle.id)
      const cycleNumber = cycle.cycleNumber ?? cycleIndex + 1
      const duplicateCycleNumber = cycle.cycleNumber !== undefined
        && chemotherapyCycles.filter((item) => item.cycleNumber === cycle.cycleNumber).length > 1
      const cycleLabel = `C${cycleNumber}${duplicateCycleNumber ? `·${format(dayOne, 'yyMMdd')}` : ''}`
      const nextCycle = chemotherapyCycles[cycleIndex + 1]
      const maxDay = nextCycle ? differenceInCalendarDays(parseISO(nextCycle.dayOne), dayOne) - 1 : 42
      const data = records.filter((record) => hasRecordDate(record.sampleDate)).flatMap((record) => record.indicators.filter((item) => item.normalizedCode === code && item.value !== null).map((item) => ({ day: differenceInCalendarDays(parseISO(record.sampleDate), dayOne), value: item.value }))).filter((item) => item.day >= 0 && item.day <= maxDay).sort((a, b) => a.day - b.day).map((item) => [item.day, item.value])
      const values = data.map((item) => item[1] as number)
      const min = values.length ? Math.min(...values) : null
      return { name: cycleLabel, type: 'line', symbolSize: 8, data, markPoint: min === null ? undefined : { symbolSize: 42, data: [{ type: 'min', name: '最低点' }] } }
    }),
  }
}

function recordsForChart(
  records: ExamRecord[],
  code: string,
  mode: ChartPin['mode'],
  chemotherapyCycles: ChemotherapyCycle[],
  selectedCycleIds: string[],
) {
  const numericRecords = records.filter((record) => (
    hasRecordDate(record.sampleDate)
    && record.indicators.some((indicator) => indicator.normalizedCode === code && indicator.value !== null)
  ))
  if (mode === 'trend') return [...numericRecords].sort((first, second) => second.sampleDate.localeCompare(first.sampleDate))
  return numericRecords.filter((record) => chemotherapyCycles.some((cycle, cycleIndex) => {
    if (!selectedCycleIds.includes(cycle.id)) return false
    const dayOne = parseISO(cycle.dayOne)
    const nextCycle = chemotherapyCycles[cycleIndex + 1]
    const maxDay = nextCycle ? differenceInCalendarDays(parseISO(nextCycle.dayOne), dayOne) - 1 : 42
    const day = differenceInCalendarDays(parseISO(record.sampleDate), dayOne)
    return day >= 0 && day <= maxDay
  })).sort((first, second) => second.sampleDate.localeCompare(first.sampleDate))
}

function TimeSeriesChart({ option, compact = false, height, onReady }: { option: object; compact?: boolean; height?: number; onReady?: (instance: EChartsType) => void }) {
  return <div className={`chart-canvas-gesture${compact ? ' compact' : ''}`}>
    <ReactECharts
      option={option}
      style={{ height: height ?? (compact ? 300 : 460) }}
      opts={{ renderer: 'canvas' }}
      notMerge
      onChartReady={onReady}
    />
  </div>
}

export function ChartsPage() {
  const { records, events, pins, preferences, savePin, reorderPins, deletePin, savePreferences } = useApp()
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
  const [savedChartsReordering, setSavedChartsReordering] = useState(false)
  const [draftPinOrder, setDraftPinOrder] = useState<string[]>([])
  const [savedOrderError, setSavedOrderError] = useState('')
  const [deletingPin, setDeletingPin] = useState<ChartPin | null>(null)
  const [deletePinBusy, setDeletePinBusy] = useState(false)
  const [deletePinError, setDeletePinError] = useState('')
  const [addingChart, setAddingChart] = useState(false)
  const [detailPinId, setDetailPinId] = useState<string | null>(null)
  const [detailCycleIds, setDetailCycleIds] = useState<string[]>([])
  const [detailTrendRange, setDetailTrendRange] = useState<TrendRange>('6m')
  const [detailSaveError, setDetailSaveError] = useState('')
  const [showEventMarkers, setShowEventMarkers] = useState(false)
  const chartInstancesRef = useRef(new Set<EChartsType>())
  const draftPinOrderRef = useRef<string[]>([])
  const dragTargetPinIdRef = useRef<string | null>(null)
  const { beginDrag: beginPinDrag, draggingId: draggingPinId, finishDrag: finishPinDragLift, listRef: savedChartListRef, positionerRef: savedChartPositionerRef, preview: savedChartPreview } = useSortableDragLift({
    enabled: savedChartsReordering,
    layoutKey: draftPinOrder.join('\u0000'),
    onDragMove: ({ clientX, clientY, sourceId }) => {
      if (typeof document.elementFromPoint !== 'function') return
      const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-saved-chart-id]')
      const targetId = target?.dataset.savedChartId
      if (!targetId || targetId === sourceId) {
        dragTargetPinIdRef.current = null
        return
      }
      if (targetId === dragTargetPinIdRef.current) return
      dragTargetPinIdRef.current = targetId
      const next = moveChartPin(draftPinOrderRef.current, sourceId, targetId)
      if (next !== draftPinOrderRef.current) setPinOrder(next)
    },
    onDragEnd: () => {
      dragTargetPinIdRef.current = null
      persistPinOrder(draftPinOrderRef.current)
    },
  })

  const currentCode = indicators.some((item) => item.code === selectedCode) ? selectedCode : indicators[0]?.code ?? ''
  const currentCycles = selectedCycles.length ? selectedCycles : chemotherapyCycles.map((cycle) => cycle.id)
  const currentIndicator = indicators.find((item) => item.code === currentCode)
  const currentIndicatorName = currentIndicator?.name || currentCode || '检查指标'
  const currentChartTitle = mode === 'trend'
    ? `${currentIndicatorName}趋势`
    : `${currentIndicatorName}周期对比`

  const hideChartTooltips = useCallback(() => {
    chartInstancesRef.current.forEach((instance) => {
      if (typeof instance.isDisposed === 'function' && instance.isDisposed()) {
        chartInstancesRef.current.delete(instance)
        return
      }
      instance.dispatchAction({ type: 'hideTip' })
    })
  }, [])

  const registerChartInstance = useCallback((instance: EChartsType) => {
    chartInstancesRef.current.add(instance)
  }, [])

  useEffect(() => {
    hideChartTooltips()
  }, [currentCode, hideChartTooltips, mode])

  useEffect(() => {
    const chartInstances = chartInstancesRef.current
    const hide = () => hideChartTooltips()
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
      chartInstances.clear()
    }
  }, [hideChartTooltips])
  const currentPin = pins.find((pin) => (
    pin.mode === mode
    && pin.indicatorCodes[0] === currentCode
    && (mode === 'trend' || (
      pin.cycleEventIds.length === currentCycles.length
      && pin.cycleEventIds.every((id) => currentCycles.includes(id))
    ))
  ))
  const orderedPins = useMemo(() => sortChartPins(pins), [pins])
  const pinById = useMemo(() => new Map(orderedPins.map((pin) => [pin.id, pin])), [orderedPins])
  const filteredPins = useMemo(() => {
    const query = savedQuery.trim().toLocaleLowerCase('zh-CN')
    return orderedPins
      .filter((pin) => {
        if (!query) return true
        const modeLabel = pin.mode === 'trend' ? '实际日期趋势' : '化疗周期叠加'
        return `${pin.title} ${modeLabel}`.toLocaleLowerCase('zh-CN').includes(query)
      })
  }, [orderedPins, savedQuery])
  const visiblePins = savedChartsReordering
    ? draftPinOrder.map((id) => pinById.get(id)).filter((pin): pin is ChartPin => Boolean(pin))
    : filteredPins
  const detailPin = detailPinId ? pins.find((pin) => pin.id === detailPinId) ?? null : null
  const detailCode = detailPin?.indicatorCodes[0] ?? ''
  const detailIndicator = indicators.find((item) => item.code === detailCode)
  const effectiveDetailCycleIds = detailPin?.mode === 'cycle'
    ? detailCycleIds
    : []
  const detailOption = detailPin
    ? detailPin.mode === 'trend'
      ? buildTrendOption(records, events, detailCode, detailIndicator, false, detailTrendRange)
      : buildCycleOption(records, chemotherapyCycles, cyclesNewestFirst, effectiveDetailCycleIds, detailCode, detailIndicator)
    : null
  const detailRecords = detailPin
    ? recordsForChart(records, detailCode, detailPin.mode, chemotherapyCycles, effectiveDetailCycleIds)
    : []
  const showChartBuilder = pins.length === 0 || addingChart

  const trendOption = useMemo(
    () => buildTrendOption(records, events, currentCode, currentIndicator, showEventMarkers),
    [currentCode, currentIndicator, records, events, showEventMarkers],
  )

  const cycleOption = useMemo(
    () => buildCycleOption(records, chemotherapyCycles, cyclesNewestFirst, currentCycles, currentCode, currentIndicator),
    [currentCode, currentCycles, chemotherapyCycles, currentIndicator, cyclesNewestFirst, records],
  )

  const savedChartItems = useMemo(() => orderedPins.map((pin) => {
    const code = pin.indicatorCodes[0] ?? ''
    const meta = indicators.find((item) => item.code === code)
    const availableCycleIds = chemotherapyCycles.map((cycle) => cycle.id)
    const savedCycleIds = pin.cycleEventIds.filter((id) => availableCycleIds.includes(id))
    const selectedCycleIds = savedCycleIds.length ? savedCycleIds : availableCycleIds
    return {
      pin,
      option: pin.mode === 'trend'
        ? buildTrendOption(records, events, code, meta, false)
        : buildCycleOption(records, chemotherapyCycles, cyclesNewestFirst, selectedCycleIds, code, meta),
      unavailable: !meta || (pin.mode === 'cycle' && selectedCycleIds.length === 0),
    }
  }), [orderedPins, indicators, records, events, chemotherapyCycles, cyclesNewestFirst])

  function persistIndicatorLayout(nextOrder: string[], nextPinned: string[]) {
    void savePreferences({ ...preferences, chartIndicatorOrder: nextOrder, chartPinnedIndicatorCodes: nextPinned })
  }

  async function pinCurrent() {
    if (!currentCode || currentPin) return
    const pin: ChartPin = { id: newId(), title: currentChartTitle, mode, indicatorCodes: [currentCode], cycleEventIds: mode === 'cycle' ? currentCycles : [], createdAt: new Date().toISOString() }
    await savePin(pin)
    setAddingChart(false)
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
    if (savedChartsReordering) return
    openChartDetail(pin)
    setSavedChartsOpen(false)
  }

  function openChartDetail(pin: ChartPin) {
    const availableCycleIds = chemotherapyCycles.map((cycle) => cycle.id)
    const savedCycleIds = pin.cycleEventIds.filter((id) => availableCycleIds.includes(id))
    hideChartTooltips()
    setDetailPinId(pin.id)
    setDetailTrendRange('6m')
    setDetailCycleIds(pin.mode === 'cycle'
      ? (savedCycleIds.length ? savedCycleIds : availableCycleIds)
      : [])
    setDetailSaveError('')
  }

  async function toggleDetailCycle(cycleId: string) {
    if (!detailPin || detailPin.mode !== 'cycle') return
    const selected = detailCycleIds.includes(cycleId)
    if (selected && detailCycleIds.length === 1) return
    const next = selected
      ? detailCycleIds.filter((id) => id !== cycleId)
      : [...detailCycleIds, cycleId]
    const previous = detailCycleIds
    setDetailCycleIds(next)
    setDetailSaveError('')
    try {
      await savePin({ ...detailPin, cycleEventIds: next })
    } catch (error) {
      setDetailCycleIds(previous)
      setDetailSaveError(error instanceof Error ? error.message : '保存默认显示周期失败，请重试')
    }
  }

  function setPinOrder(next: string[]) {
    draftPinOrderRef.current = next
    setDraftPinOrder(next)
  }

  function enterSavedChartsReordering() {
    if (pins.length < 2) return
    setSavedQuery('')
    setSavedOrderError('')
    setPinOrder(orderedPins.map((pin) => pin.id))
    setSavedChartsReordering(true)
  }

  function closeSavedCharts() {
    setSavedChartsOpen(false)
    setSavedQuery('')
    setSavedChartsReordering(false)
    finishPinDragLift()
    setSavedOrderError('')
  }

  function persistPinOrder(next: string[]) {
    setPinOrder(next)
    void reorderPins(next).catch((error) => {
      setSavedOrderError(error instanceof Error ? error.message : '保存排序失败，请重试')
    })
  }

  function movePinByKeyboard(pinId: string, direction: -1 | 1) {
    const currentOrder = draftPinOrderRef.current
    const index = currentOrder.indexOf(pinId)
    const targetId = currentOrder[index + direction]
    if (!targetId) return
    persistPinOrder(moveChartPin(currentOrder, pinId, targetId))
  }

  return <>
    {savedChartsOpen && <Modal title={savedChartsReordering ? '已保存图表（排序）' : `已保存图表（${pins.length}）`} onClose={closeSavedCharts}>
      <div className={`saved-chart-tools${savedChartsReordering ? ' editing' : ''}`}>
        {savedChartsReordering
          ? <p><GripVertical /><span><strong>拖动调整图表顺序</strong><small>键盘可在把手上使用上下方向键</small></span></p>
          : <label className="search-box saved-chart-search">
              <Search aria-hidden="true" />
              <span className="sr-only">搜索已保存图表</span>
              <input value={savedQuery} onChange={(event) => setSavedQuery(event.target.value)} placeholder={pins.length > 1 ? '搜索图表，长按条目排序' : '搜索指标或图表模式'} autoFocus />
            </label>}
        {savedChartsReordering && <button type="button" className="button secondary saved-chart-order-done" onClick={() => { setSavedChartsReordering(false); finishPinDragLift() }}>完成</button>}
      </div>
      {savedOrderError && <p className="form-error" role="alert">{savedOrderError}</p>}
      <div ref={savedChartListRef} className="saved-chart-list">
        {visiblePins.map((pin) => <SwipeableListItem
          itemId={pin.id}
          itemDataAttribute="data-saved-chart-id"
          label={pin.title}
          className={`saved-chart-row${savedChartsReordering ? ' editing' : ''}${draggingPinId === pin.id ? ' sortable-drag-placeholder' : ''}`}
          surfaceClassName="saved-chart-surface"
          editMode={savedChartsReordering}
          onLongPress={pins.length > 1 ? enterSavedChartsReordering : undefined}
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
          {savedChartsReordering && <button
            type="button"
            className="saved-chart-drag-handle"
            aria-label={`拖动排序：${pin.title}`}
            title="拖动排序；键盘可用上下方向键"
            onPointerDown={(event) => beginPinDrag(event, pin.id)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
              event.preventDefault()
              movePinByKeyboard(pin.id, event.key === 'ArrowUp' ? -1 : 1)
            }}
          ><GripVertical /></button>}
          <button type="button" className="saved-chart-apply" aria-disabled={savedChartsReordering || undefined} tabIndex={savedChartsReordering ? -1 : 0} onClick={() => applyPin(pin)}>
            <span className="saved-chart-icon"><Bookmark aria-hidden="true" /></span>
            <span className="saved-chart-copy">
              <strong>{pin.title}</strong>
              <small>{pin.mode === 'trend' ? '实际日期趋势' : `化疗周期叠加 · ${pin.cycleEventIds.length} 个周期`}</small>
            </span>
            {!savedChartsReordering && <ChevronRight aria-hidden="true" />}
          </button>
        </SwipeableListItem>)}
        {visiblePins.length === 0 && <div className="empty-inline"><Search /><strong>没有匹配的图表</strong><p>换个指标名称或图表模式试试。</p></div>}
      </div>
    </Modal>}
    {detailPin && detailOption && <Modal title={detailPin.title} onClose={() => setDetailPinId(null)} wide>
      <div className="chart-detail">
        {detailPin.mode === 'cycle' && <section className="chart-detail-lines" aria-labelledby="chart-detail-lines-title">
          <div className="chart-detail-section-heading">
            <div><h3 id="chart-detail-lines-title">默认显示周期</h3><small>选择会自动保存，至少保留一条线</small></div>
            <span>{detailCycleIds.length}/{chemotherapyCycles.length}</span>
          </div>
          <div className="chart-line-options">
            {cyclesNewestFirst.map((cycle) => {
              const checked = detailCycleIds.includes(cycle.id)
              const color = cycleSeriesColor(chemotherapyCycles.findIndex((item) => item.id === cycle.id))
              return <label className={`chart-line-option${checked ? ' selected' : ''}`} style={{ '--chart-line-color': color } as CSSProperties} key={cycle.id}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={checked && detailCycleIds.length === 1}
                  onChange={() => void toggleDetailCycle(cycle.id)}
                />
                <i aria-hidden="true" />
                <span><strong>{cycle.title}</strong><small>Day 1：{cycle.dayOne}</small></span>
              </label>
            })}
          </div>
          {detailSaveError && <p className="form-error" role="alert">{detailSaveError}</p>}
        </section>}
        {detailPin.mode === 'trend' && <div className="chart-detail-range">
          <div>
            <strong>时间范围</strong>
            <div className="chart-range-options" role="group" aria-label="图表时间范围">
              {trendRangeOptions.map((option) => <button
                type="button"
                className={detailTrendRange === option.value ? 'active' : ''}
                aria-pressed={detailTrendRange === option.value}
                onClick={() => {
                  hideChartTooltips()
                  setDetailTrendRange(option.value)
                }}
                key={option.value}
              >{option.label}</button>)}
            </div>
          </div>
          <small>左右拖动图表平移，拖动下方手柄或双指精细缩放</small>
        </div>}
        <section className="chart-detail-visual" aria-label={`${detailPin.title}图表`}>
          <TimeSeriesChart option={detailOption} height={400} onReady={registerChartInstance} />
        </section>
        <section className="chart-detail-records" aria-labelledby="chart-detail-records-title">
          <div className="chart-detail-section-heading">
            <div><h3 id="chart-detail-records-title">相关检查报告</h3><small>仅显示当前图表实际使用的数值报告</small></div>
            <span>{detailRecords.length} 份</span>
          </div>
          <div className="chart-report-list">
            {detailRecords.map((record) => <Link
              className="record-row chart-report-row"
              to={`/records?recordId=${encodeURIComponent(record.id)}`}
              state={{ recordDetailOrigin: '/charts' }}
              onClick={() => setDetailPinId(null)}
              aria-label={`打开相关检查报告：${record.sampleDate || '日期未识别'}`}
              key={record.id}
            >
              <RecordSummaryContent record={record} showDate />
            </Link>)}
            {detailRecords.length === 0 && <div className="empty-inline"><ChartNoAxesCombined /><strong>没有相关数值报告</strong><p>当前选择的周期内没有可绘制的数据。</p></div>}
          </div>
        </section>
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
    {savedChartItems.length > 0 && <section className="saved-chart-dashboard" aria-label="收藏图表">
      <div className="saved-chart-dashboard-header">
        <div className="saved-chart-dashboard-actions">
          {indicators.length > 0 && <button
            type="button"
            className={`button ${addingChart ? 'secondary' : 'primary'} chart-add-button`}
            aria-expanded={addingChart}
            onClick={() => setAddingChart((current) => !current)}
          >
            {addingChart ? <X /> : <Plus />}
            <span>{addingChart ? '收起' : '添加图表'}</span>
          </button>}
          <button
            type="button"
            className="saved-charts-trigger"
            aria-label={`管理已保存图表，共 ${pins.length} 个`}
            title={`管理已保存图表（${pins.length}）`}
            onClick={() => { setSavedQuery(''); setSavedChartsReordering(false); setSavedOrderError(''); setSavedChartsOpen(true) }}
          >
            <Bookmark aria-hidden="true" />
            <span>管理</span>
            <small>{pins.length}</small>
          </button>
        </div>
      </div>
      {(() => {
        const previewPin = savedChartPreview ? pinById.get(savedChartPreview.itemId) : undefined
        if (!previewPin) return null
        return <SortableDragOverlay preview={savedChartPreview} positionerRef={savedChartPositionerRef}>
          <span className="sortable-drag-preview-handle"><GripVertical /></span>
          <span className="sortable-drag-preview-content"><strong>{previewPin.title}</strong><small>{previewPin.mode === 'trend' ? '实际日期趋势' : `化疗周期叠加 · ${previewPin.cycleEventIds.length} 个周期`}</small></span>
        </SortableDragOverlay>
      })()}
      {addingChart && indicators.length > 0 && <section className="chart-controls card" aria-label="添加图表设置">
        <div className="chart-explorer-heading"><strong>添加图表</strong><small>选择模式、指标和默认范围</small></div>
        <div className="chart-controls-toolbar">
          <div className="segmented" role="tablist" aria-label="图表模式">
            <button type="button" role="tab" aria-selected={mode === 'trend'} className={mode === 'trend' ? 'active' : ''} onClick={() => setMode('trend')}>实际日期趋势</button>
            <button type="button" role="tab" aria-selected={mode === 'cycle'} className={mode === 'cycle' ? 'active' : ''} onClick={() => setMode('cycle')}>化疗周期叠加</button>
          </div>
        </div>
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
      </section>}
      {!addingChart && <div className="saved-chart-grid">
        {savedChartItems.map(({ pin, option, unavailable }) => <article
          className="saved-chart-overview-card card"
          role="button"
          tabIndex={0}
          aria-label={`查看图表详情：${pin.title}`}
          onClick={() => openChartDetail(pin)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            openChartDetail(pin)
          }}
          key={pin.id}
        >
          <div className="saved-chart-overview-heading">
            <div>
              <span>{pin.mode === 'trend' ? '实际日期趋势' : '化疗周期叠加'}</span>
              <h3>{pin.title}</h3>
            </div>
            <ChevronRight aria-hidden="true" />
          </div>
          {unavailable
            ? <div className="saved-chart-unavailable"><ChartNoAxesCombined /><strong>暂时无法绘制</strong><small>相关指标或化疗周期当前不可用</small></div>
            : <TimeSeriesChart option={option} compact onReady={registerChartInstance} />}
        </article>)}
      </div>}
    </section>}
    {savedChartItems.length === 0 && showChartBuilder && indicators.length > 0 && <section className="chart-controls card" aria-label="添加图表设置">
      <div className="chart-explorer-heading"><strong>添加图表</strong><small>选择模式、指标和默认范围</small></div>
      <div className="chart-controls-toolbar">
        <div className="segmented" role="tablist" aria-label="图表模式">
          <button type="button" role="tab" aria-selected={mode === 'trend'} className={mode === 'trend' ? 'active' : ''} onClick={() => setMode('trend')}>实际日期趋势</button>
          <button type="button" role="tab" aria-selected={mode === 'cycle'} className={mode === 'cycle' ? 'active' : ''} onClick={() => setMode('cycle')}>化疗周期叠加</button>
        </div>
      </div>
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
    </section>}
    {showChartBuilder && <section className="chart-card card">
      {indicators.length > 0 && <div className="chart-card-header">
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
            aria-label={currentPin ? '当前图表已收藏' : '添加当前图表到收藏'}
            aria-pressed={Boolean(currentPin)}
            title={currentPin ? '当前图表已收藏' : '添加当前图表到收藏'}
            disabled={!currentCode || Boolean(currentPin)}
            onClick={() => void pinCurrent()}
          >
            {currentPin ? <BookmarkCheck /> : <Bookmark />}
          </button>
        </div>
      </div>}
      {indicators.length === 0
        ? <div className="empty-state"><ChartNoAxesCombined /><h3>还没有可绘制的指标</h3><p>导入含数值指标的检查报告后，趋势图会自动出现。</p><a className="button primary" href="#/import"><FileUp />导入检查报告</a></div>
        : mode === 'cycle' && chemotherapyCycles.length === 0
          ? <div className="empty-state"><RotateCcw /><h3>还没有化疗周期</h3><p>先在病程日历中创建化疗事件并设置 Day 1。</p><a className="button primary" href="#/calendar"><CalendarPlus />创建化疗事件</a></div>
          : <TimeSeriesChart option={mode === 'trend' ? trendOption : cycleOption} onReady={registerChartInstance} />}
    </section>}
  </>
}
