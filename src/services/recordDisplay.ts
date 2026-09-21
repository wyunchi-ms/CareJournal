import { normalizeReportType } from '../data/reportTypeAliases'
import type { AbnormalFlag, ExamRecord, LabIndicator } from '../types'

export function recordDisplayType(record: ExamRecord) {
  return record.normalizedReportType || normalizeReportType(record.reportType).label
}

export function indicatorRangeFlag(indicator: LabIndicator): AbnormalFlag {
  if (indicator.abnormalFlag === 'critical') return 'critical'
  if (indicator.value !== null) {
    if (indicator.referenceLow !== null && indicator.value < indicator.referenceLow) return 'low'
    if (indicator.referenceHigh !== null && indicator.value > indicator.referenceHigh) return 'high'
    if (indicator.referenceLow !== null && indicator.referenceHigh !== null) return 'normal'
  }
  return indicator.abnormalFlag
}

export function flagLabel(flag: AbnormalFlag) {
  if (flag === 'high') return '偏高'
  if (flag === 'low') return '偏低'
  if (flag === 'critical') return '危急'
  if (flag === 'normal') return '正常'
  return ''
}

export function resultText(indicator: LabIndicator) {
  let result = indicator.rawValue.trim()
  if (indicator.unit) {
    const escapedUnit = indicator.unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(new RegExp(escapedUnit, 'gi'), '')
  }
  result = result.replace(/[↑↓↗↘▲▼]/g, '').replace(/\s+[HL]$/i, '').trim()
  return result || String(indicator.value ?? '—')
}
