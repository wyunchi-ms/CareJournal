import type { BodyMeasurements, ExamRecord, TreatmentEvent } from '../types'

type BodyMetricKey = keyof BodyMeasurements

export interface ChartMetricMeta {
  code: string
  name: string
  unit: string
  count: number
  source: 'exam' | 'body'
  decimals?: number
}

export type ChartMetricPoint = {
  date: string
  value: number
} & ({
  source: 'exam'
  record: ExamRecord
} | {
  source: 'body'
  event: TreatmentEvent
})

export const BODY_CHART_METRICS: ReadonlyArray<ChartMetricMeta & { key: BodyMetricKey }> = [
  { code: 'BODY_HEIGHT_CM', key: 'heightCm', name: '身高', unit: 'cm', count: 0, source: 'body', decimals: 1 },
  { code: 'BODY_WEIGHT_KG', key: 'weightKg', name: '体重', unit: 'kg', count: 0, source: 'body', decimals: 2 },
  { code: 'BODY_TEMPERATURE_C', key: 'temperatureC', name: '体温', unit: '℃', count: 0, source: 'body', decimals: 1 },
  { code: 'BODY_SYSTOLIC_BP', key: 'systolicBp', name: '收缩压', unit: 'mmHg', count: 0, source: 'body', decimals: 0 },
  { code: 'BODY_DIASTOLIC_BP', key: 'diastolicBp', name: '舒张压', unit: 'mmHg', count: 0, source: 'body', decimals: 0 },
  { code: 'BODY_HEART_RATE', key: 'heartRateBpm', name: '心率', unit: '次/分', count: 0, source: 'body', decimals: 0 },
  { code: 'BODY_OXYGEN_SATURATION', key: 'oxygenSaturationPercent', name: '血氧', unit: '%', count: 0, source: 'body', decimals: 1 },
]

const bodyMetricByCode = new Map(BODY_CHART_METRICS.map((metric) => [metric.code, metric]))
const hasChartDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)

export function getBodyChartMetric(code: string) {
  return bodyMetricByCode.get(code)
}

export function collectChartMetrics(records: ExamRecord[], events: TreatmentEvent[]) {
  const map = new Map<string, ChartMetricMeta>()
  records.flatMap((record) => record.indicators).filter((item) => item.value !== null).forEach((item) => {
    const current = map.get(item.normalizedCode)
    map.set(item.normalizedCode, {
      code: item.normalizedCode,
      name: item.normalizedName,
      unit: item.unit || current?.unit || '',
      count: (current?.count ?? 0) + 1,
      source: 'exam',
    })
  })

  BODY_CHART_METRICS.forEach((metric) => {
    const count = events.filter((event) => (
      event.type === 'bodyMeasurement'
      && hasChartDate(event.startDate)
      && typeof event.bodyMeasurements?.[metric.key] === 'number'
      && Number.isFinite(event.bodyMeasurements[metric.key])
    )).length
    if (count > 0) map.set(metric.code, { ...metric, count })
  })

  return [...map.values()]
}

export function chartMetricPoints(records: ExamRecord[], events: TreatmentEvent[], code: string): ChartMetricPoint[] {
  const bodyMetric = getBodyChartMetric(code)
  if (bodyMetric) {
    return events.flatMap((event): ChartMetricPoint[] => {
      const value = event.bodyMeasurements?.[bodyMetric.key]
      if (event.type !== 'bodyMeasurement' || !hasChartDate(event.startDate) || typeof value !== 'number' || !Number.isFinite(value)) return []
      return [{ date: event.startDate, value, source: 'body', event }]
    }).sort((first, second) => first.date.localeCompare(second.date))
  }

  return records.filter((record) => hasChartDate(record.sampleDate)).flatMap((record): ChartMetricPoint[] => (
    record.indicators
      .filter((indicator) => indicator.normalizedCode === code && indicator.value !== null)
      .map((indicator) => ({ date: record.sampleDate, value: indicator.value as number, source: 'exam', record }))
  )).sort((first, second) => first.date.localeCompare(second.date))
}

export function formatChartMetricValue(code: string, value: number) {
  const decimals = getBodyChartMetric(code)?.decimals
  return decimals === undefined ? String(value) : value.toFixed(decimals)
}
