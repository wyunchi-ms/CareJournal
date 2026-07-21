import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import ReactECharts from 'echarts-for-react'
import { ChartNoAxesCombined, Pin, PinOff, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { useApp } from '../store/AppContext'
import { EVENT_TYPES, newId, type ChartPin } from '../types'

const seriesColors = ['#0891b2', '#7a5af8', '#e45756', '#f59e0b', '#16a34a', '#2563eb']

export function ChartsPage() {
  const { records, events, pins, savePin, deletePin } = useApp()
  const indicators = useMemo(() => {
    const map = new Map<string, { code: string; name: string; unit: string }>()
    records.flatMap((record) => record.indicators).forEach((item) => map.set(item.normalizedCode, { code: item.normalizedCode, name: item.normalizedName, unit: item.unit }))
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  }, [records])
  const chemoEvents = useMemo(() => events.filter((event) => event.type === 'chemotherapy').sort((a, b) => a.startDate.localeCompare(b.startDate)), [events])
  const [mode, setMode] = useState<'trend' | 'cycle'>('trend')
  const [selectedCodes, setSelectedCodes] = useState<string[]>([])
  const [selectedCycles, setSelectedCycles] = useState<string[]>([])

  const currentCodes = selectedCodes.length ? selectedCodes : indicators.slice(0, 1).map((item) => item.code)
  const currentCycles = selectedCycles.length ? selectedCycles : chemoEvents.map((event) => event.id)

  const trendOption = useMemo(() => ({
    color: seriesColors,
    tooltip: { trigger: 'axis' },
    legend: { top: 0, type: 'scroll' },
    grid: { left: 48, right: 28, top: 52, bottom: 62 },
    xAxis: { type: 'time', axisLabel: { formatter: (value: number) => format(new Date(value), 'MM-dd') } },
    yAxis: { type: 'value', scale: true, splitLine: { lineStyle: { color: '#dbe6e9' } } },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 20, bottom: 14 }],
    series: currentCodes.map((code) => {
      const meta = indicators.find((item) => item.code === code)
      const data = records.flatMap((record) => record.indicators.filter((item) => item.normalizedCode === code && item.value !== null).map((item) => ({ value: [record.examDate, item.value], record, item }))).sort((a, b) => String(a.value[0]).localeCompare(String(b.value[0])))
      return { name: `${meta?.name ?? code}${meta?.unit ? ` (${meta.unit})` : ''}`, type: 'line', smooth: false, connectNulls: false, symbolSize: 8, data, markLine: { silent: true, data: events.filter((event) => ['chemotherapy', 'surgery', 'hospitalization'].includes(event.type)).map((event) => ({ xAxis: event.startDate, label: { formatter: event.title, position: 'insideEndTop' }, lineStyle: { color: EVENT_TYPES[event.type].color, opacity: 0.45, type: 'dashed' } })) } }
    }),
  }), [currentCodes, indicators, records, events])

  const cycleOption = useMemo(() => {
    const code = currentCodes[0]
    const meta = indicators.find((item) => item.code === code)
    return {
      color: seriesColors,
      tooltip: { trigger: 'axis' },
      legend: { top: 0, type: 'scroll' },
      grid: { left: 48, right: 28, top: 52, bottom: 48 },
      xAxis: { type: 'value', name: '相对 Day 1（天）', minInterval: 1, axisLabel: { formatter: (value: number) => value === 0 ? 'D1' : value > 0 ? `D+${value}` : `D${value}` } },
      yAxis: { type: 'value', name: meta?.unit ?? '', scale: true, splitLine: { lineStyle: { color: '#dbe6e9' } } },
      series: chemoEvents.filter((event) => currentCycles.includes(event.id)).map((event, index) => {
        const dayOne = parseISO(event.cycleDayOne || event.startDate)
        const nextCycle = chemoEvents[index + 1]
        const maxDay = nextCycle ? differenceInCalendarDays(parseISO(nextCycle.cycleDayOne || nextCycle.startDate), dayOne) - 1 : 42
        const data = records.flatMap((record) => record.indicators.filter((item) => item.normalizedCode === code && item.value !== null).map((item) => ({ day: differenceInCalendarDays(parseISO(record.examDate), dayOne), value: item.value }))).filter((item) => item.day >= -3 && item.day <= maxDay).sort((a, b) => a.day - b.day).map((item) => [item.day, item.value])
        const values = data.map((item) => item[1] as number)
        const min = values.length ? Math.min(...values) : null
        return { name: event.cycleNumber ? `第 ${event.cycleNumber} 周期` : event.title, type: 'line', symbolSize: 8, data, markPoint: min === null ? undefined : { symbolSize: 42, data: [{ type: 'min', name: '最低点' }] } }
      }),
    }
  }, [currentCodes, currentCycles, chemoEvents, indicators, records])

  async function pinCurrent() {
    if (!currentCodes.length) return
    const title = mode === 'trend' ? `${currentCodes.map((code) => indicators.find((item) => item.code === code)?.name ?? code).join('、')}趋势` : `${indicators.find((item) => item.code === currentCodes[0])?.name ?? currentCodes[0]}周期对比`
    const pin: ChartPin = { id: newId(), title, mode, indicatorCodes: currentCodes, cycleEventIds: mode === 'cycle' ? currentCycles : [], createdAt: new Date().toISOString() }
    await savePin(pin)
  }

  function applyPin(pin: ChartPin) { setMode(pin.mode); setSelectedCodes(pin.indicatorCodes); setSelectedCycles(pin.cycleEventIds) }

  return <>
    <PageHeader eyebrow="纵向数据" title="指标图表" description="观察指标走势，或按化疗 Day 1 对齐多个周期。" actions={<button className="button secondary" disabled={!currentCodes.length} onClick={() => void pinCurrent()}><Pin />固定当前图表</button>} />
    {pins.length > 0 && <section className="pinned-strip"><span>已固定</span>{pins.map((pin) => <div className="pin-chip" key={pin.id}><button onClick={() => applyPin(pin)}>{pin.title}</button><button aria-label={`取消固定 ${pin.title}`} onClick={() => void deletePin(pin.id)}><PinOff /></button></div>)}</section>}
    <section className="chart-controls card">
      <div className="segmented" role="group" aria-label="图表模式"><button className={mode === 'trend' ? 'active' : ''} onClick={() => setMode('trend')}>实际日期趋势</button><button className={mode === 'cycle' ? 'active' : ''} onClick={() => setMode('cycle')}>化疗周期叠加</button></div>
      <div className="control-groups">
        <fieldset><legend>{mode === 'trend' ? '选择指标（可多选）' : '选择一个指标'}</legend><div className="choice-chips">{indicators.map((item) => { const active = currentCodes.includes(item.code); return <button key={item.code} className={active ? 'active' : ''} onClick={() => setSelectedCodes((current) => mode === 'cycle' ? [item.code] : current.includes(item.code) ? current.filter((code) => code !== item.code) : [...current, item.code])}>{item.name}</button> })}</div></fieldset>
        {mode === 'cycle' && <fieldset><legend>叠加周期</legend><div className="choice-chips">{chemoEvents.map((event) => { const active = currentCycles.includes(event.id); return <button key={event.id} className={active ? 'active' : ''} onClick={() => setSelectedCycles((current) => current.includes(event.id) ? current.filter((id) => id !== event.id) : [...current, event.id])}>{event.cycleNumber ? `第 ${event.cycleNumber} 周期` : event.title}<small>{event.cycleDayOne || event.startDate}</small></button> })}</div></fieldset>}
      </div>
    </section>
    <section className="chart-card card">
      {indicators.length === 0 ? <div className="empty-state"><ChartNoAxesCombined /><h3>还没有可绘制的指标</h3><p>导入含数值指标的检查报告后，趋势图会自动出现。</p></div> : mode === 'cycle' && chemoEvents.length === 0 ? <div className="empty-state"><RotateCcw /><h3>还没有化疗周期</h3><p>先在病程日历中创建化疗事件并设置 Day 1。</p></div> : <ReactECharts option={mode === 'trend' ? trendOption : cycleOption} style={{ height: 460 }} notMerge />}
    </section>
  </>
}
