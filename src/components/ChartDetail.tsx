import type { EChartsType } from 'echarts'
import ReactECharts from 'echarts-for-react'
import { ArrowDown, ArrowUp, ChartNoAxesCombined } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { chartMetricPoints, formatChartMetricValue, getBodyChartMetric, type ChartMetricPoint } from '../services/chartMetrics'
import { buildTrendOption, trendRangeOptions, type TrendRange } from '../services/chartTrend'
import { flagLabel, indicatorRangeFlag, resultText } from '../services/recordDisplay'
import { useApp } from '../store/AppContext'
import type { ExamRecord, LabIndicator } from '../types'
import { Modal } from './Modal'

export function TimeSeriesChart({ option, compact = false, height, onReady }: { option: object; compact?: boolean; height?: number; onReady?: (instance: EChartsType) => void }) {
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

export function TrendRangePicker({ value, onChange }: { value: TrendRange; onChange: (range: TrendRange) => void }) {
  return <div className="chart-detail-range">
    <div>
      <strong>时间范围</strong>
      <div className="chart-range-options" role="group" aria-label="图表时间范围">
        {trendRangeOptions.map((option) => <button
          type="button"
          className={value === option.value ? 'active' : ''}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          key={option.value}
        >{option.label}</button>)}
      </div>
    </div>
    <small>左右拖动图表平移，拖动下方手柄或双指精细缩放</small>
  </div>
}

export function ChartSourceList({ sources, code, onOpen, onOpenRecord, origin = '/charts' }: {
  sources: ChartMetricPoint[]
  code: string
  onOpen: () => void
  onOpenRecord?: (record: ExamRecord) => void
  origin?: string | null
}) {
  const headingId = useId()
  const isBodyMetric = Boolean(getBodyChartMetric(code))
  return <section className="chart-detail-records" aria-labelledby={headingId}>
    <div className="chart-detail-section-heading">
      <div>
        <h3 id={headingId}>{isBodyMetric ? '相关身体记录' : '相关检查报告'}</h3>
        <small>{isBodyMetric ? '仅显示当前图表实际使用的身体测量记录' : '仅显示当前图表实际使用的数值报告'}</small>
      </div>
      <span>{sources.length} {isBodyMetric ? '条' : '份'}</span>
    </div>
    <div className="chart-report-list">
      {sources.map((source) => {
        const isExam = source.source === 'exam'
        const flag = isExam ? indicatorRangeFlag(source.indicator) : 'unknown'
        const direction = isExam && flag === 'critical'
          ? indicatorRangeFlag({ ...source.indicator, abnormalFlag: 'unknown' })
          : flag
        const DirectionIcon = direction === 'high' ? ArrowUp : direction === 'low' ? ArrowDown : null
        const value = isExam ? resultText(source.indicator) : formatChartMetricValue(code, source.value)
        const sourceId = isExam ? `exam-${source.record.id}-${source.indicator.id}` : `body-${source.event.id}`
        const valueId = `${headingId}-chart-source-value-${sourceId}`
        return <Link
          className="chart-report-row"
          to={isExam ? `/records?recordId=${encodeURIComponent(source.record.id)}` : `/calendar?date=${encodeURIComponent(source.date)}`}
          state={isExam && origin ? { recordDetailOrigin: origin } : undefined}
          onClick={(event) => {
            if (isExam && onOpenRecord) {
              event.preventDefault()
              onOpenRecord(source.record)
            }
            onOpen()
          }}
          aria-label={`打开相关${isExam ? '检查报告' : '身体记录'}：${source.date}`}
          aria-describedby={valueId}
          key={sourceId}
        >
          <time className="chart-report-date" dateTime={source.date}>{source.date}</time>
          <span className={`chart-report-value ${flag}`} id={valueId} title={flagLabel(flag) || undefined}>
            <span>{value}</span>
            {DirectionIcon && <DirectionIcon aria-hidden="true" />}
            {flagLabel(flag) && <span className="sr-only">，{flagLabel(flag)}</span>}
          </span>
        </Link>
      })}
      {sources.length === 0 && <div className="empty-inline"><ChartNoAxesCombined /><strong>{isBodyMetric ? '没有相关身体记录' : '没有相关数值报告'}</strong><p>当前没有可绘制的数值数据。</p></div>}
    </div>
  </section>
}

export function IndicatorTrendDetail({ indicator, onClose, onOpenRecord }: {
  indicator: LabIndicator
  onClose: () => void
  onOpenRecord: (record: ExamRecord) => void
}) {
  const { records, events } = useApp()
  const [range, setRange] = useState<TrendRange>('6m')
  const chartRef = useRef<EChartsType | null>(null)
  const code = indicator.normalizedCode
  const title = `${indicator.normalizedName}趋势`
  const sources = [...chartMetricPoints(records, events, code)].reverse()
  const option = buildTrendOption(records, events, code, {
    code, name: indicator.normalizedName, unit: indicator.unit, count: sources.length,
  }, false, range)

  useEffect(() => {
    const hide = () => {
      const chart = chartRef.current
      if (chart && !chart.isDisposed()) chart.dispatchAction({ type: 'hideTip' })
    }
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])

  return <Modal title={title} onClose={onClose} wide>
    <div className="chart-detail">
      <TrendRangePicker value={range} onChange={setRange} />
      <section className="chart-detail-visual" aria-label={`${title}图表`}>
        <TimeSeriesChart option={option} height={400} onReady={(instance) => { chartRef.current = instance }} />
      </section>
      <ChartSourceList sources={sources} code={code} onOpen={onClose} onOpenRecord={onOpenRecord} origin={null} />
    </div>
  </Modal>
}
