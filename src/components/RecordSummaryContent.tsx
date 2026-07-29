import { ChevronRight } from 'lucide-react'
import { recordDisplayType } from '../services/recordDisplay'
import type { ExamRecord } from '../types'

export function RecordSummaryContent({ record, showDate = false }: { record: ExamRecord; showDate?: boolean }) {
  const abnormalCount = record.indicators.filter((item) => ['high', 'low', 'critical'].includes(item.abnormalFlag)).length
  const metadata = [
    showDate ? record.sampleDate || '日期未识别' : '',
    record.hospital || '医院未记录',
    `${record.indicators.length} 项指标`,
  ].filter(Boolean).join(' · ')

  return <>
    <span className="record-main">
      <strong>{recordDisplayType(record)}</strong>
      <small>{metadata}</small>
    </span>
    {abnormalCount > 0 && <span className="abnormal-badge">{abnormalCount} 项异常</span>}
    <ChevronRight aria-hidden="true" />
  </>
}
