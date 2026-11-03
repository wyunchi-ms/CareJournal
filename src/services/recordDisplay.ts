import { normalizeReportType } from '../data/reportTypeAliases'
import type { AbnormalFlag, ExamRecord, LabIndicator } from '../types'
import { cleanReportResult } from './indicatorNames'

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

export function stripReferenceUnit(reference: string, unit: string) {
  const text = reference.trim()
  if (!unit.trim()) return text
  const escaped = unit.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[µμ]/g, '[µμ]')
  return text.replace(new RegExp(`(?:\\s*[（(]\\s*${escaped}\\s*[）)]|(?<![\\p{L}/])\\s*${escaped})\\s*$`, 'u'), '').trim()
}

export function referenceRangeText(indicator: LabIndicator) {
  const text = stripReferenceUnit(indicator.referenceText, indicator.unit)
  if (text) return text
  if (indicator.referenceLow !== null && indicator.referenceHigh !== null) return `${indicator.referenceLow}–${indicator.referenceHigh}`
  if (indicator.referenceLow !== null) return `≥${indicator.referenceLow}`
  if (indicator.referenceHigh !== null) return `≤${indicator.referenceHigh}`
  return ''
}

export function resultText(indicator: LabIndicator) {
  let result = indicator.rawValue.trim()
  if (indicator.unit) {
    const escapedUnit = indicator.unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(new RegExp(escapedUnit, 'gi'), '')
  }
  result = cleanReportResult(result)
  return result || String(indicator.value ?? '—')
}
