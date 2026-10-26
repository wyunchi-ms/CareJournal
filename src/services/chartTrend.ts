import { differenceInCalendarDays, format, parseISO, subMonths } from 'date-fns'
import type { ChartIndicatorOption } from './chartIndicators'
import { chartMetricPoints, formatChartMetricValue, getBodyChartMetric } from './chartMetrics'
import { EVENT_TYPES, type ExamRecord, type TreatmentEvent } from '../types'

export type TrendRange = '3m' | '6m' | '1y' | 'all'

export const trendRangeOptions: Array<{ value: TrendRange; label: string; months: number | null }> = [
  { value: '3m', label: '3个月', months: 3 },
  { value: '6m', label: '6个月', months: 6 },
  { value: '1y', label: '1年', months: 12 },
  { value: 'all', label: '全部', months: null },
]

export function formatTooltipValue(code: string, unit: string, value: unknown) {
  const rawValue = Array.isArray(value) ? value.at(-1) : value
  const numericValue = Number(rawValue)
  const label = Number.isFinite(numericValue) ? formatChartMetricValue(code, numericValue) : String(rawValue ?? '')
  return `${label}${unit ? ` ${unit}` : ''}`
}

export function bodyMetricAxisLabel(code: string) {
  return getBodyChartMetric(code)
    ? { formatter: (value: number) => formatChartMetricValue(code, Number(value)) }
    : {}
}

export function buildTrendOption(
  records: ExamRecord[],
  events: TreatmentEvent[],
  code: string,
  meta: ChartIndicatorOption | undefined,
  showEventMarkers: boolean,
  range: TrendRange = 'all',
) {
  const points = code ? chartMetricPoints(records, events, code) : []
  const data = points.map((point) => [point.date, point.value])
  const firstDate = points[0]?.date
  const lastDate = points.at(-1)?.date
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
    color: ['#0891b2', '#7a5af8', '#e45756', '#f59e0b', '#16a34a', '#2563eb'],
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
    yAxis: { type: 'value', name: meta?.unit ?? '', scale: true, axisLabel: bodyMetricAxisLabel(code), splitLine: { lineStyle: { color: '#dbe6e9' } } },
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
      tooltip: getBodyChartMetric(code) ? { valueFormatter: (value: unknown) => formatTooltipValue(code, meta?.unit ?? '', value) } : undefined,
      markLine: showEventMarkers ? { silent: true, data: events.filter((event) => ['chemotherapy', 'surgery', 'hospitalization'].includes(event.type)).map((event) => ({ xAxis: event.startDate, label: { formatter: event.title, position: 'insideEndTop' }, lineStyle: { color: EVENT_TYPES[event.type].color, opacity: 0.45, type: 'dashed' } })) } : undefined,
    }] : [],
  }
}
